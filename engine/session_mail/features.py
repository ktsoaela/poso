"""Labels, snooze, pin, bulk actions, permanent delete, rules, contacts, and the scheduled-send outbox."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from sqlalchemy import func, select

from session_mail.audit import record
from session_mail.db import current_settings, session_scope
from session_mail.hub import hub
from session_mail.mail.errors import MailError
from session_mail.models import Account, Attachment, Folder, Label, Message, MessageLabel, OutboxItem, Rule
from session_mail import rules as rule_engine
from session_mail.secrets import secret_get

log = logging.getLogger("session.features")
LABEL_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#64748b"]


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _label_out(row: Label) -> dict:
    return {"id": row.id, "session_id": row.session_id, "name": row.name, "color": row.color}


# ---------- labels ----------

def create_label(session_id: int, name: str, color: str) -> dict:
    with session_scope() as db:
        clean = name.strip()
        exists = db.scalar(select(Label).where(Label.session_id == session_id, func.lower(Label.name) == clean.lower()))
        if exists is not None:
            raise MailError("A label with that name already exists in this session.")
        count = db.scalar(select(func.count()).select_from(Label).where(Label.session_id == session_id)) or 0
        row = Label(session_id=session_id, name=clean, color=color or LABEL_COLORS[count % len(LABEL_COLORS)])
        db.add(row)
        db.flush()
        record(db, "label.create", session_id=session_id, target=row.name)
        return _label_out(row)


def update_label(label_id: int, name: str | None, color: str | None) -> dict:
    with session_scope() as db:
        row = db.get(Label, label_id)
        if row is None:
            raise MailError("That label is gone.")
        if name and name.strip():
            row.name = name.strip()[:80]
        if color:
            row.color = color
        record(db, "label.update", session_id=row.session_id, target=row.name)
        return _label_out(row)


def delete_label(label_id: int) -> None:
    with session_scope() as db:
        row = db.get(Label, label_id)
        if row is None:
            return
        record(db, "label.delete", session_id=row.session_id, target=row.name)
        db.delete(row)


def set_message_labels(message_id: int, add: list[int], remove: list[int]) -> dict:
    from session_mail.services import _detail

    with session_scope() as db:
        message = db.get(Message, message_id)
        if message is None:
            raise MailError("That message is gone.")
        account = db.get(Account, message.account_id)
        for label_id in add:
            label = db.get(Label, label_id)
            if label is None or account is None or label.session_id != account.session_id:
                continue
            if rule_engine.apply_label(db, message_id, label_id):
                record(db, "message.label", session_id=label.session_id, account_id=message.account_id, target=message.subject or "", detail={"label": label.name, "message_id": message_id})
        for label_id in remove:
            row = db.scalar(select(MessageLabel).where(MessageLabel.message_id == message_id, MessageLabel.label_id == label_id))
            if row is not None:
                label = db.get(Label, label_id)
                record(db, "message.unlabel", session_id=label.session_id if label else None, account_id=message.account_id, target=message.subject or "", detail={"label": label.name if label else label_id, "message_id": message_id})
                db.delete(row)
        db.flush()
        return _detail(db, message)


# ---------- snooze & pin ----------

def snooze(message_id: int, until: datetime | None) -> dict:
    from session_mail.services import _detail

    until = _aware(until)
    with session_scope() as db:
        message = db.get(Message, message_id)
        if message is None:
            raise MailError("That message is gone.")
        if until is not None and until <= datetime.now(timezone.utc):
            raise MailError("Pick a time in the future.")
        account = db.get(Account, message.account_id)
        message.snoozed_until = until
        record(
            db,
            "message.snooze" if until else "message.unsnooze",
            session_id=account.session_id if account else None,
            account_id=message.account_id,
            target=message.subject or "",
            detail={"until": until.isoformat() if until else None, "message_id": message_id},
        )
        return _detail(db, message)


def pin(message_id: int, pinned: bool) -> dict:
    from session_mail.services import _detail

    with session_scope() as db:
        message = db.get(Message, message_id)
        if message is None:
            raise MailError("That message is gone.")
        message.pinned = pinned
        account = db.get(Account, message.account_id)
        record(db, "message.pin" if pinned else "message.unpin", session_id=account.session_id if account else None, account_id=message.account_id, target=message.subject or "")
        return _detail(db, message)


def wake_snoozed() -> int:
    now = datetime.now(timezone.utc)
    woke: list[tuple[int, int, str]] = []
    with session_scope() as db:
        rows = db.scalars(select(Message).where(Message.snoozed_until.is_not(None), Message.snoozed_until <= now)).all()
        for row in rows:
            row.snoozed_until = None
            row.seen = False
            account = db.get(Account, row.account_id)
            woke.append((row.id, account.session_id if account else 0, row.subject or ""))
            record(db, "message.snooze_wake", session_id=account.session_id if account else None, account_id=row.account_id, target=row.subject or "", actor="system")
    for message_id, session_id, subject in woke:
        hub.emit({"type": "mail.new", "message_ids": [message_id], "session_id": session_id, "subject": subject, "reason": "snooze"})
    return len(woke)


# ---------- permanent delete ----------

def _drop_rows(db, rows: list[Message]) -> None:
    root = current_settings().attachment_dir
    for row in rows:
        for item in db.scalars(select(Attachment).where(Attachment.message_id == row.id)).all():
            if item.storage_name:
                try:
                    (root / item.storage_name).unlink(missing_ok=True)
                except OSError:
                    pass
        db.delete(row)


def _remote_delete(account: Account, by_folder: dict[str, list[int]]) -> None:
    from session_mail.mail.imap_client import connect_account, delete_uid, logout, select_folder

    client = connect_account(account, secret_get(f"account:{account.id}") or {})
    try:
        for folder_name, uids in by_folder.items():
            select_folder(client, folder_name)
            for uid in uids:
                delete_uid(client, uid)
    finally:
        logout(client)


def delete_forever(message_ids: list[int]) -> int:
    plan: dict[int, dict[str, list[int]]] = {}
    accounts: dict[int, Account] = {}
    with session_scope() as db:
        for message_id in message_ids:
            row = db.get(Message, message_id)
            if row is None:
                continue
            account = db.get(Account, row.account_id)
            folder = db.get(Folder, row.folder_id)
            if account is None or folder is None:
                continue
            accounts[account.id] = account
            if account.auth_type != "local" and row.uid > 0:
                plan.setdefault(account.id, {}).setdefault(folder.imap_name, []).append(row.uid)
    for account_id, by_folder in plan.items():
        _remote_delete(accounts[account_id], by_folder)
    with session_scope() as db:
        rows = [row for row in (db.get(Message, item) for item in message_ids) if row is not None]
        for row in rows:
            account = accounts.get(row.account_id)
            record(db, "message.delete_forever", session_id=account.session_id if account else None, account_id=row.account_id, target=row.subject or "", detail={"from": row.from_email})
        _drop_rows(db, rows)
        return len(rows)


def empty_folder(session_id: int, role: str) -> int:
    if role not in {"trash", "spam"}:
        raise MailError("Only Trash and Spam can be emptied.")
    with session_scope() as db:
        ids = [
            row[0]
            for row in db.execute(
                select(Message.id)
                .join(Account, Account.id == Message.account_id)
                .join(Folder, Folder.id == Message.folder_id)
                .where(Account.session_id == session_id, Folder.role == role)
            ).all()
        ]
    count = delete_forever(ids)
    with session_scope() as db:
        record(db, "folder.empty", session_id=session_id, target=role, detail={"deleted": count})
    return count


# ---------- bulk ----------

def bulk(ids: list[int], action: str, label_id: int | None, until: datetime | None) -> dict:
    from session_mail import services

    done = 0
    errors: list[str] = []
    if action == "delete_forever":
        return {"done": delete_forever(ids), "errors": []}
    for message_id in ids[:1000]:
        try:
            if action in {"archive", "trash", "inbox"}:
                services.move_message(message_id, action)
            elif action == "spam":
                services.report_spam(message_id)
            elif action == "not_spam":
                services.mark_not_spam(message_id)
            elif action in {"read", "unread"}:
                services.set_flags(message_id, action == "read", None)
            elif action in {"flag", "unflag"}:
                services.set_flags(message_id, None, action == "flag")
            elif action == "label" and label_id:
                set_message_labels(message_id, [label_id], [])
            elif action == "unlabel" and label_id:
                set_message_labels(message_id, [], [label_id])
            elif action == "snooze":
                snooze(message_id, until)
            else:
                raise MailError("Unknown action.")
            done += 1
        except MailError as exc:
            errors.append(str(exc))
    return {"done": done, "errors": errors[:5]}


# ---------- rules ----------

def list_rules(session_id: int) -> dict:
    with session_scope() as db:
        rows = db.scalars(select(Rule).where(Rule.session_id == session_id).order_by(Rule.sort_order, Rule.id)).all()
        return {"rules": [rule_engine.rule_out(row) for row in rows]}


def save_rule(rule_id: int | None, payload) -> dict:
    conditions, actions = rule_engine.validate(payload.conditions, payload.actions)
    with session_scope() as db:
        row = db.get(Rule, rule_id) if rule_id else None
        if row is None:
            count = db.scalar(select(func.count()).select_from(Rule).where(Rule.session_id == payload.session_id)) or 0
            row = Rule(session_id=payload.session_id, sort_order=int(count))
            db.add(row)
        row.name = payload.name.strip()
        row.enabled = payload.enabled
        row.match = "any" if payload.match == "any" else "all"
        row.conditions_json = json.dumps(conditions)
        row.actions_json = json.dumps(actions)
        row.stop = payload.stop
        db.flush()
        record(db, "rule.save", session_id=row.session_id, target=row.name, detail={"conditions": conditions, "actions": actions})
        return rule_engine.rule_out(row)


def delete_rule(rule_id: int) -> None:
    with session_scope() as db:
        row = db.get(Rule, rule_id)
        if row is not None:
            record(db, "rule.delete", session_id=row.session_id, target=row.name)
            db.delete(row)


def run_rules(session_id: int) -> dict:
    """Apply rules to everything currently in the session's inbox."""
    from session_mail import services

    with session_scope() as db:
        rows = db.execute(
            select(Message.id)
            .join(Account, Account.id == Message.account_id)
            .join(Folder, Folder.id == Message.folder_id)
            .where(Account.session_id == session_id, Folder.role == "inbox")
        ).all()
        work: list[tuple[int, list[dict]]] = []
        for (message_id,) in rows:
            message = db.get(Message, message_id)
            planned = rule_engine.plan(db, session_id, message)
            if planned:
                work.append((message_id, [action for _rule, action in planned]))
    touched = 0
    for message_id, actions in work:
        moved = False
        for action in actions:
            try:
                kind = action["type"]
                if kind == "label":
                    set_message_labels(message_id, [action["label_id"]], [])
                elif kind == "read":
                    services.set_flags(message_id, True, None)
                elif kind == "flag":
                    services.set_flags(message_id, None, True)
                elif not moved:
                    role = rule_engine.target_role(action)
                    if role:
                        services.move_message(message_id, role)
                        moved = True
            except MailError:
                continue
        touched += 1
    with session_scope() as db:
        record(db, "rule.run", session_id=session_id, detail={"messages": touched})
    return {"matched": touched}


