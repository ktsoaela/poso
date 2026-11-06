from __future__ import annotations

import base64
import html
import json
import re
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid

from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError

from session_mail.auth.oauth import app_credentials, fresh_access_token, run_oauth, save_app_credentials
from session_mail.config import OAUTH_REDIRECT_URI
from session_mail.db import fts_search_ids, session_scope
from session_mail.mail.errors import MailError
from session_mail.mail.imap_client import (
    append_raw,
    connect_account,
    ensure_mailbox,
    list_remote_folders,
    logout,
    move_uid,
    select_folder,
    store_flags,
)
from session_mail.mail.parse import parse_message
from session_mail.mail.presets import ACCOUNT_COLORS, PRESETS, apply_preset
from session_mail.mail.roles import assert_email
from session_mail.mail.smtp_client import send_message
from session_mail.mail.store import (
    add_local_message,
    ensure_local_folders,
    folder_by_role,
    save_remote_folders,
    spam_text,
    upsert_parsed,
)
from session_mail.models import (
    Account,
    AllowEntry,
    Attachment,
    BlockEntry,
    Draft,
    Folder,
    MailSession,
    Message,
    Setting,
)
from session_mail.secrets import secret_delete, secret_get, secret_put
from session_mail.spam.bayes import forget, remember, train

SESSION_COLORS = ["#1d4e89", "#8d4a32", "#0e6b52", "#6b4c9a", "#a15c07"]
ROLE_MAILBOX = {
    "inbox": "INBOX",
    "sent": "Sent",
    "drafts": "Drafts",
    "spam": "Junk",
    "trash": "Trash",
    "archive": "Archive",
}


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def _loads(raw: str, fallback):
    try:
        return json.loads(raw or "")
    except json.JSONDecodeError:
        return fallback


def _setting(db, key: str, default: str = "") -> str:
    row = db.get(Setting, key)
    return row.value if row else default


def _put_setting(db, key: str, value: str) -> None:
    row = db.get(Setting, key)
    if row is None:
        db.add(Setting(key=key, value=value))
    else:
        row.value = value


def _active_id(db) -> int:
    raw = _setting(db, "active_session_id")
    if raw.isdigit():
        found = db.get(MailSession, int(raw))
        if found is not None:
            return found.id
    first = db.scalar(select(MailSession).order_by(MailSession.sort_order, MailSession.id))
    if first is None:
        raise MailError("No sessions exist yet.")
    _put_setting(db, "active_session_id", str(first.id))
    return first.id


def _session_out(db, row: MailSession, unread: dict[int, int]) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "color": row.color,
        "sort_order": row.sort_order,
        "unread": unread.get(row.id, 0),
    }


def _unread_by_session(db) -> dict[int, int]:
    rows = db.execute(
        select(Account.session_id, func.count(Message.id))
        .join(Message, Message.account_id == Account.id)
        .join(Folder, Folder.id == Message.folder_id)
        .where(Folder.role == "inbox", Message.seen.is_(False))
        .group_by(Account.session_id)
    ).all()
    return {int(session_id): int(count) for session_id, count in rows}


def _account_out(row: Account) -> dict:
    return {
        "id": row.id,
        "session_id": row.session_id,
        "email": row.email,
        "username": row.username,
        "display_name": row.display_name,
        "provider": row.provider,
        "auth_type": row.auth_type,
        "imap_host": row.imap_host,
        "imap_port": row.imap_port,
        "imap_ssl": row.imap_ssl,
        "smtp_host": row.smtp_host,
        "smtp_port": row.smtp_port,
        "smtp_mode": row.smtp_mode,
        "color": row.color,
        "sync_enabled": row.sync_enabled,
        "last_sync_at": _iso(row.last_sync_at),
        "last_error": row.last_error or "",
    }


def _folder_out(row: Folder, unread: int = 0) -> dict:
    return {
        "id": row.id,
        "account_id": row.account_id,
        "imap_name": row.imap_name,
        "role": row.role,
        "unread": unread,
    }


