"""Client-IP resolution for rate-limit bucketing (H1).

`SECURITY.md` §3.6a. The documented edge — Cloudflare in front of every Render
web service — makes the socket peer a load balancer, so per-IP limits keyed on it
aggregate every caller into one bucket. The fix is to read `CF-Connecting-IP`,
which the edge overwrites, and only when the deployment has declared it.

The risks worth pinning down, and none of them is "the header is read":

* a spoofed `X-Forwarded-For` minting a fresh bucket per request;
* the trusted header being read when trust was never configured;
* a header Cloudflare does *not* overwrite being accepted as if it did;
* a malformed or absent trusted header taking a request down instead of falling
  back to the peer;
* the two rate-limited routes resolving identity through different functions.
"""

from __future__ import annotations

import sys
from collections.abc import AsyncIterator
from typing import Any

import pytest
from fastapi import status
from httpx import ASGITransport, AsyncClient

from app.config import Settings
from app.rate_limit import FixedWindowLimiter
from app.security.client_ip import UNKNOWN_CLIENT_IP, client_ip

BASE_DATABASE_URL = "postgresql://user@localhost:5432/portfolio"
TRUSTED = "cf-connecting-ip"


def _settings(trusted_header: str = "") -> Settings:
    return Settings(
        DATABASE_URL=BASE_DATABASE_URL,
        TRUSTED_PROXY_HEADER=trusted_header,
    )


class _FakeClient:
    def __init__(self, host: str | None) -> None:
        self.host = host


