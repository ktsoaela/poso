from session_mail.mail.roles import detect_role


def test_special_use_and_common_names():
    assert detect_role(["\\Inbox"], "INBOX") == "inbox"
    assert detect_role(["\\Sent"], "Sent Items") == "sent"
    assert detect_role(["\\Junk"], "Junk Email") == "spam"
    assert detect_role([], "Trash") == "trash"
    assert detect_role(["\\All"], "[Gmail]/All Mail") == "all"
    assert detect_role([], "Projects") == "custom"
    assert detect_role([], "INBOX") == "inbox"
