from __future__ import annotations

from datetime import datetime, timedelta, timezone


def _seed(client, auth):
    data = client.post("/api/demo/seed", headers=auth).json()
    sessions = {row["name"]: row["id"] for row in data["sessions"]}
    accounts = {row["email"]: row for row in data["accounts"]}
    return data, sessions, accounts


def _list(client, auth, **params):
    response = client.get("/api/messages", params=params, headers=auth)
    assert response.status_code == 200, response.text
    return response.json()["messages"]


def test_bootstrap_has_version_labels_and_settings(client, auth):
    data, sessions, _ = _seed(client, auth)
    assert data["version"]
    assert {row["name"] for row in data["labels"] if row["session_id"] == sessions["Business"]} >= {"Clients", "Finance", "Urgent"}
    assert data["settings"]["reading_pane"] == "right"
    assert data["settings"]["undo_send_seconds"] == 5


def test_search_operators(client, auth):
    _, sessions, _ = _seed(client, auth)
    business = sessions["Business"]
    from_lina = _list(client, auth, session_id=business, q="from:lina@quay.example")
    assert from_lina and all(row["from_email"] == "lina@quay.example" for row in from_lina)
    with_files = _list(client, auth, session_id=business, q="has:attachment")
    assert [row["subject"] for row in with_files] == ["Q4 forecast — numbers for review"]
    assert with_files[0]["has_attachments"] is True
    labelled = _list(client, auth, session_id=business, q="label:finance")
    assert any("Q4 forecast" in row["subject"] for row in labelled)
    unread_subject = _list(client, auth, session_id=business, q="is:unread subject:harbor")
    assert len(unread_subject) == 1
    assert _list(client, auth, session_id=business, q="label:nope") == []


def test_virtual_folders_and_pinning(client, auth):
    _, sessions, _ = _seed(client, auth)
    business = sessions["Business"]
    flagged = _list(client, auth, session_id=business, folder_role="flagged")
    assert any(row["flagged"] for row in flagged)
    inbox = _list(client, auth, session_id=business, folder_role="inbox")
    assert inbox[0]["pinned"] is True


def test_snooze_hides_from_inbox_and_wakes(client, auth):
    _, sessions, _ = _seed(client, auth)
    business = sessions["Business"]
    target = _list(client, auth, session_id=business, folder_role="inbox", q="dockledger")[0]
    until = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
    assert client.post(f"/api/messages/{target['id']}/snooze", json={"until": until}, headers=auth).status_code == 200
    assert all(row["id"] != target["id"] for row in _list(client, auth, session_id=business, folder_role="inbox"))
    assert any(row["id"] == target["id"] for row in _list(client, auth, session_id=business, folder_role="snoozed"))

    from session_mail.db import session_scope
    from session_mail.features import wake_snoozed
    from session_mail.models import Message

    with session_scope() as db:
        db.get(Message, target["id"]).snoozed_until = datetime.now(timezone.utc) - timedelta(minutes=1)
    assert wake_snoozed() == 1
    assert any(row["id"] == target["id"] for row in _list(client, auth, session_id=business, folder_role="inbox"))


def test_labels_and_bulk_actions(client, auth):
    _, sessions, _ = _seed(client, auth)
    business = sessions["Business"]
    label = client.post("/api/labels", json={"session_id": business, "name": "Board"}, headers=auth).json()
    inbox = _list(client, auth, session_id=business, folder_role="inbox")
    ids = [row["id"] for row in inbox[:2]]
    result = client.post("/api/bulk", json={"ids": ids, "action": "label", "label_id": label["id"]}, headers=auth).json()
    assert result["done"] == 2
    tagged = _list(client, auth, session_id=business, label_id=label["id"])
    assert {row["id"] for row in tagged} == set(ids)
    client.post("/api/bulk", json={"ids": ids, "action": "archive"}, headers=auth)
    archive = _list(client, auth, session_id=business, folder_role="archive")
    assert set(ids) <= {row["id"] for row in archive}


def test_rules_run_on_inbox(client, auth):
    _, sessions, _ = _seed(client, auth)
    business = sessions["Business"]
    rule = client.post(
        "/api/rules",
        json={
            "session_id": business,
            "name": "Newsletters away",
            "conditions": [{"field": "from", "op": "contains", "value": "harborweekly"}],
            "actions": [{"type": "read"}, {"type": "archive"}],
        },
        headers=auth,
    )
    assert rule.status_code == 200, rule.text
    assert client.post("/api/rules/run", params={"session_id": business}, headers=auth).json()["matched"] >= 1
    archive = _list(client, auth, session_id=business, folder_role="archive")
    weekly = next(row for row in archive if "Harbor Weekly" in row["subject"])
    assert weekly["seen"] is True
    bad = client.post("/api/rules", json={"session_id": business, "name": "x", "conditions": [], "actions": []}, headers=auth)
    assert bad.status_code == 400


