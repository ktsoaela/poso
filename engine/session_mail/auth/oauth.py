from __future__ import annotations

import base64
import hashlib
import json
import secrets
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

import httpx

from session_mail.config import OAUTH_REDIRECT_PORT, OAUTH_REDIRECT_URI
from session_mail.mail.errors import MailError
from session_mail.mail.presets import PRESETS
from session_mail.models import Account
from session_mail.secrets import secret_get, secret_put

GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
MICROSOFT_AUTH = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
MICROSOFT_TOKEN = "https://login.microsoftonline.com/common/oauth2/v2.0/token"

GOOGLE_SCOPE = "openid email https://mail.google.com/"
MICROSOFT_SCOPE = (
    "offline_access openid email profile "
    "https://outlook.office.com/IMAP.AccessAsUser.All "
    "https://outlook.office.com/SMTP.Send"
)


def app_credentials(provider: str) -> tuple[str, str]:
    data = secret_get(f"app:{provider}") or {}
    return str(data.get("client_id") or ""), str(data.get("client_secret") or "")


def save_app_credentials(provider: str, client_id: str | None = None, client_secret: str | None = None) -> None:
    current = secret_get(f"app:{provider}") or {}
    if client_id is not None:
        current["client_id"] = client_id.strip()
    if client_secret:
        current["client_secret"] = client_secret
    secret_put(f"app:{provider}", current)


def _pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return verifier, challenge


def _email_from_id_token(id_token: str) -> str:
    try:
        payload = id_token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload))
    except Exception as exc:
        raise MailError("The sign-in response did not include an email address.") from exc
    email = data.get("email") or data.get("preferred_username") or ""
    if not email:
        raise MailError("The sign-in response did not include an email address.")
    return str(email)


class _CallbackState:
    def __init__(self) -> None:
        self.done = threading.Event()
        self.query: dict[str, list[str]] = {}


def _handler(state: _CallbackState):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            if parsed.path != "/callback":
                self.send_response(404)
                self.end_headers()
                return
            state.query = parse_qs(parsed.query)
            state.done.set()
            body = (
                "<!doctype html><html><body style=\"font-family:Georgia,serif;padding:48px\">"
                "<p>Signed in. You can close this window and return to Session.</p></body></html>"
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt: str, *args) -> None:
            return

    return Handler


def _exchange(provider: str, code: str, verifier: str, client_id: str, client_secret: str) -> dict:
    token_url = GOOGLE_TOKEN if provider == "google" else MICROSOFT_TOKEN
    payload = {
        "client_id": client_id,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": OAUTH_REDIRECT_URI,
        "code_verifier": verifier,
    }
    if client_secret:
        payload["client_secret"] = client_secret
    if provider == "microsoft":
        payload["scope"] = MICROSOFT_SCOPE
    response = httpx.post(token_url, data=payload, timeout=30)
    if response.status_code >= 400:
        raise MailError("The mail provider refused the sign-in. Check the client id and redirect URI.")
    return response.json()


def fresh_access_token(account: Account, secret: dict) -> str:
    expires_at = float(secret.get("expires_at") or 0)
    access = str(secret.get("access_token") or "")
    if access and expires_at > time.time() + 60:
        return access
    refresh = str(secret.get("refresh_token") or "")
    if not refresh:
        raise MailError(f"Session needs you to sign in to {account.email} again.")
    provider = "google" if account.auth_type == "oauth_google" else "microsoft"
    client_id = str(secret.get("client_id") or "")
    client_secret = str(secret.get("client_secret") or "")
    if not client_id:
        client_id, client_secret = app_credentials(provider)
    token_url = GOOGLE_TOKEN if provider == "google" else MICROSOFT_TOKEN
    payload = {
        "client_id": client_id,
        "grant_type": "refresh_token",
        "refresh_token": refresh,
    }
    if client_secret:
        payload["client_secret"] = client_secret
    if provider == "microsoft":
        payload["scope"] = MICROSOFT_SCOPE
    response = httpx.post(token_url, data=payload, timeout=30)
    if response.status_code >= 400:
        raise MailError(f"Session needs you to sign in to {account.email} again.")
    data = response.json()
    secret["access_token"] = data.get("access_token") or ""
    secret["expires_at"] = time.time() + int(data.get("expires_in") or 3600)
    if data.get("refresh_token"):
        secret["refresh_token"] = data["refresh_token"]
    secret_put(f"account:{account.id}", secret)
    if not secret["access_token"]:
        raise MailError(f"Session needs you to sign in to {account.email} again.")
    return str(secret["access_token"])


def run_oauth(provider: str, session_id: int) -> dict:
    if provider not in {"google", "microsoft"}:
        raise MailError("Choose Google or Microsoft.")
    client_id, client_secret = app_credentials(provider)
    if not client_id:
        label = "Google" if provider == "google" else "Microsoft"
        raise MailError(f"Add a {label} client id in Settings first.")
    verifier, challenge = _pkce()
    state_token = secrets.token_urlsafe(24)
    scope = GOOGLE_SCOPE if provider == "google" else MICROSOFT_SCOPE
    params = {
        "client_id": client_id,
        "redirect_uri": OAUTH_REDIRECT_URI,
        "response_type": "code",
        "scope": scope,
        "state": state_token,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    if provider == "google":
        params["access_type"] = "offline"
        params["prompt"] = "consent"
        auth_url = GOOGLE_AUTH
        preset_key = "gmail"
        auth_type = "oauth_google"
    else:
        params["prompt"] = "select_account"
        auth_url = MICROSOFT_AUTH
        preset_key = "outlook"
        auth_type = "oauth_microsoft"
    callback = _CallbackState()
    try:
        server = HTTPServer(("127.0.0.1", OAUTH_REDIRECT_PORT), _handler(callback))
    except OSError as exc:
        raise MailError(
            "The sign-in port 8734 is already in use. Close the other sign-in window and try again."
        ) from exc
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        webbrowser.open(f"{auth_url}?{urlencode(params)}")
        if not callback.done.wait(180):
            raise MailError("The sign-in window timed out.")
    finally:
        server.shutdown()
        server.server_close()
    if callback.query.get("error"):
        raise MailError("The mail provider cancelled the sign-in.")
    if (callback.query.get("state") or [""])[0] != state_token:
        raise MailError("The sign-in response did not match this Session window.")
    code = (callback.query.get("code") or [""])[0]
    if not code:
        raise MailError("The sign-in response did not include a code.")
    token = _exchange(provider, code, verifier, client_id, client_secret)
    if not token.get("refresh_token"):
        raise MailError("The provider did not grant offline access. Sign in again and accept every permission.")
    email = _email_from_id_token(str(token.get("id_token") or ""))
    preset = PRESETS[preset_key]
    return {
        "session_id": session_id,
        "email": email,
        "username": email,
        "provider": preset_key,
        "auth_type": auth_type,
        "imap_host": preset["imap_host"],
        "imap_port": preset["imap_port"],
        "imap_ssl": preset["imap_ssl"],
        "smtp_host": preset["smtp_host"],
        "smtp_port": preset["smtp_port"],
        "smtp_mode": preset["smtp_mode"],
        "secret": {
            "refresh_token": token.get("refresh_token"),
            "access_token": token.get("access_token"),
            "expires_at": time.time() + int(token.get("expires_in") or 3600),
            "client_id": client_id,
            "client_secret": client_secret,
        },
    }
