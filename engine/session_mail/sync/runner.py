from __future__ import annotations

import logging
import threading

from sqlalchemy import select

from session_mail.db import session_scope
from session_mail.hub import hub
from session_mail.mail.imap_client import (
    connect_account,
    ensure_mailbox,
    fetch_headers,
    flags_from_item,
    header_bytes,
    idle_for,
    list_remote_folders,
    logout,
    move_uid,
    preview_bytes,
    search_uids,
    select_folder,
    size_from_item,
)
from session_mail.mail.parse import parse_header_and_preview
from session_mail.mail.store import folder_by_role, save_remote_folders, spam_text, upsert_parsed
from session_mail.models import Account, Folder, Message
from session_mail.secrets import secret_get
from session_mail.spam.bayes import evaluate

log = logging.getLogger("session.sync")

_guard = threading.Lock()
_locks: dict[int, threading.Lock] = {}
ROLE_MAILBOX = {
    "inbox": "INBOX",
    "sent": "Sent",
    "drafts": "Drafts",
    "spam": "Junk",
    "trash": "Trash",
    "archive": "Archive",
}


def account_lock(account_id: int) -> threading.Lock:
    with _guard:
        lock = _locks.get(account_id)
        if lock is None:
            lock = threading.Lock()
            _locks[account_id] = lock
        return lock


def _error(account_id: int, message: str) -> None:
    with session_scope() as db:
        account = db.get(Account, account_id)
        if account is not None:
            account.last_error = message[:500]


def _touch(account_id: int) -> None:
    from datetime import datetime, timezone

    with session_scope() as db:
        account = db.get(Account, account_id)
        if account is not None:
            account.last_sync_at = datetime.now(timezone.utc)
            account.last_error = ""


def sync_account(account_id: int, idle: bool = False) -> None:
    with account_lock(account_id):
        _sync_account(account_id, idle)


def _sync_account(account_id: int, idle: bool) -> None:
    with session_scope() as db:
        account = db.get(Account, account_id)
        if account is None or not account.sync_enabled or account.auth_type == "local":
            return
        if not account.imap_host:
            return
    secret = secret_get(f"account:{account.id}") or {}
    hub.emit({"type": "sync.start", "account_id": account_id})
    try:
        client = connect_account(account, secret)
    except Exception as exc:
        _error(account_id, str(exc))
        hub.emit({"type": "sync.error", "account_id": account_id, "error": str(exc)[:300]})
        return
    try:
        remote = list_remote_folders(client)
        with session_scope() as db:
            save_remote_folders(db, account_id, remote)
            account = db.get(Account, account_id)
            session_id = account.session_id if account else 0
            folders = db.scalars(select(Folder).where(Folder.account_id == account_id, Folder.role != "all")).all()
            plan = [(folder.id, folder.imap_name, folder.role) for folder in folders]
        plan.sort(key=lambda item: 0 if item[2] == "inbox" else 1 if item[2] == "spam" else 2)
        new_ids: list[int] = []
        for folder_id, name, role in plan:
            try:
                new_ids.extend(_sync_folder(client, account_id, session_id, folder_id, name, role))
            except Exception:
                log.exception("Could not sync %s", name)
        if idle:
            inbox = next((item for item in plan if item[2] == "inbox"), None)
            if inbox is not None:
                try:
                    select_folder(client, inbox[1])
                    idle_for(client, 25)
                except Exception:
                    log.debug("IDLE skipped", exc_info=True)
        _touch(account_id)
        hub.emit({"type": "sync.done", "account_id": account_id, "message_ids": new_ids[:40]})
        if new_ids:
            hub.emit({"type": "mail.new", "account_id": account_id, "message_ids": new_ids[:40]})
    except Exception as exc:
        log.exception("Account sync failed")
        _error(account_id, str(exc))
        hub.emit({"type": "sync.error", "account_id": account_id, "error": str(exc)[:300]})
    finally:
        logout(client)


def _sync_folder(client, account_id: int, session_id: int, folder_id: int, name: str, role: str) -> list[int]:
    status = select_folder(client, name)
    validity = int(status.get(b"UIDVALIDITY") or status.get("UIDVALIDITY") or 0)
    with session_scope() as db:
        folder = db.get(Folder, folder_id)
        if folder is None:
            return []
        if validity and folder.uidvalidity and validity != folder.uidvalidity:
            for row in db.scalars(select(Message).where(Message.folder_id == folder_id)).all():
                db.delete(row)
            folder.highest_uid = 0
        if validity:
            folder.uidvalidity = validity
        highest = folder.highest_uid
    uids = search_uids(client)
    server = set(uids)
    with session_scope() as db:
        local_rows = db.scalars(select(Message).where(Message.folder_id == folder_id, Message.uid > 0)).all()
        have = set()
        for row in local_rows:
            if row.uid not in server:
                db.delete(row)
            else:
                have.add(row.uid)
    if highest == 0:
        wanted = [uid for uid in uids[-400:] if uid not in have]
    else:
        recent = [uid for uid in uids[-400:] if uid not in have]
        fresh = [uid for uid in uids if uid > highest and uid not in have]
        wanted = sorted(set(recent + fresh))
    created: list[int] = []
    pending_moves: list[tuple[int, int, float, str]] = []
    for offset in range(0, len(wanted), 25):
        chunk = wanted[offset : offset + 25]
        fetched = fetch_headers(client, chunk)
        with session_scope() as db:
            for uid in chunk:
                item = fetched.get(uid)
                if not item:
                    continue
                header = header_bytes(item)
                if not header:
                    continue
                parsed = parse_header_and_preview(header, preview_bytes(item))
                seen, flagged, answered = flags_from_item(item)
                parsed.seen = seen
                parsed.flagged = flagged
                parsed.answered = answered
                parsed.size = size_from_item(item) or parsed.size
                row = upsert_parsed(db, account_id, folder_id, uid, parsed)
                created.append(row.id)
                if role != "inbox":
                    continue
                action, score = evaluate(db, session_id, spam_text(row), row.from_email)
                row.spam_score = score
                if action == "move":
                    pending_moves.append((row.id, uid, score, row.subject))
                    row.auto_spam = True
    if pending_moves and role == "inbox":
        dest_name = _spam_mailbox(client, account_id)
        if dest_name:
            for message_id, uid, score, subject in pending_moves:
                try:
                    move_uid(client, uid, dest_name)
                except Exception:
                    log.exception("Could not file spam")
                    with session_scope() as db:
                        row = db.get(Message, message_id)
                        if row is not None:
                            row.auto_spam = False
                    continue
                with session_scope() as db:
                    row = db.get(Message, message_id)
                    dest = folder_by_role(db, account_id, "spam")
                    if row is not None and dest is not None:
                        row.folder_id = dest.id
                        row.auto_spam = True
                        row.spam_score = score
                hub.emit(
                    {
                        "type": "spam.auto",
                        "message_id": message_id,
                        "session_id": session_id,
                        "subject": subject,
                        "account_id": account_id,
                    }
                )
    with session_scope() as db:
        folder = db.get(Folder, folder_id)
        if folder is not None and uids:
            folder.highest_uid = max(uids)
    return created


def _spam_mailbox(client, account_id: int) -> str | None:
    with session_scope() as db:
        folder = folder_by_role(db, account_id, "spam")
        if folder is not None:
            return folder.imap_name
    name = ROLE_MAILBOX["spam"]
    ensure_mailbox(client, name)
    with session_scope() as db:
        if folder_by_role(db, account_id, "spam") is None:
            db.add(Folder(account_id=account_id, imap_name=name, role="spam"))
    return name
