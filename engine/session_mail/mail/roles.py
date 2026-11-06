from __future__ import annotations

from session_mail.mail.errors import MailError


def detect_role(flags: list[str], name: str) -> str:
    flagset = {flag.lstrip("\\").lower() for flag in flags}
    if "all" in flagset or "allmail" in flagset:
        return "all"
    mapping = {
        "inbox": "inbox",
        "sent": "sent",
        "drafts": "drafts",
        "junk": "spam",
        "spam": "spam",
        "trash": "trash",
        "archive": "archive",
    }
    for key, role in mapping.items():
        if key in flagset:
            return role
    leaf = name.replace("\\", "/").split("/")[-1].strip().lower()
    names = {
        "inbox": "inbox",
        "sent": "sent",
        "sent items": "sent",
        "sent mail": "sent",
        "drafts": "drafts",
        "draft": "drafts",
        "junk": "spam",
        "junk email": "spam",
        "spam": "spam",
        "bulk mail": "spam",
        "trash": "trash",
        "deleted": "trash",
        "deleted items": "trash",
        "deleted messages": "trash",
        "bin": "trash",
        "archive": "archive",
        "archives": "archive",
    }
    if leaf in names:
        return names[leaf]
    if name.lower() == "inbox":
        return "inbox"
    return "custom"


def assert_email(value: str) -> str:
    email = value.strip()
    if "@" not in email or email.startswith("@") or email.endswith("@"):
        raise MailError("Enter a full email address.")
    return email
