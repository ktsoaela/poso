from __future__ import annotations

import asyncio
import contextlib
import logging
import secrets
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from session_mail.config import load_settings
from session_mail.db import init_db
from session_mail.hub import hub
from session_mail.mail.errors import MailError
from session_mail.schemas import (
    AccountCreate,
    AccountUpdate,
    DraftIn,
    FlagUpdate,
    MoveRequest,
    OAuthStart,
    SendRequest,
    SessionCreate,
    SessionUpdate,
    SettingsUpdate,
)
from session_mail.services import (
    attachment_file,
    bootstrap,
    connect_oauth_account,
    create_password_account,
    create_session,
    delete_account,
    delete_block,
    delete_draft,
    delete_session,
    get_message,
    list_blocklist,
    list_drafts,
    list_messages,
    list_providers,
    mark_not_spam,
    move_message,
    report_spam,
    save_draft,
    seed_demo,
    send_mail,
    set_flags,
    undo_auto_spam,
    update_account,
    update_session,
    update_settings,
)
from session_mail.sync.runner import sync_account
from session_mail.sync.worker import SyncManager

log = logging.getLogger("session")
_settings = None


def create_app() -> FastAPI:
    settings = load_settings()
    init_db(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        hub.loop = asyncio.get_running_loop()
        app.state.settings = settings
        app.state.sync = None
        task = None
        if not settings.disable_sync:
            manager = SyncManager()
            app.state.sync = manager
            task = asyncio.create_task(manager.run())
        yield
        if app.state.sync is not None:
            app.state.sync.stop.set()
            app.state.sync.wake()
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    app = FastAPI(title="Session", lifespan=lifespan)
    app.state.settings = settings
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:1420",
            "http://127.0.0.1:1420",
            "tauri://localhost",
            "http://tauri.localhost",
            "https://tauri.localhost",
        ],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def require_bearer(authorization: str | None = Header(default=None)) -> None:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Sign-in required")
        got = authorization.removeprefix("Bearer ").strip()
        expected = settings.token
        if not secrets.compare_digest(got, expected):
            raise HTTPException(status_code=401, detail="Sign-in required")

    async def call(func, *args):
        try:
            return await asyncio.to_thread(func, *args)
        except MailError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    def wake(request: Request) -> None:
        manager = getattr(request.app.state, "sync", None)
        if manager is not None:
            manager.wake()

    @app.get("/health")
    def health() -> dict:
        return {"ok": True}

    @app.get("/api/providers")
    async def providers(_auth: None = Depends(require_bearer)) -> list:
        return list_providers()

    @app.get("/api/bootstrap")
    async def get_bootstrap(_auth: None = Depends(require_bearer)) -> dict:
        return await call(bootstrap)

    @app.post("/api/sessions")
    async def post_session(body: SessionCreate, _auth: None = Depends(require_bearer)) -> dict:
        return await call(create_session, body.name, body.color)

    @app.patch("/api/sessions/{session_id}")
    async def patch_session(session_id: int, body: SessionUpdate, _auth: None = Depends(require_bearer)) -> dict:
        return await call(update_session, session_id, body.name, body.color, body.sort_order)

    @app.delete("/api/sessions/{session_id}")
    async def remove_session(session_id: int, _auth: None = Depends(require_bearer)) -> dict:
        await call(delete_session, session_id)
        return {"ok": True}

    @app.patch("/api/settings")
    async def patch_settings(body: SettingsUpdate, request: Request, _auth: None = Depends(require_bearer)) -> dict:
        result = await call(update_settings, body)
        wake(request)
        return result

    @app.post("/api/accounts")
    async def post_account(body: AccountCreate, request: Request, _auth: None = Depends(require_bearer)) -> dict:
        account = await call(create_password_account, body)
        wake(request)
        asyncio.create_task(asyncio.to_thread(sync_account, account["id"], False))
        return account

    @app.patch("/api/accounts/{account_id}")
    async def patch_account(account_id: int, body: AccountUpdate, request: Request, _auth: None = Depends(require_bearer)) -> dict:
        account = await call(update_account, account_id, body)
        wake(request)
        return account

    @app.delete("/api/accounts/{account_id}")
    async def remove_account(account_id: int, _auth: None = Depends(require_bearer)) -> dict:
        await call(delete_account, account_id)
        return {"ok": True}

    @app.post("/api/accounts/{account_id}/sync")
    async def post_sync(account_id: int, _auth: None = Depends(require_bearer)) -> dict:
        asyncio.create_task(asyncio.to_thread(sync_account, account_id, False))
        return {"ok": True}

    @app.post("/api/oauth/start")
    async def oauth_start(body: OAuthStart, request: Request, _auth: None = Depends(require_bearer)) -> dict:
        account = await call(connect_oauth_account, body.provider, body.session_id)
        wake(request)
        asyncio.create_task(asyncio.to_thread(sync_account, account["id"], False))
        return account

    @app.get("/api/messages")
    async def get_messages(
        session_id: int,
        folder_role: str | None = None,
        folder_id: int | None = None,
        account_id: int | None = None,
        q: str = "",
        limit: int = 200,
        offset: int = 0,
        _auth: None = Depends(require_bearer),
    ) -> dict:
        return await call(list_messages, session_id, folder_role, folder_id, account_id, q, limit, offset)

    @app.get("/api/messages/{message_id}")
    async def read_message(message_id: int, _auth: None = Depends(require_bearer)) -> dict:
        return await call(get_message, message_id)

    @app.get("/api/messages/{message_id}/attachments/{attachment_id}")
    async def download_attachment(message_id: int, attachment_id: int, _auth: None = Depends(require_bearer)):
        path, filename, media = await call(attachment_file, message_id, attachment_id)
        return FileResponse(path, filename=filename, media_type=media)

    @app.post("/api/messages/{message_id}/flags")
    async def flags(message_id: int, body: FlagUpdate, _auth: None = Depends(require_bearer)) -> dict:
        return await call(set_flags, message_id, body.seen, body.flagged)

    @app.post("/api/messages/{message_id}/move")
    async def move(message_id: int, body: MoveRequest, _auth: None = Depends(require_bearer)) -> dict:
        return await call(move_message, message_id, body.role)

    @app.post("/api/messages/{message_id}/spam")
    async def spam(message_id: int, _auth: None = Depends(require_bearer)) -> dict:
        return await call(report_spam, message_id)

    @app.post("/api/messages/{message_id}/not-spam")
    async def not_spam(message_id: int, _auth: None = Depends(require_bearer)) -> dict:
        return await call(mark_not_spam, message_id)

    @app.post("/api/messages/{message_id}/spam/undo")
    async def undo_spam(message_id: int, _auth: None = Depends(require_bearer)) -> dict:
        return await call(undo_auto_spam, message_id)

    @app.post("/api/send")
    async def send(body: SendRequest, _auth: None = Depends(require_bearer)) -> dict:
        return await call(send_mail, body)

    @app.get("/api/drafts")
    async def drafts(session_id: int = Query(...), _auth: None = Depends(require_bearer)) -> dict:
        return await call(list_drafts, session_id)

    @app.put("/api/drafts")
    async def put_draft(body: DraftIn, _auth: None = Depends(require_bearer)) -> dict:
        return await call(save_draft, body)

    @app.delete("/api/drafts/{draft_id}")
    async def remove_draft(draft_id: int, _auth: None = Depends(require_bearer)) -> dict:
        await call(delete_draft, draft_id)
        return {"ok": True}

    @app.get("/api/blocklist")
    async def blocklist(session_id: int, _auth: None = Depends(require_bearer)) -> dict:
        return await call(list_blocklist, session_id)

    @app.delete("/api/blocklist/{entry_id}")
    async def remove_block(entry_id: int, _auth: None = Depends(require_bearer)) -> dict:
        await call(delete_block, entry_id)
        return {"ok": True}

    @app.post("/api/demo/seed")
    async def demo(_auth: None = Depends(require_bearer)) -> dict:
        return await call(seed_demo)

    @app.websocket("/ws")
    async def socket(websocket: WebSocket, token: str = "") -> None:
        if not secrets.compare_digest(token, settings.token):
            await websocket.close(code=1008)
            return
        await websocket.accept()
        hub.clients.add(websocket)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            hub.clients.discard(websocket)
        except Exception:
            hub.clients.discard(websocket)

    return app


def main() -> None:
    import uvicorn

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    settings = load_settings()
    uvicorn.run(create_app(), host=settings.host, port=settings.port, log_level="info")
