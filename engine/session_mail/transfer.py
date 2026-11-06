"""Import and export: .eml, .mbox (Thunderbird / Apple Mail / Gmail Takeout), .zip of .eml, and JSON backups."""

from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from datetime import datetime, timezone
from email import policy
from email.generator import BytesGenerator
from email.message import EmailMessage
from email.utils import format_datetime, formataddr

from sqlalchemy import select
from sqlalchemy.orm import Session

from session_mail.audit import record
from session_mail.db import current_settings, session_scope
from session_mail.mail.errors import MailError
from session_mail.mail.parse import parse_message
from session_mail.mail.store import ensure_local_folders, folder_by_role, upsert_parsed
from session_mail.models import (
    Account,
    AllowEntry,
    Attachment,
    BlockEntry,
    Folder,
    Label,
    MailSession,
    Message,
    MessageLabel,
    Rule,
)

BACKUP_VERSION = 2
_SAFE = re.compile(r"[^\w.-]+")


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def _loads(raw: str, fallback):
    try:
        return json.loads(raw or "")
    except json.JSONDecodeError:
        return fallback


def _addr_list(raw: str) -> str:
    items = _loads(raw, [])
    return ", ".join(formataddr((item.get("name", ""), item.get("email", ""))) for item in items if isinstance(item, dict))


def rebuild_message(db: Session, row: Message, account: Account) -> EmailMessage:
    """Recreate an RFC 5322 message from what the local store keeps."""
    message = EmailMessage()
    message["From"] = formataddr((row.from_name or "", row.from_email or ""))
    to_text = _addr_list(row.to_json)
    if to_text:
        message["To"] = to_text
    cc_text = _addr_list(row.cc_json)
    if cc_text:
        message["Cc"] = cc_text
    message["Subject"] = row.subject or ""
    if row.date:
        when = row.date if row.date.tzinfo else row.date.replace(tzinfo=timezone.utc)
        message["Date"] = format_datetime(when)
    if row.message_id:
        message["Message-ID"] = row.message_id
    if row.in_reply_to:
        message["In-Reply-To"] = row.in_reply_to
    refs = _loads(row.references_json, [])
    if refs:
        message["References"] = " ".join(refs)
    message["X-Session-Account"] = account.email
    message["Status"] = "RO" if row.seen else "O"
    if row.flagged:
        message["X-Session-Flagged"] = "1"
    message.set_content(row.body_text or row.snippet or "")
    if row.body_html:
        message.add_alternative(row.body_html, subtype="html")
    root = current_settings().attachment_dir
    for item in db.scalars(select(Attachment).where(Attachment.message_id == row.id)).all():
        if not item.storage_name:
            continue
        path = root / item.storage_name
        if not path.exists():
            continue
        maintype, _, subtype = (item.content_type or "application/octet-stream").partition("/")
        message.add_attachment(path.read_bytes(), maintype=maintype or "application", subtype=subtype or "octet-stream", filename=item.filename)
    return message


def _scope_rows(db: Session, session_id: int | None, account_id: int | None, folder_role: str | None):
    stmt = select(Message, Account, Folder).join(Account, Account.id == Message.account_id).join(Folder, Folder.id == Message.folder_id)
    if session_id is not None:
        stmt = stmt.where(Account.session_id == session_id)
    if account_id is not None:
        stmt = stmt.where(Account.id == account_id)
    if folder_role:
        stmt = stmt.where(Folder.role == folder_role)
    return db.execute(stmt.order_by(Message.date, Message.id)).all()


def _bytes(message: EmailMessage) -> bytes:
    buffer = io.BytesIO()
    BytesGenerator(buffer, mangle_from_=True, policy=policy.SMTP).flatten(message)
    return buffer.getvalue()


def export_mbox(session_id: int | None, account_id: int | None, folder_role: str | None) -> tuple[bytes, str, str]:
    out = io.BytesIO()
    with session_scope() as db:
        rows = _scope_rows(db, session_id, account_id, folder_role)
        for row, account, _folder in rows:
            when = row.date or datetime.now(timezone.utc)
            sender = row.from_email or "MAILER-DAEMON"
            out.write(f"From {sender} {when.strftime('%a %b %d %H:%M:%S %Y')}\r\n".encode("utf-8"))
            out.write(_bytes(rebuild_message(db, row, account)))
            out.write(b"\r\n")
        record(db, "data.export", session_id=session_id, account_id=account_id, target="mbox", detail={"messages": len(rows), "folder": folder_role or "all"})
    return out.getvalue(), f"session-mail-{_stamp()}.mbox", "application/mbox"