class _FakeRequest:
    """The two attributes the resolver touches: `headers` and `client`."""

    def __init__(
        self,
        client: _FakeClient | None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.client = client
        self.headers = headers or {}


def _use_settings(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    """Point the resolver at `settings` without disturbing the process cache.

    `app.security` re-exports the `client_ip` *function*, so the package attribute
    shadows the module of the same name. Reach the module through `sys.modules`.
    """
    module = sys.modules["app.security.client_ip"]
    monkeypatch.setattr(module, "get_settings", lambda: settings)


# ---------------------------------------------------------------------------
# Trust is off by default
# ---------------------------------------------------------------------------


def test_the_socket_peer_is_used_when_no_trusted_header_is_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _use_settings(monkeypatch, _settings())
    request = _FakeRequest(
        _FakeClient("198.51.100.7"),
        {"cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "1.1.1.1"},
    )

    assert client_ip(request) == "198.51.100.7"


def test_a_configured_trusted_header_supplies_the_client_ip(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _use_settings(monkeypatch, _settings(TRUSTED))
    request = _FakeRequest(_FakeClient("10.0.0.1"), {TRUSTED: "203.0.113.9"})

    assert client_ip(request) == "203.0.113.9"


def test_two_clients_with_different_trusted_headers_get_different_buckets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _use_settings(monkeypatch, _settings(TRUSTED))
    proxy = _FakeClient("10.0.0.1")

    first = client_ip(_FakeRequest(proxy, {TRUSTED: "203.0.113.9"}))
    second = client_ip(_FakeRequest(proxy, {TRUSTED: "203.0.113.10"}))
    repeat = client_ip(_FakeRequest(proxy, {TRUSTED: "203.0.113.9"}))

    assert first != second, "distinct callers must not share a bucket"
    assert first == repeat, "the same caller must land in the same bucket"


# ---------------------------------------------------------------------------
# Spoofable headers are never read
# ---------------------------------------------------------------------------


def test_x_forwarded_for_is_ignored_when_it_is_the_only_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Trust enabled, but the caller sent `X-Forwarded-For` instead of the edge
    header. It must fall back to the peer, not honour the spoofable value."""
    _use_settings(monkeypatch, _settings(TRUSTED))
    request = _FakeRequest(
        _FakeClient("198.51.100.7"), {"x-forwarded-for": "1.1.1.1, 2.2.2.2"}
    )

    assert client_ip(request) == "198.51.100.7"


def test_a_spoofed_x_forwarded_for_does_not_override_the_edge_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _use_settings(monkeypatch, _settings(TRUSTED))
    request = _FakeRequest(
        _FakeClient("198.51.100.7"),
        {TRUSTED: "203.0.113.9", "x-forwarded-for": "1.1.1.1"},
    )

    assert client_ip(request) == "203.0.113.9"


# ---------------------------------------------------------------------------
# Malformed and absent values fall back
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("value", ["", "   ", "not-an-ip", "203.0.113.999", "garbage, 1.2.3.4"])
def test_a_malformed_trusted_header_falls_back_to_the_peer(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    """A bad header is a proxy misconfiguration, not a failed request."""
    _use_settings(monkeypatch, _settings(TRUSTED))
    request = _FakeRequest(_FakeClient("198.51.100.7"), {TRUSTED: value})

    assert client_ip(request) == "198.51.100.7"


def test_an_absent_trusted_header_falls_back_to_the_peer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _use_settings(monkeypatch, _settings(TRUSTED))
    request = _FakeRequest(_FakeClient("198.51.100.7"))

    assert client_ip(request) == "198.51.100.7"


def test_an_absent_peer_falls_back_to_the_shared_bucket(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _use_settings(monkeypatch, _settings(TRUSTED))
    request = _FakeRequest(None, {TRUSTED: "not-an-ip"})

    assert client_ip(request) == UNKNOWN_CLIENT_IP


# ---------------------------------------------------------------------------
# Header value shaping
# ---------------------------------------------------------------------------


def test_the_first_entry_of_a_comma_list_is_used(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_settings(monkeypatch, _settings(TRUSTED))
    request = _FakeRequest(_FakeClient("10.0.0.1"), {TRUSTED: "203.0.113.9, 198.51.100.4"})

    assert client_ip(request) == "203.0.113.9"


def test_a_bracketed_ipv6_header_is_normalised(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_settings(monkeypatch, _settings(TRUSTED))
    request = _FakeRequest(_FakeClient("10.0.0.1"), {TRUSTED: "[2001:0db8::1]"})

    assert client_ip(request) == "2001:db8::1"


def test_an_ipv4_header_with_a_port_is_unwrapped(monkeypatch: pytest.MonkeyPatch) -> None:
    _use_settings(monkeypatch, _settings(TRUSTED))
    request = _FakeRequest(_FakeClient("10.0.0.1"), {TRUSTED: "203.0.113.9:51000"})

    assert client_ip(request) == "203.0.113.9"


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


def test_the_trusted_header_defaults_to_disabled() -> None:
    settings = Settings(DATABASE_URL=BASE_DATABASE_URL)

    assert settings.TRUSTED_PROXY_HEADER == ""
    assert settings.trusted_proxy_header is None


def test_the_cloudflare_header_is_accepted_case_insensitively() -> None:
    settings = Settings(DATABASE_URL=BASE_DATABASE_URL, TRUSTED_PROXY_HEADER="  CF-Connecting-IP ")

    assert settings.TRUSTED_PROXY_HEADER == TRUSTED
    assert settings.trusted_proxy_header == TRUSTED


@pytest.mark.parametrize("value", ["x-forwarded-for", "x-real-ip", "true-client-ip", "forwarded"])
def test_a_header_the_edge_does_not_overwrite_is_refused(value: str) -> None:
    """`X-Forwarded-For` is the important one: Cloudflare appends to it."""
    with pytest.raises(ValueError, match="TRUSTED_PROXY_HEADER"):
        Settings(DATABASE_URL=BASE_DATABASE_URL, TRUSTED_PROXY_HEADER=value)


# ---------------------------------------------------------------------------
# Both rate-limited routes use the canonical resolver
# ---------------------------------------------------------------------------


def test_both_routes_resolve_identity_through_the_canonical_function(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An admin-login and a contact limit must not disagree about who a caller is."""
    from app.rate_limit import client_ip as content_and_contact_resolver
    from app.routes.admin_auth import client_ip as login_resolver

    _use_settings(monkeypatch, _settings(TRUSTED))
    request = _FakeRequest(_FakeClient("10.0.0.1"), {TRUSTED: "203.0.113.9"})

    assert login_resolver(request) == "203.0.113.9"
    assert content_and_contact_resolver(request) == "203.0.113.9"


# ---------------------------------------------------------------------------
# Through the endpoint
# ---------------------------------------------------------------------------


@pytest.fixture
def throttled_app(
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[Any]:
    """A one-request-per-bucket content app whose resolver trusts the edge header."""
    from app.db.session import get_session
    from app.main import app
    from app.routes import content as content_module

    _use_settings(monkeypatch, _settings(TRUSTED))

    original_limiter = content_module.limiter
    content_module.limiter = FixedWindowLimiter(limit=1, window_seconds=60)

    class _NoProfileSession:
        async def execute(self, *_args: object, **_kwargs: object) -> None:
            from app.services.content import ContentNotFoundError

            raise ContentNotFoundError("no profile in a client-ip test")

    async def _session() -> AsyncIterator[_NoProfileSession]:
        yield _NoProfileSession()

    app.dependency_overrides[get_session] = _session
    try:
        yield lambda: AsyncClient(
            transport=ASGITransport(app=app), base_url="http://testserver"
        )
    finally:
        content_module.limiter = original_limiter
        app.dependency_overrides.clear()


async def test_the_endpoint_buckets_by_the_trusted_header(throttled_app: Any) -> None:
    client = throttled_app()

    try:
        first = await client.get("/api/content", headers={TRUSTED: "203.0.113.1"})
        other = await client.get("/api/content", headers={TRUSTED: "203.0.113.2"})
        repeat = await client.get("/api/content", headers={TRUSTED: "203.0.113.1"})
    finally:
        await client.aclose()

    assert first.status_code == status.HTTP_404_NOT_FOUND
    assert other.status_code == status.HTTP_404_NOT_FOUND, "a different caller has its own bucket"
    assert repeat.status_code == status.HTTP_429_TOO_MANY_REQUESTS


async def test_a_spoofed_x_forwarded_for_cannot_mint_a_bucket(throttled_app: Any) -> None:
    """Same shared peer, varying `X-Forwarded-For`: the second request is still
    refused, proving the header never produced a distinct bucket."""
    client = throttled_app()

    try:
        first = await client.get("/api/content", headers={"x-forwarded-for": "1.1.1.1"})
        second = await client.get("/api/content", headers={"x-forwarded-for": "2.2.2.2"})
    finally:
        await client.aclose()

    assert first.status_code == status.HTTP_404_NOT_FOUND
    assert second.status_code == status.HTTP_429_TOO_MANY_REQUESTS
