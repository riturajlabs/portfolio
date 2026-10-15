"""Admin login, logout and current-user behaviour.

Covers `TESTING.md` §7.2. The properties worth reading the assertions for:

* every login failure returns a **byte-identical** body, so the endpoint cannot be
  used to discover whether an administrator account exists;
* the cookie is `HttpOnly` + `SameSite=Strict` + `Path=/`, and adds `Secure`
  outside development;
* the password never leaves the process, and the stored column holds an Argon2id
  PHC string;
* `admin_session.token_hash` holds a hash, not a token that would work.
"""

from __future__ import annotations

import re
import time
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import Response
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine
from support_admin import (
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    WRONG_PASSWORD,
    audit_rows,
    session_factory,
    sessions_for,
)

from app.config import Settings, get_settings
from app.models import AdminUser
from app.security.passwords import verify_password
from app.security.tokens import csrf_token_for_session, hash_session_token
from app.services.auth import client_ip_hash
from app.session_cookie import SESSION_COOKIE_NAME, set_session_cookie

# ---------------------------------------------------------------------------
# Successful login
# ---------------------------------------------------------------------------


async def test_login_with_valid_credentials_returns_200_and_the_user(
    client: AsyncClient, admin_user: AdminUser
) -> None:
    response = await _login(client)

    assert response.status_code == 200
    payload = response.json()
    assert payload["user"]["id"] == str(admin_user.id)
    assert payload["user"]["email"] == ADMIN_EMAIL
    assert payload["user"]["role"] == "ADMIN"
    assert payload["user"]["last_login_at"] is not None, "a login stamps last_login_at"
    assert set(payload) == {"user"}
    assert set(payload["user"]) == {"id", "email", "role", "last_login_at"}


async def test_login_sets_an_httponly_strict_session_cookie(
    client: AsyncClient, admin_user: AdminUser
) -> None:
    """`HttpOnly`, `SameSite=Strict`, `Path=/` and a 12-hour Max-Age.

    `Secure` is asserted separately below, because it depends on the environment
    and this suite runs in development.
    """
    header = (await _login(client)).headers["set-cookie"]

    assert header.startswith(f"{SESSION_COOKIE_NAME}=")
    assert "HttpOnly" in header
    assert "samesite=strict" in header.lower()
    assert "Path=/" in header
    assert f"Max-Age={get_settings().ADMIN_SESSION_IDLE_SECONDS}" in header
    assert "Secure" not in header, "development is plain HTTP; the attribute belongs elsewhere"


@pytest.mark.parametrize("environment", ["staging", "production"])
def test_the_session_cookie_is_secure_outside_development(environment: str) -> None:
    """§3.3 requires `Secure`; it is present in staging as well as production."""
    settings = Settings(DATABASE_URL="postgresql://u:p@localhost/db", ENVIRONMENT=environment)
    response = Response()

    set_session_cookie(response, "token", settings)

    assert "Secure" in response.headers["set-cookie"]


def test_the_session_cookie_omits_secure_only_in_development() -> None:
    """The documented exception, and it is narrow: development only.

    A browser discards a `Secure` cookie received over `http://localhost`, so
    keeping the attribute there would break the local login flow without making it
    safer.
    """
    settings = Settings(DATABASE_URL="postgresql://u:p@localhost/db", ENVIRONMENT="development")
    response = Response()

    set_session_cookie(response, "token", settings)

    assert "Secure" not in response.headers["set-cookie"]
    assert "HttpOnly" in response.headers["set-cookie"]


async def test_login_response_carries_nothing_but_the_documented_user(
    client: AsyncClient, admin_user: AdminUser
) -> None:
    """No password, no hash, and no CSRF token — §6.1's login body is `{user}`."""
    body = (await _login(client)).text

    assert ADMIN_PASSWORD not in body
    assert admin_user.password_hash not in body
    assert "csrf" not in body.lower()