def _message_out(row: Message, account: Account, folder: Folder) -> dict:
    return {
        "id": row.id,
        "account_id": row.account_id,
        "folder_id": row.folder_id,
        "thread_id": row.thread_id,
        "subject": row.subject or "(no subject)",
        "from_name": row.from_name,
        "from_email": row.from_email,
        "to": _loads(row.to_json, []),
        "cc": _loads(row.cc_json, []),
        "date": _iso(row.date),
        "snippet": row.snippet,
        "seen": row.seen,
        "flagged": row.flagged,
        "answered": row.answered,
        "auto_spam": row.auto_spam,
        "spam_score": row.spam_score,
        "has_body": row.has_body,
        "account_email": account.email,
        "account_color": account.color,
        "folder_role": folder.role,
    }


def _need_message(db, message_id: int) -> tuple[Message, Account, Folder]:
    message = db.get(Message, message_id)
    if message is None:
        raise MailError("That message is gone.")
    account = db.get(Account, message.account_id)
    folder = db.get(Folder, message.folder_id)
    if account is None or folder is None:
        raise MailError("That message is gone.")
    return message, account, folder


def fts_query(raw: str) -> str:
    cleaned = re.sub(r"[^\w\s@.+'-]", " ", raw, flags=re.UNICODE)
    parts = []
    for part in cleaned.split():
        part = part.replace('"', "").strip()
        if part:
            parts.append(f'"{part}"')
    return " AND ".join(parts)


def list_providers() -> list[dict]:
    return [{"id": key, **{k: v for k, v in value.items() if k != "oauth"}, "oauth": value.get("oauth")} for key, value in PRESETS.items()]


def bootstrap() -> dict:
    with session_scope() as db:
        active = _active_id(db)
        unread = _unread_by_session(db)
        sessions = db.scalars(select(MailSession).order_by(MailSession.sort_order, MailSession.id)).all()
        accounts = db.scalars(select(Account).order_by(Account.email)).all()
        account_ids = [row.id for row in accounts]
        folders = []
        if account_ids:
            folders = db.scalars(select(Folder).where(Folder.account_id.in_(account_ids), Folder.role != "all")).all()
        folder_unread_rows = db.execute(
            select(Message.folder_id, func.count(Message.id))
            .where(Message.seen.is_(False))
            .group_by(Message.folder_id)
        ).all()
        folder_unread = {int(folder_id): int(count) for folder_id, count in folder_unread_rows}
        google_id, google_secret = app_credentials("google")
        microsoft_id, microsoft_secret = app_credentials("microsoft")
        return {
            "active_session_id": active,
            "sessions": [_session_out(db, row, unread) for row in sessions],
            "accounts": [_account_out(row) for row in accounts],
            "folders": [_folder_out(row, folder_unread.get(row.id, 0)) for row in folders],
            "settings": {
                "theme": _setting(db, "theme", "system"),
                "density": _setting(db, "density", "comfortable"),
                "load_remote_images": _setting(db, "load_remote_images", "0") == "1",
            },
            "oauth": {
                "google_client_id": google_id,
                "google_has_secret": bool(google_secret),
                "microsoft_client_id": microsoft_id,
                "microsoft_has_secret": bool(microsoft_secret),
                "redirect_uri": OAUTH_REDIRECT_URI,
            },
        }


def create_session(name: str, color: str = "") -> dict:
    with session_scope() as db:
        count = db.scalar(select(func.count()).select_from(MailSession)) or 0
        row = MailSession(
            name=name.strip(),
            color=color.strip() or SESSION_COLORS[count % len(SESSION_COLORS)],
            sort_order=int(count),
        )
        db.add(row)
        db.flush()
        return _session_out(db, row, {})


def update_session(session_id: int, name: str | None, color: str | None, sort_order: int | None) -> dict:
    with session_scope() as db:
        row = db.get(MailSession, session_id)
        if row is None:
            raise MailError("That session is gone.")
        if name is not None and name.strip():
            row.name = name.strip()
        if color is not None and color.strip():
            row.color = color.strip()
        if sort_order is not None:
            row.sort_order = sort_order
        unread = _unread_by_session(db)
        return _session_out(db, row, unread)


def delete_session(session_id: int) -> None:
    with session_scope() as db:
        row = db.get(MailSession, session_id)
        if row is None:
            raise MailError("That session is gone.")
        count = db.scalar(select(func.count()).select_from(MailSession)) or 0
        if count <= 1:
            raise MailError("Keep at least one session.")
        used = db.scalar(select(func.count()).select_from(Account).where(Account.session_id == session_id)) or 0
        if used:
            raise MailError("Move this session's accounts before deleting it.")
        if _setting(db, "active_session_id") == str(session_id):
            other = db.scalar(select(MailSession).where(MailSession.id != session_id))
            if other:
                _put_setting(db, "active_session_id", str(other.id))
        db.delete(row)


