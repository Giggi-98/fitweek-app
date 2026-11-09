import json
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

PASSWORD = "test-password-123"


def make_settings(tmp_path: Path, **overrides) -> Settings:
    values = dict(
        app_password=PASSWORD,
        session_secret="s" * 40,
        cookie_secure=False,
        db_path=tmp_path / "fitweek.sqlite",
    )
    values.update(overrides)
    return Settings(**values)


@pytest.fixture
def settings(tmp_path):
    return make_settings(tmp_path)


@pytest.fixture
def client(settings):
    return TestClient(create_app(settings))


@pytest.fixture
def auth_client(client):
    r = client.post("/api/login", json={"password": PASSWORD})
    assert r.status_code == 200
    return client


def db_state(db_path: Path) -> tuple[int, dict]:
    c = sqlite3.connect(db_path)
    version, blob = c.execute("SELECT version, json FROM app_state").fetchone()
    c.close()
    return version, json.loads(blob)
