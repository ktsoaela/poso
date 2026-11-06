def test_bearer_required(client):
    response = client.get("/api/bootstrap")
    assert response.status_code == 401


def test_messages_and_search_stay_inside_the_session(client, auth):
    seeded = client.post("/api/demo/seed", headers=auth)
    assert seeded.status_code == 200
    sessions = {row["name"]: row for row in seeded.json()["sessions"]}
    business = sessions["Business"]["id"]
    personal = sessions["Personal"]["id"]

    inbox = client.get("/api/messages", params={"session_id": business, "folder_role": "inbox"}, headers=auth)
    assert inbox.status_code == 200
    subjects = [row["subject"] for row in inbox.json()["messages"]]
    assert any("Dock ledger" in subject for subject in subjects)
    assert all("Zephyr" not in subject for subject in subjects)

    hidden = client.get("/api/messages", params={"session_id": business, "q": "zephyrinvoice"}, headers=auth)
    assert hidden.json()["messages"] == []
    found = client.get("/api/messages", params={"session_id": personal, "q": "zephyrinvoice"}, headers=auth)
    assert len(found.json()["messages"]) == 1
    assert found.json()["messages"][0]["account_email"] == "alex@personal.example"

    work = client.get("/api/messages", params={"session_id": business, "q": "dockledger"}, headers=auth)
    assert len(work.json()["messages"]) == 1


def test_report_spam_leaves_the_inbox(client, auth):
    seeded = client.post("/api/demo/seed", headers=auth)
    business = next(row["id"] for row in seeded.json()["sessions"] if row["name"] == "Business")
    inbox = client.get("/api/messages", params={"session_id": business, "folder_role": "inbox"}, headers=auth)
    standup = next(row for row in inbox.json()["messages"] if "Standup" in row["subject"])
    reported = client.post(f"/api/messages/{standup['id']}/spam", headers=auth)
    assert reported.status_code == 200
    assert reported.json()["folder_role"] == "spam"
    inbox_after = client.get("/api/messages", params={"session_id": business, "folder_role": "inbox"}, headers=auth)
    assert all(row["id"] != standup["id"] for row in inbox_after.json()["messages"])
    spam = client.get("/api/messages", params={"session_id": business, "folder_role": "spam"}, headers=auth)
    assert any(row["id"] == standup["id"] for row in spam.json()["messages"])
    blocked = client.get("/api/blocklist", params={"session_id": business}, headers=auth)
    assert any(row["value"] == "ben@northwind.example" for row in blocked.json()["entries"])
    restored = client.post(f"/api/messages/{standup['id']}/not-spam", headers=auth)
    assert restored.status_code == 200
    assert restored.json()["folder_role"] == "inbox"


def test_send_local_lands_in_sent(client, auth):
    seeded = client.post("/api/demo/seed", headers=auth)
    ada = next(row for row in seeded.json()["accounts"] if row["email"] == "ada@northwind.example")
    business = ada["session_id"]
    sent = client.post(
        "/api/send",
        headers=auth,
        json={
            "account_id": ada["id"],
            "to": "lina@quay.example",
            "subject": "Re: site visit",
            "body": "The dock will be clear.",
        },
    )
    assert sent.status_code == 200
    assert sent.json()["folder_role"] == "sent"
    listing = client.get("/api/messages", params={"session_id": business, "folder_role": "sent"}, headers=auth)
    assert any(row["subject"] == "Re: site visit" for row in listing.json()["messages"])