def update_settings(payload) -> dict:
    with session_scope() as db:
        if payload.theme in {"light", "dark", "system"}:
            _put_setting(db, "theme", payload.theme)
        if payload.density in {"comfortable", "compact"}:
            _put_setting(db, "density", payload.density)
        if payload.load_remote_images is not None:
            _put_setting(db, "load_remote_images", "1" if payload.load_remote_images else "0")
        if payload.active_session_id is not None:
            row = db.get(MailSession, payload.active_session_id)
            if row is None:
                raise MailError("That session is gone.")
            _put_setting(db, "active_session_id", str(row.id))
    if payload.google_client_id is not None or payload.google_client_secret:
        save_app_credentials("google", payload.google_client_id, payload.google_client_secret)
    if payload.microsoft_client_id is not None or payload.microsoft_client_secret:
        save_app_credentials("microsoft", payload.microsoft_client_id, payload.microsoft_client_secret)
    return bootstrap()


def _display(email: str, display_name: str) -> str:
    cleaned = display_name.strip()
    return cleaned or email.split("@", 1)[0]


def create_password_account(payload) -> dict:
    email = assert_email(payload.email)
    hosts = apply_preset(
        payload.provider,
        imap_host=payload.imap_host,
        imap_port=payload.imap_port,
        imap_ssl=payload.imap_ssl,
        smtp_host=payload.smtp_host,
        smtp_port=payload.smtp_port,
        smtp_mode=payload.smtp_mode,
    )
    if not payload.password:
        raise MailError("Enter a password or app password.")
    probe = Account(
        email=email,
        username=(payload.username or email).strip(),
        auth_type="password",
        imap_host=hosts["imap_host"],
        imap_port=hosts["imap_port"],
        imap_ssl=hosts["imap_ssl"],
        smtp_host=hosts["smtp_host"],
        smtp_port=hosts["smtp_port"],
        smtp_mode=hosts["smtp_mode"],
    )
    secret = {"password": payload.password}
    client = connect_account(probe, secret)
    try:
        remote_folders = list_remote_folders(client)
    finally:
        logout(client)
    with session_scope() as db:
        if db.get(MailSession, payload.session_id) is None:
            raise MailError("Choose a session for this account.")
        existing = db.scalar(select(Account).where(func.lower(Account.email) == email.lower()))
        if existing is not None:
            raise MailError("That address is already in Session. Move it from Settings.")
        color_index = db.scalar(select(func.count()).select_from(Account).where(Account.session_id == payload.session_id)) or 0
        account = Account(
            session_id=payload.session_id,
            email=email,
            username=probe.username,
            display_name=_display(email, payload.display_name),
            provider=hosts["provider"],
            auth_type="password",
            imap_host=hosts["imap_host"],
            imap_port=hosts["imap_port"],
            imap_ssl=hosts["imap_ssl"],
            smtp_host=hosts["smtp_host"],
            smtp_port=hosts["smtp_port"],
            smtp_mode=hosts["smtp_mode"],
            color=ACCOUNT_COLORS[int(color_index) % len(ACCOUNT_COLORS)],
        )
        db.add(account)
        db.flush()
        secret_put(f"account:{account.id}", secret)
        save_remote_folders(db, account.id, remote_folders)
        return _account_out(account)