# ---------- contacts ----------

def contacts(session_id: int, q: str, limit: int = 20) -> dict:
    needle = q.strip().lower()
    found: dict[str, dict] = {}
    with session_scope() as db:
        account_ids = [row.id for row in db.scalars(select(Account).where(Account.session_id == session_id)).all()]
        own = {row.email.lower() for row in db.scalars(select(Account)).all()}
        if not account_ids:
            return {"contacts": []}
        senders = db.execute(
            select(Message.from_email, func.max(Message.from_name), func.count(Message.id), func.max(Message.date))
            .join(Folder, Folder.id == Message.folder_id)
            .where(Message.account_id.in_(account_ids), Folder.role.notin_(["spam", "trash"]), Message.from_email != "")
            .group_by(func.lower(Message.from_email))
        ).all()
        for email, name, count, last in senders:
            key = email.lower()
            if key in own:
                continue
            found[key] = {"email": email, "name": name or "", "count": int(count), "last": _aware(last).isoformat() if last else None}
        sent = db.execute(
            select(Message.to_json, Message.cc_json, Message.date)
            .join(Folder, Folder.id == Message.folder_id)
            .where(Message.account_id.in_(account_ids), Folder.role == "sent")
        ).all()
        for to_json, cc_json, date in sent:
            for raw in (to_json, cc_json):
                try:
                    items = json.loads(raw or "[]")
                except json.JSONDecodeError:
                    continue
                for item in items:
                    email = str(item.get("email", "")).strip()
                    key = email.lower()
                    if not email or "@" not in email or key in own:
                        continue
                    entry = found.setdefault(key, {"email": email, "name": item.get("name", ""), "count": 0, "last": None})
                    entry["count"] += 2  # people you write to rank higher
                    if not entry["name"]:
                        entry["name"] = item.get("name", "")
    from session_mail.organizer import saved_contacts

    for saved in saved_contacts(session_id):
        key = saved.email.strip().lower()
        if not key or "@" not in key or key in own:
            continue
        entry = found.setdefault(key, {"email": saved.email.strip(), "name": "", "count": 0, "last": None})
        entry["name"] = saved.name or entry["name"]
        entry["count"] += 25 if saved.favorite else 10  # address-book entries outrank one-off senders
    rows = list(found.values())
    if needle:
        rows = [row for row in rows if needle in row["email"].lower() or needle in (row["name"] or "").lower()]
    rows.sort(key=lambda row: (-row["count"], row["email"]))
    return {"contacts": rows[:limit]}


