from __future__ import annotations

from datetime import datetime, timedelta, timezone

from session_mail import organizer


def _sessions(client, auth) -> tuple[int, int]:
    boot = client.get("/api/bootstrap", headers=auth).json()
    ids = [row["id"] for row in boot["sessions"]]
    return ids[0], ids[1]


def _iso(delta: timedelta) -> str:
    return (datetime.now(timezone.utc) + delta).isoformat()


def test_crud_for_every_kind_stays_inside_its_session(client, auth):
    business, personal = _sessions(client, auth)
    samples = {
        "people": {"name": "Dana Reyes", "email": "dana@example.com", "phone": "+1 555 0100"},
        "events": {"title": "Board review", "starts_at": _iso(timedelta(days=1)), "ends_at": _iso(timedelta(days=1, hours=1))},
        "tasks": {"title": "Send invoice"},
        "notes": {"title": "Ideas", "body": "First line\nSecond line"},
        "reminders": {"title": "Call bank", "remind_at": _iso(timedelta(hours=2))},
    }
    for kind, body in samples.items():
        created = client.post(f"/api/{kind}", json={"session_id": business, **body}, headers=auth)
        assert created.status_code == 200, (kind, created.text)
        item = created.json()

        mine = client.get(f"/api/{kind}", params={"session_id": business}, headers=auth).json()["items"]
        assert [row["id"] for row in mine] == [item["id"]]
        theirs = client.get(f"/api/{kind}", params={"session_id": personal}, headers=auth).json()["items"]
        assert theirs == []

        patched = client.patch(f"/api/{kind}/{item['id']}", json={"notes": "updated"}, headers=auth)
        assert patched.status_code == 200
        removed = client.delete(f"/api/{kind}/{item['id']}", headers=auth)
        assert removed.status_code == 200
        assert client.get(f"/api/{kind}", params={"session_id": business}, headers=auth).json()["items"] == []


def test_unknown_kind_is_rejected(client, auth):
    response = client.get("/api/widgets", params={"session_id": 1}, headers=auth)
    assert response.status_code in {404, 422}


def test_event_end_defaults_after_start_and_window_filter(client, auth):
    business, _ = _sessions(client, auth)
    start = datetime(2030, 3, 10, 9, tzinfo=timezone.utc)
    event = client.post(
        "/api/events",
        json={"session_id": business, "title": "Bad end", "starts_at": start.isoformat(), "ends_at": (start - timedelta(hours=3)).isoformat()},
        headers=auth,
    ).json()
    assert datetime.fromisoformat(event["ends_at"]) == start + timedelta(hours=1)

    march = client.get("/api/events", params={"session_id": business, "start": "2030-03-01T00:00:00Z", "end": "2030-04-01T00:00:00Z"}, headers=auth)
    assert len(march.json()["items"]) == 1
    april = client.get("/api/events", params={"session_id": business, "start": "2030-04-01T00:00:00Z", "end": "2030-05-01T00:00:00Z"}, headers=auth)
    assert april.json()["items"] == []


def test_due_reminders_events_and_tasks_fire_once(client, auth):
    business, _ = _sessions(client, auth)
    client.post("/api/reminders", json={"session_id": business, "title": "Past", "remind_at": _iso(-timedelta(minutes=1))}, headers=auth)
    client.post("/api/reminders", json={"session_id": business, "title": "Future", "remind_at": _iso(timedelta(hours=3))}, headers=auth)
    client.post(
        "/api/events",
        json={"session_id": business, "title": "Soon", "starts_at": _iso(timedelta(minutes=5)), "remind_minutes": 10},
        headers=auth,
    )
    client.post(
        "/api/events",
        json={"session_id": business, "title": "Later", "starts_at": _iso(timedelta(hours=5)), "remind_minutes": 10},
        headers=auth,
    )
    client.post("/api/tasks", json={"session_id": business, "title": "Overdue", "due_at": _iso(-timedelta(minutes=2))}, headers=auth)

    assert organizer.fire_due() == 3
    assert organizer.fire_due() == 0

    reminders = client.get("/api/reminders", params={"session_id": business}, headers=auth).json()["items"]
    past = next(row for row in reminders if row["title"] == "Past")
    assert past["fired_at"] is not None and past["done"] is False