def connect_oauth_account(provider: str, session_id: int) -> dict:
    spec = run_oauth(provider, session_id)
    with session_scope() as db:
        if db.get(MailSession, spec["session_id"]) is None:
            raise MailError("Choose a session for this account.")
        email = spec["email"]
        account = db.scalar(select(Account).where(func.lower(Account.email) == email.lower()))
        if account is None:
            color_index = db.scalar(
                select(func.count()).select_from(Account).where(Account.session_id == spec["session_id"])
            ) or 0
            account = Account(
                session_id=spec["session_id"],
                email=email,
                username=email,
                display_name=_display(email, ""),
                provider=spec["provider"],
                auth_type=spec["auth_type"],
                imap_host=spec["imap_host"],
                imap_port=spec["imap_port"],
                imap_ssl=spec["imap_ssl"],
                smtp_host=spec["smtp_host"],
                smtp_port=spec["smtp_port"],
                smtp_mode=spec["smtp_mode"],
                color=ACCOUNT_COLORS[int(color_index) % len(ACCOUNT_COLORS)],
            )
            db.add(account)
            db.flush()
        else:
            account.session_id = spec["session_id"]
            account.auth_type = spec["auth_type"]
            account.provider = spec["provider"]
            account.username = email
            account.imap_host = spec["imap_host"]
            account.imap_port = spec["imap_port"]
            account.imap_ssl = spec["imap_ssl"]
            account.smtp_host = spec["smtp_host"]
            account.smtp_port = spec["smtp_port"]
            account.smtp_mode = spec["smtp_mode"]
            account.sync_enabled = True
            account.last_error = ""
        secret_put(f"account:{account.id}", spec["secret"])
        return _account_out(account)


def update_account(account_id: int, payload) -> dict:
    with session_scope() as db:
        account = db.get(Account, account_id)
        if account is None:
            raise MailError("That account is gone.")
        if payload.session_id is not None:
            if db.get(MailSession, payload.session_id) is None:
                raise MailError("That session is gone.")
            account.session_id = payload.session_id
        if payload.display_name is not None and payload.display_name.strip():
            account.display_name = payload.display_name.strip()
        if payload.color is not None and payload.color.strip():
            account.color = payload.color.strip()
        if payload.sync_enabled is not None:
            account.sync_enabled = payload.sync_enabled
        password = (payload.password or "").strip()
        auth_type = account.auth_type
    if password:
        if auth_type != "password":
            raise MailError("This account signs in with the browser, not a password.")
        secret_put(f"account:{account_id}", {"password": password})
    match = next((item for item in bootstrap()["accounts"] if item["id"] == account_id), None)
    if match is None:
        raise MailError("That account is gone.")
    return match


def delete_account(account_id: int) -> None:
    with session_scope() as db:
        account = db.get(Account, account_id)
        if account is None:
            raise MailError("That account is gone.")
        db.delete(account)
    secret_delete(f"account:{account_id}")


def list_messages(session_id: int, folder_role: str | None, folder_id: int | None, account_id: int | None, query: str, limit: int, offset: int) -> dict:
    limit = min(max(limit, 1), 500)
    offset = max(offset, 0)
    with session_scope() as db:
        if db.get(MailSession, session_id) is None:
            raise MailError("That session is gone.")
        accounts = {row.id: row for row in db.scalars(select(Account).where(Account.session_id == session_id)).all()}
        if not accounts:
            return {"messages": []}
        folders = {
            row.id: row
            for row in db.scalars(select(Folder).where(Folder.account_id.in_(list(accounts)))).all()
        }
        if query.strip():
            match = fts_query(query)
            if not match:
                return {"messages": []}
            try:
                ids = fts_search_ids(db, match, session_id, 1000)
            except OperationalError as exc:
                raise MailError("That search could not be run.") from exc
            rows = []
            if ids:
                found = {row.id: row for row in db.scalars(select(Message).where(Message.id.in_(ids))).all()}
                rows = [found[item] for item in ids if item in found]
        else:
            stmt = (
                select(Message)
                .where(Message.account_id.in_(list(accounts)))
                .order_by(Message.date.desc(), Message.id.desc())
            )
            rows = db.scalars(stmt).all()
        filtered = []
        for row in rows:
            folder = folders.get(row.folder_id)
            account = accounts.get(row.account_id)
            if folder is None or account is None or folder.role == "all":
                continue
            if folder_role and folder.role != folder_role:
                continue
            if folder_id and row.folder_id != folder_id:
                continue
            if account_id and row.account_id != account_id:
                continue
            filtered.append(_message_out(row, account, folder))
        return {"messages": filtered[offset : offset + limit]}


