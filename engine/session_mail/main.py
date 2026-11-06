from __future__ import annotations

import asyncio
import contextlib
import logging
import secrets
from contextlib import asynccontextmanager
from typing import Literal

from datetime import datetime

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response

from session_mail import __version__, features, organizer, transfer
from session_mail import audit as audit_log
from session_mail.db import session_scope

from session_mail.config import load_settings
from session_mail.db import init_db
from session_mail.hub import hub
from session_mail.mail.errors import MailError
from session_mail.schemas import (
    AccountCreate,
    AccountUpdate,
    BulkRequest,
    DraftIn,
    EmptyRequest,
    FlagUpdate,
    LabelIn,
    LabelUpdate,
    MessageLabels,
    MoveRequest,
    OAuthStart,
    OrganizerItem,
    PinRequest,
    RuleIn,
    SendRequest,
    SessionCreate,
    SessionUpdate,
    SettingsUpdate,
    SnoozeMinutes,
    SnoozeRequest,
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
    clear_demo,
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
Kind = Literal["people", "events", "tasks", "notes", "reminders"]
_settings = None


async def _scheduler(stop: asyncio.Event) -> None:
    """Sends scheduled mail, wakes snoozed messages and fires reminders."""
    while not stop.is_set():
        for job in (features.flush_outbox, features.wake_snoozed, organizer.fire_when_listening):
            try:
                await asyncio.to_thread(job)
            except Exception:
                log.exception("Scheduler job failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=15)
        except TimeoutError:
            pass


def _download(result: tuple[bytes, str, str]) -> Response:
    data, filename, media = result
    return Response(
        content=data,
        media_type=media,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


def create_app() -> FastAPI:
    settings = load_settings()
    init_db(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        hub.loop = asyncio.get_running_loop()
        app.state.settings = settings
        app.state.sync = None
        task = None
        stop = asyncio.Event()
        scheduler = asyncio.create_task(_scheduler(stop))
        if not settings.disable_sync:
            manager = SyncManager()
            app.state.sync = manager
            task = asyncio.create_task(manager.run())
        yield
        stop.set()
        scheduler.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await scheduler
        if app.state.sync is not None:
            app.state.sync.stop.set()
            app.state.sync.wake()
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    app = FastAPI(title="Poso", version=__version__, lifespan=lifespan)
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
        allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+" if settings.dev else None,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
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
        return {"ok": True, "version": __version__}

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
        label_id: int | None = None,
        q: str = "",
        limit: int = 300,
        offset: int = 0,
        _auth: None = Depends(require_bearer),
    ) -> dict:
        return await call(list_messages, session_id, folder_role, folder_id, account_id, q, limit, offset, label_id)

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

    @app.post("/api/demo/clear")
    async def clear_sample(_auth: None = Depends(require_bearer)) -> dict:
        return await call(clear_demo)

    # ----- labels -----
    @app.post("/api/labels")
    async def post_label(body: LabelIn, _auth: None = Depends(require_bearer)) -> dict:
        return await call(features.create_label, body.session_id, body.name, body.color)

    @app.patch("/api/labels/{label_id}")
    async def patch_label(label_id: int, body: LabelUpdate, _auth: None = Depends(require_bearer)) -> dict:
        return await call(features.update_label, label_id, body.name, body.color)

    @app.delete("/api/labels/{label_id}")
    async def remove_label(label_id: int, _auth: None = Depends(require_bearer)) -> dict:
        await call(features.delete_label, label_id)
        return {"ok": True}

    @app.post("/api/messages/{message_id}/labels")
    async def message_labels(message_id: int, body: MessageLabels, _auth: None = Depends(require_bearer)) -> dict:
        return await call(features.set_message_labels, message_id, body.add, body.remove)

    # ----- snooze, pin, bulk, delete -----
    @app.post("/api/messages/{message_id}/snooze")
    async def post_snooze(message_id: int, body: SnoozeRequest, _auth: None = Depends(require_bearer)) -> dict:
        return await call(features.snooze, message_id, body.until)

    @app.post("/api/messages/{message_id}/pin")
    async def post_pin(message_id: int, body: PinRequest, _auth: None = Depends(require_bearer)) -> dict:
        return await call(features.pin, message_id, body.pinned)

    @app.post("/api/bulk")
    async def post_bulk(body: BulkRequest, _auth: None = Depends(require_bearer)) -> dict:
        return await call(features.bulk, body.ids, body.action, body.label_id, body.until)

    @app.delete("/api/messages/{message_id}")
    async def delete_message(message_id: int, _auth: None = Depends(require_bearer)) -> dict:
        return {"deleted": await call(features.delete_forever, [message_id])}

    @app.post("/api/folders/empty")
    async def post_empty(body: EmptyRequest, _auth: None = Depends(require_bearer)) -> dict:
        return {"deleted": await call(features.empty_folder, body.session_id, body.role)}

    @app.get("/api/messages/{message_id}/eml")
    async def get_eml(message_id: int, _auth: None = Depends(require_bearer)) -> Response:
        return _download(await call(transfer.export_eml, message_id))

    # ----- rules -----
    @app.get("/api/rules")
    async def get_rules(session_id: int, _auth: None = Depends(require_bearer)) -> dict:
        return await call(features.list_rules, session_id)

    @app.post("/api/rules")
    async def post_rule(body: RuleIn, _auth: None = Depends(require_bearer)) -> dict:
        return await call(features.save_rule, None, body)

    @app.put("/api/rules/{rule_id}")
    async def put_rule(rule_id: int, body: RuleIn, _auth: None = Depends(require_bearer)) -> dict:
        return await call(features.save_rule, rule_id, body)

    @app.delete("/api/rules/{rule_id}")
    async def remove_rule(rule_id: int, _auth: None = Depends(require_bearer)) -> dict:
        await call(features.delete_rule, rule_id)
        return {"ok": True}

    @app.post("/api/rules/run")
    async def post_run_rules(session_id: int, _auth: None = Depends(require_bearer)) -> dict:
        return await call(features.run_rules, session_id)

    # ----- contacts & outbox -----
    @app.get("/api/contacts")
    async def get_contacts(session_id: int, q: str = "", limit: int = 20, _auth: None = Depends(require_bearer)) -> dict:
        return await call(features.contacts, session_id, q, min(max(limit, 1), 500))

    @app.get("/api/outbox")
    async def get_outbox(session_id: int, _auth: None = Depends(require_bearer)) -> dict:
        return await call(features.list_outbox, session_id)

    @app.delete("/api/outbox/{item_id}")
    async def remove_outbox(item_id: int, _auth: None = Depends(require_bearer)) -> dict:
        return await call(features.cancel_outbox, item_id)

    # ----- audit -----
    @app.get("/api/audit")
    async def get_audit(
        session_id: int | None = None,
        action: str = "",
        q: str = "",
        since: datetime | None = None,
        until: datetime | None = None,
        limit: int = 200,
        offset: int = 0,
        _auth: None = Depends(require_bearer),
    ) -> dict:
        def run() -> dict:
            with session_scope() as db:
                return audit_log.query(
                    db, session_id=session_id, action=action, q=q, since=since, until=until,
                    limit=min(max(limit, 1), 2000), offset=max(offset, 0),
                )

        return await call(run)

    @app.get("/api/audit/export")
    async def export_audit(fmt: str = "csv", session_id: int | None = None, _auth: None = Depends(require_bearer)) -> Response:
        def run():
            with session_scope() as db:
                result = audit_log.export(db, "csv" if fmt == "csv" else "json", session_id)
                audit_log.record(db, "audit.export", session_id=session_id, target=fmt)
                return result

        return _download(await call(run))

    # ----- import / export -----
    @app.get("/api/export")
    async def export_data(
        fmt: str = "mbox",
        session_id: int | None = None,
        account_id: int | None = None,
        folder_role: str | None = None,
        _auth: None = Depends(require_bearer),
    ) -> Response:
        if fmt == "mbox":
            return _download(await call(transfer.export_mbox, session_id, account_id, folder_role))
        if fmt == "eml":
            return _download(await call(transfer.export_eml_zip, session_id, account_id, folder_role))
        if fmt == "contacts":
            if session_id is None:
                raise HTTPException(status_code=400, detail="Choose a session.")
            return _download(await call(transfer.export_contacts, session_id))
        if fmt == "json":
            return _download(await call(transfer.export_backup, session_id))
        raise HTTPException(status_code=400, detail="Unknown export format.")

    @app.post("/api/import")
    async def import_data(
        account_id: int = Form(...),
        folder_role: str = Form("inbox"),
        upload: bool = Form(False),
        files: list[UploadFile] = File(...),
        _auth: None = Depends(require_bearer),
    ) -> dict:
        blobs = [(item.filename or "upload", await item.read()) for item in files]
        return await call(transfer.import_files, account_id, folder_role, blobs, upload)

    @app.post("/api/restore")
    async def restore_data(file: UploadFile = File(...), _auth: None = Depends(require_bearer)) -> dict:
        return await call(transfer.restore_backup, await file.read())

    # ----- organizer: contacts, calendar, to-do, notes, reminders -----
    def organizer_kind(kind: str) -> str:
        # /api/contacts already serves mail-history autocomplete, so the address book lives at /api/people.
        return "contacts" if kind == "people" else kind

    @app.get("/api/organizer/upcoming")
    async def get_upcoming(session_id: int, hours: int = 24, _auth: None = Depends(require_bearer)) -> dict:
        return await call(organizer.upcoming, session_id, hours)

    @app.post("/api/reminders/{item_id}/snooze")
    async def post_reminder_snooze(item_id: int, body: SnoozeMinutes, _auth: None = Depends(require_bearer)) -> dict:
        return await call(organizer.snooze_reminder, item_id, body.minutes)

    @app.get("/api/{kind}")
    async def get_items(
        kind: Kind,
        session_id: int,
        q: str = "",
        start: datetime | None = None,
        end: datetime | None = None,
        _auth: None = Depends(require_bearer),
    ) -> dict:
        return await call(organizer.list_items, organizer_kind(kind), session_id, q, start, end)

    @app.post("/api/{kind}")
    async def post_item(kind: Kind, body: OrganizerItem, _auth: None = Depends(require_bearer)) -> dict:
        if body.session_id is None:
            raise HTTPException(status_code=422, detail="session_id is required")
        data = body.model_dump(exclude_unset=True, exclude={"session_id"})
        return await call(organizer.create_item, organizer_kind(kind), body.session_id, data)

    @app.patch("/api/{kind}/{item_id}")
    async def patch_item(kind: Kind, item_id: int, body: OrganizerItem, _auth: None = Depends(require_bearer)) -> dict:
        data = body.model_dump(exclude_unset=True, exclude={"session_id"})
        return await call(organizer.update_item, organizer_kind(kind), item_id, data)

    @app.delete("/api/{kind}/{item_id}")
    async def remove_item(kind: Kind, item_id: int, _auth: None = Depends(require_bearer)) -> dict:
        await call(organizer.delete_item, organizer_kind(kind), item_id)
        return {"ok": True}

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
    import os
    import sys
    import uvicorn

    # PyInstaller windowed builds have no console, and uvicorn exits if it cannot log.
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    settings = load_settings()
    uvicorn.run(create_app(), host=settings.host, port=settings.port, log_level="info")
