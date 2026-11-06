from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SESSION_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("SESSION_TOKEN", "test-token")
    monkeypatch.setenv("SESSION_DEV", "1")
    monkeypatch.setenv("SESSION_DISABLE_SYNC", "1")
    monkeypatch.setenv("SESSION_SECRET_STORE", "file")
    from session_mail.db import reset_db_state
    from session_mail.main import create_app

    reset_db_state()
    app = create_app()
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def auth():
    return {"Authorization": "Bearer test-token"}
