"""Session lifetime and revocation behaviour.

`SECURITY.md` §3.2 fixes three separate ways a session must stop working, and this
file is where each is proved to stop it:

* **idle timeout** — 12 hours since `last_used_at`;
* **absolute timeout** — 7 days since `issued_at`, *not* extended by activity;
* **revocation** — `revoked_at`, effective on the very next request.

Rows are aged directly rather than by waiting, so a twelve-hour property is tested
in milliseconds. `age_session` exists for exactly that.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine
from support_admin import (
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    age_session,
    audit_rows,
    hours_ago,
    session_factory,
    sessions_for,
)

from app.config import get_settings
from app.models import AdminSession, AdminUser
from app.session_cookie import SESSION_COOKIE_NAME

# ---------------------------------------------------------------------------
# Idle timeout
# ---------------------------------------------------------------------------


async def test_a_session_idled_past_twelve_hours_is_refused(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    """The documented 12-hour idle window, enforced from `last_used_at`."""
    token = _token(await _login(client))
    record = (await sessions_for(engine))[0]

    await age_session(engine, record.id, last_used_at=hours_ago(12) - timedelta(minutes=1))

    response = await client.get("/api/admin/me", headers=_cookie(token))
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


async def test_a_session_idled_under_twelve_hours_still_works(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    """The complement of the test above, so the boundary cannot drift upward."""
    token = _token(await _login(client))
    record = (await sessions_for(engine))[0]

    await age_session(engine, record.id, last_used_at=hours_ago(11.9))

    assert (await client.get("/api/admin/me", headers=_cookie(token))).status_code == 200


async def test_activity_refreshes_the_idle_window_but_not_the_absolute_deadline(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    """The two timeouts are independent, and only one of them is a sliding window.

    A session is nearly idled out; using it moves `last_used_at` forward and keeps
    it alive, while `expires_at` stays where issuance put it. If the absolute
    deadline were recomputed from activity, a daily user could hold a session open
    forever and the 7-day ceiling would be decoration.
    """
    settings = get_settings()
    token = _token(await _login(client))
    record = (await sessions_for(engine))[0]
    original_expiry = record.expires_at

    await age_session(engine, record.id, last_used_at=hours_ago(11))

    assert (await client.get("/api/admin/me", headers=_cookie(token))).status_code == 200

    refreshed = (await sessions_for(engine))[0]
    assert refreshed.last_used_at > hours_ago(1)
    assert refreshed.expires_at == original_expiry
    assert settings.ADMIN_SESSION_ABSOLUTE_SECONDS == 604_800


async def test_the_idle_window_is_refreshed_without_a_write_on_every_request(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    """`last_used_at` is only rewritten once a minute.

    Refreshing on every request would make each authenticated admin call a write,
    for a value only ever read to enforce a twelve-hour window. The trade is
    documented in `app.services.auth`: sixty seconds of slack against 43,200 is
    0.14%, and an admin browsing the site costs no writes at all.
    """
    from app.services.auth import IDLE_REFRESH_INTERVAL_SECONDS

    assert IDLE_REFRESH_INTERVAL_SECONDS == 60
    token = _token(await _login(client))
    record = (await sessions_for(engine))[0]

    await age_session(engine, record.id, last_used_at=hours_ago(0.0001))
    aged = (await sessions_for(engine))[0].last_used_at

    assert (await client.get("/api/admin/me", headers=_cookie(token))).status_code == 200

    # Still within the refresh interval, so the stored value is untouched.
    assert (await sessions_for(engine))[0].last_used_at == aged


# ---------------------------------------------------------------------------
# Cookie renewal
# ---------------------------------------------------------------------------


async def test_an_authenticated_request_reissues_the_cookie_with_the_idle_window(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    """The browser's `Max-Age` must track the sliding server-side window.

    `require_admin_session` re-issues the cookie on success. Without it the
    browser would keep the issuance-time value while the server slid
    `last_used_at` forward, and the cookie would die while the session was still
    alive.
    """
    settings = get_settings()
    token = _token(await _login(client))
    assert settings.ADMIN_SESSION_IDLE_SECONDS == 43_200

    response = await client.get("/api/admin/me", headers=_cookie(token))
    assert response.status_code == 200

    header = response.headers["set-cookie"]
    assert f"{SESSION_COOKIE_NAME}={token}" in header
    assert f"Max-Age={settings.ADMIN_SESSION_IDLE_SECONDS}" in header


async def test_the_reissued_cookie_is_clamped_to_the_absolute_deadline(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    """Renewing slides the idle window but never the seven-day ceiling.

    With only ~90 seconds left on `expires_at`, the re-issued `Max-Age` must be
    the remaining absolute lifetime, not the full idle window.
    """
    settings = get_settings()
    token = _token(await _login(client))
    record = (await sessions_for(engine))[0]

    await age_session(engine, record.id, last_used_at=hours_ago(0.01))
    await age_session(engine, record.id, expires_at=datetime.now(UTC) + timedelta(seconds=90))

    response = await client.get("/api/admin/me", headers=_cookie(token))
    assert response.status_code == 200

    max_age = _max_age(response.headers["set-cookie"])
    assert 0 < max_age <= 90
    assert max_age < settings.ADMIN_SESSION_IDLE_SECONDS


# ---------------------------------------------------------------------------
# Absolute timeout
# ---------------------------------------------------------------------------


async def test_a_session_past_seven_days_is_refused(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    token = _token(await _login(client))
    record = (await sessions_for(engine))[0]

    await age_session(engine, record.id, expires_at=hours_ago(24 * 7) - timedelta(minutes=1))

    assert (await client.get("/api/admin/me", headers=_cookie(token))).status_code == 401


async def test_the_absolute_deadline_is_not_extended_by_repeated_use(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    """The whole point of a *separate* absolute timeout.

    The session is pushed to the edge of the idle window and then used repeatedly.
    Each use refreshes `last_used_at`; if any of them also pushed `expires_at`, the
    seven-day ceiling would never arrive.
    """
    token = _token(await _login(client))
    record = (await sessions_for(engine))[0]
    original_expiry = record.expires_at

    for _ in range(3):
        await age_session(engine, record.id, last_used_at=hours_ago(11))
        assert (await client.get("/api/admin/me", headers=_cookie(token))).status_code == 200

    assert (await sessions_for(engine))[0].expires_at == original_expiry

    # Now step past the absolute deadline; usage cannot save it.
    await age_session(engine, record.id, last_used_at=hours_ago(0.01))
    await age_session(engine, record.id, expires_at=hours_ago(0.02))
    assert (await client.get("/api/admin/me", headers=_cookie(token))).status_code == 401


async def test_an_absolute_expiry_beyond_the_idle_window_still_ends_the_session(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    token = _token(await _login(client))
    record = (await sessions_for(engine))[0]

    # Idle is fresh; only the absolute deadline has passed. The stricter of the two
    # decides, which is why both are checked.
    await age_session(engine, record.id, expires_at=hours_ago(1))

    assert (await client.get("/api/admin/me", headers=_cookie(token))).status_code == 401


# ---------------------------------------------------------------------------
# Revocation
# ---------------------------------------------------------------------------


async def test_logout_sets_revoked_at_and_leaves_other_sessions_alone(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    """Revocation is per session row, not per account.

    Two browsers, two tokens, one logout. If revocation had been implemented as
    "clear every session for this user", the second browser would be signed out as
    a side effect — which is a decision nobody documented.
    """
    first = _token(await _login(client))
    second = _token(await _login(client))
    assert first != second

    await client.post("/api/admin/auth/logout", headers=_csrf(second))

    rows = {str(row.token_hash): row for row in await sessions_for(engine)}
    assert len(rows) == 2
    assert sum(1 for row in rows.values() if row.revoked_at is not None) == 1
    assert (await client.get("/api/admin/me", headers=_cookie(first))).status_code == 200


async def test_revoking_twice_is_impossible_because_the_second_call_is_401(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    token = _token(await _login(client))
    assert (await client.post("/api/admin/auth/logout", headers=_csrf(token))).status_code == 204

    replay = await client.post("/api/admin/auth/logout", headers=_csrf(token))

    assert replay.status_code == 401
    assert len(await audit_rows(engine, action="logout")) == 1


async def test_revocation_survives_a_dead_idle_window(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    """A revoked row is refused even when it is also idle-expired.

    The order of the checks matters for the log, not the response: both produce an
    identical 401, so a caller learns nothing about which rule caught it.
    """
    token = _token(await _login(client))
    record = (await sessions_for(engine))[0]

    factory = session_factory(engine)
    async with factory() as session:
        row = await session.get(AdminSession, record.id)
        assert row is not None
        row.revoked_at = datetime.now(UTC)
        row.last_used_at = hours_ago(48)
        await session.commit()

    assert (await client.get("/api/admin/me", headers=_cookie(token))).status_code == 401


# ---------------------------------------------------------------------------
# Token handling
# ---------------------------------------------------------------------------


async def test_each_login_mints_a_distinct_token(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    """Tokens are 256 random bits, never derived from the user or the clock.

    A token built from `user_id + issued_at` would be predictable to anyone who
    knew when the owner last logged in, which is precisely the kind of structure
    `SECURITY.md` §3.2 rules out.
    """
    tokens = {_token(await _login(client)) for _ in range(3)}

    assert len(tokens) == 3
    assert len({row.token_hash for row in await sessions_for(engine)}) == 3


async def test_a_token_for_one_user_cannot_authenticate_another(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    """The lookup is by token hash alone, and the hash is unique.

    Proving the other direction — that a valid token cannot be re-pointed at a
    different row — is what the unique index on `token_hash` is for, and what
    `tests/test_constraints.py` asserts about the constraint itself.
    """
    token = _token(await _login(client))
    assert (await client.get("/api/admin/me", headers=_cookie(token))).status_code == 200

    # A token that differs only in its last character must not resolve.
    other = token[:-1] + ("a" if token[-1] != "a" else "b")
    assert (await client.get("/api/admin/me", headers=_cookie(other))).status_code == 401


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _login(client: AsyncClient) -> object:
    return await client.post(
        "/api/admin/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )


def _token(response: object) -> str:
    match = re.search(r"portfolio_admin_session=([^;]+)", response.headers["set-cookie"])  # type: ignore[attr-defined]
    assert match is not None
    return match.group(1)


def _max_age(header: str) -> int:
    match = re.search(r"Max-Age=(\d+)", header)
    assert match is not None, header
    return int(match.group(1))


def _cookie(token: str) -> dict[str, str]:
    return {"Cookie": f"portfolio_admin_session={token}"}


def _csrf(token: str) -> dict[str, str]:
    from app.security.tokens import csrf_token_for_session

    return {**_cookie(token), "X-CSRF-Token": csrf_token_for_session(token)}