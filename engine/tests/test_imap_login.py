from session_mail.mail.imap_client import explain_sign_in_error, prefers_plain
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


def test_gmail_rejects_account_password_in_plain_language():
    message = explain_sign_in_error(
        "ada@example.com",
        "imap.gmail.com",
        Exception("[AUTHENTICATIONFAILED] Invalid credentials (Failure)"),
    )
    assert "app password" in message
    assert "Couldn't sign in" not in message


def test_app_passwords_drop_printed_spaces():
    assert normalize_password("gmail", "abcd efgh ijkl mnop") == "abcdefghijklmnop"
    assert normalize_password("yahoo", "abcd efgh ijkl mnop") == "abcdefghijklmnop"
    assert normalize_password("custom", "my password") == "my password"
