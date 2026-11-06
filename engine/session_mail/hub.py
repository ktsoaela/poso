from __future__ import annotations

import asyncio
from typing import Any

from fastapi import WebSocket


class Hub:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()
        self.loop: asyncio.AbstractEventLoop | None = None

    async def broadcast(self, payload: dict[str, Any]) -> None:
        stale: list[WebSocket] = []
        for socket in list(self.clients):
            try:
                await socket.send_json(payload)
            except Exception:
                stale.append(socket)
        for socket in stale:
            self.clients.discard(socket)

    def emit(self, payload: dict[str, Any]) -> None:
        loop = self.loop
        if loop is None or loop.is_closed():
            return

        def _go() -> None:
            loop.create_task(self.broadcast(payload))

        try:
            loop.call_soon_threadsafe(_go)
        except RuntimeError:
            return


hub = Hub()
