"""Extra sample content for "Explore with sample mail": rich HTML, attachments, labels, threads, rules."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta

from sqlalchemy import select

from session_mail.db import current_settings
from session_mail.mail.store import add_local_message, folder_by_role
from session_mail.models import Account, Attachment, Label, MailSession, MessageLabel, Rule

NEWSLETTER = """
<html><head><style>
  .wrap{max-width:600px;margin:0 auto;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a}
  .hero{background:linear-gradient(135deg,#4f46e5,#9333ea);color:#fff;border-radius:16px;padding:32px}
  .hero h1{margin:0 0 8px;font-size:28px}
  .grid td{padding:12px;vertical-align:top}
  .card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px}
  .btn{display:inline-block;background:#fff;color:#4f46e5;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600}
  .muted{color:#64748b;font-size:12px}
</style></head><body>
<div class="wrap">
  <div class="hero">
    <h1>Harbor Weekly</h1>
    <p>Freight rates, port congestion and three things to watch this week.</p>
    <a class="btn" href="https://example.com/read">Read the full issue</a>
  </div>
  <table class="grid" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td width="50%"><div class="card">
      <img alt="Chart" width="100%" src="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 90'%3E%3Crect width='240' height='90' rx='10' fill='%23eef2ff'/%3E%3Cpolyline fill='none' stroke='%234f46e5' stroke-width='4' points='10,70 50,55 90,60 130,30 170,38 230,14'/%3E%3C/svg%3E">
      <h3 style="margin:10px 0 4px">Rates eased 4%</h3>
      <p style="margin:0">Spot container rates slipped for a second week.</p>
    </div></td>
    <td width="50%"><div class="card">
      <img alt="Port photo (remote)" width="100%" height="90" style="border-radius:8px;object-fit:cover" src="https://images.unsplash.com/photo-1494412574643-ff11b0a5c1c3?w=480">
      <h3 style="margin:10px 0 4px">Quay 7 reopens</h3>
      <p style="margin:0">Berthing resumes Monday after dredging works.</p>
    </div></td>
  </tr></table>
  <p class="muted">You get this because you follow Harbor Weekly. <a href="https://example.com/unsubscribe">Unsubscribe</a></p>
</div></body></html>
"""

RECEIPT = """
<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden">
  <div style="background:#0f172a;color:#fff;padding:20px 24px;font-size:18px;font-weight:600">Receipt · Skyline Air</div>
  <div style="padding:20px 24px">
    <p>Thanks for flying with us, Alex. Your booking <b>SKY-48D2</b> is confirmed.</p>
    <table width="100%" style="border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 0;color:#6b7280">Route</td><td align="right">JNB → CPT</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280">Date</td><td align="right">Fri, 14 Nov · 07:10</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280">Seat</td><td align="right">12A</td></tr>
      <tr style="border-top:1px solid #e5e7eb"><td style="padding:10px 0;font-weight:700">Total</td><td align="right" style="font-weight:700">R 1 849.00</td></tr>
    </table>
  </div>
</div>
"""


def _label(db, session_id: int, name: str, color: str) -> Label:
    row = db.scalar(select(Label).where(Label.session_id == session_id, Label.name == name))
    if row is None:
        row = Label(session_id=session_id, name=name, color=color)
        db.add(row)
        db.flush()
    return row


def _attach(db, message_id: int, filename: str, content_type: str, data: bytes) -> None:
    root = current_settings().attachment_dir
    root.mkdir(parents=True, exist_ok=True)
    storage = f"{message_id}-{uuid.uuid4().hex}"
    (root / storage).write_bytes(data)
    db.add(Attachment(message_id=message_id, filename=filename, content_type=content_type, size=len(data), storage_name=storage))


def seed_extras(db, made: dict[str, Account], business: MailSession, personal: MailSession, now: datetime, html_body) -> None:
    clients = _label(db, business.id, "Clients", "#0ea5e9")
    finance = _label(db, business.id, "Finance", "#10b981")
    urgent = _label(db, business.id, "Urgent", "#ef4444")
    family = _label(db, personal.id, "Family", "#ec4899")
    travel = _label(db, personal.id, "Travel", "#f59e0b")

    def put(email: str, role: str, labels: list[Label] | None = None, **kwargs):
        account = made[email]
        folder = folder_by_role(db, account.id, role)
        body = kwargs.pop("body")
        html = kwargs.pop("html", None) or html_body(body)
        to = kwargs.pop("to", None) or [{"name": account.display_name, "email": email}]
        flagged = kwargs.pop("flagged", False)
        pinned = kwargs.pop("pinned", False)
        thread = kwargs.pop("thread", "")
        row = add_local_message(db, account.id, folder, to=to, body=body, html=html, **kwargs)
        row.flagged = flagged
        row.pinned = pinned
        if thread:
            row.thread_id = thread
            row.in_reply_to = thread
            row.references_json = json.dumps([thread])
        db.flush()
        for label in labels or []:
            db.add(MessageLabel(message_id=row.id, label_id=label.id))
        return row

    put(
        "ada@northwind.example", "inbox", [clients],
        subject="Harbor Weekly: rates eased 4%", from_name="Harbor Weekly", from_email="news@harborweekly.example",
        body="Freight rates, port congestion and three things to watch this week.", html=NEWSLETTER,
        when=now - timedelta(minutes=25), seen=False, message_id="<weekly-48@harborweekly.example>",
    )
    forecast = put(
        "cio@northwind.example", "inbox", [finance, urgent],
        subject="Q4 forecast — numbers for review", from_name="Priya Natarajan", from_email="priya@northwind.example",
        body="Hi Cio,\n\nAttached is the Q4 forecast. Freight volume is up 6% and the yard lease renews in January. Could you sign off by Thursday?\n\nThanks,\nPriya",
        when=now - timedelta(hours=1, minutes=10), seen=False, message_id="<q4@northwind.example>", flagged=True, pinned=True,
    )
    _attach(db, forecast.id, "Q4-forecast.csv", "text/csv", b"month,volume,revenue\nOct,1240,412000\nNov,1302,433500\nDec,1388,461900\n")
    _attach(
        db, forecast.id, "yard-lease-summary.txt", "text/plain",
        b"Yard lease: 3 years, renewal 1 Jan, 3% escalation, 90 day notice.\n",
    )
    first = put(
        "ben@northwind.example", "inbox", [clients],
        subject="Pallet labels for the Quay order", from_name="Lina Vos", from_email="lina@quay.example",
        body="Ben, can we switch to the new pallet labels from next week's Quay order?",
        when=now - timedelta(days=1, hours=3), seen=True, message_id="<labels-1@quay.example>", thread="<labels-1@quay.example>",
    )
    first.thread_id = "<labels-1@quay.example>"
    put(
        "ben@northwind.example", "sent",
        subject="Re: Pallet labels for the Quay order", from_name="Ben", from_email="ben@northwind.example",
        to=[{"name": "Lina Vos", "email": "lina@quay.example"}],
        body="Yes — I'll print a test batch tomorrow and send photos.",
        when=now - timedelta(days=1, hours=1), seen=True, message_id="<labels-2@northwind.example>", thread="<labels-1@quay.example>",
    )
    put(
        "ben@northwind.example", "inbox", [clients],
        subject="Re: Pallet labels for the Quay order", from_name="Lina Vos", from_email="lina@quay.example",
        body="Perfect, photos look great. Go ahead with the full run.",
        when=now - timedelta(hours=3), seen=False, message_id="<labels-3@quay.example>", thread="<labels-1@quay.example>",
    )
    put(
        "cio@northwind.example", "archive",
        subject="Invoice INV-2207 paid", from_name="Accounts", from_email="billing@tugboat.example",
        body="Payment for invoice INV-2207 has been received. Thank you.",
        when=now - timedelta(days=6), seen=True, message_id="<inv2207@tugboat.example>",
    )
    put(
        "alex@personal.example", "inbox", [travel],
        subject="Your flight to Cape Town is confirmed", from_name="Skyline Air", from_email="no-reply@skyline.example",
        body="Booking SKY-48D2 is confirmed. JNB to CPT, Fri 14 Nov 07:10, seat 12A.", html=RECEIPT,
        when=now - timedelta(hours=4), seen=False, message_id="<sky48d2@skyline.example>", flagged=True,
    )
    put(
        "sam@personal.example", "inbox", [family],
        subject="Sunday lunch at Mom's?", from_name="Thandi Iyer", from_email="thandi@family.example",
        body="Mom is making her lamb potjie. 1pm? Bring the camera, she wants new photos for the album.",
        when=now - timedelta(hours=7), seen=False, message_id="<lunch@family.example>",
    )
    put(
        "sam@personal.example", "spam",
        subject="Congratulations!!! Claim your crypto bonus", from_name="Wallet Rewards", from_email="bonus@coinrain.example",
        body="Click now to claim your crypto bonus. Limited offer, act today.",
        when=now - timedelta(days=1), seen=False, message_id="<bonus@coinrain.example>", spam_score=0.98,
    )
    if db.scalar(select(Rule).where(Rule.session_id == business.id, Rule.name == "Invoices to Finance")) is None:
        db.add(
            Rule(
                session_id=business.id,
                name="Invoices to Finance",
                match="any",
                conditions_json=json.dumps([
                    {"field": "subject", "op": "contains", "value": "invoice"},
                    {"field": "from", "op": "contains", "value": "billing@"},
                ]),
                actions_json=json.dumps([{"type": "label", "label_id": finance.id}]),
            )
        )
    signatures = {
        "ada@northwind.example": "<p>—<br><b>Ada Moyo</b> · Operations, Northwind Freight<br>+27 11 555 0100</p>",
        "ben@northwind.example": "<p>—<br><b>Ben Okonkwo</b> · Yard Lead, Northwind Freight</p>",
        "cio@northwind.example": "<p>—<br><b>Cio Mensah</b> · CFO, Northwind Freight</p>",
        "alex@personal.example": "<p>Cheers,<br>Alex</p>",
    }
    for email, signature in signatures.items():
        made[email].signature = signature
