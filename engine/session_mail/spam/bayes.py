from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from session_mail.models import AllowEntry, BlockEntry, SpamStat, SpamToken

_TOKEN = re.compile(r"[a-z0-9']{3,}", re.IGNORECASE)
AUTO_THRESHOLD = 0.9
MIN_TRAINED = 8


def tokenize(text: str) -> list[str]:
    return _TOKEN.findall((text or "").lower())


def train(db: Session, session_id: int, text: str, is_spam: bool) -> None:
    tokens = list(dict.fromkeys(tokenize(text)))[:400]
    if not tokens:
        return
    stat = db.get(SpamStat, session_id)
    if stat is None:
        stat = SpamStat(session_id=session_id, ham_messages=0, spam_messages=0)
        db.add(stat)
    if is_spam:
        stat.spam_messages += 1
    else:
        stat.ham_messages += 1
    existing = {
        row.token: row
        for row in db.scalars(
            select(SpamToken).where(SpamToken.session_id == session_id, SpamToken.token.in_(tokens))
        ).all()
    }
    for token in tokens:
        row = existing.get(token)
        if row is None:
            row = SpamToken(session_id=session_id, token=token, ham_count=0, spam_count=0)
            db.add(row)
        if is_spam:
            row.spam_count += 1
        else:
            row.ham_count += 1


def score_text(db: Session, session_id: int, text: str) -> float:
    stat = db.get(SpamStat, session_id)
    if stat is None or stat.ham_messages < 1 or stat.spam_messages < 1:
        return 0.5
    tokens = list(dict.fromkeys(tokenize(text)))[:400]
    if not tokens:
        return 0.5
    rows = db.scalars(
        select(SpamToken).where(SpamToken.session_id == session_id, SpamToken.token.in_(tokens))
    ).all()
    found = {row.token: row for row in rows}
    interesting: list[float] = []
    for token in tokens:
        row = found.get(token)
        ham = row.ham_count if row else 0
        spam = row.spam_count if row else 0
        if ham + spam == 0:
            continue
        p_spam = (spam + 0.5) / (stat.spam_messages + 1)
        p_ham = (ham + 0.5) / (stat.ham_messages + 1)
        probability = p_spam / (p_spam + p_ham)
        interesting.append(min(0.99, max(0.01, probability)))
    if not interesting:
        return 0.5
    interesting.sort(key=lambda value: abs(value - 0.5), reverse=True)
    chosen = interesting[:20]
    product = 1.0
    inverse = 1.0
    for probability in chosen:
        product *= probability
        inverse *= 1 - probability
    if product + inverse == 0:
        return 0.5
    return product / (product + inverse)


def _listed(
    db: Session,
    model: type[BlockEntry] | type[AllowEntry],
    session_id: int,
    email: str,
    domain: str,
) -> bool:
    email_row = db.scalar(select(model).where(model.session_id == session_id, model.value == email))
    if email_row is not None:
        return True
    if not domain:
        return False
    domain_row = db.scalar(
        select(model).where(model.session_id == session_id, model.kind == "domain", model.value == domain)
    )
    return domain_row is not None


def evaluate(db: Session, session_id: int, text: str, from_email: str) -> tuple[str, float]:
    email = (from_email or "").lower().strip()
    domain = email.split("@", 1)[1] if "@" in email else ""
    score = score_text(db, session_id, text)
    if _listed(db, AllowEntry, session_id, email, domain):
        return "allow", score
    if _listed(db, BlockEntry, session_id, email, domain):
        return "move", max(score, 0.99)
    stat = db.get(SpamStat, session_id)
    trained = 0 if stat is None else stat.ham_messages + stat.spam_messages
    if trained >= MIN_TRAINED and score >= AUTO_THRESHOLD:
        return "move", score
    return "keep", score


def remember(db: Session, model: type[BlockEntry] | type[AllowEntry], session_id: int, email: str) -> None:
    value = email.lower().strip()
    if not value:
        return
    existing = db.scalar(select(model).where(model.session_id == session_id, model.value == value))
    if existing is None:
        db.add(model(session_id=session_id, kind="email", value=value))


def forget(db: Session, model: type[BlockEntry] | type[AllowEntry], session_id: int, email: str) -> None:
    value = email.lower().strip()
    row = db.scalar(select(model).where(model.session_id == session_id, model.value == value))
    if row is not None:
        db.delete(row)
