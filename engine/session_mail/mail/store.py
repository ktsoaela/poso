from __future__ import annotations

import json
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from session_mail.db import current_settings
from session_mail.mail.parse import ParsedAttachment, ParsedMessage, thread_id_for
from session_mail.models import Attachment, Folder, Message

_MAX_ATTACHMENT = 25 * 1024 * 1024


def spam_text(message: Message) -> str:
    return "\n".join(
        part
        for part in (message.subject, message.from_name, message.from_email, message.snippet, message.body_text)
        if part
    )


def save_remote_folders(db: Session, account_id: int, folders: list) -> None:
    existing = {
        row.imap_name: row
        for row in db.scalars(select(Folder).where(Folder.account_id == account_id)).all()
    }
    for remote in folders:
        row = existing.get(remote.name)
        if row is None:
            db.add(Folder(account_id=account_id, imap_name=remote.name, role=remote.role))
        else:
            row.role = remote.role


def ensure_local_folders(db: Session, account_id: int) -> None:
    wanted = (
        ("INBOX", "inbox"),
        ("Sent", "sent"),
        ("Drafts", "drafts"),
        ("Junk", "spam"),
        ("Trash", "trash"),
        ("Archive", "archive"),
    )
    for name, role in wanted:
        row = db.scalar(select(Folder).where(Folder.account_id == account_id, Folder.imap_name == name))
        if row is None:
            db.add(Folder(account_id=account_id, imap_name=name, role=role))
    db.flush()


def folder_by_role(db: Session, account_id: int, role: str) -> Folder | None:
    return db.scalar(select(Folder).where(Folder.account_id == account_id, Folder.role == role))


def upsert_parsed(db: Session, account_id: int, folder_id: int, uid: int, parsed: ParsedMessage) -> Message:
    row = db.scalar(
        select(Message).where(Message.account_id == account_id, Message.folder_id == folder_id, Message.uid == uid)
    )
    if row is None and parsed.message_id:
        row = db.scalar(
            select(Message).where(
                Message.account_id == account_id,
                Message.folder_id == folder_id,
                Message.message_id == parsed.message_id,
            )
        )
    if row is None:
        row = Message(account_id=account_id, folder_id=folder_id, uid=uid or -1)
        db.add(row)
    row.uid = uid or row.uid
    row.message_id = parsed.message_id or row.message_id
    row.thread_id = thread_id_for(row.message_id, parsed.in_reply_to, parsed.references) or row.thread_id
    row.subject = parsed.subject or row.subject
    row.from_name = parsed.from_name
    row.from_email = parsed.from_email
    row.to_json = json.dumps(parsed.to)
    row.cc_json = json.dumps(parsed.cc)
    if parsed.date is not None:
        row.date = parsed.date
    if parsed.snippet:
        row.snippet = parsed.snippet
    row.in_reply_to = parsed.in_reply_to or row.in_reply_to
    if parsed.references:
        row.references_json = json.dumps(parsed.references)
    row.seen = parsed.seen
    row.flagged = parsed.flagged
    row.answered = parsed.answered
    if parsed.size:
        row.size = parsed.size
    if parsed.full:
        row.body_text = parsed.text
        row.body_html = parsed.html
        row.has_body = True
    elif not row.has_body and parsed.text:
        row.body_text = parsed.text
    db.flush()
    if uid <= 0 and row.uid <= 0:
        row.uid = -row.id
    if parsed.full and parsed.attachments:
        write_attachments(db, row, parsed.attachments)
    return row


def write_attachments(db: Session, message: Message, attachments: list[ParsedAttachment]) -> None:
    already = db.scalars(select(Attachment).where(Attachment.message_id == message.id)).first()
    if already is not None:
        return
    root = current_settings().attachment_dir
    root.mkdir(parents=True, exist_ok=True)
    for item in attachments:
        storage_name = ""
        if item.data and len(item.data) <= _MAX_ATTACHMENT:
            storage_name = f"{message.id}-{uuid.uuid4().hex}"
            (root / storage_name).write_bytes(item.data)
        db.add(
            Attachment(
                message_id=message.id,
                filename=(item.filename or "attachment").replace("\\", "_").replace("/", "_")[:240],
                content_type=item.content_type or "application/octet-stream",
                size=len(item.data),
                storage_name=storage_name,
                content_id=item.content_id or "",
                inline=bool(item.inline),
            )
        )


def add_local_message(
    db: Session,
    account_id: int,
    folder: Folder,
    *,
    subject: str,
    from_name: str,
    from_email: str,
    to: list[dict[str, str]],
    body: str,
    when: datetime,
    seen: bool = False,
    html: str = "",
    message_id: str = "",
    spam_score: float | None = None,
) -> Message:
    parsed = ParsedMessage(
        message_id=message_id,
        subject=subject,
        from_name=from_name,
        from_email=from_email,
        to=to,
        date=when,
        text=body,
        html=html,
        snippet=body[:180],
        seen=seen,
        full=True,
    )
    row = upsert_parsed(db, account_id, folder.id, -1_000_000_000, parsed)
    row.uid = -row.id
    row.spam_score = spam_score
    row.date = when
    return row
