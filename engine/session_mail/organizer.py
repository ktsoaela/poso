"""Contacts, calendar events, to-do tasks, notes and reminders, plus the job that fires their alerts."""

from __future__ import annotations

import calendar
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import or_, select

from session_mail.audit import record
from session_mail.db import session_scope
from session_mail.hub import hub
from session_mail.mail.errors import MailError
from session_mail.models import Base, CalendarEvent, Contact, Note, Reminder, Task

log = logging.getLogger("session.organizer")

REPEATS = {"none", "daily", "weekdays", "weekly", "monthly", "yearly"}
# Alerts older than this when the engine first sees them are skipped rather than shown late.
STALE_EVENT = timedelta(hours=1)
STALE_TASK = timedelta(days=1)


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _utc(value: datetime | None) -> datetime | None:
    """SQLite keeps no offset, so everything is stored as UTC."""
    value = _aware(value)
    return value.astimezone(timezone.utc) if value is not None else None


def _iso(value: datetime | None) -> str | None:
    value = _aware(value)
    return value.isoformat() if value else None


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------- serializers ----------

def _contact_out(row: Contact) -> dict:
    return {
        "id": row.id, "session_id": row.session_id, "name": row.name, "email": row.email, "phone": row.phone,
        "company": row.company, "title": row.title, "address": row.address, "birthday": row.birthday,
        "notes": row.notes, "favorite": row.favorite, "updated_at": _iso(row.updated_at),
    }


def _event_out(row: CalendarEvent) -> dict:
    return {
        "id": row.id, "session_id": row.session_id, "title": row.title, "starts_at": _iso(row.starts_at),
        "ends_at": _iso(row.ends_at), "all_day": row.all_day, "location": row.location, "notes": row.notes,
        "color": row.color, "remind_minutes": row.remind_minutes, "updated_at": _iso(row.updated_at),
    }


def _task_out(row: Task) -> dict:
    return {
        "id": row.id, "session_id": row.session_id, "title": row.title, "notes": row.notes,
        "due_at": _iso(row.due_at), "important": row.important, "done": row.done, "done_at": _iso(row.done_at),
        "created_at": _iso(row.created_at), "updated_at": _iso(row.updated_at),
    }


def _note_out(row: Note) -> dict:
    return {
        "id": row.id, "session_id": row.session_id, "title": row.title, "body": row.body, "color": row.color,
        "pinned": row.pinned, "created_at": _iso(row.created_at), "updated_at": _iso(row.updated_at),
    }


def _reminder_out(row: Reminder) -> dict:
    return {
        "id": row.id, "session_id": row.session_id, "title": row.title, "notes": row.notes,
        "remind_at": _iso(row.remind_at), "repeat": row.repeat, "done": row.done, "fired_at": _iso(row.fired_at),
        "updated_at": _iso(row.updated_at),
    }


# kind -> (model, serializer, fields the client may write, audit noun)
KINDS: dict[str, tuple[type[Base], Any, set[str], str]] = {
    "contacts": (Contact, _contact_out, {"name", "email", "phone", "company", "title", "address", "birthday", "notes", "favorite"}, "contact"),
    "events": (CalendarEvent, _event_out, {"title", "starts_at", "ends_at", "all_day", "location", "notes", "color", "remind_minutes"}, "event"),
    "tasks": (Task, _task_out, {"title", "notes", "due_at", "important", "done"}, "task"),
    "notes": (Note, _note_out, {"title", "body", "color", "pinned"}, "note"),
    "reminders": (Reminder, _reminder_out, {"title", "notes", "remind_at", "repeat", "done"}, "reminder"),
}


def _spec(kind: str):
    spec = KINDS.get(kind)
    if spec is None:
        raise MailError("Unknown item type.")
    return spec


def _label(row: Any) -> str:
    return str(getattr(row, "title", "") or getattr(row, "name", "") or getattr(row, "email", "") or "")


def _apply(row: Any, kind: str, data: dict) -> None:
    _, _, allowed, _ = _spec(kind)
    before_due = {name: _aware(getattr(row, name, None)) for name in ("starts_at", "due_at", "remind_at")}
    before_lead = getattr(row, "remind_minutes", None)
    for key, value in data.items():
        if key not in allowed:
            continue
        if isinstance(value, datetime):
            value = _utc(value)
        if isinstance(value, str):
            value = value.strip() if key not in {"body", "notes", "address"} else value
        setattr(row, key, value)

    if kind == "events":
        if row.starts_at is None:
            raise MailError("An event needs a start time.")
        if row.ends_at is None or _aware(row.ends_at) < _aware(row.starts_at):
            row.ends_at = _aware(row.starts_at) + timedelta(hours=1)
        if row.remind_minutes is not None and row.remind_minutes < 0:
            row.remind_minutes = None
        if _aware(row.starts_at) != before_due["starts_at"] or row.remind_minutes != before_lead:
            row.notified_at = None
    if kind == "tasks":
        if "done" in data:
            row.done_at = _now() if row.done else None
        if _aware(row.due_at) != before_due["due_at"]:
            row.notified_at = None
    if kind == "reminders":
        if row.remind_at is None:
            raise MailError("A reminder needs a time.")
        if row.repeat not in REPEATS:
            row.repeat = "none"
        if _aware(row.remind_at) != before_due["remind_at"]:
            row.fired_at = None
    if kind in {"tasks", "notes", "reminders", "events"} and hasattr(row, "title"):
        row.title = (row.title or "")[:300]
    row.updated_at = _now()


