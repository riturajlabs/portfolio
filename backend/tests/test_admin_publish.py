"""`POST /api/admin/publish`, the deploy-hook trigger, and AI re-ingestion — `ADR-017`.

Three layers are covered:

* the **service** (`app.services.publish`), which must turn every outcome —
  unconfigured, unreachable, rejected, succeeded — into a result instead of
  raising, for both the static rebuild and the AI re-ingestion step, and must
  never leak a capability token (deploy-hook URL, admin token) into a log;
* `publish_all`, which must fold the two steps into an honest verdict: `ok` only
  when nothing failed, `partial` when a step is merely unconfigured;
* the **route**, which must be session- and CSRF-gated (it is unsafe and
  state-changing) and must write an audit row for every attempt, including the
  ones that never reached an integration.

Both integrations are faked rather than called: the real deploy hook would start
a build, and the real re-ingestion endpoint would mutate the AI service.
"""

from __future__ import annotations

import httpx
import pytest
import pytest_asyncio
from httpx import AsyncClient
from support_admin import ADMIN_EMAIL, ADMIN_PASSWORD, audit_rows

from app.config import get_settings
from app.models import AdminUser
from app.services import publish

CSRF_HEADER = "X-CSRF-Token"
HOOK_URL = "https://example.test/deploy-hook-secret"
AI_BASE_URL = "https://ai.example.test"
REINGEST_TOKEN = "admin-token-secret"


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    login = await client.post(
        "/api/admin/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    assert login.status_code == 200, login.text
    me = await client.get("/api/admin/me")
    return {CSRF_HEADER: me.json()["csrf_token"]}


@pytest_asyncio.fixture(autouse=True)
async def _ensure_admin(admin_user: AdminUser) -> AdminUser:
    return admin_user


class _FakeResponse:
    def __init__(self, status_code: int, json_data: dict | None = None) -> None:
        self.status_code = status_code
        self._json_data = json_data

    def json(self) -> dict:
        # A 2xx from the re-ingestion endpoint is only meaningful when its body
        # confirms `ok: true`; the fake defaults to confirming so success tests
        # exercise the happy path unless a test overrides `json_data`.
        return self._json_data if self._json_data is not None else {"ok": True}


class _FakeAsyncClient:
    """Minimal stand-in for `httpx.AsyncClient` used as an async context manager.

    `get` serves the deploy hook and `post` serves the AI re-ingestion endpoint, so
    a single monkeypatch covers both steps (which run concurrently under
    `asyncio.gather`).
    """

    calls: list[tuple[str, str]] = []
    last_headers: dict[str, str] | None = None
    deploy_status = 200
    reingest_status = 200
    reingest_body: dict | None = None
    deploy_error: Exception | None = None
    reingest_error: Exception | None = None

    def __init__(self, *, timeout: float) -> None:
        self.timeout = timeout

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False

    async def get(self, url: str, **kwargs: object) -> _FakeResponse:
        type(self).calls.append(("GET", url))
        if type(self).deploy_error is not None:
            raise type(self).deploy_error
        return _FakeResponse(type(self).deploy_status)

    async def post(self, url: str, **kwargs: object) -> _FakeResponse:
        type(self).calls.append(("POST", url))
        type(self).last_headers = kwargs.get("headers")
        if type(self).reingest_error is not None:
            raise type(self).reingest_error
        return _FakeResponse(type(self).reingest_status, type(self).reingest_body)


@pytest.fixture
def fake_http(monkeypatch: pytest.MonkeyPatch):
    """Patch `publish.httpx.AsyncClient` with `_FakeAsyncClient` and reset state."""
    _FakeAsyncClient.calls = []
    _FakeAsyncClient.last_headers = None
    _FakeAsyncClient.deploy_status = 200
    _FakeAsyncClient.reingest_status = 200
    _FakeAsyncClient.reingest_body = None
    _FakeAsyncClient.deploy_error = None
    _FakeAsyncClient.reingest_error = None
    monkeypatch.setattr(publish.httpx, "AsyncClient", _FakeAsyncClient)
    return _FakeAsyncClient


def _configure_ai(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "AI_SERVICE_URL", AI_BASE_URL)
    monkeypatch.setattr(settings, "AI_SERVICE_ADMIN_TOKEN", REINGEST_TOKEN)


# ---------------------------------------------------------------------------
# Service — static rebuild
# ---------------------------------------------------------------------------


async def test_trigger_deploy_is_not_configured_without_a_hook_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "DEPLOY_HOOK_URL", "")
    result = await publish.trigger_deploy()
    assert result.configured is False
    assert result.ok is False
    assert result.status == publish.STATUS_NOT_CONFIGURED


