"""Gmail-style search operators: from: to: subject: has:attachment is:unread label: in: before: after:"""

from __future__ import annotations

import re
import shlex
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

OPERATORS = {"from", "to", "subject", "has", "is", "label", "in", "before", "after", "account", "older", "newer"}
_REL = re.compile(r"^(\d+)([dwmy])$")


@dataclass
class SearchSpec:
    text: list[str] = field(default_factory=list)
    from_: list[str] = field(default_factory=list)
    to: list[str] = field(default_factory=list)
    subject: list[str] = field(default_factory=list)
    labels: list[str] = field(default_factory=list)
    folder: str = ""
    account: str = ""
    has_attachment: bool = False
    unread: bool | None = None
    flagged: bool | None = None
    snoozed: bool = False
    before: datetime | None = None
    after: datetime | None = None

    @property
    def empty(self) -> bool:
        return not any(
            [
                self.text, self.from_, self.to, self.subject, self.labels, self.folder, self.account,
                self.has_attachment, self.unread is not None, self.flagged is not None, self.snoozed,
                self.before, self.after,
            ]
        )


def _date(value: str) -> datetime | None:
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _relative(value: str) -> datetime | None:
    match = _REL.match(value.lower())
    if not match:
        return None
    amount, unit = int(match.group(1)), match.group(2)
    days = {"d": 1, "w": 7, "m": 30, "y": 365}[unit] * amount
    return datetime.now(timezone.utc) - timedelta(days=days)


def parse(raw: str) -> SearchSpec:
    spec = SearchSpec()
    try:
        tokens = shlex.split(raw or "")
    except ValueError:
        tokens = (raw or "").split()
    for token in tokens:
        key, sep, value = token.partition(":")
        key = key.lower()
        if not sep or key not in OPERATORS or not value:
            spec.text.append(token)
            continue
        lowered = value.lower()
        if key == "from":
            spec.from_.append(lowered)
        elif key == "to":
            spec.to.append(lowered)
        elif key == "subject":
            spec.subject.append(lowered)
        elif key == "label":
            spec.labels.append(lowered)
        elif key == "in":
            spec.folder = {"junk": "spam", "starred": "flagged", "bin": "trash"}.get(lowered, lowered)
        elif key == "account":
            spec.account = lowered
        elif key == "has" and lowered in {"attachment", "attachments", "file"}:
            spec.has_attachment = True
        elif key == "is":
            if lowered == "unread":
                spec.unread = True
            elif lowered == "read":
                spec.unread = False
            elif lowered in {"flagged", "starred", "important"}:
                spec.flagged = True
            elif lowered == "snoozed":
                spec.snoozed = True
        elif key == "before":
            spec.before = _date(value)
        elif key == "after":
            spec.after = _date(value)
        elif key == "older":
            spec.before = _relative(value)
        elif key == "newer":
            spec.after = _relative(value)
    return spec
