from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from imapclient import IMAPClient

from session_mail.mail.errors import MailError
from session_mail.mail.roles import detect_role
from session_mail.models import Account

log = logging.getLogger("session.imap")

HEADER_FETCH = ["FLAGS", "RFC822.SIZE", "ENVELOPE", "BODY.PEEK[HEADER]", "BODY.PEEK[TEXT]<0.16000>"]
FULL_FETCH = ["RFC822", "FLAGS"]


@dataclass
class RemoteFolder:
    name: str
    flags: list[str]
    role: str


def _text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return str(value)


def cap_names(capabilities) -> set[str]:
    names: set[str] = set()
    for item in capabilities:
        text = item.decode("ascii", "replace") if isinstance(item, bytes) else str(item)
        names.add(text.upper())
    return names


def prefers_plain(capabilities) -> bool:
    """Gmail and Yahoo advertise AUTH=PLAIN and reject the IMAP LOGIN command."""
    return "AUTH=PLAIN" in cap_names(capabilities)


def connect_account(account: Account, secret: dict) -> IMAPClient:
    try:
        client = IMAPClient(account.imap_host, port=account.imap_port, ssl=account.imap_ssl, timeout=30)
        if account.auth_type in {"oauth_google", "oauth_microsoft"}:
            from session_mail.auth.oauth import fresh_access_token

            token = fresh_access_token(account, secret)
            client.oauth2_login(account.username or account.email, token)
        else:
            password = secret.get("password") or ""
            if not password:
                raise MailError("This account has no password saved.")
            username = account.username or account.email
            names = cap_names(client.capabilities())
            if prefers_plain(names):
                client.plain_login(username, password)
            elif "LOGINDISABLED" in names:
                raise MailError("This server does not accept a password.")
            else:
                client.login(username, password)
        return client
    except MailError:
        raise
    except Exception as exc:
        raise MailError(f"Couldn't sign in to {account.email}: {exc}") from exc


def logout(client: IMAPClient) -> None:
    try:
        client.logout()
    except Exception:
        return


def list_remote_folders(client: IMAPClient) -> list[RemoteFolder]:
    folders: list[RemoteFolder] = []
    for flags, _delimiter, name in client.list_folders():
        flag_text = [_text(flag) for flag in flags]
        folder_name = _text(name)
        folders.append(RemoteFolder(name=folder_name, flags=flag_text, role=detect_role(flag_text, folder_name)))
    return folders


def select_folder(client: IMAPClient, name: str) -> dict:
    return client.select_folder(name, readonly=False)


def search_uids(client: IMAPClient) -> list[int]:
    uids = client.search(["ALL"])
    return sorted(int(uid) for uid in uids)


def fetch_headers(client: IMAPClient, uids: list[int]) -> dict:
    if not uids:
        return {}
    return client.fetch(uids, HEADER_FETCH)


def fetch_rfc822(client: IMAPClient, uid: int) -> bytes | None:
    data = client.fetch([uid], FULL_FETCH)
    item = data.get(uid) or data.get(str(uid))
    if not item:
        return None
    raw = item.get(b"RFC822") or item.get("RFC822")
    if raw is None:
        return None
    return bytes(raw)


def store_flags(client: IMAPClient, uid: int, *, seen: bool | None, flagged: bool | None) -> None:
    if seen is True:
        client.add_flags([uid], [b"\\Seen"])
    elif seen is False:
        client.remove_flags([uid], [b"\\Seen"])
    if flagged is True:
        client.add_flags([uid], [b"\\Flagged"])
    elif flagged is False:
        client.remove_flags([uid], [b"\\Flagged"])


def move_uid(client: IMAPClient, uid: int, dest_name: str) -> None:
    try:
        client.move([uid], dest_name)
    except Exception:
        client.copy([uid], dest_name)
        client.add_flags([uid], [b"\\Deleted"])
        client.expunge()


def append_raw(client: IMAPClient, folder: str, raw: bytes) -> None:
    client.append(folder, raw, flags=[b"\\Seen"], msg_time=datetime.now(timezone.utc))


def ensure_mailbox(client: IMAPClient, name: str) -> None:
    try:
        client.create_folder(name)
    except Exception:
        return


def idle_for(client: IMAPClient, seconds: int = 25) -> None:
    try:
        caps = { _text(cap).upper() for cap in client.capabilities() }
        if "IDLE" not in caps:
            return
        client.idle()
        try:
            client.idle_check(timeout=seconds)
        finally:
            client.idle_done()
    except Exception:
        log.debug("IDLE ended early", exc_info=True)


def flags_from_item(item: dict) -> tuple[bool, bool, bool]:
    raw = item.get(b"FLAGS") or item.get("FLAGS") or ()
    text = {_text(flag).lower() for flag in raw}
    return "\\seen" in text, "\\flagged" in text, "\\answered" in text


def header_bytes(item: dict) -> bytes:
    raw = item.get(b"BODY[HEADER]") or item.get("BODY[HEADER]") or b""
    return bytes(raw) if raw else b""


def preview_bytes(item: dict) -> bytes:
    for key, value in item.items():
        name = key.decode() if isinstance(key, bytes) else str(key)
        if name.startswith("BODY[TEXT]"):
            return bytes(value or b"")
    return b""


def size_from_item(item: dict) -> int:
    raw = item.get(b"RFC822.SIZE") or item.get("RFC822.SIZE") or 0
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


def delete_uid(client: IMAPClient, uid: int) -> None:
    client.add_flags([uid], [b"\\Deleted"])
    try:
        client.uid_expunge([uid])
    except Exception:
        client.expunge()