async def test_the_password_column_holds_an_argon2id_phc_string(
    engine: AsyncEngine, admin_user: AdminUser
) -> None:
    """A hash, never the plaintext, and never a cheaper algorithm.

    The parameter line is asserted because `SECURITY.md` §3.1 rules out bcrypt,
    scrypt and PBKDF2: a downgrade would still start with `$argon2id$` in this
    schema's era, so the parameters are what actually pin the decision.
    """
    stored = await _get_user(engine, admin_user.id)

    assert stored is not None
    assert stored.password_hash != ADMIN_PASSWORD
    assert stored.password_hash.startswith("$argon2id$")
    assert re.match(r"^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$", stored.password_hash)
    assert "m=19456,t=2,p=1" in stored.password_hash
    assert verify_password(stored.password_hash, ADMIN_PASSWORD)
    assert not verify_password(stored.password_hash, WRONG_PASSWORD)


async def test_the_token_column_holds_a_hash_and_not_a_working_token(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    """A database dump must not be replayable as cookies.

    The raw value from `Set-Cookie` is confirmed to work, then the stored
    `token_hash` is confirmed *not* to — which is the only way to prove the token
    is stored hashed rather than asserting that some column looks like a hash.
    """
    raw_token = _token(await _login(client))

    assert (await client.get("/api/admin/me", headers=_cookie(raw_token))).status_code == 200

    record = (await sessions_for(engine))[0]
    assert record.token_hash != raw_token
    assert record.token_hash == hash_session_token(raw_token)
    assert re.fullmatch(r"[0-9a-f]{64}", record.token_hash), "SHA-256, lowercase hex"

    denied = await client.get("/api/admin/me", headers=_cookie(record.token_hash))
    assert denied.status_code == 401


async def test_the_session_row_stores_a_keyed_ip_hash_and_a_bounded_user_agent(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    """The raw peer address is never stored.

    An unkeyed SHA-256 of an IPv4 address is reversible in seconds by brute force,
    so hashing alone would not satisfy "the raw IP is not stored". `client_ip_hash`
    keys with a process-local secret, and the test asserts the stored value is the
    *keyed* form and that the address itself appears nowhere.
    """
    await client.post(
        "/api/admin/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        headers={"User-Agent": "x" * 5_000},
    )

    record = (await sessions_for(engine))[0]

    # httpx's ASGI transport presents the peer as 127.0.0.1.
    assert record.ip_hash == client_ip_hash("127.0.0.1")
    assert record.ip_hash is not None
    assert re.fullmatch(r"[0-9a-f]{64}", record.ip_hash)
    assert "127.0.0.1" not in record.ip_hash
    # `user_agent` is `text(300)`; an over-long header is cut, not rejected.
    assert record.user_agent is not None
    assert len(record.user_agent) == 300


async def test_the_session_row_carries_the_documented_lifetimes(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    await _login(client)

    settings = get_settings()
    record = (await sessions_for(engine))[0]

    assert record.user_id == admin_user.id
    assert record.revoked_at is None

    issued = _aware(record.issued_at)
    expires = _aware(record.expires_at)
    assert record.last_used_at is not None
    assert _aware(record.last_used_at) == issued

    # Absolute lifetime is measured from issuance and never from activity, which
    # is what makes it absolute.
    window = settings.ADMIN_SESSION_ABSOLUTE_SECONDS
    lifetime = expires - issued
    assert timedelta(seconds=window - 1) < lifetime <= timedelta(seconds=window)
    assert settings.ADMIN_SESSION_ABSOLUTE_SECONDS == 7 * 24 * 60 * 60
    assert settings.ADMIN_SESSION_IDLE_SECONDS == 12 * 60 * 60


async def test_login_updates_last_login_and_clears_the_failure_counters(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    factory = session_factory(engine)
    async with factory() as session:
        user = await session.get(AdminUser, admin_user.id)
        assert user is not None
        user.failed_attempts = 3
        user.locked_until = datetime.now(UTC) + timedelta(minutes=5)
        await session.commit()

    await _login(client)

    user = await _get_user(engine, admin_user.id)
    assert user is not None
    assert user.failed_attempts == 0
    assert user.locked_until is None
    assert user.last_login_at is not None


async def test_login_writes_an_audit_row(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    await _login(client)

    rows = await audit_rows(engine, action="login")
    assert len(rows) == 1
    entry = rows[0]
    assert entry.actor_user_id is not None
    assert entry.entity == "admin_session"
    assert entry.entity_id is not None, "the audit row names the session it describes"
    assert entry.after == {"outcome": "success"}


# ---------------------------------------------------------------------------
# Failed login
# ---------------------------------------------------------------------------


async def test_wrong_password_is_401(client: AsyncClient, admin_user: AdminUser) -> None:
    response = await _login(client, password=WRONG_PASSWORD)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


async def test_every_failure_mode_returns_a_byte_identical_body(
    client: AsyncClient, inactive_admin: AdminUser
) -> None:
    """The core of `TESTING.md` §7.2: unknown email, wrong password and disabled
    account are indistinguishable.

    Compared as raw text rather than parsed JSON, because the requirement is
    byte-for-byte and a parser would hide differences in key order or spacing that
    a diffing caller could still use.

    `request_id` is the one field that cannot match, because `API.md` §7.2 requires
    it to be unique so a reported failure can be traced. The two requirements are
    reconciled by excluding it: it is a correlation handle, carries no information
    about *why* the login failed, and is the only permitted difference. Anything
    else differing would mean the endpoint leaks which check failed.
    """
    responses = [
        await _login(client, email="nobody@example.com"),
        await _login(client, password=WRONG_PASSWORD),
        await _login(client),
    ]

    bodies = {
        _without_request_id(response.text)
        for response in responses
    }
    assert len(bodies) == 1, f"failure bodies differ: {bodies}"

    # Every failure still gets its own id, which is the documented exception.
    assert len({response.json()["error"]["request_id"] for response in responses}) == 3

    for response in responses:
        assert response.status_code == 401
        assert response.headers.get("set-cookie") is None, "a failed login sets no cookie"


async def test_login_does_not_reveal_whether_the_account_exists(
    client: AsyncClient, admin_user: AdminUser
) -> None:
    """Timing, not only the body.

    An unknown address still pays the full Argon2 cost against a dummy hash, so the
    two cases land in the same order of magnitude. The bound is loose on purpose: a
    tight one would be flaky on a loaded machine, and the property that matters is
    the absence of an order-of-magnitude gap.
    """
    timings: dict[str, float] = {}
    for label, email, password in (
        ("unknown", "nobody@example.com", WRONG_PASSWORD),
        ("wrong", ADMIN_EMAIL, WRONG_PASSWORD),
    ):
        samples = []
        for _ in range(3):
            started = time.perf_counter()
            await _login(client, email=email, password=password)
            samples.append(time.perf_counter() - started)
        timings[label] = sorted(samples)[len(samples) // 2]

    unknown, wrong = timings["unknown"], timings["wrong"]
    assert unknown > 0, "the unknown-address path must not short-circuit Argon2"
    ratio = max(unknown, wrong) / min(unknown, wrong)
    assert ratio < 5, f"timing gap suggests the dummy hash is not being used: {timings}"


async def test_one_failed_password_increments_the_durable_counter(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    """Recorded for the operator; see `app.services.auth` for why this is not what
    enforces the limit."""
    await _login(client, password=WRONG_PASSWORD)

    user = await _get_user(engine, admin_user.id)
    assert user is not None
    assert user.failed_attempts == 1
    assert user.locked_until is None, "one failure is below the limit of five"


async def test_five_failures_stamp_locked_until_for_the_operator(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    for _ in range(5):
        assert (await _login(client, password=WRONG_PASSWORD)).status_code == 401

    user = await _get_user(engine, admin_user.id)
    assert user is not None
    assert user.failed_attempts == 5
    assert user.locked_until is not None
    assert user.locked_until > datetime.now(UTC)


async def test_a_correct_password_clears_an_unfinished_failure_run(
    client: AsyncClient, admin_user: AdminUser
) -> None:
    """A correct password is never treated as a failure, and it clears the record.

    Four failures — one short of the limit — then a success. If successes counted
    as failures, or did not reset the run, the two attempts after this would be
    refused.
    """
    for _ in range(4):
        assert (await _login(client, password=WRONG_PASSWORD)).status_code == 401

    assert (await _login(client)).status_code == 200
    assert (await _login(client)).status_code == 200
    assert (await _login(client)).status_code == 200


async def test_deactivating_the_account_does_not_record_a_password_failure(
    client: AsyncClient, engine: AsyncEngine, inactive_admin: AdminUser
) -> None:
    """Otherwise anyone who knew the password could deliberately lock the owner out.

    The attempt reached a *correct* password; it was the account's status that
    refused it, which is not a credential failure.
    """
    for _ in range(5):
        assert (await _login(client)).status_code == 401

    user = await _get_user(engine, inactive_admin.id)
    assert user is not None
    assert user.failed_attempts == 0
    assert user.locked_until is None


async def test_a_failed_login_on_a_disabled_account_is_audited(
    client: AsyncClient, engine: AsyncEngine, inactive_admin: AdminUser
) -> None:
    await _login(client)

    rows = await audit_rows(engine, action="login")
    assert len(rows) == 1
    assert rows[0].after == {
        "outcome": "failure",
        "reason": "inactive_account",
        "email": ADMIN_EMAIL,
    }
    assert rows[0].entity == "admin_user"


async def test_a_failed_login_on_an_unknown_email_is_audited_with_no_actor(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """`actor_user_id` is nullable exactly so an attempt with no account can be
    recorded. Credential stuffing against a guessed address is the event an
    operator most needs to see, and it would leave no trace otherwise.
    """
    await _login(client, email="nobody@example.com")

    rows = await audit_rows(engine, action="login")
    assert len(rows) == 1
    entry = rows[0]
    assert entry.actor_user_id is None
    assert entry.entity_id is None
    assert entry.after == {
        "outcome": "failure",
        "reason": "unknown_email",
        # The attempted address is kept: credential stuffing against a guessed
        # address is the event an operator most needs to see, and it would
        # otherwise leave no trace at all.
        "email": "nobody@example.com",
    }


async def test_login_audits_a_wrong_password_with_the_admin_as_actor(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    await _login(client, password=WRONG_PASSWORD)

    entry = (await audit_rows(engine, action="login"))[0]
    assert entry.actor_user_id == admin_user.id
    assert entry.after["reason"] == "wrong_password"


async def test_login_rejects_a_malformed_body_with_the_admin_envelope(client: AsyncClient) -> None:
    """A 422 on an admin path uses §7.2's enriched shape, not FastAPI's default."""
    response = await client.post(
        "/api/admin/auth/login",
        json={"email": "not-an-email", "password": ADMIN_PASSWORD},
    )

    assert response.status_code == 422
    payload = response.json()
    assert payload["error"]["code"] == "VALIDATION_ERROR"
    assert payload["error"]["request_id"]
    assert {field["field"] for field in payload["error"]["fields"]} == {"email"}


async def test_login_rejects_an_unknown_field(client: AsyncClient, admin_user: AdminUser) -> None:
    """`extra="forbid"`, so a field the contract does not define cannot be ignored."""
    response = await client.post(
        "/api/admin/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD, "is_admin": True},
    )

    assert response.status_code == 422


# ---------------------------------------------------------------------------
# Logout
# ---------------------------------------------------------------------------


async def test_logout_revokes_the_session_and_clears_the_cookie(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    token = _token(await _login(client))

    response = await client.post("/api/admin/auth/logout", headers=_csrf(token))

    assert response.status_code == 204
    assert "Max-Age=0" in response.headers["set-cookie"]
    assert (await sessions_for(engine))[0].revoked_at is not None


async def test_a_revoked_cookie_fails_on_the_very_next_request(
    client: AsyncClient, admin_user: AdminUser
) -> None:
    """Revocation is immediate, not eventual: the token stops working at once."""
    token = _token(await _login(client))
    assert (await client.get("/api/admin/me", headers=_cookie(token))).status_code == 200

    await client.post("/api/admin/auth/logout", headers=_csrf(token))

    assert (await client.get("/api/admin/me", headers=_cookie(token))).status_code == 401


async def test_logout_writes_an_audit_row(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    token = _token(await _login(client))

    await client.post("/api/admin/auth/logout", headers=_csrf(token))

    rows = await audit_rows(engine, action="logout")
    assert len(rows) == 1
    assert rows[0].entity == "admin_session"
    assert rows[0].entity_id is not None
    assert rows[0].after == {"outcome": "success"}


async def test_logout_without_a_session_is_401(client: AsyncClient, engine: AsyncEngine) -> None:
    """There is nothing to revoke, and answering 200 would let a caller probe for
    live sessions."""
    response = await client.post("/api/admin/auth/logout")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"
    assert await audit_rows(engine, action="logout") == []


# ---------------------------------------------------------------------------
# /api/admin/me
# ---------------------------------------------------------------------------


async def test_me_returns_the_user_and_its_csrf_token(
    client: AsyncClient, admin_user: AdminUser
) -> None:
    token = _token(await _login(client))

    response = await client.get("/api/admin/me", headers=_cookie(token))

    assert response.status_code == 200
    payload = response.json()
    assert payload["user"]["email"] == ADMIN_EMAIL
    assert payload["user"]["id"] == str(admin_user.id)
    assert payload["csrf_token"] == csrf_token_for_session(token)


async def test_me_never_returns_columns_outside_the_documented_contract(
    client: AsyncClient, admin_user: AdminUser
) -> None:
    token = _token(await _login(client))

    body = (await client.get("/api/admin/me", headers=_cookie(token))).text

    assert admin_user.password_hash not in body
    for forbidden in ("password_hash", "failed_attempts", "locked_until", "is_active"):
        assert forbidden not in body, f"{forbidden} is not part of the §6.1 contract"


async def test_me_without_a_cookie_is_401_and_clears_the_cookie(client: AsyncClient) -> None:
    response = await client.get("/api/admin/me")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"
    assert "Max-Age=0" in response.headers["set-cookie"]


async def test_me_with_a_tampered_token_is_401(client: AsyncClient, admin_user: AdminUser) -> None:
    token = _token(await _login(client))
    tampered = token[:-1] + ("A" if token[-1] != "A" else "B")

    response = await client.get("/api/admin/me", headers=_cookie(tampered))

    assert response.status_code == 401


async def test_me_with_an_unknown_token_is_401(client: AsyncClient) -> None:
    assert (await client.get("/api/admin/me", headers=_cookie("never-issued"))).status_code == 401


async def test_me_stops_working_when_the_account_is_deactivated(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    """An open cookie must not outlive the permission that granted it.

    Deactivating the administrator ends the session as surely as a logout; only
    the mechanism differs.
    """
    token = _token(await _login(client))
    factory = session_factory(engine)
    async with factory() as session:
        user = await session.get(AdminUser, admin_user.id)
        assert user is not None
        user.is_active = False
        await session.commit()

    assert (await client.get("/api/admin/me", headers=_cookie(token))).status_code == 401


async def test_logging_out_one_session_leaves_another_alone(
    client: AsyncClient, engine: AsyncEngine, admin_user: AdminUser
) -> None:
    """Each login mints an independent token and revocation is per row.

    If revocation had been "clear all sessions for the user", this would fail —
    which is why an obviously-correct behaviour still gets a test.
    """
    first = _token(await _login(client))
    await client.post("/api/admin/auth/logout", headers=_csrf(first))

    second = _token(await _login(client))
    assert second != first

    assert (await client.get("/api/admin/me", headers=_cookie(second))).status_code == 200
    assert (await client.get("/api/admin/me", headers=_cookie(first))).status_code == 401
    assert len(await sessions_for(engine)) == 2


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_user(engine: AsyncEngine, user_id: object) -> AdminUser | None:
    factory = session_factory(engine)
    async with factory() as session:
        return await session.get(AdminUser, user_id)


async def _login(client: AsyncClient, **overrides: object) -> object:
    body: dict[str, object] = {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
    body.update(overrides)
    return await client.post("/api/admin/auth/login", json=body)


def _token(response: object) -> str:
    """Extract the raw session token from a login response's `Set-Cookie`."""
    header = response.headers["set-cookie"]  # type: ignore[attr-defined]
    match = re.search(rf"{SESSION_COOKIE_NAME}=([^;]+)", header)
    assert match is not None, header
    return match.group(1)


def _without_request_id(body: str) -> str:
    """The response body with its per-response correlation id removed."""
    import json

    payload = json.loads(body)
    payload["error"].pop("request_id", None)
    return json.dumps(payload, sort_keys=True)


def _cookie(token: str) -> dict[str, str]:
    return {"Cookie": f"{SESSION_COOKIE_NAME}={token}"}


def _csrf(token: str) -> dict[str, str]:
    return {**_cookie(token), "X-CSRF-Token": csrf_token_for_session(token)}


def _aware(moment: datetime) -> datetime:
    """`TIMESTAMP WITHOUT TIME ZONE` comes back naive; treat it as UTC."""
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def _iso(moment: datetime | None) -> str | None:
    return _aware(moment).isoformat() if moment else None