def _detail(db, message: Message) -> dict:
    account = db.get(Account, message.account_id)
    folder = db.get(Folder, message.folder_id)
    if account is None or folder is None:
        raise MailError("That message is gone.")
    base = _message_out(message, account, folder)
    attachments = db.scalars(select(Attachment).where(Attachment.message_id == message.id)).all()
    peers = []
    if message.thread_id:
        peer_rows = db.scalars(
            select(Message)
            .join(Account, Account.id == Message.account_id)
            .where(Account.session_id == account.session_id, Message.thread_id == message.thread_id)
            .order_by(Message.date, Message.id)
        ).all()
        for peer in peer_rows:
            peer_account = db.get(Account, peer.account_id)
            peer_folder = db.get(Folder, peer.folder_id)
            if peer_account and peer_folder:
                peers.append(_message_out(peer, peer_account, peer_folder))
    base.update(
        {
            "body_text": message.body_text or "",
            "body_html": message.body_html or "",
            "message_id": message.message_id,
            "in_reply_to": message.in_reply_to,
            "references": _loads(message.references_json, []),
            "attachments": [
                {
                    "id": item.id,
                    "filename": item.filename,
                    "content_type": item.content_type,
                    "size": item.size,
                }
                for item in attachments
            ],
            "thread": peers,
        }
    )
    return base


def get_message(message_id: int) -> dict:
    with session_scope() as db:
        message, account, folder = _need_message(db, message_id)
        needs_fetch = (not message.has_body) and account.auth_type != "local" and message.uid > 0
        imap_name = folder.imap_name
        uid = message.uid
    if needs_fetch:
        secret = secret_get(f"account:{account.id}") or {}
        client = connect_account(account, secret)
        try:
            select_folder(client, imap_name)
            from session_mail.mail.imap_client import fetch_rfc822

            raw = fetch_rfc822(client, uid)
        finally:
            logout(client)
        if raw:
            parsed = parse_message(raw, full=True)
            with session_scope() as db:
                message, _, _ = _need_message(db, message_id)
                parsed.seen = message.seen
                parsed.flagged = message.flagged
                parsed.answered = message.answered
                upsert_parsed(db, message.account_id, message.folder_id, message.uid, parsed)
    with session_scope() as db:
        message, _, _ = _need_message(db, message_id)
        return _detail(db, message)


def attachment_file(message_id: int, attachment_id: int) -> tuple[object, str, str]:
    from session_mail.db import current_settings

    with session_scope() as db:
        item = db.get(Attachment, attachment_id)
        if item is None or item.message_id != message_id or not item.storage_name:
            raise MailError("That attachment is gone.")
        path = current_settings().attachment_dir / item.storage_name
        filename = item.filename
        media = item.content_type
    if not path.exists() or path.parent != current_settings().attachment_dir:
        raise MailError("That attachment is gone.")
    return path, filename, media


def set_flags(message_id: int, seen: bool | None, flagged: bool | None) -> dict:
    with session_scope() as db:
        message, account, folder = _need_message(db, message_id)
        auth = account.auth_type
        uid = message.uid
        imap_name = folder.imap_name
    if account.auth_type != "local" and uid > 0:
        secret = secret_get(f"account:{account.id}") or {}
        client = connect_account(account, secret)
        try:
            select_folder(client, imap_name)
            store_flags(client, uid, seen=seen, flagged=flagged)
        finally:
            logout(client)
    with session_scope() as db:
        message, _, _ = _need_message(db, message_id)
        if seen is not None:
            message.seen = seen
        if flagged is not None:
            message.flagged = flagged
        return _detail(db, message)


def move_message(message_id: int, role: str) -> dict:
    if role not in ROLE_MAILBOX:
        raise MailError("Choose a folder.")
    with session_scope() as db:
        message, account, folder = _need_message(db, message_id)
        dest = folder_by_role(db, account.id, role)
        auth = account.auth_type
        uid = message.uid
        source_name = folder.imap_name
        dest_name = dest.imap_name if dest else None
        dest_id = dest.id if dest else None
        account_id = account.id
    if auth != "local" and uid > 0:
        secret = secret_get(f"account:{account.id}") or {}
        client = connect_account(account, secret)
        try:
            if not dest_name:
                dest_name = ROLE_MAILBOX[role]
                ensure_mailbox(client, dest_name)
            select_folder(client, source_name)
            move_uid(client, uid, dest_name)
        finally:
            logout(client)
    with session_scope() as db:
        if dest_id is None:
            if auth == "local":
                ensure_local_folders(db, account_id)
            dest = folder_by_role(db, account_id, role)
            if dest is None:
                dest = Folder(account_id=account_id, imap_name=dest_name or ROLE_MAILBOX[role], role=role)
                db.add(dest)
                db.flush()
            dest_id = dest.id
        message, _, _ = _need_message(db, message_id)
        message.folder_id = dest_id
        if role == "inbox":
            message.auto_spam = False
        return _detail(db, message)