def test_html_keeps_styles_and_strips_scripts(client, auth):
    _, sessions, _ = _seed(client, auth)
    weekly = _list(client, auth, session_id=sessions["Business"], q="subject:weekly")[0]
    detail = client.get(f"/api/messages/{weekly['id']}", headers=auth).json()
    assert "<style>" in detail["body_html"]
    assert "linear-gradient" in detail["body_html"]

    from session_mail.mail.parse import sanitize_html

    cleaned = sanitize_html('<div style="color:red" onclick="x()">a<script>alert(1)</script><img src="cid:logo"></div>')
    assert "script" not in cleaned and "onclick" not in cleaned
    assert 'style="color:red"' in cleaned and 'src="cid:logo"' in cleaned


def test_inline_cid_images_become_data_uris(client, auth):
    _, sessions, accounts = _seed(client, auth)
    raw = (
        b"From: Logo Co <hi@logo.example>\r\nTo: ada@northwind.example\r\nSubject: Inline logo\r\n"
        b"Message-ID: <inline@logo.example>\r\nMIME-Version: 1.0\r\n"
        b'Content-Type: multipart/related; boundary="b1"\r\n\r\n'
        b"--b1\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Hello <img src=\"cid:logo1\"></p>\r\n"
        b"--b1\r\nContent-Type: image/png\r\nContent-ID: <logo1>\r\nContent-Transfer-Encoding: base64\r\n\r\niVBORw0KGgo=\r\n"
        b"--b1--\r\n"
    )
    account = accounts["ada@northwind.example"]
    result = client.post(
        "/api/import",
        data={"account_id": str(account["id"]), "folder_role": "inbox"},
        files=[("files", ("logo.eml", raw, "message/rfc822"))],
        headers=auth,
    ).json()
    assert result["imported"] == 1
    row = _list(client, auth, session_id=sessions["Business"], q="subject:inline")[0]
    detail = client.get(f"/api/messages/{row['id']}", headers=auth).json()
    assert "data:image/png;base64," in detail["body_html"]
    assert detail["attachments"] == []


def test_export_import_roundtrip_and_backup(client, auth):
    _, sessions, accounts = _seed(client, auth)
    business = sessions["Business"]
    mbox = client.get("/api/export", params={"fmt": "mbox", "session_id": business}, headers=auth)
    assert mbox.status_code == 200
    assert mbox.content.startswith(b"From ")
    assert "attachment" in mbox.headers["content-disposition"]

    sam = accounts["sam@personal.example"]
    imported = client.post(
        "/api/import",
        data={"account_id": str(sam["id"]), "folder_role": "archive"},
        files=[("files", ("business.mbox", mbox.content, "application/mbox"))],
        headers=auth,
    ).json()
    assert imported["imported"] >= 8
    archive = _list(client, auth, session_id=sessions["Personal"], folder_role="archive", q="dockledger")
    assert len(archive) == 1

    again = client.post(
        "/api/import",
        data={"account_id": str(sam["id"]), "folder_role": "archive"},
        files=[("files", ("business.mbox", mbox.content, "application/mbox"))],
        headers=auth,
    ).json()
    assert again["imported"] == imported["imported"]
    assert len(_list(client, auth, session_id=sessions["Personal"], folder_role="archive", q="dockledger")) == 1

    backup = client.get("/api/export", params={"fmt": "json"}, headers=auth)
    assert backup.status_code == 200
    restored = client.post("/api/restore", files={"file": ("b.json", backup.content, "application/json")}, headers=auth).json()
    assert restored["messages"] > 0

    zipped = client.get("/api/export", params={"fmt": "eml", "session_id": business}, headers=auth)
    assert zipped.content[:2] == b"PK"
    contacts = client.get("/api/export", params={"fmt": "contacts", "session_id": business}, headers=auth)
    assert b"lina@quay.example" in contacts.content


