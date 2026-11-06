from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email import policy
from email.header import decode_header, make_header
from email.message import EmailMessage, Message
from email.utils import getaddresses, parsedate_to_datetime

import nh3

_TAG = re.compile(r"<[^>]+>")
_NON_TEXT = re.compile(r"<(style|script|head|title)\b[^>]*>.*?</\1\s*>", re.IGNORECASE | re.DOTALL)
_SPACE = re.compile(r"\s+")
_MAX_TEXT = 1_000_000
_MAX_HTML = 1_500_000


_LAYOUT_ATTRS = {
    "style", "class", "id", "align", "valign", "bgcolor", "background", "width", "height",
    "border", "cellpadding", "cellspacing", "color", "face", "size", "dir", "lang", "role",
    "colspan", "rowspan", "nowrap", "start", "type",
}
_TAGS = set(nh3.ALLOWED_TAGS) | {"style", "font", "center"}
_ATTRIBUTES = {key: set(value) for key, value in nh3.ALLOWED_ATTRIBUTES.items()}
_ATTRIBUTES["*"] = _LAYOUT_ATTRS
_ATTRIBUTES.setdefault("img", set()).update({"src", "alt", "title", "width", "height"})
_ATTRIBUTES.setdefault("a", set()).update({"href", "title", "target"})
_URL_SCHEMES = {"http", "https", "mailto", "tel", "cid", "data"}


@dataclass
class ParsedAttachment:
    filename: str
    content_type: str
    data: bytes
    content_id: str = ""
    inline: bool = False


@dataclass
class ParsedMessage:
    message_id: str = ""
    subject: str = ""
    from_name: str = ""
    from_email: str = ""
    to: list[dict[str, str]] = field(default_factory=list)
    cc: list[dict[str, str]] = field(default_factory=list)
    date: datetime | None = None
    in_reply_to: str = ""
    references: list[str] = field(default_factory=list)
    text: str = ""
    html: str = ""
    snippet: str = ""
    attachments: list[ParsedAttachment] = field(default_factory=list)
    size: int = 0
    seen: bool = False
    flagged: bool = False
    answered: bool = False
    full: bool = False
    uid: int = 0


def thread_id_for(message_id: str, in_reply_to: str, references: list[str]) -> str:
    if references:
        return references[0]
    if in_reply_to:
        return in_reply_to
    return message_id or ""


def decode_header_value(value: str | None) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return value


def _addresses(value: str | None) -> list[dict[str, str]]:
    found = []
    for name, email in getaddresses([value or ""]):
        email = (email or "").strip()
        if not email:
            continue
        found.append({"name": decode_header_value(name), "email": email})
    return found


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _references(value: str | None) -> list[str]:
    if not value:
        return []
    return re.findall(r"<[^>]+>", value) or value.split()


def html_to_text(html: str) -> str:
    import html as html_lib

    text = _TAG.sub(" ", _NON_TEXT.sub(" ", html))
    text = html_lib.unescape(text)
    return _SPACE.sub(" ", text).strip()


def sanitize_html(html: str) -> str:
    """Keep the sender's layout (CSS, tables, inline images) and drop anything executable.

    The reader also renders mail inside a sandboxed iframe with a CSP, so remote
    loads stay blocked until the person asks for them.
    """
    if not html:
        return ""
    try:
        cleaned = nh3.clean(
            html,
            tags=_TAGS,
            clean_content_tags={"script"},
            attributes=_ATTRIBUTES,
            generic_attribute_prefixes={"data-"},
            url_schemes=_URL_SCHEMES,
            link_rel="noopener noreferrer",
            strip_comments=True,
        )
    except Exception:
        return ""
    if len(cleaned) > _MAX_HTML:
        return cleaned[:_MAX_HTML]
    return cleaned


def make_snippet(text: str, limit: int = 180) -> str:
    flat = _SPACE.sub(" ", text).strip()
    if len(flat) <= limit:
        return flat
    return flat[: limit - 1].rstrip() + "…"


def _walk_parts(message: Message) -> tuple[str, str, list[ParsedAttachment]]:
    text_parts: list[str] = []
    html_parts: list[str] = []
    attachments: list[ParsedAttachment] = []
    for part in message.walk():
        if part.is_multipart():
            continue
        disposition = (part.get_content_disposition() or "").lower()
        content_type = part.get_content_type()
        payload = part.get_payload(decode=True) or b""
        filename = part.get_filename()
        if filename:
            filename = decode_header_value(filename)
        content_id = (part.get("Content-ID") or "").strip().strip("<>")
        is_text = content_type in {"text/plain", "text/html"}
        if content_id and not is_text and disposition != "attachment":
            attachments.append(
                ParsedAttachment(
                    filename=filename or f"inline-{content_id[:40]}",
                    content_type=content_type,
                    data=payload,
                    content_id=content_id,
                    inline=True,
                )
            )
            continue
        if disposition == "attachment" or (filename and not is_text):
            attachments.append(
                ParsedAttachment(
                    filename=filename or "attachment",
                    content_type=content_type,
                    data=payload,
                    content_id=content_id,
                )
            )
            continue
        charset = part.get_content_charset() or "utf-8"
        try:
            decoded = payload.decode(charset, errors="replace")
        except LookupError:
            decoded = payload.decode("utf-8", errors="replace")
        if content_type == "text/plain":
            text_parts.append(decoded)
        elif content_type == "text/html":
            html_parts.append(decoded)
    return "\n".join(text_parts).strip(), "\n".join(html_parts).strip(), attachments


def parse_message(raw: bytes, *, full: bool = True) -> ParsedMessage:
    message = EmailMessage()
    try:
        parsed: Message = __import__("email").message_from_bytes(raw, policy=policy.default)
    except Exception:
        parsed = message
    text, html, attachments = _walk_parts(parsed) if full else ("", "", [])
    if not full:
        try:
            header = __import__("email").message_from_bytes(raw, policy=policy.default)
        except Exception:
            header = parsed
        parsed = header
    from_list = _addresses(parsed.get("From"))
    from_name = from_list[0]["name"] if from_list else ""
    from_email = from_list[0]["email"] if from_list else ""
    if not text and html:
        text = html_to_text(html)
    if len(text) > _MAX_TEXT:
        text = text[:_MAX_TEXT]
    html = sanitize_html(html) if full else ""
    references = _references(parsed.get("References"))
    in_reply_to = (parsed.get("In-Reply-To") or "").strip()
    return ParsedMessage(
        message_id=(parsed.get("Message-ID") or "").strip(),
        subject=decode_header_value(parsed.get("Subject")),
        from_name=from_name,
        from_email=from_email,
        to=_addresses(parsed.get("To")),
        cc=_addresses(parsed.get("Cc")),
        date=_parse_date(parsed.get("Date")),
        in_reply_to=in_reply_to,
        references=references,
        text=text,
        html=html,
        snippet=make_snippet(text or html_to_text(html)),
        attachments=attachments if full else [],
        size=len(raw),
        full=full,
    )


def parse_header_and_preview(header: bytes, preview: bytes) -> ParsedMessage:
    parsed = parse_message(header + b"\r\n", full=False)
    if preview:
        try:
            preview_text = preview.decode("utf-8", errors="replace")
        except Exception:
            preview_text = ""
        if "<" in preview_text and ">" in preview_text:
            preview_text = html_to_text(preview_text)
        preview_text = preview_text.strip()
        if preview_text:
            parsed.text = preview_text[:20_000]
            parsed.snippet = make_snippet(preview_text)
    parsed.full = False
    return parsed
