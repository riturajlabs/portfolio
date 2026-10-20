"""CORS — least-privilege allow-list, never a wildcard in production (U7 / AI-1).

The AI service's browser-facing surface is deliberately narrow: in production
the frontend reaches it same-origin through Vercel's edge (`/api/chat/*`), and
the backend calls `/contact`, `/github` and `/admin/*` server-to-server (no
`Origin`, so CORS does not apply). The only genuine cross-origin browser flow is
local dev, which is exclusively `POST` to `/chat`/`/chat/stream` with
`Content-Type: application/json`.

These tests assert the parts that decide whether a random website can read this
service through a visitor's browser, and that the method/header grants are no
broader than that one flow. A server that reflects whatever `Origin` it is given,
or that ships `"*"` methods/headers, has not protected anything — a test that
only checks a known-good origin passes against such a server too.

CORS is decided by middleware *before* routing, so preflight assertions never
touch ChromaDB, auth or a provider.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import app, allow_origins

PRODUCTION_ORIGIN = "https://riturajlabs.vercel.app"
DEV_ORIGIN = "http://localhost:5173"
EVIL_ORIGIN = "https://attacker.example"
CHAT_PATH = "/chat/stream"


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


# ---------------------------------------------------------------------------
# Origins
# ---------------------------------------------------------------------------


def test_default_allow_list_is_explicit() -> None:
    """The shipped app never uses a wildcard origin by default."""
    assert "*" not in allow_origins
    assert PRODUCTION_ORIGIN in allow_origins
    assert DEV_ORIGIN in allow_origins


def test_allowed_production_origin_is_echoed_back(client: TestClient) -> None:
    response = client.options(
        CHAT_PATH,
        headers={
            "Origin": PRODUCTION_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.headers["access-control-allow-origin"] == PRODUCTION_ORIGIN


def test_unallowed_origin_receives_no_cors_grant(client: TestClient) -> None:
    """No `Access-Control-Allow-Origin` means the browser blocks the read."""
    response = client.options(
        CHAT_PATH,
        headers={
            "Origin": EVIL_ORIGIN,
            "Access-Control-Request-Method": "POST",
        },
    )
    assert "access-control-allow-origin" not in response.headers
    assert "access-control-allow-credentials" not in response.headers


def test_one_allowlisted_origin_does_not_admit_a_lookalike(
    client: TestClient,
) -> None:
    response = client.options(
        CHAT_PATH,
        headers={
            "Origin": "https://riturajlabs.vercel.app.evil",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert "access-control-allow-origin" not in response.headers


# ---------------------------------------------------------------------------
# Methods — POST only (the sole cross-origin flow)
# ---------------------------------------------------------------------------


def test_preflight_permits_post(client: TestClient) -> None:
    response = client.options(
        CHAT_PATH,
        headers={
            "Origin": DEV_ORIGIN,
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.status_code == 200
    methods = response.headers.get("access-control-allow-methods", "")
    assert "POST" in methods


def test_preflight_does_not_permit_arbitrary_methods(client: TestClient) -> None:
    """GET/PUT/DELETE/PATCH are not part of the browser surface."""
    response = client.options(
        CHAT_PATH,
        headers={
            "Origin": DEV_ORIGIN,
            "Access-Control-Request-Method": "POST",
        },
    )
    methods = response.headers.get("access-control-allow-methods", "")
    for method in ("GET", "PUT", "DELETE", "PATCH"):
        assert method not in methods


# ---------------------------------------------------------------------------
# Headers — Content-Type only
# ---------------------------------------------------------------------------


def test_preflight_allows_content_type(client: TestClient) -> None:
    response = client.options(
        CHAT_PATH,
        headers={
            "Origin": DEV_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    allowed = response.headers.get("access-control-allow-headers", "").lower()
    assert "content-type" in allowed


def test_preflight_rejects_a_non_safelisted_header(client: TestClient) -> None:
    """An arbitrary request header (e.g. a smuggled auth header) is not granted."""
    response = client.options(
        CHAT_PATH,
        headers={
            "Origin": DEV_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-custom-header",
        },
    )
    allowed = response.headers.get("access-control-allow-headers", "").lower()
    assert "x-custom-header" not in allowed


# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------


def test_credentials_are_never_allowed(client: TestClient) -> None:
    """The chat client sends no cookies, so credentialed CORS is off.

    Enabling it would let a cookie-bearing cross-origin request read the
    service; the shared `X-API-Key` is injected by the edge and never sent by
    the browser, so credentials are unnecessary here.
    """
    response = client.get("/health", headers={"Origin": PRODUCTION_ORIGIN})
    assert "access-control-allow-credentials" not in response.headers