def test_scheduled_send_goes_through_outbox(client, auth):
    _, sessions, accounts = _seed(client, auth)
    ada = accounts["ada@northwind.example"]
    when = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    scheduled = client.post(
        "/api/send",
        json={"account_id": ada["id"], "to": "lina@quay.example", "subject": "Later", "body_html": "<p><b>Hi</b> Lina</p>", "send_at": when},
        headers=auth,
    ).json()
    assert scheduled["scheduled"] is True
    outbox = client.get("/api/outbox", params={"session_id": sessions["Business"]}, headers=auth).json()["items"]
    assert outbox[0]["subject"] == "Later"

    from session_mail.db import session_scope
    from session_mail.features import flush_outbox
    from session_mail.models import OutboxItem

    with session_scope() as db:
        db.get(OutboxItem, scheduled["id"]).send_at = datetime.now(timezone.utc) - timedelta(seconds=5)
    assert flush_outbox() == 1
    sent = _list(client, auth, session_id=sessions["Business"], folder_role="sent", q="subject:later")
    assert len(sent) == 1
    detail = client.get(f"/api/messages/{sent[0]['id']}", headers=auth).json()
    assert "<b>Hi</b>" in detail["body_html"]


def test_delete_forever_and_empty_trash(client, auth):
    _, sessions, _ = _seed(client, auth)
    business = sessions["Business"]
    inbox = _list(client, auth, session_id=business, folder_role="inbox")
    client.post(f"/api/messages/{inbox[0]['id']}/move", json={"role": "trash"}, headers=auth)
    client.post(f"/api/messages/{inbox[1]['id']}/move", json={"role": "trash"}, headers=auth)
    assert client.delete(f"/api/messages/{inbox[0]['id']}", headers=auth).json()["deleted"] == 1
    assert client.post("/api/folders/empty", json={"session_id": business, "role": "trash"}, headers=auth).json()["deleted"] == 1
    assert _list(client, auth, session_id=business, folder_role="trash") == []
    assert client.post("/api/folders/empty", json={"session_id": business, "role": "inbox"}, headers=auth).status_code == 400


def test_audit_log_records_and_exports(client, auth):
    _, sessions, accounts = _seed(client, auth)
    business = sessions["Business"]
    inbox = _list(client, auth, session_id=business, folder_role="inbox")
    client.post(f"/api/messages/{inbox[0]['id']}/spam", headers=auth)
    client.post("/api/send", json={"account_id": accounts["ada@northwind.example"]["id"], "to": "x@y.example", "subject": "Audit me"}, headers=auth)
    log = client.get("/api/audit", params={"session_id": business}, headers=auth).json()
    actions = {row["action"] for row in log["events"]}
    assert {"spam.report", "message.move", "message.send", "demo.seed"} <= actions
    sends = client.get("/api/audit", params={"session_id": business, "action": "message.send"}, headers=auth).json()
    assert sends["total"] == 1 and sends["events"][0]["target"] == "Audit me"
    csv = client.get("/api/audit/export", params={"fmt": "csv", "session_id": business}, headers=auth)
    assert csv.status_code == 200 and b"message.send" in csv.content


def test_contacts_autocomplete(client, auth):
    _, sessions, _ = _seed(client, auth)
    found = client.get("/api/contacts", params={"session_id": sessions["Business"], "q": "lin"}, headers=auth).json()["contacts"]
    assert found[0]["email"] == "lina@quay.example"
    personal = client.get("/api/contacts", params={"session_id": sessions["Personal"], "q": "lina"}, headers=auth).json()["contacts"]
    assert personal == []


def test_old_database_gets_new_columns(tmp_path, monkeypatch):
    import sqlite3

    db_path = tmp_path / "mail.db"
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE accounts (id INTEGER PRIMARY KEY, session_id INTEGER, email VARCHAR(320))")
    conn.commit()
    conn.close()
    monkeypatch.setenv("SESSION_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SESSION_SECRET_STORE", "file")
    from session_mail.config import load_settings
    from session_mail.db import init_db, reset_db_state

    reset_db_state()
    init_db(load_settings())
    conn = sqlite3.connect(db_path)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(accounts)")}
    conn.close()
    assert {"signature", "color", "sync_enabled"} <= columns
    reset_db_state()


def test_invalid_recipients_are_rejected(client, auth):
    _, _, accounts = _seed(client, auth)
    ada = accounts["ada@northwind.example"]["id"]
    bad = client.post("/api/send", json={"account_id": ada, "to": "lin", "subject": "x"}, headers=auth)
    assert bad.status_code == 400 and "valid email" in bad.json()["detail"]
    ok = client.post("/api/send", json={"account_id": ada, "to": "Lina Vos <lina@quay.example>", "cc": "x@y.example", "subject": "y"}, headers=auth)
    assert ok.status_code == 200
