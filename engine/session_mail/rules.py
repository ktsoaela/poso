"""Outlook-style rules / Thunderbird-style filters evaluated against incoming mail."""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from session_mail.mail.errors import MailError
from session_mail.models import Account, Label, MessageLabel, Rule

FIELDS = {"from", "to", "subject", "body", "any", "account"}
OPS = {"contains", "not_contains", "equals", "starts_with", "ends_with"}
ACTIONS = {"move", "label", "read", "flag", "spam", "archive", "trash"}
MOVE_ROLES = {"inbox", "archive", "trash", "spam"}


def _loads(raw: str) -> list:
    try:
        value = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    return value if isinstance(value, list) else []


def validate(conditions: list[dict], actions: list[dict]) -> tuple[list[dict], list[dict]]:
    clean_conditions = []
    for item in conditions:
        field = str(item.get("field", "")).lower()
        op = str(item.get("op", "contains")).lower()
        value = str(item.get("value", "")).strip()
        if field not in FIELDS or op not in OPS or not value:
            raise MailError("Each condition needs a field, a test, and a value.")
        clean_conditions.append({"field": field, "op": op, "value": value})
    if not clean_conditions:
        raise MailError("Add at least one condition.")
    clean_actions = []
    for item in actions:
        kind = str(item.get("type", "")).lower()
        if kind not in ACTIONS:
            raise MailError("Choose what the rule should do.")
        action: dict = {"type": kind}
        if kind == "move":
            role = str(item.get("role", "")).lower()
            if role not in MOVE_ROLES:
                raise MailError("Choose a folder to move to.")
            action["role"] = role
        if kind == "label":
            try:
                action["label_id"] = int(item.get("label_id"))
            except (TypeError, ValueError) as exc:
                raise MailError("Choose a label.") from exc
        clean_actions.append(action)
    if not clean_actions:
        raise MailError("Add at least one action.")
    return clean_conditions, clean_actions


def rule_out(row: Rule) -> dict:
    return {
        "id": row.id,
        "session_id": row.session_id,
        "name": row.name,
        "enabled": row.enabled,
        "match": row.match,
        "conditions": _loads(row.conditions_json),
        "actions": _loads(row.actions_json),
        "stop": row.stop,
        "sort_order": row.sort_order,
    }


def _haystack(message, account_email: str, field: str) -> str:
    to_list = _loads(message.to_json) + _loads(message.cc_json)
    to_text = " ".join(f"{item.get('name', '')} {item.get('email', '')}" for item in to_list if isinstance(item, dict))
    values = {
        "from": f"{message.from_name} {message.from_email}",
        "to": to_text,
        "subject": message.subject or "",
        "body": f"{message.snippet or ''} {message.body_text or ''}",
        "account": account_email,
    }
    if field == "any":
        return " ".join(values.values()).lower()
    return values.get(field, "").lower()


def _test(op: str, haystack: str, needle: str) -> bool:
    needle = needle.lower()
    if op == "contains":
        return needle in haystack
    if op == "not_contains":
        return needle not in haystack
    if op == "equals":
        return haystack.strip() == needle or needle in haystack.split()
    if op == "starts_with":
        return haystack.strip().startswith(needle)
    if op == "ends_with":
        return haystack.strip().endswith(needle)
    return False


def matches(rule: dict, message, account_email: str) -> bool:
    results = [
        _test(cond["op"], _haystack(message, account_email, cond["field"]), cond["value"])
        for cond in rule["conditions"]
    ]
    if not results:
        return False
    return all(results) if rule["match"] == "all" else any(results)


def plan(db: Session, session_id: int, message) -> list[tuple[dict, dict]]:
    """Return (rule, action) pairs for every enabled rule matching the message, in rule order."""
    account = db.get(Account, message.account_id)
    email = account.email if account else ""
    rules = db.scalars(
        select(Rule).where(Rule.session_id == session_id, Rule.enabled.is_(True)).order_by(Rule.sort_order, Rule.id)
    ).all()
    planned: list[tuple[dict, dict]] = []
    for row in rules:
        rule = rule_out(row)
        if not matches(rule, message, email):
            continue
        for action in rule["actions"]:
            planned.append((rule, action))
        if rule["stop"]:
            break
    return planned


def apply_label(db: Session, message_id: int, label_id: int) -> bool:
    if db.get(Label, label_id) is None:
        return False
    exists = db.scalar(
        select(MessageLabel).where(MessageLabel.message_id == message_id, MessageLabel.label_id == label_id)
    )
    if exists is None:
        db.add(MessageLabel(message_id=message_id, label_id=label_id))
    return True


def target_role(action: dict) -> str | None:
    kind = action["type"]
    if kind == "move":
        return action["role"]
    if kind in {"archive", "trash", "spam"}:
        return kind
    return None