async def test_trigger_deploy_reports_an_unreachable_hook(
    monkeypatch: pytest.MonkeyPatch, fake_http, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(get_settings(), "DEPLOY_HOOK_URL", HOOK_URL)
    fake_http.deploy_error = httpx.ConnectError("refused")

    result = await publish.trigger_deploy()
    assert result.configured is True
    assert result.ok is False
    assert result.status == publish.STATUS_FAILED
    # The capability token must never reach the logs.
    assert "deploy-hook-secret" not in caplog.text


async def test_trigger_deploy_reports_a_rejected_hook(
    monkeypatch: pytest.MonkeyPatch, fake_http
) -> None:
    monkeypatch.setattr(get_settings(), "DEPLOY_HOOK_URL", HOOK_URL)
    fake_http.deploy_status = 404

    result = await publish.trigger_deploy()
    assert result.ok is False
    assert result.status == publish.STATUS_FAILED


async def test_trigger_deploy_starts_the_build_on_success(
    monkeypatch: pytest.MonkeyPatch, fake_http
) -> None:
    monkeypatch.setattr(get_settings(), "DEPLOY_HOOK_URL", HOOK_URL)
    fake_http.deploy_status = 200

    result = await publish.trigger_deploy()
    assert result.configured is True
    assert result.ok is True
    assert result.status == publish.STATUS_TRIGGERED
    assert ("GET", HOOK_URL) in fake_http.calls


# ---------------------------------------------------------------------------
# Service — AI re-ingestion
# ---------------------------------------------------------------------------


async def test_trigger_reingest_is_not_configured_without_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "AI_SERVICE_URL", "")
    monkeypatch.setattr(get_settings(), "AI_SERVICE_ADMIN_TOKEN", "")
    result = await publish.trigger_reingest()
    assert result.configured is False
    assert result.ok is False
    assert result.status == publish.STATUS_NOT_CONFIGURED


async def test_trigger_reingest_reports_an_unreachable_service(
    monkeypatch: pytest.MonkeyPatch, fake_http, caplog: pytest.LogCaptureFixture
) -> None:
    _configure_ai(monkeypatch)
    fake_http.reingest_error = httpx.ConnectError("refused")

    result = await publish.trigger_reingest()
    assert result.configured is True
    assert result.ok is False
    assert result.status == publish.STATUS_FAILED
    # Neither the base URL nor the admin token may reach the logs.
    assert REINGEST_TOKEN not in caplog.text
    assert AI_BASE_URL not in caplog.text


async def test_trigger_reingest_reports_a_rejected_request(
    monkeypatch: pytest.MonkeyPatch, fake_http
) -> None:
    _configure_ai(monkeypatch)
    fake_http.reingest_status = 502

    result = await publish.trigger_reingest()
    assert result.ok is False
    assert result.status == publish.STATUS_FAILED


async def test_trigger_reingest_updates_on_success(
    monkeypatch: pytest.MonkeyPatch, fake_http
) -> None:
    _configure_ai(monkeypatch)
    fake_http.reingest_status = 200

    result = await publish.trigger_reingest()
    assert result.ok is True
    assert result.status == publish.STATUS_UPDATED
    assert ("POST", f"{AI_BASE_URL}/admin/reingest") in fake_http.calls
    # The token travels in the header, not a query string or log line.
    assert fake_http.last_headers == {"X-Admin-Token": REINGEST_TOKEN}


# ---------------------------------------------------------------------------
# Service — combined verdict
# ---------------------------------------------------------------------------


async def test_publish_all_is_ok_only_when_both_steps_succeed(
    monkeypatch: pytest.MonkeyPatch, fake_http
) -> None:
    monkeypatch.setattr(get_settings(), "DEPLOY_HOOK_URL", HOOK_URL)
    _configure_ai(monkeypatch)

    outcome = await publish.publish_all()
    assert outcome.ok is True
    assert outcome.status == publish.OVERALL_OK
    assert outcome.rebuild.ok is True
    assert outcome.reingest.ok is True