def export_eml_zip(session_id: int | None, account_id: int | None, folder_role: str | None) -> tuple[bytes, str, str]:
    out = io.BytesIO()
    with session_scope() as db:
        rows = _scope_rows(db, session_id, account_id, folder_role)
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
            for row, account, folder in rows:
                name = _SAFE.sub("_", (row.subject or "message"))[:60] or "message"
                path = f"{_SAFE.sub('_', account.email)}/{_SAFE.sub('_', folder.role)}/{row.id}-{name}.eml"
                archive.writestr(path, _bytes(rebuild_message(db, row, account)))
        record(db, "data.export", session_id=session_id, account_id=account_id, target="eml-zip", detail={"messages": len(rows)})
    return out.getvalue(), f"session-mail-{_stamp()}.zip", "application/zip"


def export_eml(message_id: int) -> tuple[bytes, str, str]:
    with session_scope() as db:
        row = db.get(Message, message_id)
        if row is None:
            raise MailError("That message is gone.")
        account = db.get(Account, row.account_id)
        if account is None:
            raise MailError("That message is gone.")
        data = _bytes(rebuild_message(db, row, account))
        record(db, "message.export", session_id=account.session_id, account_id=account.id, target=row.subject or "", detail={"message_id": row.id})
        name = _SAFE.sub("_", row.subject or "message")[:60] or "message"
    return data, f"{name}.eml", "message/rfc822"


def export_contacts(session_id: int) -> tuple[bytes, str, str]:
    from session_mail.features import contacts

    rows = contacts(session_id, "", 100_000)["contacts"]
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["Name", "Email", "Messages", "Last seen"])
    for row in rows:
        writer.writerow([row["name"], row["email"], row["count"], row["last"] or ""])
    with session_scope() as db:
        record(db, "data.export", session_id=session_id, target="contacts-csv", detail={"contacts": len(rows)})
    return buffer.getvalue().encode("utf-8-sig"), f"session-contacts-{_stamp()}.csv", "text/csv"


def export_backup(session_id: int | None) -> tuple[bytes, str, str]:
    with session_scope() as db:
        sessions = db.scalars(select(MailSession).order_by(MailSession.sort_order)).all()
        if session_id is not None:
            sessions = [row for row in sessions if row.id == session_id]
        payload: dict = {"app": "Session", "version": BACKUP_VERSION, "exported_at": _stamp(), "sessions": []}
        count = 0
        for session in sessions:
            labels = db.scalars(select(Label).where(Label.session_id == session.id)).all()
            label_names = {row.id: row.name for row in labels}
            accounts = db.scalars(select(Account).where(Account.session_id == session.id)).all()
            entry = {
                "name": session.name,
                "color": session.color,
                "labels": [{"name": row.name, "color": row.color} for row in labels],
                "rules": [
                    {"name": row.name, "enabled": row.enabled, "match": row.match, "conditions": _loads(row.conditions_json, []), "actions": _loads(row.actions_json, []), "stop": row.stop}
                    for row in db.scalars(select(Rule).where(Rule.session_id == session.id)).all()
                ],
                "blocklist": [row.value for row in db.scalars(select(BlockEntry).where(BlockEntry.session_id == session.id)).all()],
                "allowlist": [row.value for row in db.scalars(select(AllowEntry).where(AllowEntry.session_id == session.id)).all()],
                "accounts": [],
            }
            for account in accounts:
                messages = []
                for row, _account, folder in _scope_rows(db, None, account.id, None):
                    tags = db.scalars(select(MessageLabel.label_id).where(MessageLabel.message_id == row.id)).all()
                    messages.append(
                        {
                            "folder_role": folder.role,
                            "folder": folder.imap_name,
                            "message_id": row.message_id,
                            "subject": row.subject,
                            "from_name": row.from_name,
                            "from_email": row.from_email,
                            "to": _loads(row.to_json, []),
                            "cc": _loads(row.cc_json, []),
                            "date": row.date.isoformat() if row.date else None,
                            "body_text": row.body_text,
                            "body_html": row.body_html,
                            "seen": row.seen,
                            "flagged": row.flagged,
                            "in_reply_to": row.in_reply_to,
                            "references": _loads(row.references_json, []),
                            "labels": [label_names[item] for item in tags if item in label_names],
                        }
                    )
                count += len(messages)
                entry["accounts"].append(
                    {
                        "email": account.email,
                        "display_name": account.display_name,
                        "provider": account.provider,
                        "color": account.color,
                        "signature": account.signature,
                        "messages": messages,
                    }
                )
            payload["sessions"].append(entry)
        record(db, "data.export", session_id=session_id, target="json-backup", detail={"messages": count})
    body = json.dumps(payload, ensure_ascii=False, indent=1, default=str)
    return body.encode("utf-8"), f"session-backup-{_stamp()}.json", "application/json"


