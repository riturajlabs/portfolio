"""`core/rate_limit` configuration and its enforcement on the chat routes.

Finding F-2: the `/chat` and `/chat/stream` routes were decorated with a
hard-coded `"10/minute"` while `CHAT_RATE_LIMIT`/`CHAT_RATE_WINDOW` only changed
the string the 429 body advertised. The enforced limit and the reported limit
must be the same thing, so these tests pin the three properties that can regress
silently:

* the documented default is 10 requests / 60 s;
* the enforced string is derived from the configured values, and a value that is
  not a positive whole number is refused at import rather than ignored;
* the `/chat` and `/chat/stream` routes enforce the configured string.

The enforcement test drives the real chat router and the real limiter with an
in-process ASGI client; only the (network-bound) stream body is stubbed. Async
code is driven with `asyncio.run` because `pytest-asyncio` is not a dependency.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI
from fastapi.responses import Response
from httpx import ASGITransport, AsyncClient
from limits import parse
from slowapi.errors import RateLimitExceeded

from core.rate_limit import (
    _RATE_LIMIT,
    _RATE_LIMIT_STR,
    _RATE_WINDOW_SECONDS,
    _read_positive_int,
    limiter,
    rate_limit_exceeded_handler,
)
from routes import chat

CHAT_PAYLOAD = {"message": "hi", "sessionId": "s", "history": [], "temperature": 0.2}


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


def test_defaults_match_the_documented_limit() -> None:
    assert _RATE_LIMIT == 10
    assert _RATE_WINDOW_SECONDS == 60
    assert _RATE_LIMIT_STR == "10/60 seconds"


def test_the_limit_string_encodes_the_configured_requests_and_window() -> None:
    item = parse(_RATE_LIMIT_STR)
    assert item.amount == _RATE_LIMIT
    assert item.get_expiry() == _RATE_WINDOW_SECONDS


def test_the_enforced_string_is_derived_from_the_configured_values() -> None:
    # The module must build the string from the validated integers, not a literal.
    assert _RATE_LIMIT_STR == f"{_RATE_LIMIT}/{_RATE_WINDOW_SECONDS} seconds"


def test_a_configured_limit_is_accepted(monkeypatch) -> None:
    monkeypatch.setenv("CHAT_RATE_LIMIT", "3")
    assert _read_positive_int("CHAT_RATE_LIMIT", "10") == 3


def test_a_configured_window_is_accepted(monkeypatch) -> None:
    monkeypatch.setenv("CHAT_RATE_WINDOW", "120")
    assert _read_positive_int("CHAT_RATE_WINDOW", "60") == 120


def test_a_value_that_is_not_a_positive_integer_is_refused(monkeypatch) -> None:
    for name in ("CHAT_RATE_LIMIT", "CHAT_RATE_WINDOW"):
        for value in ("abc", "", "0", "-5", "1.5", "  "):
            monkeypatch.setenv(name, value)
            with pytest.raises(ValueError, match=name):
                _read_positive_int(name, "10")


# ---------------------------------------------------------------------------
# Wiring: the routes are decorated with the configured string
# ---------------------------------------------------------------------------


def test_chat_routes_enforce_the_configured_limit_string() -> None:
    expected = str(parse(_RATE_LIMIT_STR))
    for endpoint in ("routes.chat.chat", "routes.chat.chat_stream"):
        limits = limiter._route_limits.get(endpoint)
        assert limits, f"no rate limit registered for {endpoint}"
        registered = {str(entry.limit) for entry in limits}
        assert registered == {expected}, (
            f"{endpoint} is not enforcing the configured limit "
            f"{_RATE_LIMIT_STR!r}: {sorted(registered)}"
        )


# ---------------------------------------------------------------------------
# Enforcement through the endpoint
# ---------------------------------------------------------------------------


async def _fake_streaming_response(request, chat_request, log_tag):
    return Response(content="ok", media_type="text/event-stream")


def _demonstrate_limit(path: str) -> tuple[list[int], Response]:
    """Send the allowed number of requests, then one past the limit."""

    async def _run():
        app = FastAPI()
        app.state.limiter = limiter
        app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
        app.include_router(chat.router)

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            allowed = [
                (await client.post(path, json=CHAT_PAYLOAD)).status_code
                for _ in range(_RATE_LIMIT)
            ]
            blocked = await client.post(path, json=CHAT_PAYLOAD)
            return allowed, blocked

    return asyncio.run(_run())


@pytest.mark.parametrize("path", ["/chat", "/chat/stream"])
def test_the_endpoint_returns_429_once_the_limit_is_passed(monkeypatch, path) -> None:
    # Auth is a separate concern here: use the dev bypass so the limiter is what
    # is measured. `verify_api_key` reads ENV at call time.
    monkeypatch.setenv("ENV", "development")
    monkeypatch.setattr(chat, "_chat_stream_response", _fake_streaming_response)

    limiter._storage.reset()
    try:
        allowed, blocked = _demonstrate_limit(path)
    finally:
        limiter._storage.reset()

    assert allowed == [200] * _RATE_LIMIT
    assert blocked.status_code == 429
    assert blocked.json()["limit"] == _RATE_LIMIT_STR
    assert blocked.headers["Retry-After"] == str(_RATE_WINDOW_SECONDS)