def report_spam(message_id: int) -> dict:
    with session_scope() as db:
        message, account, _ = _need_message(db, message_id)
        train(db, account.session_id, spam_text(message), True)
        remember(db, BlockEntry, account.session_id, message.from_email)
        forget(db, AllowEntry, account.session_id, message.from_email)
    move_message(message_id, "spam")
    with session_scope() as db:
        message, _, _ = _need_message(db, message_id)
        message.auto_spam = False
        message.spam_score = 0.99
        return _detail(db, message)


def mark_not_spam(message_id: int) -> dict:
    with session_scope() as db:
        message, account, _ = _need_message(db, message_id)
        train(db, account.session_id, spam_text(message), False)
        forget(db, BlockEntry, account.session_id, message.from_email)
        remember(db, AllowEntry, account.session_id, message.from_email)
    move_message(message_id, "inbox")
    with session_scope() as db:
        message, _, _ = _need_message(db, message_id)
        message.auto_spam = False
        message.spam_score = 0.01
        return _detail(db, message)


def undo_auto_spam(message_id: int) -> dict:
    with session_scope() as db:
        message, account, _ = _need_message(db, message_id)
        train(db, account.session_id, spam_text(message), False)
    move_message(message_id, "inbox")
    with session_scope() as db:
        message, _, _ = _need_message(db, message_id)
        message.auto_spam = False
        message.spam_score = 0.2
        return _detail(db, message)


def _plain_html(body: str) -> str:
    lines = "<br>".join(html.escape(line) for line in body.split("\n"))
    return f'<div style="font-family:Georgia,serif;font-size:16px;line-height:1.55">{lines}</div>'


def _build_outgoing(account: Account, payload) -> EmailMessage:
    if not payload.to.strip():
        raise MailError("Add at least one recipient.")
    message = EmailMessage()
    message["From"] = formataddr((account.display_name or account.email, account.email))
    message["To"] = payload.to.strip()
    if payload.cc.strip():
        message["Cc"] = payload.cc.strip()
    if payload.bcc.strip():
        message["Bcc"] = payload.bcc.strip()
    message["Subject"] = payload.subject.strip() or "(no subject)"
    message["Date"] = formatdate(localtime=False)
    domain = account.email.split("@")[-1] or "session.local"
    message["Message-ID"] = make_msgid(domain=domain)
    references = [item for item in payload.references if item]
    if payload.in_reply_to:
        message["In-Reply-To"] = payload.in_reply_to
        references.append(payload.in_reply_to)
    if references:
        message["References"] = " ".join(references)
    message.set_content(payload.body or "")
    message.add_alternative(_plain_html(payload.body or ""), subtype="html")
    total = 0
    for item in payload.attachments:
        try:
            data = base64.b64decode(item.data_base64, validate=True)
        except Exception as exc:
            raise MailError(f"Couldn't read the attachment {item.filename}.") from exc
        total += len(data)
        if len(data) > 10 * 1024 * 1024 or total > 20 * 1024 * 1024:
            raise MailError("Attachments need to stay under 20 MB.")
        content_type = item.content_type or "application/octet-stream"
        if "/" not in content_type:
            content_type = "application/octet-stream"
        maintype, subtype = content_type.split("/", 1)
        filename = item.filename.replace("\\", "_").replace("/", "_")[:180] or "attachment"
        message.add_attachment(data, maintype=maintype, subtype=subtype, filename=filename)
    return message


