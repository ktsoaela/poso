from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class SessionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    color: str = ""


class SessionUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    sort_order: int | None = None


class AccountCreate(BaseModel):
    session_id: int
    email: str
    display_name: str = ""
    provider: str = "custom"
    password: str = ""
    username: str = ""
    imap_host: str = ""
    imap_port: int | None = None
    imap_ssl: bool | None = None
    smtp_host: str = ""
    smtp_port: int | None = None
    smtp_mode: str = ""


class AccountUpdate(BaseModel):
    session_id: int | None = None
    display_name: str | None = None
    color: str | None = None
    sync_enabled: bool | None = None
    password: str | None = None
    signature: str | None = None


class OAuthStart(BaseModel):
    provider: str
    session_id: int


class SettingsUpdate(BaseModel):
    theme: str | None = None
    density: str | None = None
    load_remote_images: bool | None = None
    reading_pane: str | None = None
    accent: str | None = None
    undo_send_seconds: int | None = None
    notify: bool | None = None
    conversations: bool | None = None
    active_session_id: int | None = None
    google_client_id: str | None = None
    google_client_secret: str | None = None
    microsoft_client_id: str | None = None
    microsoft_client_secret: str | None = None


class FlagUpdate(BaseModel):
    seen: bool | None = None
    flagged: bool | None = None


class MoveRequest(BaseModel):
    role: str


class AttachmentIn(BaseModel):
    filename: str
    content_type: str = "application/octet-stream"
    data_base64: str


class SendRequest(BaseModel):
    account_id: int
    to: str
    cc: str = ""
    bcc: str = ""
    subject: str = ""
    body: str = ""
    in_reply_to: str = ""
    references: list[str] = Field(default_factory=list)
    reply_to_message_id: int | None = None
    draft_id: int | None = None
    attachments: list[AttachmentIn] = Field(default_factory=list)
    body_html: str = ""
    send_at: datetime | None = None
    priority: str = "normal"
    read_receipt: bool = False


class DraftIn(BaseModel):
    id: int | None = None
    account_id: int
    to: str = ""
    cc: str = ""
    bcc: str = ""
    subject: str = ""
    body: str = ""
    body_html: str = ""
    in_reply_to: str = ""
    references: list[str] = Field(default_factory=list)
    reply_to_message_id: int | None = None


class LabelIn(BaseModel):
    session_id: int
    name: str = Field(min_length=1, max_length=80)
    color: str = "#6366f1"


class LabelUpdate(BaseModel):
    name: str | None = None
    color: str | None = None


class MessageLabels(BaseModel):
    add: list[int] = Field(default_factory=list)
    remove: list[int] = Field(default_factory=list)


class SnoozeRequest(BaseModel):
    until: datetime | None = None


class PinRequest(BaseModel):
    pinned: bool


class BulkRequest(BaseModel):
    ids: list[int]
    action: str
    label_id: int | None = None
    until: datetime | None = None


class RuleIn(BaseModel):
    session_id: int
    name: str = Field(min_length=1, max_length=120)
    enabled: bool = True
    match: str = "all"
    conditions: list[dict] = Field(default_factory=list)
    actions: list[dict] = Field(default_factory=list)
    stop: bool = False


class EmptyRequest(BaseModel):
    session_id: int
    role: str


class OrganizerItem(BaseModel):
    """One shape for contacts, events, tasks, notes and reminders; each kind keeps only its own fields."""

    session_id: int | None = None
    name: str | None = Field(default=None, max_length=200)
    email: str | None = Field(default=None, max_length=320)
    phone: str | None = Field(default=None, max_length=80)
    company: str | None = Field(default=None, max_length=200)
    title: str | None = Field(default=None, max_length=300)
    address: str | None = None
    birthday: str | None = Field(default=None, max_length=10)
    notes: str | None = None
    favorite: bool | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    all_day: bool | None = None
    location: str | None = Field(default=None, max_length=300)
    color: str | None = Field(default=None, max_length=32)
    remind_minutes: int | None = None
    due_at: datetime | None = None
    important: bool | None = None
    done: bool | None = None
    body: str | None = None
    pinned: bool | None = None
    remind_at: datetime | None = None
    repeat: str | None = None


class SnoozeMinutes(BaseModel):
    minutes: int = Field(default=10, ge=1, le=60 * 24 * 30)
