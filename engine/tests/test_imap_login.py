from session_mail.mail.imap_client import prefers_plain
from session_mail.mail.presets import normalize_password


GMAIL_CAPS = (
    b"IMAP4REV1",
    b"SASL-IR",
    b"AUTH=XOAUTH2",
    b"AUTH=PLAIN",
    b"AUTH=OAUTHBEARER",
)


def test_gmail_capabilities_use_plain():
    assert prefers_plain(GMAIL_CAPS) is True


def test_login_when_plain_is_absent():
    assert prefers_plain((b"IMAP4REV1", b"AUTH=LOGIN")) is False


def test_app_passwords_drop_printed_spaces():
    assert normalize_password("gmail", "abcd efgh ijkl mnop") == "abcdefghijklmnop"
    assert normalize_password("yahoo", "abcd efgh ijkl mnop") == "abcdefghijklmnop"
    assert normalize_password("custom", "my password") == "my password"