def test_repeating_reminder_moves_to_next_occurrence(client, auth):
    business, _ = _sessions(client, auth)
    first = datetime.now(timezone.utc) - timedelta(minutes=1)
    created = client.post(
        "/api/reminders", json={"session_id": business, "title": "Standup", "remind_at": first.isoformat(), "repeat": "daily"}, headers=auth
    ).json()
    assert organizer.fire_due() == 1
    row = next(item for item in client.get("/api/reminders", params={"session_id": business}, headers=auth).json()["items"] if item["id"] == created["id"])
    assert datetime.fromisoformat(row["remind_at"]) == first + timedelta(days=1)
    assert organizer.fire_due() == 0


def test_snooze_rearms_a_fired_reminder(client, auth):
    business, _ = _sessions(client, auth)
    created = client.post("/api/reminders", json={"session_id": business, "title": "Pay rent", "remind_at": _iso(-timedelta(minutes=1))}, headers=auth).json()
    assert organizer.fire_due() == 1
    snoozed = client.post(f"/api/reminders/{created['id']}/snooze", json={"minutes": 15}, headers=auth).json()
    assert snoozed["fired_at"] is None
    assert datetime.fromisoformat(snoozed["remind_at"]) > datetime.now(timezone.utc) + timedelta(minutes=14)


def test_next_occurrence_handles_month_ends_and_weekdays():
    now = datetime(2031, 1, 31, 12, tzinfo=timezone.utc)
    assert organizer.next_occurrence(datetime(2031, 1, 31, 9, tzinfo=timezone.utc), "monthly", now) == datetime(2031, 2, 28, 9, tzinfo=timezone.utc)
    friday = datetime(2031, 1, 3, 9, tzinfo=timezone.utc)  # a Friday
    assert organizer.next_occurrence(friday, "weekdays", friday) == datetime(2031, 1, 6, 9, tzinfo=timezone.utc)
    assert organizer.next_occurrence(friday, "none", friday) is None


def test_saved_contacts_feed_compose_autocomplete(client, auth):
    sessions = {row["name"]: row["id"] for row in client.post("/api/demo/seed", headers=auth).json()["sessions"]}
    business, personal = sessions["Business"], sessions["Personal"]
    client.post("/api/people", json={"session_id": business, "name": "Quinn Park", "email": "quinn@example.org"}, headers=auth)
    found = client.get("/api/contacts", params={"session_id": business, "q": "quinn"}, headers=auth).json()["contacts"]
    assert found and found[0]["email"] == "quinn@example.org" and found[0]["name"] == "Quinn Park"
    assert client.get("/api/contacts", params={"session_id": personal, "q": "quinn"}, headers=auth).json()["contacts"] == []


def test_times_with_an_offset_are_stored_as_utc(client, auth):
    business, _ = _sessions(client, auth)
    local = datetime.now(timezone(timedelta(hours=2))) - timedelta(minutes=1)
    created = client.post("/api/reminders", json={"session_id": business, "title": "Offset", "remind_at": local.isoformat()}, headers=auth).json()
    assert datetime.fromisoformat(created["remind_at"]) == local
    assert organizer.fire_due() == 1


def test_alerts_wait_for_a_connected_window(client, auth, monkeypatch):
    business, _ = _sessions(client, auth)
    client.post("/api/reminders", json={"session_id": business, "title": "Held", "remind_at": _iso(-timedelta(minutes=1))}, headers=auth)
    monkeypatch.setattr(organizer.hub, "clients", set())
    assert organizer.fire_when_listening() == 0
    monkeypatch.setattr(organizer.hub, "clients", {object()})
    assert organizer.fire_when_listening() == 1
