"""Login abuse protection.

`API.md` §8 and `SECURITY.md` §4.4 define two independent windows on
`POST /api/admin/auth/login`:

* **10 attempts / 15 min / IP**, counting every attempt;
* **5 failures / 15 min / email**, counting only failures.

The unit tests below drive `LoginAttemptLimiter` directly with an injected clock,
which is the only way to assert window expiry without fifteen minutes of sleeping.
The HTTP tests then confirm the router is actually wired to that limiter.

The asymmetry is the point of the design and is tested as such: a correct password
must never advance the per-email failure window, and successes clear it.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine
from support_admin import ADMIN_EMAIL, ADMIN_PASSWORD, WRONG_PASSWORD

from app.config import get_settings
from app.models import AdminUser
from app.rate_limit_login import LoginAttemptLimiter, get_login_limiter

IP = "203.0.113.10"
OTHER_IP = "203.0.113.11"
OTHER_EMAIL = "someone-else@example.com"


def fresh_email(index: int) -> str:
    """A distinct address per call, so a per-email window never fills up.

    The two dimensions have independent limits (10 vs 5), so a test about the IP
    window that reuses one address would trip the email window first and prove
    nothing. Varying the address isolates the dimension under test — which is also
    exactly what credential stuffing looks like.
    """
    return f"victim-{index}@example.com"


def fresh_ip(index: int) -> str:
    """A distinct peer address per call, to isolate the email window."""
    return f"198.51.100.{index}"


class FakeClock:
    """A clock the test moves by hand."""

    def __init__(self) -> None:
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def limiter(clock: FakeClock) -> Iterator[LoginAttemptLimiter]:
    """A limiter with the documented numbers and a controllable clock."""
    return LoginAttemptLimiter(
        ip_limit=10,
        ip_window_seconds=900,
        email_failure_limit=5,
        email_window_seconds=900,
        clock=clock,
    )


# ---------------------------------------------------------------------------
# The per-IP window counts every attempt
# ---------------------------------------------------------------------------


def test_ten_attempts_are_allowed_and_the_eleventh_is_not(
    limiter: LoginAttemptLimiter, clock: FakeClock
) -> None:
    for attempt in range(1, 11):
        assert limiter.check(IP, fresh_email(attempt)).allowed, f"attempt {attempt}"
        limiter.record_failure(IP, fresh_email(attempt))

    blocked = limiter.check(IP, fresh_email(99))
    assert not blocked.allowed
    assert blocked.dimension == "ip"
    assert blocked.limit == 10


def test_a_successful_login_still_counts_against_the_ip_budget(limiter: LoginAttemptLimiter) -> None:
    """The per-IP dimension exists to bound total Argon2 work, not to judge the password.

    Ten correct logins in fifteen minutes is unusual but not hostile, and it *is*
    ten Argon2 runs. Excluding successes here would let an attacker probe passwords
    for free once they had one, since only failures would be visible to the limiter.
    """
    for attempt in range(1, 11):
        assert limiter.check(IP, fresh_email(attempt)).allowed
        limiter.record_success(IP, fresh_email(attempt))

    assert limiter.check(IP, fresh_email(99)).dimension == "ip"


def test_the_ip_window_is_per_address(limiter: LoginAttemptLimiter) -> None:
    for attempt in range(1, 11):
        limiter.record_failure(IP, fresh_email(attempt))

    assert not limiter.check(IP, fresh_email(99)).allowed
    assert limiter.check(OTHER_IP, fresh_email(99)).allowed, "a different peer is a different bucket"


def test_the_ip_window_expires_on_its_own(limiter: LoginAttemptLimiter, clock: FakeClock) -> None:
    """A blocked request must not extend the window it is stuck in.

    If `check` counted the attempt, retrying every second would hold the lock open
    indefinitely and the per-account control would become the permanent lockout
    `SECURITY.md` §5 rules out. `check` is therefore read-only.
    """
    for attempt in range(1, 11):
        limiter.record_failure(IP, fresh_email(attempt))

    for _ in range(20):
        assert not limiter.check(IP, fresh_email(99)).allowed, "retrying must not extend the window"

    clock.advance(901)
    assert limiter.check(IP, fresh_email(99)).allowed


# ---------------------------------------------------------------------------
# The per-email window counts failures only
# ---------------------------------------------------------------------------


def test_five_failures_block_the_sixth_attempt(limiter: LoginAttemptLimiter) -> None:
    for _ in range(5):
        assert limiter.check(OTHER_IP, ADMIN_EMAIL).allowed
        limiter.record_failure(OTHER_IP, ADMIN_EMAIL)

    blocked = limiter.check(OTHER_IP, ADMIN_EMAIL)
    assert not blocked.allowed
    assert blocked.dimension == "email"
    assert blocked.limit == 5


def test_the_email_window_follows_the_account_not_the_caller(limiter: LoginAttemptLimiter) -> None:
    """Five guesses from five different addresses still exhaust the account.

    This is the attack the per-email limit exists for: distributing one guess per
    source address defeats a per-IP limit entirely.
    """
    for attempt in range(1, 6):
        limiter.record_failure(fresh_ip(attempt), ADMIN_EMAIL)

    # Every one of those failures came from a different address, and all of them
    # count against the same account.
    assert not limiter.check(fresh_ip(99), ADMIN_EMAIL).allowed
    assert limiter.check(IP, OTHER_EMAIL).allowed, "an untried address has no failure history"


def test_a_success_clears_the_failure_window(limiter: LoginAttemptLimiter) -> None:
    """The documented reason the two rows of §4.4 differ.

    Four failures, one short of the limit, then a correct password. If the run were
    carried forward the next attempt would be refused — punishing a mistake that has
    already been corrected, against the single person who can clear it.
    """
    for attempt in range(1, 5):
        limiter.record_failure(fresh_ip(attempt), ADMIN_EMAIL)

    limiter.record_success(fresh_ip(50), ADMIN_EMAIL)

    for attempt in range(1, 6):
        assert limiter.check(fresh_ip(attempt), ADMIN_EMAIL).allowed
        limiter.record_failure(fresh_ip(attempt), ADMIN_EMAIL)


def test_the_email_window_expires_after_fifteen_minutes(
    limiter: LoginAttemptLimiter, clock: FakeClock
) -> None:
    for attempt in range(1, 6):
        limiter.record_failure(fresh_ip(attempt), ADMIN_EMAIL)
    assert not limiter.check(fresh_ip(99), ADMIN_EMAIL).allowed

    clock.advance(899)
    assert not limiter.check(fresh_ip(99), ADMIN_EMAIL).allowed, "still inside the window"

    clock.advance(2)
    assert limiter.check(fresh_ip(99), ADMIN_EMAIL).allowed


# ---------------------------------------------------------------------------
# Retry-After and the two-window interaction
# ---------------------------------------------------------------------------


def test_retry_after_is_a_positive_number_of_seconds(
    limiter: LoginAttemptLimiter, clock: FakeClock
) -> None:
    for attempt in range(1, 6):
        limiter.record_failure(fresh_ip(attempt), ADMIN_EMAIL)

    clock.advance(100)
    blocked = limiter.check(fresh_ip(99), ADMIN_EMAIL)

    assert blocked.retry_after > 0
    assert blocked.retry_after <= 900


def test_the_longer_of_the_two_waits_is_reported(limiter: LoginAttemptLimiter, clock: FakeClock) -> None:
    """When both windows are exhausted, the client is told the longer wait.

    Reporting the shorter would invite it to retry into the other limit immediately,
    which is how a client ends up hammering an endpoint it was just told to leave
    alone.
    """
    for _ in range(5):
        limiter.record_failure(IP, ADMIN_EMAIL)
    clock.advance(400)
    for _ in range(5):
        limiter.record_failure(IP, OTHER_EMAIL)

    blocked = limiter.check(IP, OTHER_EMAIL)

    assert not blocked.allowed
    # The IP window opened 400 s ago and has 500 s left; OTHER_EMAIL's window opened
    # just now and has 900 s left. The longer wait is the useful one to report.
    assert blocked.dimension == "email"
    assert blocked.retry_after == 900


# ---------------------------------------------------------------------------
# No global ban
# ---------------------------------------------------------------------------


def test_the_limiter_has_no_global_state(limiter: LoginAttemptLimiter) -> None:
    """`SECURITY.md` §5 rules out a ban list.

    With one administrator behind CGNAT, every visitor shares one address; a ban
    list would lock the owner out on a timer an attacker chose.
    """
    for attempt in range(1, 11):
        limiter.record_failure(IP, fresh_email(attempt))

    assert limiter.check("198.51.100.1", "never-seen@example.com").allowed


# ---------------------------------------------------------------------------
# The router is wired to it
# ---------------------------------------------------------------------------


async def test_login_is_rate_limited_after_five_failures(
    client: AsyncClient, admin_user: AdminUser
) -> None:
    """End to end, at the documented threshold.

    Five wrong passwords, then a correct one refused with 429. The assertion that
    the *correct* password is refused is deliberate: at that point the request must
    not reach Argon2 at all, which is what makes the endpoint cheap to hammer.
    """
    for _ in range(5):
        response = await client.post(
            "/api/admin/auth/login",
            json={"email": ADMIN_EMAIL, "password": WRONG_PASSWORD},
        )
        assert response.status_code == 401

    blocked = await client.post(
        "/api/admin/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )

    assert blocked.status_code == 429
    assert blocked.headers["Retry-After"] == "900"
    assert blocked.json()["error"]["code"] == "RATE_LIMITED"
    assert blocked.json()["error"]["message"] == "Too many requests. Please try again shortly."


async def test_a_rate_limited_login_sets_no_cookie(
    client: AsyncClient, admin_user: AdminUser
) -> None:
    for _ in range(5):
        await client.post(
            "/api/admin/auth/login",
            json={"email": ADMIN_EMAIL, "password": WRONG_PASSWORD},
        )

    blocked = await client.post(
        "/api/admin/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )

    assert blocked.headers.get("set-cookie") is None


async def test_the_429_body_carries_no_information_about_which_limit_fired(
    client: AsyncClient, admin_user: AdminUser
) -> None:
    """The per-email window is the one that fired, and the body must not say so.

    Distinguishing "this address is being brute-forced" from "this client is too
    busy" tells an attacker that a guess is landing.
    """
    for _ in range(5):
        await client.post(
            "/api/admin/auth/login",
            json={"email": ADMIN_EMAIL, "password": WRONG_PASSWORD},
        )

    # Five more from this address exhaust the per-IP budget too, so a request for
    # an untouched account is refused on the IP dimension alone.
    for _ in range(5):
        await client.post(
            "/api/admin/auth/login",
            json={"email": OTHER_EMAIL, "password": WRONG_PASSWORD},
        )

    by_email = await client.post(
        "/api/admin/auth/login",
        json={"email": ADMIN_EMAIL, "password": WRONG_PASSWORD},
    )
    by_ip = await client.post(
        "/api/admin/auth/login",
        json={"email": OTHER_EMAIL, "password": WRONG_PASSWORD},
    )

    assert by_email.status_code == by_ip.status_code == 429
    assert by_email.json()["error"]["message"] == by_ip.json()["error"]["message"]


async def test_a_correct_password_after_fewer_than_five_failures_succeeds(
    client: AsyncClient, admin_user: AdminUser
) -> None:
    for _ in range(4):
        await client.post(
            "/api/admin/auth/login",
            json={"email": ADMIN_EMAIL, "password": WRONG_PASSWORD},
        )

    response = await client.post(
        "/api/admin/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )

    assert response.status_code == 200


async def test_the_email_key_is_normalised_case_insensitively(
    client: AsyncClient, admin_user: AdminUser
) -> None:
    """Varying the case of an address must not buy a fresh failure window.

    `admin_user.email` is `citext`, so the database already treats these as one
    identity. If the limiter bucketed them separately, an attacker could try five
    guesses per casing and multiply the documented limit indefinitely.
    """
    for index in range(5):
        await client.post(
            "/api/admin/auth/login",
            json={"email": "Admin@Example.COM" if index % 2 else ADMIN_EMAIL, "password": WRONG_PASSWORD},
        )

    blocked = await client.post(
        "/api/admin/auth/login",
        json={"email": "ADMIN@EXAMPLE.COM", "password": ADMIN_PASSWORD},
    )

    assert blocked.status_code == 429


def test_the_router_limiter_is_built_from_the_documented_settings() -> None:
    """Not from constants: an operator changing `ADMIN_LOGIN_EMAIL_FAILURE_LIMIT`
    must actually change the limit."""
    settings = get_settings()
    limiter = get_login_limiter()

    assert settings.ADMIN_LOGIN_IP_LIMIT == 10
    assert settings.ADMIN_LOGIN_IP_WINDOW_SECONDS == 900
    assert settings.ADMIN_LOGIN_EMAIL_FAILURE_LIMIT == 5
    assert settings.ADMIN_LOGIN_EMAIL_WINDOW_SECONDS == 900
    assert limiter is get_login_limiter(), "one instance per process"


def test_the_login_limiter_is_separate_from_the_public_content_limiter() -> None:
    """`TESTING.md`'s "raw IP stored: not stored" reasoning applies here too.

    The content limiter counts *reads* of `/api/content` and knows nothing about
    accounts. Sharing its counters would count the wrong events against the wrong
    key and let a caller walk past the per-email limit.
    """
    from app.rate_limit import FixedWindowLimiter

    assert isinstance(get_login_limiter(), LoginAttemptLimiter)
    assert not isinstance(get_login_limiter(), FixedWindowLimiter)


async def test_health_probes_are_never_rate_limited(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    """An infrastructure probe must not be throttled into looking like a bug.

    Same reasoning as Phase 3: a probe refused with 429 sends an operator looking at
    rate limiting when the real problem is the service restarting.
    """
    for _ in range(5):
        await client.post(
            "/api/admin/auth/login",
            json={"email": ADMIN_EMAIL, "password": WRONG_PASSWORD},
        )

    assert (await client.get("/health")).status_code == 200