def send_mail(payload) -> dict:
    with session_scope() as db:
        account = db.get(Account, payload.account_id)
        if account is None:
            raise MailError("Choose an account to send from.")
    message = _build_outgoing(account, payload)
    raw = message.as_bytes()
    append_error = ""
    if account.auth_type != "local":
        secret = secret_get(f"account:{account.id}") or {}
        token = None
        if account.auth_type in {"oauth_google", "oauth_microsoft"}:
            token = fresh_access_token(account, secret)
        send_message(message, account, secret, token)
        with session_scope() as db:
            sent_folder = folder_by_role(db, account.id, "sent")
            sent_name = sent_folder.imap_name if sent_folder else "Sent"
        try:
            secret = secret_get(f"account:{account.id}") or {}
            client = connect_account(account, secret)
            try:
                if sent_folder is None:
                    ensure_mailbox(client, sent_name)
                append_raw(client, sent_name, raw)
            finally:
                logout(client)
        except Exception:
            append_error = "Sent, but the copy was not saved in Sent."
    parsed = parse_message(raw, full=True)
    parsed.seen = True
    with session_scope() as db:
        account = db.get(Account, payload.account_id)
        if account is None:
            raise MailError("Choose an account to send from.")
        if account.auth_type == "local":
            ensure_local_folders(db, account.id)
        sent_folder = folder_by_role(db, account.id, "sent")
        if sent_folder is None:
            sent_folder = Folder(account_id=account.id, imap_name="Sent", role="sent")
            db.add(sent_folder)
            db.flush()
        row = upsert_parsed(db, account.id, sent_folder.id, -1_000_000_000, parsed)
        row.uid = -row.id
        if payload.draft_id:
            draft = db.get(Draft, payload.draft_id)
            if draft is not None and draft.account_id == account.id:
                db.delete(draft)
        if payload.reply_to_message_id:
            original = db.get(Message, payload.reply_to_message_id)
            if original is not None:
                original.answered = True
        if append_error:
            account.last_error = append_error
        return _detail(db, row)


def save_draft(payload) -> dict:
    with session_scope() as db:
        account = db.get(Account, payload.account_id)
        if account is None:
            raise MailError("Choose an account for this draft.")
        draft = db.get(Draft, payload.id) if payload.id else None
        if draft is None:
            draft = Draft(account_id=account.id)
            db.add(draft)
        draft.account_id = account.id
        draft.to_text = payload.to
        draft.cc_text = payload.cc
        draft.bcc_text = payload.bcc
        draft.subject = payload.subject
        draft.body = payload.body
        draft.in_reply_to = payload.in_reply_to
        draft.references_json = json.dumps(payload.references)
        draft.reply_to_message_id = payload.reply_to_message_id
        draft.updated_at = datetime.now(timezone.utc)
        db.flush()
        return _draft_out(draft, account)


def _draft_out(draft: Draft, account: Account) -> dict:
    return {
        "id": draft.id,
        "account_id": draft.account_id,
        "account_email": account.email,
        "to": draft.to_text,
        "cc": draft.cc_text,
        "bcc": draft.bcc_text,
        "subject": draft.subject,
        "body": draft.body,
        "in_reply_to": draft.in_reply_to,
        "references": _loads(draft.references_json, []),
        "reply_to_message_id": draft.reply_to_message_id,
        "updated_at": _iso(draft.updated_at),
    }


def list_drafts(session_id: int) -> dict:
    with session_scope() as db:
        rows = db.execute(
            select(Draft, Account)
            .join(Account, Account.id == Draft.account_id)
            .where(Account.session_id == session_id)
            .order_by(Draft.updated_at.desc())
        ).all()
        return {"drafts": [_draft_out(draft, account) for draft, account in rows]}


def delete_draft(draft_id: int) -> None:
    with session_scope() as db:
        draft = db.get(Draft, draft_id)
        if draft is not None:
            db.delete(draft)


def list_blocklist(session_id: int) -> dict:
    with session_scope() as db:
        rows = db.scalars(select(BlockEntry).where(BlockEntry.session_id == session_id).order_by(BlockEntry.value)).all()
        return {"entries": [{"id": row.id, "kind": row.kind, "value": row.value} for row in rows]}


def delete_block(entry_id: int) -> None:
    with session_scope() as db:
        row = db.get(BlockEntry, entry_id)
        if row is not None:
            db.delete(row)


def _plain(text: str) -> str:
    return text.strip()


def _html_body(text: str) -> str:
    return _plain_html(text)