def split_mbox(data: bytes) -> list[bytes]:
    messages: list[bytes] = []
    current: list[bytes] = []
    previous_blank = True
    for line in data.splitlines(keepends=True):
        if line.startswith(b"From ") and previous_blank:
            if current:
                messages.append(b"".join(current))
            current = []
            previous_blank = False
            continue
        if line.startswith(b">From "):
            line = line[1:]
        current.append(line)
        previous_blank = line.strip() == b""
    if current and b"".join(current).strip():
        messages.append(b"".join(current))
    return messages


def _target_folder(db: Session, account: Account, role: str) -> Folder:
    if account.auth_type == "local":
        ensure_local_folders(db, account.id)
    folder = folder_by_role(db, account.id, role)
    if folder is None:
        names = {"inbox": "INBOX", "archive": "Archive", "sent": "Sent", "trash": "Trash", "spam": "Junk", "drafts": "Drafts"}
        folder = Folder(account_id=account.id, imap_name=names.get(role, "Imported"), role=role)
        db.add(folder)
        db.flush()
    return folder


def _store_raw(db: Session, account: Account, folder: Folder, raw: bytes) -> bool:
    parsed = parse_message(raw, full=True)
    if not (parsed.subject or parsed.from_email or parsed.text or parsed.html):
        return False
    header_end = raw.find(b"\r\n\r\n")
    if header_end < 0:
        header_end = raw.find(b"\n\n")
    head = raw[: header_end if header_end > 0 else 4000].lower()
    status = re.search(rb"^status:\s*(\w+)", head, re.MULTILINE)
    parsed.seen = True if status is None else b"r" in status.group(1)
    parsed.flagged = b"x-session-flagged: 1" in head
    row = upsert_parsed(db, account.id, folder.id, -1_000_000_000, parsed)
    if row.uid <= 0:
        row.uid = -row.id
    return True


def import_files(account_id: int, folder_role: str, files: list[tuple[str, bytes]], upload: bool = False) -> dict:
    if folder_role not in {"inbox", "archive", "sent", "trash", "spam", "drafts"}:
        raise MailError("Choose a folder to import into.")
    imported = 0
    skipped = 0
    raws: list[bytes] = []
    for name, data in files:
        lower = name.lower()
        if lower.endswith(".json"):
            raise MailError("JSON backups are restored with Restore backup, not Import mail.")
        if lower.endswith(".zip"):
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                for member in archive.namelist():
                    if member.lower().endswith(".eml"):
                        raws.append(archive.read(member))
            continue
        if lower.endswith((".mbox", ".mbx")) or data.startswith(b"From "):
            raws.extend(split_mbox(data))
            continue
        raws.append(data)
    with session_scope() as db:
        account = db.get(Account, account_id)
        if account is None:
            raise MailError("Choose an account to import into.")
        folder = _target_folder(db, account, folder_role)
        folder_name = folder.imap_name
        for raw in raws:
            try:
                if _store_raw(db, account, folder, raw):
                    imported += 1
                else:
                    skipped += 1
            except Exception:
                skipped += 1
        record(db, "data.import", session_id=account.session_id, account_id=account.id, target=f"{len(files)} file(s)", detail={"imported": imported, "skipped": skipped, "folder": folder_role})
        auth = account.auth_type
    uploaded = 0
    if upload and auth != "local" and raws:
        from session_mail.mail.imap_client import append_raw, connect_account, logout
        from session_mail.secrets import secret_get

        with session_scope() as db:
            account = db.get(Account, account_id)
        client = connect_account(account, secret_get(f"account:{account_id}") or {})
        try:
            for raw in raws:
                try:
                    append_raw(client, folder_name, raw)
                    uploaded += 1
                except Exception:
                    continue
        finally:
            logout(client)
    return {"imported": imported, "skipped": skipped, "uploaded": uploaded}