# ---------- outbox ----------

def _outbox_out(row: OutboxItem, account: Account) -> dict:
    payload = json.loads(row.payload_json or "{}")
    return {
        "id": row.id,
        "account_id": row.account_id,
        "account_email": account.email,
        "send_at": _aware(row.send_at).isoformat() if row.send_at else None,
        "status": row.status,
        "error": row.error,
        "to": payload.get("to", ""),
        "subject": payload.get("subject", ""),
        "snippet": (payload.get("body") or "")[:160],
        "payload": payload,
    }


def list_outbox(session_id: int) -> dict:
    with session_scope() as db:
        rows = db.execute(
            select(OutboxItem, Account)
            .join(Account, Account.id == OutboxItem.account_id)
            .where(Account.session_id == session_id, OutboxItem.status.in_(["scheduled", "failed"]))
            .order_by(OutboxItem.send_at)
        ).all()
        return {"items": [_outbox_out(item, account) for item, account in rows]}


def cancel_outbox(item_id: int) -> dict:
    with session_scope() as db:
        row = db.get(OutboxItem, item_id)
        if row is None:
            raise MailError("That scheduled message is gone.")
        account = db.get(Account, row.account_id)
        out = _outbox_out(row, account)
        record(db, "message.unschedule", session_id=account.session_id if account else None, account_id=row.account_id, target=out["subject"])
        db.delete(row)
        return out