def seed_demo() -> dict:
    now = datetime.now(timezone.utc)
    samples = [
        ("business", "ada@northwind.example", "Ada", "#1d4e89"),
        ("business", "ben@northwind.example", "Ben", "#0e6b52"),
        ("business", "cio@northwind.example", "Cio", "#6b4c9a"),
        ("personal", "alex@personal.example", "Alex", "#8d4a32"),
        ("personal", "sam@personal.example", "Sam", "#a15c07"),
    ]
    with session_scope() as db:
        for account in db.scalars(select(Account).where(Account.auth_type == "local")).all():
            secret_delete(f"account:{account.id}")
            db.delete(account)
        db.flush()
        sessions = {row.name.lower(): row for row in db.scalars(select(MailSession)).all()}
        business = sessions.get("business") or db.scalar(select(MailSession).order_by(MailSession.sort_order))
        personal = sessions.get("personal")
        if personal is None:
            personal = MailSession(name="Personal", color="#8d4a32", sort_order=1)
            db.add(personal)
            db.flush()
        if business is None:
            raise MailError("No sessions exist yet.")
        made: dict[str, Account] = {}
        for kind, email, name, color in samples:
            session = business if kind == "business" else personal
            account = Account(
                session_id=session.id,
                email=email,
                username=email,
                display_name=name,
                provider="custom",
                auth_type="local",
                color=color,
                sync_enabled=False,
            )
            db.add(account)
            db.flush()
            ensure_local_folders(db, account.id)
            made[email] = account

        def inbox(email: str) -> Folder:
            folder = folder_by_role(db, made[email].id, "inbox")
            if folder is None:
                raise MailError("Sample inbox is missing.")
            return folder

        def junk(email: str) -> Folder:
            folder = folder_by_role(db, made[email].id, "spam")
            if folder is None:
                raise MailError("Sample junk folder is missing.")
            return folder

        def add(email: str, folder: Folder, **kwargs):
            body = kwargs.pop("body")
            add_local_message(
                db,
                made[email].id,
                folder,
                to=[{"name": made[email].display_name, "email": email}],
                body=body,
                html=_html_body(body),
                **kwargs,
            )

        add(
            "ada@northwind.example",
            inbox("ada@northwind.example"),
            subject="Dock ledger for Friday",
            from_name="Mara Chen",
            from_email="mara@harbor.example",
            body="Ada, the dockledger for Friday is ready. Two pallets stay on the quay until the afternoon truck.",
            when=now - timedelta(hours=2),
            seen=False,
            message_id="<dockledger@harbor.example>",
        )
        add(
            "ada@northwind.example",
            inbox("ada@northwind.example"),
            subject="Standup notes",
            from_name="Ben Okonkwo",
            from_email="ben@northwind.example",
            body="We kept the standup short. The yard gate code changed, and the Thursday site visit is still on.",
            when=now - timedelta(days=1),
            seen=True,
            message_id="<standup@northwind.example>",
        )
        add(
            "ben@northwind.example",
            inbox("ben@northwind.example"),
            subject="Site visit Thursday",
            from_name="Lina Vos",
            from_email="lina@quay.example",
            body="Ben, I will be at the yard Thursday at 09:00. Please have the loading dock clear.",
            when=now - timedelta(hours=5),
            seen=False,
            message_id="<visit@quay.example>",
        )
        add(
            "ada@northwind.example",
            junk("ada@northwind.example"),
            subject="You won a warehouse prize",
            from_name="Prize Desk",
            from_email="deals@prizes.example",
            body="Click now. You won a warehouse prize. Claim the shipment today.",
            when=now - timedelta(days=3),
            seen=False,
            message_id="<prize@prizes.example>",
            spam_score=0.97,
        )
        add(
            "alex@personal.example",
            inbox("alex@personal.example"),
            subject="Zephyr invoice from the studio",
            from_name="Jordan Lee",
            from_email="jordan@studio.example",
            body="Alex, the zephyrinvoice for the studio portraits is attached in spirit only. Pay it whenever the month allows.",
            when=now - timedelta(minutes=40),
            seen=False,
            message_id="<zephyrinvoice@studio.example>",
        )
        add(
            "alex@personal.example",
            inbox("alex@personal.example"),
            subject="Photos from Sunday",
            from_name="Sam Iyer",
            from_email="sam@personal.example",
            body="The river path was quiet. I kept the best three photos and left the rest on the camera.",
            when=now - timedelta(days=2),
            seen=True,
            message_id="<photos@personal.example>",
        )
        _put_setting(db, "active_session_id", str(business.id))
    return bootstrap()
