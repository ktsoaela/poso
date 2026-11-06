"""Append-only audit trail of everything Session does to mail, accounts, and settings."""

from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from session_mail.models import AuditEvent

FIELDS = ["id", "at", "session_id", "account_id", "actor", "action", "target", "detail"]


def record(
    db: Session,
    action: str,
    *,
    session_id: int | None = None,
    account_id: int | None = None,
    target: str = "",
    detail: str | dict = "",
    actor: str = "you",
) -> None:
    if isinstance(detail, dict):
        detail = json.dumps(detail, ensure_ascii=False, default=str)
    db.add(
        AuditEvent(
            at=datetime.now(timezone.utc),
            session_id=session_id,
            account_id=account_id,
            actor=actor,
            action=action,
            target=(target or "")[:500],
            detail=(detail or "")[:4000],
        )
    )


def _out(row: AuditEvent) -> dict:
    at = row.at
    if at is not None and at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    return {
        "id": row.id,
        "at": at.isoformat() if at else None,
        "session_id": row.session_id,
        "account_id": row.account_id,
        "actor": row.actor,
        "action": row.action,
        "target": row.target,
        "detail": row.detail,
    }


def query(
    db: Session,
    *,
    session_id: int | None = None,
    action: str = "",
    q: str = "",
    since: datetime | None = None,
    until: datetime | None = None,
    limit: int = 200,
    offset: int = 0,
) -> dict:
    stmt = select(AuditEvent)
    if session_id is not None:
        stmt = stmt.where(or_(AuditEvent.session_id == session_id, AuditEvent.session_id.is_(None)))
    if action:
        stmt = stmt.where(AuditEvent.action.like(f"{action}%"))
    if q.strip():
        needle = f"%{q.strip()}%"
        stmt = stmt.where(or_(AuditEvent.target.like(needle), AuditEvent.detail.like(needle), AuditEvent.action.like(needle)))
    if since is not None:
        stmt = stmt.where(AuditEvent.at >= since)
    if until is not None:
        stmt = stmt.where(AuditEvent.at <= until)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(AuditEvent.at.desc(), AuditEvent.id.desc()).limit(limit).offset(offset)).all()
    actions = [row[0] for row in db.execute(select(AuditEvent.action).distinct().order_by(AuditEvent.action)).all()]
    return {"events": [_out(row) for row in rows], "total": int(total), "actions": actions}


def export(db: Session, fmt: str, session_id: int | None = None) -> tuple[bytes, str, str]:
    data = query(db, session_id=session_id, limit=1_000_000)["events"]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    if fmt == "csv":
        buffer = io.StringIO()
        writer = csv.DictWriter(buffer, fieldnames=FIELDS)
        writer.writeheader()
        for row in data:
            writer.writerow(row)
        return buffer.getvalue().encode("utf-8-sig"), f"session-audit-{stamp}.csv", "text/csv"
    body = json.dumps({"exported_at": stamp, "events": data}, indent=2, ensure_ascii=False)
    return body.encode("utf-8"), f"session-audit-{stamp}.json", "application/json"