def restore_backup(data: bytes) -> dict:
    try:
        payload = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise MailError("That file is not a Session backup.") from exc
    if not isinstance(payload, dict) or payload.get("app") != "Session":
        raise MailError("That file is not a Session backup.")
    summary = {"sessions": 0, "labels": 0, "rules": 0, "messages": 0, "skipped_accounts": []}
    with session_scope() as db:
        for entry in payload.get("sessions", []):
            name = str(entry.get("name") or "Imported").strip()[:120]
            session = db.scalar(select(MailSession).where(MailSession.name == name))
            if session is None:
                count = len(db.scalars(select(MailSession)).all())
                session = MailSession(name=name, color=entry.get("color") or "#4f46e5", sort_order=count)
                db.add(session)
                db.flush()
                summary["sessions"] += 1
            labels: dict[str, Label] = {row.name.lower(): row for row in db.scalars(select(Label).where(Label.session_id == session.id)).all()}
            for item in entry.get("labels", []):
                key = str(item.get("name", "")).strip()
                if key and key.lower() not in labels:
                    row = Label(session_id=session.id, name=key[:80], color=item.get("color") or "#6366f1")
                    db.add(row)
                    db.flush()
                    labels[key.lower()] = row
                    summary["labels"] += 1
            existing_rules = {row.name for row in db.scalars(select(Rule).where(Rule.session_id == session.id)).all()}
            for item in entry.get("rules", []):
                if item.get("name") in existing_rules:
                    continue
                db.add(
                    Rule(
                        session_id=session.id,
                        name=str(item.get("name") or "Rule")[:120],
                        enabled=bool(item.get("enabled", True)),
                        match="any" if item.get("match") == "any" else "all",
                        conditions_json=json.dumps(item.get("conditions", [])),
                        actions_json=json.dumps(item.get("actions", [])),
                        stop=bool(item.get("stop", False)),
                    )
                )
                summary["rules"] += 1
            for model, key in ((BlockEntry, "blocklist"), (AllowEntry, "allowlist")):
                have = {row.value for row in db.scalars(select(model).where(model.session_id == session.id)).all()}
                for value in entry.get(key, []):
                    if value and value not in have:
                        db.add(model(session_id=session.id, kind="email", value=value))
                        have.add(value)
            for item in entry.get("accounts", []):
                email = str(item.get("email", "")).lower()
                account = db.scalar(select(Account).where(Account.email == item.get("email"))) or next(
                    (row for row in db.scalars(select(Account)).all() if row.email.lower() == email), None
                )
                if account is None:
                    summary["skipped_accounts"].append(item.get("email"))
                    continue
                if item.get("signature") and not account.signature:
                    account.signature = item["signature"]
                for message in item.get("messages", []):
                    folder = _target_folder(db, account, message.get("folder_role") if message.get("folder_role") in {"inbox", "archive", "sent", "trash", "spam", "drafts"} else "archive")
                    from session_mail.mail.parse import ParsedMessage, make_snippet

                    date = None
                    if message.get("date"):
                        try:
                            date = datetime.fromisoformat(message["date"])
                        except ValueError:
                            date = None
                    parsed = ParsedMessage(
                        message_id=message.get("message_id") or "",
                        subject=message.get("subject") or "",
                        from_name=message.get("from_name") or "",
                        from_email=message.get("from_email") or "",
                        to=message.get("to") or [],
                        cc=message.get("cc") or [],
                        date=date,
                        in_reply_to=message.get("in_reply_to") or "",
                        references=message.get("references") or [],
                        text=message.get("body_text") or "",
                        html=message.get("body_html") or "",
                        snippet=make_snippet(message.get("body_text") or ""),
                        seen=bool(message.get("seen", True)),
                        flagged=bool(message.get("flagged", False)),
                        full=True,
                    )
                    row = upsert_parsed(db, account.id, folder.id, -1_000_000_000, parsed)
                    if row.uid <= 0:
                        row.uid = -row.id
                    for label_name in message.get("labels", []):
                        label = labels.get(str(label_name).lower())
                        if label is not None and db.scalar(select(MessageLabel).where(MessageLabel.message_id == row.id, MessageLabel.label_id == label.id)) is None:
                            db.add(MessageLabel(message_id=row.id, label_id=label.id))
                    summary["messages"] += 1
        record(db, "data.restore", target="json-backup", detail=summary)
    return summary