def flush_outbox() -> int:
    from session_mail.schemas import SendRequest
    from session_mail import services

    now = datetime.now(timezone.utc)
    with session_scope() as db:
        due = [
            (row.id, row.account_id, row.payload_json)
            for row in db.scalars(select(OutboxItem).where(OutboxItem.status == "scheduled", OutboxItem.send_at <= now)).all()
        ]
        for item_id, _account_id, _payload in due:
            db.get(OutboxItem, item_id).status = "sending"
    sent = 0
    for item_id, account_id, payload_json in due:
        try:
            payload = SendRequest(**json.loads(payload_json))
            payload.send_at = None
            payload.draft_id = None
            with session_scope() as db:
                account = db.get(Account, account_id)
            if account is None:
                raise MailError("The sending account was removed.")
            services._deliver(account, payload, services._build_outgoing(account, payload))
            with session_scope() as db:
                row = db.get(OutboxItem, item_id)
                if row is not None:
                    db.delete(row)
            sent += 1
            hub.emit({"type": "mail.sent", "subject": payload.subject})
        except Exception as exc:  # keep the message so the person can retry or edit it
            log.exception("Scheduled send failed")
            with session_scope() as db:
                row = db.get(OutboxItem, item_id)
                if row is not None:
                    row.status = "failed"
                    row.error = str(exc)[:500]
                    account = db.get(Account, row.account_id)
                    record(db, "message.schedule_failed", session_id=account.session_id if account else None, account_id=row.account_id, detail=str(exc)[:300], actor="system")
    return sent
