from __future__ import annotations

import json
from typing import Any

from session_mail.db import current_settings


def _file_path():
    return current_settings().data_dir / "secrets.json"


def _read_file() -> dict[str, str]:
    path = _file_path()
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(key): str(value) for key, value in data.items()}


def _write_file(data: dict[str, str]) -> None:
    path = _file_path()
    path.write_text(json.dumps(data), encoding="utf-8")


def _use_file() -> bool:
    return current_settings().secret_store == "file"


def secret_put(key: str, payload: dict[str, Any]) -> None:
    raw = json.dumps(payload)
    if _use_file():
        data = _read_file()
        data[key] = raw
        _write_file(data)
        return
    import keyring

    keyring.set_password("SessionMail", key, raw)


def secret_get(key: str) -> dict[str, Any] | None:
    raw: str | None
    if _use_file():
        raw = _read_file().get(key)
    else:
        import keyring

        raw = keyring.get_password("SessionMail", key)
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    return data


def secret_delete(key: str) -> None:
    if _use_file():
        data = _read_file()
        data.pop(key, None)
        _write_file(data)
        return
    import keyring

    try:
        keyring.delete_password("SessionMail", key)
    except keyring.errors.PasswordDeleteError:
        return
