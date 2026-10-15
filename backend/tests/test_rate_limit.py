"""Rate limiting — 300 requests/minute per IP, on the content endpoint only.

`API.md` §8 fixes the number and the 429 shape. The risks worth testing are
specific, and none of them are "does the counter increment":

* a limit that is not enforced at all, or enforced on `/health` and `/ready`,
  which would turn a restart loop into a throttling investigation;
* a 429 that leaks the counter, the window or the limit internals;
* a `Retry-After` that is wrong, so a well-behaved client is throttled again;
* trusting `X-Forwarded-For`, which would let a caller mint a fresh bucket per
  request by varying a header.

Every test drives an injected clock, so none of them sleep.
"""

from __future__ import annotations

import json
import threading
from collections.abc import AsyncIterator, Callable, Iterator

import pytest
from fastapi import status
from httpx import ASGITransport, AsyncClient

from app.config import Settings
from app.rate_limit import (
    FixedWindowLimiter,
    RateLimitDecision,
    client_ip,
    rate_limit_response,
)
from app.services.content import ContentNotFoundError

DEFAULT_LIMIT = 300
DEFAULT_WINDOW = 60
RATE_LIMITED_MESSAGE = "Too many requests. Please try again shortly."

BASE_DATABASE_URL = "postgresql://user@localhost:5432/portfolio"