# ---------- CRUD ----------

def list_items(kind: str, session_id: int, q: str = "", start: datetime | None = None, end: datetime | None = None) -> dict:
    model, out, _, _ = _spec(kind)
    with session_scope() as db:
        stmt = select(model).where(model.session_id == session_id)
        if kind == "events":
            if start is not None:
                stmt = stmt.where(CalendarEvent.ends_at >= _utc(start))
            if end is not None:
                stmt = stmt.where(CalendarEvent.starts_at < _utc(end))
            stmt = stmt.order_by(CalendarEvent.starts_at)
        elif kind == "contacts":
            stmt = stmt.order_by(Contact.favorite.desc(), Contact.name, Contact.email)
        elif kind == "tasks":
            stmt = stmt.order_by(Task.done, Task.due_at.is_(None), Task.due_at, Task.created_at.desc())
        elif kind == "notes":
            stmt = stmt.order_by(Note.pinned.desc(), Note.updated_at.desc())
        elif kind == "reminders":
            stmt = stmt.order_by(Reminder.done, Reminder.remind_at)
        rows = [out(row) for row in db.scalars(stmt).all()]
    needle = q.strip().lower()
    if needle:
        rows = [row for row in rows if any(needle in str(value).lower() for value in row.values() if isinstance(value, str))]
    return {"items": rows}


def create_item(kind: str, session_id: int, data: dict) -> dict:
    model, out, _, noun = _spec(kind)
    with session_scope() as db:
        row = model(session_id=session_id)
        if kind == "reminders":
            row.repeat = "none"
        _apply(row, kind, data)
        if kind == "contacts" and not (row.name or row.email or row.phone):
            raise MailError("Give the contact a name, email or phone number.")
        db.add(row)
        db.flush()
        record(db, f"{noun}.create", session_id=session_id, target=_label(row))
        result = out(row)
    hub.emit({"type": "organizer.changed", "kind": kind, "session_id": session_id})
    return result


def update_item(kind: str, item_id: int, data: dict) -> dict:
    model, out, _, noun = _spec(kind)
    with session_scope() as db:
        row = db.get(model, item_id)
        if row is None:
            raise MailError(f"That {noun} is gone.")
        _apply(row, kind, data)
        record(db, f"{noun}.update", session_id=row.session_id, target=_label(row))
        result = out(row)
        session_id = row.session_id
    hub.emit({"type": "organizer.changed", "kind": kind, "session_id": session_id})
    return result


def delete_item(kind: str, item_id: int) -> None:
    model, _, _, noun = _spec(kind)
    with session_scope() as db:
        row = db.get(model, item_id)
        if row is None:
            return
        session_id = row.session_id
        record(db, f"{noun}.delete", session_id=session_id, target=_label(row))
        db.delete(row)
    hub.emit({"type": "organizer.changed", "kind": kind, "session_id": session_id})


def snooze_reminder(item_id: int, minutes: int) -> dict:
    with session_scope() as db:
        row = db.get(Reminder, item_id)
        if row is None:
            raise MailError("That reminder is gone.")
        row.remind_at = _now() + timedelta(minutes=max(1, min(minutes, 60 * 24 * 30)))
        row.fired_at = None
        row.done = False
        row.updated_at = _now()
        record(db, "reminder.snooze", session_id=row.session_id, target=row.title, detail={"minutes": minutes})
        result = _reminder_out(row)
        session_id = row.session_id
    hub.emit({"type": "organizer.changed", "kind": "reminders", "session_id": session_id})
    return result


def saved_contacts(session_id: int) -> list[Contact]:
    with session_scope() as db:
        return list(db.scalars(select(Contact).where(Contact.session_id == session_id, Contact.email != "")).all())


# ---------- alerts ----------

def _add_months(value: datetime, months: int) -> datetime:
    month = value.month - 1 + months
    year = value.year + month // 12
    month = month % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