async def test_publish_all_is_partial_when_a_step_is_unconfigured(
    monkeypatch: pytest.MonkeyPatch, fake_http
) -> None:
    monkeypatch.setattr(get_settings(), "DEPLOY_HOOK_URL", HOOK_URL)
    monkeypatch.setattr(get_settings(), "AI_SERVICE_URL", "")

    outcome = await publish.publish_all()
    assert outcome.ok is False
    assert outcome.status == publish.OVERALL_PARTIAL
    assert outcome.rebuild.ok is True
    assert outcome.reingest.status == publish.STATUS_NOT_CONFIGURED


async def test_publish_all_is_failed_when_a_configured_step_fails(
    monkeypatch: pytest.MonkeyPatch, fake_http
) -> None:
    monkeypatch.setattr(get_settings(), "DEPLOY_HOOK_URL", HOOK_URL)
    _configure_ai(monkeypatch)
    fake_http.deploy_status = 500

    outcome = await publish.publish_all()
    assert outcome.ok is False
    assert outcome.status == publish.OVERALL_FAILED


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


async def test_publish_without_a_session_is_401(client: AsyncClient) -> None:
    response = await client.post("/api/admin/publish")
    assert response.status_code == 401


async def test_publish_without_a_csrf_token_is_403(client: AsyncClient) -> None:
    await _auth_headers(client)  # logs in; captured headers not reused
    response = await client.post("/api/admin/publish")
    assert response.status_code == 403