class FakeClock:
    """A hand-cranked clock, so window behaviour is exact rather than timed."""

    def __init__(self, now: float = 1000.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def limiter(clock: FakeClock) -> FixedWindowLimiter:
    return FixedWindowLimiter(limit=DEFAULT_LIMIT, window_seconds=DEFAULT_WINDOW, clock=clock)


# ---------------------------------------------------------------------------
# The counter
# ---------------------------------------------------------------------------


def test_requests_below_the_limit_are_allowed(limiter: FixedWindowLimiter) -> None:
    for _ in range(DEFAULT_LIMIT):
        decision = limiter.check("203.0.113.10")

    assert decision.allowed is True
    assert decision.remaining == 0


def test_the_request_past_the_limit_is_refused(limiter: FixedWindowLimiter) -> None:
    """300 is allowed; 301 is not. Off-by-one here is a real outage or a silent hole."""
    for _ in range(DEFAULT_LIMIT):
        assert limiter.check("203.0.113.10").allowed is True

    refused = limiter.check("203.0.113.10")

    assert refused.allowed is False
    assert refused.remaining == 0


def test_refused_requests_stay_refused(limiter: FixedWindowLimiter) -> None:
    for _ in range(DEFAULT_LIMIT):
        limiter.check("203.0.113.10")

    for _ in range(5):
        assert limiter.check("203.0.113.10").allowed is False


def test_remaining_counts_down(limiter: FixedWindowLimiter) -> None:
    assert limiter.check("203.0.113.10").remaining == DEFAULT_LIMIT - 1
    assert limiter.check("203.0.113.10").remaining == DEFAULT_LIMIT - 2
    assert limiter.check("203.0.113.10").remaining == DEFAULT_LIMIT - 3


def test_remaining_never_goes_negative(limiter: FixedWindowLimiter) -> None:
    for _ in range(DEFAULT_LIMIT + 50):
        decision = limiter.check("203.0.113.10")

    assert decision.remaining == 0


def test_separate_clients_have_separate_budgets(limiter: FixedWindowLimiter) -> None:
    for _ in range(DEFAULT_LIMIT):
        limiter.check("203.0.113.10")

    assert limiter.check("203.0.113.10").allowed is False
    assert limiter.check("203.0.113.11").allowed is True


def test_the_decision_reports_the_configured_limit(limiter: FixedWindowLimiter) -> None:
    assert limiter.check("203.0.113.10").limit == DEFAULT_LIMIT
    assert limiter.limit == DEFAULT_LIMIT
    assert limiter.window_seconds == DEFAULT_WINDOW


# ---------------------------------------------------------------------------
# The window
# ---------------------------------------------------------------------------


def test_the_budget_returns_when_the_window_rolls_over(
    limiter: FixedWindowLimiter, clock: FakeClock
) -> None:
    for _ in range(DEFAULT_LIMIT):
        limiter.check("203.0.113.10")
    assert limiter.check("203.0.113.10").allowed is False

    clock.advance(DEFAULT_WINDOW)

    assert limiter.check("203.0.113.10").allowed is True
    assert limiter.check("203.0.113.10").remaining == DEFAULT_LIMIT - 2


def test_one_second_short_of_the_window_is_still_limited(
    limiter: FixedWindowLimiter, clock: FakeClock
) -> None:
    """The window must actually expire, not reset a little early."""
    for _ in range(DEFAULT_LIMIT):
        limiter.check("203.0.113.10")

    clock.advance(DEFAULT_WINDOW - 1)

    assert limiter.check("203.0.113.10").allowed is False


def test_the_window_anchor_is_the_first_request_not_the_last(
    limiter: FixedWindowLimiter, clock: FakeClock
) -> None:
    """A client dribbling requests must not extend its own window forever.

    The window is fixed and starts at the first request, so a slow caller is reset
    on schedule rather than being able to stay throttled indefinitely by continuing
    to send traffic.
    """
    for _ in range(10):
        limiter.check("203.0.113.10")
    clock.advance(DEFAULT_WINDOW - 1)
    limiter.check("203.0.113.10")

    clock.advance(1)

    assert limiter.check("203.0.113.10").remaining == DEFAULT_LIMIT - 1


def test_retry_after_counts_down_as_the_window_elapses(
    limiter: FixedWindowLimiter, clock: FakeClock
) -> None:
    """`Retry-After` must be the real time left, so an obedient client is not
    throttled again the moment it obeys."""
    for _ in range(DEFAULT_LIMIT):
        limiter.check("203.0.113.10")

    assert limiter.check("203.0.113.10").retry_after == DEFAULT_WINDOW

    clock.advance(30)

    assert limiter.check("203.0.113.10").retry_after == DEFAULT_WINDOW // 2

    clock.advance(DEFAULT_WINDOW)

    assert limiter.check("203.0.113.10").allowed is True


def test_retry_after_on_a_fresh_window_is_the_window_length(
    limiter: FixedWindowLimiter, clock: FakeClock
) -> None:
    """A client told to wait 61 s for a 60 s window is being told to over-wait."""
    decision = limiter.check("203.0.113.10")

    assert decision.retry_after == DEFAULT_WINDOW

    clock.advance(1)
    assert limiter.check("203.0.113.10").retry_after == DEFAULT_WINDOW - 1


def test_retry_after_is_always_at_least_one_second(
    limiter: FixedWindowLimiter, clock: FakeClock
) -> None:
    for _ in range(DEFAULT_LIMIT):
        limiter.check("203.0.113.10")
    clock.advance(DEFAULT_WINDOW)

    decision = limiter.check("203.0.113.10")

    assert decision.retry_after >= 1


# ---------------------------------------------------------------------------
# Bookkeeping
# ---------------------------------------------------------------------------


def test_reset_clears_every_bucket(limiter: FixedWindowLimiter) -> None:
    for _ in range(DEFAULT_LIMIT):
        limiter.check("203.0.113.10")

    limiter.reset()

    assert limiter.check("203.0.113.10").allowed is True
    assert limiter.check("203.0.113.10").remaining == DEFAULT_LIMIT - 2


def test_expired_entries_are_swept(clock: FakeClock) -> None:
    """The counter table must not grow without bound on a long-running process."""
    limiter = FixedWindowLimiter(limit=DEFAULT_LIMIT, window_seconds=DEFAULT_WINDOW, clock=clock)

    for index in range(11_000):
        limiter.check(f"203.0.113.{index % 250}.{index % 251}")

    clock.advance(DEFAULT_WINDOW * 2)
    limiter.check("203.0.113.0.0")

    assert len(limiter._hits) < 11_000


def test_concurrent_checks_do_not_lose_counts() -> None:
    """The lock is the whole reason this is safe under async concurrency.

    Without it, two requests can read the same count, both write `count + 1`, and a
    caller can exceed the limit by a wide margin.
    """
    limiter = FixedWindowLimiter(limit=DEFAULT_LIMIT, window_seconds=DEFAULT_WINDOW)
    allowed = []
    start = threading.Barrier(8)

    def worker() -> None:
        start.wait()
        for _ in range(100):
            if limiter.check("203.0.113.10").allowed:
                allowed.append(1)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(allowed) == DEFAULT_LIMIT


# ---------------------------------------------------------------------------
# Client identity
# ---------------------------------------------------------------------------


async def test_the_peer_address_is_the_bucket_key() -> None:
    """`X-Forwarded-For` is attacker-controlled, so it is not trusted here.

    If it were, anyone could mint an unlimited number of buckets by sending a
    different header on every request.
    """

    class _Client:
        def __init__(self, host: str) -> None:
            self.host = host

    request = _FakeRequest(_Client("198.51.100.7"), "1.1.1.1, 2.2.2.2")

    assert client_ip(request) == "198.51.100.7"


async def test_a_request_without_a_peer_falls_back_to_a_shared_bucket() -> None:
    """An absent client must still get *a* key, not raise inside the limiter."""
    request = _FakeRequest(None)

    assert client_ip(request) == "unknown"


class _FakeClient:
    def __init__(self, host: str) -> None:
        self.host = host


class _FakeRequest:
    def __init__(self, client: _FakeClient | None, forwarded_for: str | None = None) -> None:
        self.client = client
        self.headers: dict[str, str] = {}
        if forwarded_for is not None:
            self.headers["X-Forwarded-For"] = forwarded_for


# ---------------------------------------------------------------------------
# The 429 response
# ---------------------------------------------------------------------------


def test_the_429_body_is_the_documented_bare_detail_shape() -> None:
    response = rate_limit_response(RateLimitDecision(False, DEFAULT_LIMIT, 0, 30))

    assert response.status_code == status.HTTP_429_TOO_MANY_REQUESTS
    assert response.body is not None
    assert b'"detail"' in response.body
    assert RATE_LIMITED_MESSAGE.encode() in response.body


def test_the_429_body_is_json_not_html() -> None:
    """A client parsing JSON must not be handed an HTML error page."""
    response = rate_limit_response(RateLimitDecision(False, DEFAULT_LIMIT, 0, 30))

    assert response.media_type == "application/json"
    payload = json.loads(response.body)
    assert set(payload) == {"detail"}
    assert payload["detail"] == RATE_LIMITED_MESSAGE


def test_the_429_does_not_disclose_the_window_or_the_counter() -> None:
    """`Retry-After` is useful; the window boundary is an invitation to tune around it."""
    response = rate_limit_response(RateLimitDecision(False, DEFAULT_LIMIT, 0, 30))
    body = response.body or b""

    assert b"60" not in body
    assert b"window" not in body
    assert b"limit" not in body


def test_the_429_carries_retry_after() -> None:
    response = rate_limit_response(RateLimitDecision(False, DEFAULT_LIMIT, 0, 45))

    assert response.headers["Retry-After"] == "45"


def test_the_429_reports_the_quota_headers() -> None:
    response = rate_limit_response(RateLimitDecision(False, DEFAULT_LIMIT, 0, 45))

    assert response.headers["X-RateLimit-Limit"] == str(DEFAULT_LIMIT)
    assert response.headers["X-RateLimit-Remaining"] == "0"


def test_retry_after_header_is_an_integer_a_client_can_parse() -> None:
    """A non-numeric `Retry-After` is ignored by clients and invites a retry loop."""
    for retry_after in (1, 7, 60):
        response = rate_limit_response(RateLimitDecision(False, DEFAULT_LIMIT, 0, retry_after))

        assert response.headers["Retry-After"].isdigit()


# ---------------------------------------------------------------------------
# Through the endpoint
# ---------------------------------------------------------------------------


@pytest.fixture
def throttled_app() -> Iterator[Callable[[int], AsyncClient]]:
    """An app whose content limiter allows a chosen number of requests.

    The module-level limiter and the session dependency are both replaced for the
    duration of the test, then restored. Without the restore a limit of 5 would
    leak into every later test in the session.
    """
    from app.db.session import get_session
    from app.main import app
    from app.routes import content as content_module

    original_limiter = content_module.limiter

    async def _no_profile_session() -> AsyncIterator[_NoProfileSession]:
        """A session that resolves, but reports a database with no profile.

        It must *not* raise. FastAPI resolves dependencies in declaration order and
        an exception from a later dependency discards the `Response` an earlier one
        returned, so a raising stub would mask the 429 this fixture exists to
        observe. Yielding a stand-in lets the route body run, which is what a real
        session does: it is lazy and opens no connection until a query runs.
        """
        yield _NoProfileSession()

    def _client(limit: int) -> AsyncClient:
        content_module.limiter = FixedWindowLimiter(
            limit=limit, window_seconds=DEFAULT_WINDOW
        )
        app.dependency_overrides[get_session] = _no_profile_session
        return AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver")

    try:
        yield _client
    finally:
        content_module.limiter = original_limiter
        app.dependency_overrides.clear()


class _NoProfileSession:
    """Reports a missing profile, so an allowed request yields the documented 404."""

    async def execute(self, *_args: object, **_kwargs: object) -> None:
        raise ContentNotFoundError("no profile in a rate-limit test")


async def test_the_endpoint_returns_429_once_the_limit_is_passed(
    throttled_app: Callable[[int], AsyncClient]
) -> None:
    client = throttled_app(5)

    try:
        for _ in range(5):
            assert (await client.get("/api/content")).status_code != 429

        blocked = await client.get("/api/content")
    finally:
        await client.aclose()

    assert blocked.status_code == status.HTTP_429_TOO_MANY_REQUESTS
    assert blocked.headers["Retry-After"].isdigit()


async def test_a_429_is_not_cached(throttled_app: Callable[[int], AsyncClient]) -> None:
    """A cached 429 would keep failing a client long after its window reset."""
    client = throttled_app(1)

    try:
        await client.get("/api/content")
        blocked = await client.get("/api/content")
    finally:
        await client.aclose()

    cache_control = blocked.headers.get("Cache-Control", "")
    assert "public" not in cache_control
    assert "max-age" not in cache_control


async def test_health_endpoints_are_never_throttled(
    throttled_app: Callable[[int], AsyncClient]
) -> None:
    """An infrastructure probe must not be able to exhaust a client budget.

    If a platform's health check were limited, a burst of probes would fail the
    deployment and the resulting restarts would look like a rate-limit fault.
    """
    client = throttled_app(1)

    try:
        statuses = [(await client.get("/health")).status_code for _ in range(25)]
        ready = [(await client.get("/ready")).status_code for _ in range(25)]
    finally:
        await client.aclose()

    assert set(statuses) == {status.HTTP_200_OK}
    assert set(ready) <= {status.HTTP_200_OK, status.HTTP_503_SERVICE_UNAVAILABLE}


async def test_the_default_limit_matches_the_api_contract() -> None:
    settings = Settings(DATABASE_URL=BASE_DATABASE_URL)

    assert settings.CONTENT_RATE_LIMIT == DEFAULT_LIMIT
    assert settings.CONTENT_RATE_WINDOW_SECONDS == DEFAULT_WINDOW


def test_the_rate_limit_is_configurable_for_a_stricter_deployment() -> None:
    settings = Settings(DATABASE_URL=BASE_DATABASE_URL, CONTENT_RATE_LIMIT=60)

    assert settings.CONTENT_RATE_LIMIT == 60


def test_a_nonsense_rate_limit_is_rejected_at_startup() -> None:
    for value in (0, -1):
        with pytest.raises(ValueError, match="CONTENT_RATE_LIMIT"):
            Settings(DATABASE_URL=BASE_DATABASE_URL, CONTENT_RATE_LIMIT=value)