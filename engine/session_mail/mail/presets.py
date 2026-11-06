from __future__ import annotations

PRESETS: dict[str, dict] = {
    "gmail": {
        "label": "Gmail",
        "imap_host": "imap.gmail.com",
        "imap_port": 993,
        "imap_ssl": True,
        "smtp_host": "smtp.gmail.com",
        "smtp_port": 587,
        "smtp_mode": "starttls",
        "oauth": "google",
        "hint": "Gmail blocks normal passwords. Use an app password, or Sign in with Google.",
    },
    "outlook": {
        "label": "Outlook / Microsoft 365",
        "imap_host": "outlook.office365.com",
        "imap_port": 993,
        "imap_ssl": True,
        "smtp_host": "smtp.office365.com",
        "smtp_port": 587,
        "smtp_mode": "starttls",
        "oauth": "microsoft",
        "hint": "Work and Outlook.com accounts need Sign in with Microsoft.",
    },
    "yahoo": {
        "label": "Yahoo",
        "imap_host": "imap.mail.yahoo.com",
        "imap_port": 993,
        "imap_ssl": True,
        "smtp_host": "smtp.mail.yahoo.com",
        "smtp_port": 465,
        "smtp_mode": "ssl",
        "oauth": None,
        "hint": "Yahoo needs an app password.",
    },
    "icloud": {
        "label": "iCloud",
        "imap_host": "imap.mail.me.com",
        "imap_port": 993,
        "imap_ssl": True,
        "smtp_host": "smtp.mail.me.com",
        "smtp_port": 587,
        "smtp_mode": "starttls",
        "oauth": None,
        "hint": "iCloud needs an app-specific password.",
    },
    "custom": {
        "label": "Custom IMAP",
        "imap_host": "",
        "imap_port": 993,
        "imap_ssl": True,
        "smtp_host": "",
        "smtp_port": 587,
        "smtp_mode": "starttls",
        "oauth": None,
        "hint": "Any host Thunderbird can add. Use SSL on IMAP port 993.",
    },
}

ACCOUNT_COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#8b5cf6", "#f43f5e", "#f59e0b"]


def apply_preset(
    provider: str,
    *,
    imap_host: str = "",
    imap_port: int | None = None,
    imap_ssl: bool | None = None,
    smtp_host: str = "",
    smtp_port: int | None = None,
    smtp_mode: str = "",
) -> dict:
    preset = PRESETS.get(provider) or PRESETS["custom"]
    host = imap_host.strip() or preset["imap_host"]
    shost = smtp_host.strip() or preset["smtp_host"]
    if provider == "custom" and (not host or not shost):
        from session_mail.mail.errors import MailError

        raise MailError("Custom accounts need an IMAP host and an SMTP host.")
    if not host or not shost:
        from session_mail.mail.errors import MailError

        raise MailError("This provider needs an IMAP host and an SMTP host.")
    return {
        "provider": provider if provider in PRESETS else "custom",
        "imap_host": host,
        "imap_port": imap_port or int(preset["imap_port"]),
        "imap_ssl": preset["imap_ssl"] if imap_ssl is None else imap_ssl,
        "smtp_host": shost,
        "smtp_port": smtp_port or int(preset["smtp_port"]),
        "smtp_mode": smtp_mode or preset["smtp_mode"],
    }