async def test_publish_unconfigured_is_reported_and_audited(
    client: AsyncClient, engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "DEPLOY_HOOK_URL", "")
    monkeypatch.setattr(get_settings(), "AI_SERVICE_URL", "")
    monkeypatch.setattr(get_settings(), "AI_SERVICE_ADMIN_TOKEN", "")
    headers = await _auth_headers(client)

    response = await client.post("/api/admin/publish", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is False
    assert body["status"] == publish.OVERALL_PARTIAL
    assert body["rebuild"]["status"] == publish.STATUS_NOT_CONFIGURED
    assert body["reingest"]["status"] == publish.STATUS_NOT_CONFIGURED

    rows = await audit_rows(engine, action="publish")
    assert any(row.entity == "deployment" for row in rows)


async def test_publish_configured_runs_both_steps_and_audits(
    client: AsyncClient, engine, monkeypatch: pytest.MonkeyPatch, fake_http
) -> None:
    monkeypatch.setattr(get_settings(), "DEPLOY_HOOK_URL", HOOK_URL)
    _configure_ai(monkeypatch)
    headers = await _auth_headers(client)

    response = await client.post("/api/admin/publish", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert body["status"] == publish.OVERALL_OK
    assert body["rebuild"]["status"] == publish.STATUS_TRIGGERED
    assert body["reingest"]["status"] == publish.STATUS_UPDATED

    rows = await audit_rows(engine, action="publish")
    assert any(
        row.entity == "deployment"
        and row.after["ok"] is True
        and row.after["reingest"]["ok"] is True
        for row in rows
    )
    # The capability token must not be persisted in the audit row.
    assert REINGEST_TOKEN not in str([row.after for row in rows])


# ---------------------------------------------------------------------------
# Backend ↔ AI service integration (real httpx with a mock transport)
# ---------------------------------------------------------------------------
# These use an actual `httpx.AsyncClient` pointed at `httpx.MockTransport`, so
# the request that would leave the server — method, path, headers, and how the
# response body is judged — is exercised exactly as in production, against a
# fake AI service. No real endpoint is ever contacted.


@pytest.fixture
def mock_http(monkeypatch: pytest.MonkeyPatch):
    """Patches `publish.httpx.AsyncClient` with a transport-driven fake AI service.

    Returns a namespace the test fills in:
      * `handler(request) -> httpx.Response` (or raises) — the AI service;
      * `requests` — every `httpx.Request` the publish service sent, including
        headers, so the auth header can be asserted.
    """
    import types

    class _State(types.SimpleNamespace):
        requests: list[httpx.Request] = []
        handler = None

    state = _State()

    def transport_handler(request: httpx.Request) -> httpx.Response:
        state.requests.append(request)
        if state.handler is None:
            raise AssertionError("mock_http.handler is not configured for this test")
        return state.handler(request)

    real_async_client = publish.httpx.AsyncClient

    def _patched_client(*, timeout: float) -> httpx.AsyncClient:
        # Capture `real_async_client` first: patching `publish.httpx.AsyncClient`
        # also swaps the shared `httpx` module's attribute, so referencing it here
        # would recurse into `_patched_client`.
        return real_async_client(
            transport=httpx.MockTransport(transport_handler), timeout=timeout
        )

    monkeypatch.setattr(publish.httpx, "AsyncClient", _patched_client)
    return state


def _ok_reingest_body() -> dict:
    return {"ok": True, "added": 2, "count": 7, "cache_cleared": 0}


async def test_reingest_sends_the_admin_token_header(
    monkeypatch: pytest.MonkeyPatch, mock_http
) -> None:
    _configure_ai(monkeypatch)

    def handler(request: httpx.Request) -> httpx.Response:
        # The backend must authenticate with the shared admin token and nothing
        # else leaked into the URL.
        assert request.method == "POST"
        assert request.url.path == "/admin/reingest"
        assert request.headers.get("X-Admin-Token") == REINGEST_TOKEN
        assert "admin-token-secret" not in str(request.url)
        return httpx.Response(200, json=_ok_reingest_body())

    mock_http.handler = handler

    result = await publish.trigger_reingest()
    assert result.ok is True
    assert result.status == publish.STATUS_UPDATED
    assert mock_http.requests[0].headers.get("X-Admin-Token") == REINGEST_TOKEN


async def test_reingest_fails_when_the_service_says_not_ok(
    monkeypatch: pytest.MonkeyPatch, mock_http
) -> None:
    _configure_ai(monkeypatch)
    mock_http.handler = lambda request: httpx.Response(200, json={"ok": False, "error": "boom"})

    result = await publish.trigger_reingest()
    assert result.ok is False
    assert result.status == publish.STATUS_FAILED
    assert "did not confirm" in result.message


async def test_reingest_fails_on_a_non_json_2xx(
    monkeypatch: pytest.MonkeyPatch, mock_http
) -> None:
    _configure_ai(monkeypatch)
    mock_http.handler = lambda request: httpx.Response(200, text="OK")

    result = await publish.trigger_reingest()
    assert result.ok is False
    assert result.status == publish.STATUS_FAILED


async def test_reingest_reports_an_auth_rejection_from_the_ai_service(
    monkeypatch: pytest.MonkeyPatch, mock_http
) -> None:
    _configure_ai(monkeypatch)
    mock_http.handler = lambda request: httpx.Response(401)

    result = await publish.trigger_reingest()
    assert result.ok is False
    assert result.status == publish.STATUS_FAILED
    assert "HTTP 401" in result.message


async def test_reingest_reports_a_timeout(
    monkeypatch: pytest.MonkeyPatch, mock_http
) -> None:
    _configure_ai(monkeypatch)

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out")

    mock_http.handler = handler

    result = await publish.trigger_reingest()
    assert result.ok is False
    assert result.status == publish.STATUS_FAILED
    assert "did not respond in time" in result.message


async def test_deploy_reports_a_redirect_as_failure(
    monkeypatch: pytest.MonkeyPatch, mock_http
) -> None:
    # Only a 2xx from the Vercel deploy hook counts as started. A 3xx is not a
    # build being triggered, so reporting it as `triggered` would be a lie.
    monkeypatch.setattr(get_settings(), "DEPLOY_HOOK_URL", HOOK_URL)
    mock_http.handler = lambda request: httpx.Response(302)

    result = await publish.trigger_deploy()
    assert result.ok is False
    assert result.status == publish.STATUS_FAILED
    assert "HTTP 302" in result.message


async def test_publish_all_with_mock_ai_is_ok_only_when_both_confirm(
    monkeypatch: pytest.MonkeyPatch, mock_http
) -> None:
    monkeypatch.setattr(get_settings(), "DEPLOY_HOOK_URL", HOOK_URL)
    _configure_ai(monkeypatch)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json=_ok_reingest_body())
        return httpx.Response(200)

    mock_http.handler = handler

    outcome = await publish.publish_all()
    assert outcome.ok is True
    assert outcome.status == publish.OVERALL_OK
    assert outcome.rebuild.status == publish.STATUS_TRIGGERED
    assert outcome.reingest.status == publish.STATUS_UPDATED
