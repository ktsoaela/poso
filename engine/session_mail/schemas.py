from __future__ import annotations

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


class OAuthStart(BaseModel):
    provider: str
    session_id: int


class SettingsUpdate(BaseModel):
    theme: str | None = None
    density: str | None = None
    load_remote_images: bool | None = None
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


class DraftIn(BaseModel):
    id: int | None = None
    account_id: int
    to: str = ""
    cc: str = ""
    bcc: str = ""
    subject: str = ""
    body: str = ""
    in_reply_to: str = ""
    references: list[str] = Field(default_factory=list)
    reply_to_message_id: int | None = None
