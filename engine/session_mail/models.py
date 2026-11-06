from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class MailSession(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    color: Mapped[str] = mapped_column(String(32), default="#1d4e89")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), index=True)
    email: Mapped[str] = mapped_column(String(320), index=True)
    username: Mapped[str] = mapped_column(String(320), default="")
    display_name: Mapped[str] = mapped_column(String(200), default="")
    provider: Mapped[str] = mapped_column(String(40), default="custom")
    auth_type: Mapped[str] = mapped_column(String(40), default="password")
    imap_host: Mapped[str] = mapped_column(String(255), default="")
    imap_port: Mapped[int] = mapped_column(Integer, default=993)
    imap_ssl: Mapped[bool] = mapped_column(Boolean, default=True)
    smtp_host: Mapped[str] = mapped_column(String(255), default="")
    smtp_port: Mapped[int] = mapped_column(Integer, default=587)
    smtp_mode: Mapped[str] = mapped_column(String(20), default="starttls")
    color: Mapped[str] = mapped_column(String(32), default="#0e6b52")
    sync_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Folder(Base):
    __tablename__ = "folders"
    __table_args__ = (UniqueConstraint("account_id", "imap_name", name="uq_folder_path"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    imap_name: Mapped[str] = mapped_column(String(500))
    role: Mapped[str] = mapped_column(String(32), default="custom", index=True)
    uidvalidity: Mapped[int] = mapped_column(Integer, default=0)
    highest_uid: Mapped[int] = mapped_column(Integer, default=0)


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (UniqueConstraint("account_id", "folder_id", "uid", name="uq_message_uid"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    folder_id: Mapped[int] = mapped_column(ForeignKey("folders.id", ondelete="CASCADE"), index=True)
    uid: Mapped[int] = mapped_column(Integer, default=0)
    message_id: Mapped[str] = mapped_column(String(998), default="")
    thread_id: Mapped[str] = mapped_column(String(998), default="", index=True)
    subject: Mapped[str] = mapped_column(Text, default="")
    from_name: Mapped[str] = mapped_column(Text, default="")
    from_email: Mapped[str] = mapped_column(String(320), default="", index=True)
    to_json: Mapped[str] = mapped_column(Text, default="[]")
    cc_json: Mapped[str] = mapped_column(Text, default="[]")
    date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    snippet: Mapped[str] = mapped_column(Text, default="")
    body_text: Mapped[str] = mapped_column(Text, default="")
    body_html: Mapped[str] = mapped_column(Text, default="")
    has_body: Mapped[bool] = mapped_column(Boolean, default=False)
    seen: Mapped[bool] = mapped_column(Boolean, default=False)
    flagged: Mapped[bool] = mapped_column(Boolean, default=False)
    answered: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_spam: Mapped[bool] = mapped_column(Boolean, default=False)
    spam_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    in_reply_to: Mapped[str] = mapped_column(String(998), default="")
    references_json: Mapped[str] = mapped_column(Text, default="[]")
    size: Mapped[int] = mapped_column(Integer, default=0)


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(500), default="attachment")
    content_type: Mapped[str] = mapped_column(String(200), default="application/octet-stream")
    size: Mapped[int] = mapped_column(Integer, default=0)
    storage_name: Mapped[str] = mapped_column(String(200), default="")


class Draft(Base):
    __tablename__ = "drafts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), index=True)
    to_text: Mapped[str] = mapped_column(Text, default="")
    cc_text: Mapped[str] = mapped_column(Text, default="")
    bcc_text: Mapped[str] = mapped_column(Text, default="")
    subject: Mapped[str] = mapped_column(Text, default="")
    body: Mapped[str] = mapped_column(Text, default="")
    in_reply_to: Mapped[str] = mapped_column(String(998), default="")
    references_json: Mapped[str] = mapped_column(Text, default="[]")
    reply_to_message_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class BlockEntry(Base):
    __tablename__ = "blocklist"
    __table_args__ = (UniqueConstraint("session_id", "value", name="uq_block"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="email")
    value: Mapped[str] = mapped_column(String(320))


class AllowEntry(Base):
    __tablename__ = "allowlist"
    __table_args__ = (UniqueConstraint("session_id", "value", name="uq_allow"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="email")
    value: Mapped[str] = mapped_column(String(320))


class SpamToken(Base):
    __tablename__ = "spam_tokens"
    __table_args__ = (UniqueConstraint("session_id", "token", name="uq_spam_token"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(Integer, index=True)
    token: Mapped[str] = mapped_column(String(80))
    ham_count: Mapped[int] = mapped_column(Integer, default=0)
    spam_count: Mapped[int] = mapped_column(Integer, default=0)


class SpamStat(Base):
    __tablename__ = "spam_stats"

    session_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ham_messages: Mapped[int] = mapped_column(Integer, default=0)
    spam_messages: Mapped[int] = mapped_column(Integer, default=0)


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
