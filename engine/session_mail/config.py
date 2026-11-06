from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

OAUTH_REDIRECT_PORT = 8734
OAUTH_REDIRECT_URI = f"http://127.0.0.1:{OAUTH_REDIRECT_PORT}/callback"
DEV_TOKEN = "dev-session-token"


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    token: str
    data_dir: Path
    dev: bool
    disable_sync: bool
    secret_store: str

    @property
    def db_path(self) -> Path:
        return self.data_dir / "mail.db"

    @property
    def attachment_dir(self) -> Path:
        return self.data_dir / "attachments"


def default_data_dir() -> Path:
    appdata = os.environ.get("APPDATA")
    if os.name == "nt" and appdata:
        return Path(appdata) / "Session"
    return Path.home() / ".session"


def load_settings() -> Settings:
    data_dir = Path(os.environ.get("SESSION_DATA_DIR") or default_data_dir())
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "attachments").mkdir(parents=True, exist_ok=True)
    return Settings(
        host=os.environ.get("SESSION_HOST") or "127.0.0.1",
        port=int(os.environ.get("SESSION_PORT") or "8765"),
        token=os.environ.get("SESSION_TOKEN") or DEV_TOKEN,
        data_dir=data_dir,
        dev=os.environ.get("SESSION_DEV", "0") == "1",
        disable_sync=os.environ.get("SESSION_DISABLE_SYNC", "0") == "1",
        secret_store=os.environ.get("SESSION_SECRET_STORE") or "keyring",
    )
