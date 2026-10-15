"""`routes.admin`: operator-only re-ingestion / cache routes.

The routes are mounted on a throwaway app rather than the real one, because
`app.py` imports `routes.chat` (and therefore the `google-genai`/`groq` SDKs,
which this dev environment does not install). `routes.admin` itself has no such
dependency, so it can be exercised in isolation.

Covered: an empty `ADMIN_TOKEN` disables the surface (404), a wrong token is
rejected (401), a correct token re-ingests and clears the LLM cache, and a
failing re-ingestion is reported as 502 rather than a false success.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from config.settings import settings
from routes import admin


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(settings, "ADMIN_TOKEN", "secret-admin-token")
    app = FastAPI()
    app.include_router(admin.router)
    return TestClient(app)


def test_reingest_is_404_when_admin_token_is_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "ADMIN_TOKEN", "")
    app = FastAPI()
    app.include_router(admin.router)
    response = TestClient(app).post("/admin/reingest", headers={"X-Admin-Token": "x"})
    assert response.status_code == 404


def test_reingest_rejects_a_wrong_token(client: TestClient) -> None:
    response = client.post("/admin/reingest", headers={"X-Admin-Token": "wrong"})
    assert response.status_code == 401


def test_reingest_reports_ingestion_failure_as_502(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _boom() -> dict:
        raise RuntimeError("content API down")

    monkeypatch.setattr(admin, "reingest_knowledge_async", _boom)
    response = client.post(
        "/admin/reingest", headers={"X-Admin-Token": "secret-admin-token"}
    )
    assert response.status_code == 502


def test_reingest_success_clears_the_llm_cache(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _ok() -> dict:
        return {"added": 3, "count": 11}

    cleared: list[int] = []

    def _clear() -> int:
        cleared.append(1)
        return 7

    monkeypatch.setattr(admin, "reingest_knowledge_async", _ok)
    monkeypatch.setattr(admin.llm_response_cache, "clear", _clear)

    response = client.post(
        "/admin/reingest", headers={"X-Admin-Token": "secret-admin-token"}
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "ok": True,
        "added": 3,
        "count": 11,
        "cache_cleared": 7,
    }
    assert cleared == [1]


def test_cache_clear_requires_the_token(client: TestClient) -> None:
    assert client.post("/admin/cache/clear").status_code == 401
    response = client.post(
        "/admin/cache/clear", headers={"X-Admin-Token": "secret-admin-token"}
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True
