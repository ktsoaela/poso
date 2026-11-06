from __future__ import annotations

import asyncio

from sqlalchemy import select

from session_mail.db import session_scope
from session_mail.models import Account, Setting
from session_mail.sync.runner import sync_account


class SyncManager:
    def __init__(self) -> None:
        self.wake_event = asyncio.Event()
        self.stop = asyncio.Event()

    def wake(self) -> None:
        self.wake_event.set()

    async def run(self) -> None:
        while not self.stop.is_set():
            accounts = await asyncio.to_thread(_account_rows)
            active = await asyncio.to_thread(_active_session)
            jobs = []
            saw_active = False
            ordered = sorted(accounts, key=lambda item: item[1] != active)
            for account_id, session_id, auth_type, enabled in ordered:
                if not enabled or auth_type == "local":
                    continue
                idle = session_id == active and not saw_active
                if session_id == active:
                    saw_active = True
                jobs.append(asyncio.to_thread(sync_account, account_id, idle))
            if jobs:
                await asyncio.gather(*jobs, return_exceptions=True)
            if self.stop.is_set():
                break
            try:
                await asyncio.wait_for(self.wake_event.wait(), timeout=20)
            except TimeoutError:
                pass
            self.wake_event.clear()


def _account_rows() -> list[tuple[int, int, str, bool]]:
    with session_scope() as db:
        rows = db.scalars(select(Account)).all()
        return [(row.id, row.session_id, row.auth_type, row.sync_enabled) for row in rows]


def _active_session() -> int:
    with session_scope() as db:
        row = db.get(Setting, "active_session_id")
        if row and str(row.value).isdigit():
            return int(row.value)
        return 0