def next_occurrence(when: datetime, repeat: str, now: datetime) -> datetime | None:
    """The first repeat of ``when`` that is later than ``now``; None for one-off reminders."""
    if repeat not in REPEATS or repeat == "none":
        return None
    when = _aware(when)
    for _ in range(5000):
        if repeat == "daily":
            when += timedelta(days=1)
        elif repeat == "weekdays":
            when += timedelta(days=1)
            while when.weekday() >= 5:
                when += timedelta(days=1)
        elif repeat == "weekly":
            when += timedelta(weeks=1)
        elif repeat == "monthly":
            when = _add_months(when, 1)
        elif repeat == "yearly":
            when = _add_months(when, 12)
        if when > now:
            return when
    return None


def _describe_event(row: CalendarEvent, now: datetime) -> str:
    start = _aware(row.starts_at)
    lead = int((start - now).total_seconds() // 60)
    when = "now" if lead <= 0 else f"in {lead} min" if lead < 60 else f"in {lead // 60} h {lead % 60:02d} min"
    where = f" · {row.location}" if row.location else ""
    return f"Starts {when}{where}"


def fire_due() -> int:
    """Emit `reminder.due` for reminders, event alerts and task due times that have come up."""
    now = _now()
    alerts: list[dict] = []
    with session_scope() as db:
        reminders = db.scalars(
            select(Reminder).where(
                Reminder.done.is_(False),
                Reminder.remind_at <= now,
                or_(Reminder.fired_at.is_(None), Reminder.fired_at < Reminder.remind_at),
            )
        ).all()
        for row in reminders:
            alerts.append({"kind": "reminder", "id": row.id, "session_id": row.session_id, "title": row.title or "Reminder", "body": row.notes or "Reminder"})
            row.fired_at = now
            following = next_occurrence(row.remind_at, row.repeat, now)
            if following is not None:
                row.remind_at = following
            record(db, "reminder.fire", session_id=row.session_id, target=row.title, actor="system")

        events = db.scalars(
            select(CalendarEvent).where(
                CalendarEvent.remind_minutes.is_not(None),
                CalendarEvent.notified_at.is_(None),
                CalendarEvent.starts_at > now - STALE_EVENT,
            )
        ).all()
        for row in events:
            if _aware(row.starts_at) - timedelta(minutes=row.remind_minutes or 0) > now:
                continue
            row.notified_at = now
            alerts.append({"kind": "event", "id": row.id, "session_id": row.session_id, "title": row.title or "Event", "body": _describe_event(row, now), "at": _iso(row.starts_at)})

        tasks = db.scalars(
            select(Task).where(Task.done.is_(False), Task.due_at.is_not(None), Task.notified_at.is_(None), Task.due_at <= now, Task.due_at > now - STALE_TASK)
        ).all()
        for row in tasks:
            row.notified_at = now
            alerts.append({"kind": "task", "id": row.id, "session_id": row.session_id, "title": row.title or "Task", "body": "To-do is due"})

    for alert in alerts:
        hub.emit({"type": "reminder.due", **alert})
    if alerts:
        kinds = {f"{alert['kind']}s" for alert in alerts}
        for kind in kinds:
            hub.emit({"type": "organizer.changed", "kind": kind})
    return len(alerts)


def fire_when_listening() -> int:
    """Scheduler entry point. Alerts wait until a window is connected, so nothing fires into the void
    while Session is closed or starting; reminders missed in the meantime show on the next launch."""
    return fire_due() if hub.clients else 0


def upcoming(session_id: int, hours: int = 24) -> dict:
    """Events, tasks and reminders coming up soon; feeds the sidebar badges."""
    now = _now()
    horizon = now + timedelta(hours=max(1, min(hours, 24 * 31)))
    with session_scope() as db:
        events = db.scalars(
            select(CalendarEvent).where(CalendarEvent.session_id == session_id, CalendarEvent.ends_at >= now, CalendarEvent.starts_at < horizon).order_by(CalendarEvent.starts_at)
        ).all()
        tasks_due = db.scalars(
            select(Task).where(Task.session_id == session_id, Task.done.is_(False), Task.due_at.is_not(None), Task.due_at < horizon)
        ).all()
        open_tasks = db.scalars(select(Task.id).where(Task.session_id == session_id, Task.done.is_(False))).all()
        reminders = db.scalars(
            select(Reminder).where(Reminder.session_id == session_id, Reminder.done.is_(False), Reminder.remind_at < horizon).order_by(Reminder.remind_at)
        ).all()
        return {
            "events": [_event_out(row) for row in events],
            "tasks_due": [_task_out(row) for row in tasks_due],
            "open_tasks": len(open_tasks),
            "reminders": [_reminder_out(row) for row in reminders],
        }
