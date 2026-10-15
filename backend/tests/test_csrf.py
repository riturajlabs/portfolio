"""CSRF protection on admin mutations.

`API.md` §4.2 and `SECURITY.md` §2.5 require a session-bound double-submit token
on every mutating admin request, and `TESTING.md` §7.3 pins the status codes: 401
without a session, 403 with a missing or wrong token.

Phase 4's only mutation is `POST /api/admin/auth/logout`, so these tests exercise
the guard on the real route rather than on a purpose-built fixture. A
test-only endpoint would prove the dependency works; it would not prove that the
dependency is *attached* to the route that ships, and that attachment is the part
that regresses.

The token is derived from the session token rather than stored — see
`app.security.tokens` for why `DATABASE.md` §11 needs no CSRF column for that.
"""

from __future__ import annotations

import re
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from support_admin import ADMIN_EMAIL, ADMIN_PASSWORD

from app.config import get_settings
from app.dependencies.admin_auth import CSRF_HEADER_NAME
from app.models import AdminUser
from app.security.tokens import (
    CSRF_TOKEN_BYTES,
    SESSION_TOKEN_BYTES,
    csrf_token_for_session,
    generate_session_token,
    is_valid_csrf_token,
)
from app.session_cookie import SESSION_COOKIE_NAME


@pytest.fixture
async def session_token(client: AsyncClient, admin_user: AdminUser) -> Iterator[str]:
    """Log in and yield the raw session token."""
    response = await client.post(
        "/api/admin/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    assert response.status_code == 200, response.text
    match = re.search(rf"{SESSION_COOKIE_NAME}=([^;]+)", response.headers["set-cookie"])
    assert match is not None
    yield match.group(1)


# ---------------------------------------------------------------------------
# The token's properties
# ---------------------------------------------------------------------------


def test_the_session_token_carries_256_bits_of_entropy() -> None:
    """`SECURITY.md` §3.2: `secrets.token_urlsafe(32)`.

    Asserted on the generator rather than only on one sample, because a bug that
    shortened the length would still produce a token that looks fine.
    """
    assert SESSION_TOKEN_BYTES == 32
    token = generate_session_token()
    assert len(token) >= 43, "32 bytes base64url-encoded"
    assert token != generate_session_token()


def test_the_csrf_token_is_deterministic_for_one_session() -> None:
    """It must be reproducible, or `/me` could not hand it out.

    The value is a pure function of the session token, which is why it survives in
    no column and needs no rotation: `/me` recomputes it on every call.
    """
    token = generate_session_token()

    assert csrf_token_for_session(token) == csrf_token_for_session(token)
    assert len(csrf_token_for_session(token)) == CSRF_TOKEN_BYTES * 2, "hex of a full digest"


def test_the_csrf_token_differs_between_sessions() -> None:
    """This is what makes the check *bound* to a session.

    Two sessions of the same administrator get different CSRF tokens, so a token
    lifted from one browser cannot authorise a mutation in another.
    """
    first, second = generate_session_token(), generate_session_token()

    assert csrf_token_for_session(first) != csrf_token_for_session(second)
    assert not is_valid_csrf_token(first, csrf_token_for_session(second))


def test_the_csrf_token_is_not_the_session_token_hash() -> None:
    """Domain separation, so the CSRF value can never become a stored credential.

    Both digests are computed over the session token. Without a distinct label they
    would be identical, and `csrf_token` would be exactly the contents of
    `admin_session.token_hash` — a database credential that an audit log or a
    browser devtools panel would happily print.
    """
    import hashlib

    token = generate_session_token()
    plain_sha256 = hashlib.sha256(token.encode()).hexdigest()

    assert csrf_token_for_session(token) != plain_sha256


def test_a_missing_or_empty_csrf_token_is_rejected() -> None:
    token = generate_session_token()

    assert not is_valid_csrf_token(token, None)
    assert not is_valid_csrf_token(token, "")
    assert is_valid_csrf_token(token, csrf_token_for_session(token))


# ---------------------------------------------------------------------------
# Enforcement on the shipped route
# ---------------------------------------------------------------------------


async def test_logout_without_a_csrf_token_is_403(client: AsyncClient, session_token: str) -> None:
    response = await client.post("/api/admin/auth/logout", headers=_cookie(session_token))

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"


async def test_logout_with_a_wrong_csrf_token_is_403(client: AsyncClient, session_token: str) -> None:
    wrong = csrf_token_for_session(generate_session_token())

    response = await client.post(
        "/api/admin/auth/logout",
        headers={**_cookie(session_token), CSRF_HEADER_NAME: wrong},
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"


async def test_a_csrf_token_from_another_session_is_403(
    client: AsyncClient, session_token: str
) -> None:
    """The bound, tested at the HTTP layer.

    A syntactically valid token from a different session is the interesting case: a
    check that merely compared strings against a session-independent value would
    accept this.
    """
    other = csrf_token_for_session(generate_session_token())

    response = await client.post(
        "/api/admin/auth/logout",
        headers={**_cookie(session_token), CSRF_HEADER_NAME: other},
    )

    assert response.status_code == 403


async def test_a_rejected_csrf_token_leaves_the_session_usable(
    client: AsyncClient, session_token: str
) -> None:
    """403 means the request did not happen — the logout must not take effect."""
    await client.post("/api/admin/auth/logout", headers=_cookie(session_token))

    assert (await client.get("/api/admin/me", headers=_cookie(session_token))).status_code == 200


async def test_logout_with_a_valid_csrf_token_succeeds(
    client: AsyncClient, session_token: str
) -> None:
    response = await client.post(
        "/api/admin/auth/logout", headers={**_cookie(session_token), **_header(session_token)}
    )

    assert response.status_code == 204
    assert (await client.get("/api/admin/me", headers=_cookie(session_token))).status_code == 401


async def test_the_csrf_header_name_is_case_insensitive_on_the_wire(
    client: AsyncClient, session_token: str
) -> None:
    """Browsers and proxies treat header names case-insensitively; so must this."""
    response = await client.post(
        "/api/admin/auth/logout",
        headers={**_cookie(session_token), "x-csrf-token": csrf_token_for_session(session_token)},
    )

    assert response.status_code == 204


async def test_safe_methods_do_not_require_a_csrf_token(
    client: AsyncClient, session_token: str
) -> None:
    """A `GET` cannot change state, so requiring a token on one buys nothing.

    `POST /api/admin/auth/logout` is the only unsafe method Phase 4 ships; if this
    ever stops passing, the guard has started rejecting reads.
    """
    assert (await client.get("/api/admin/me", headers=_cookie(session_token))).status_code == 200


async def test_a_mutation_without_a_session_is_401_not_403(
    client: AsyncClient, session_token: str
) -> None:
    """401 first, then CSRF — authentication runs before authorisation.

    A caller with no session cannot have a valid CSRF token, so checking CSRF first
    would answer every anonymous mutation with 403 and hide the real problem.
    """
    _forget_cookies(client)
    response = await client.post(
        "/api/admin/auth/logout",
        headers={CSRF_HEADER_NAME: csrf_token_for_session(session_token)},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


async def test_the_shared_api_key_grants_nothing(client: AsyncClient) -> None:
    """`TESTING.md` §7.3: `X-API-Key` alone must not authenticate an admin.

    `SECURITY.md` §3.8 notes the legacy `X-API-Key` header exists in the old
    frontend and is granted nothing by this service. If any future change started
    honouring it here, this test would fail — which is the point.
    """
    _forget_cookies(client)
    response = await client.get("/api/admin/me", headers={"X-API-Key": "any-value-at-all"})

    assert response.status_code == 401


async def test_a_public_route_ignores_the_admin_cookie(
    client: AsyncClient, session_token: str
) -> None:
    """`TESTING.md` §7.3: the admin cookie is not forwarded to public endpoints.

    A byte-identical response with and without the cookie is the observable proof
    that `/api/content` neither requires nor reads it. The cookie's `Path=/` means
    the browser *will* send it there, so the route having nothing to do with it is
    what actually matters; `SameSite=Strict` prevents the cross-site case, not this
    same-site one.
    """
    _forget_cookies(client)
    with_cookie = await client.get("/api/content", headers=_cookie(session_token))
    without = await client.get("/api/content")

    assert with_cookie.status_code == without.status_code
    assert with_cookie.content == without.content
    assert with_cookie.headers.get("etag") == without.headers.get("etag")


# ---------------------------------------------------------------------------
# Every admin route is guarded
# ---------------------------------------------------------------------------


async def test_every_admin_route_refuses_an_unauthenticated_caller(
    application: FastAPI,
) -> None:
    """`TESTING.md` §7.3's enumeration test.

    Derived by walking the application's own route table rather than from a
    hand-kept list, because "a single unprotected route is a breach" and a list
    someone maintains is exactly how that happens. A new admin route added without
    a guard fails here.

    `login` is excluded because it is the endpoint that *creates* a session and so
    cannot require one; `bootstrap` is excluded because it is guarded by its own
    one-time token rather than a session cookie (its refusals — 401/403/404/409/
    413/422/429 — are pinned in `test_admin_bootstrap.py`). Every other admin
    route must refuse an anonymous caller.
    """
    # Read from the OpenAPI document rather than `application.routes`: this
    # FastAPI version keeps included routers behind a lazy `_IncludedRouter`, so
    # the flat route table does not list them.
    admin_paths = sorted(
        path for path in application.openapi()["paths"] if path.startswith("/api/admin")
    )

    # `login` is the endpoint that *creates* a session and so cannot require one;
    # every other admin route must refuse an anonymous caller. Walking the same
    # route table this test reads keeps the set in lock-step with the app: adding
    # a route without a guard fails the loop below, dropping one trivially fails
    # nothing but is caught by code review.
    async def _call(path: str, method: str) -> int:
        transport = ASGITransport(app=application)
        async with AsyncClient(transport=transport, base_url="http://testserver") as raw:
            return (await raw.request(method, path)).status_code

    for path in admin_paths:
        if path.endswith("auth/login") or path == "/api/admin/bootstrap":
            continue
        for method in application.openapi()["paths"][path]:
            if method.upper() in ("HEAD", "OPTIONS", "TRACE"):
                continue
            sample = re.sub(r"\{[^}]+\}", "c0ffeec0-ffe0-4c0f-8eef-0c0ffeec0ffe", path)
            assert await _call(sample, method.upper()) == 401, f"{method.upper()} {path}"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _forget_cookies(client: AsyncClient) -> None:
    """Drop everything httpx is holding on the client's behalf.

    `AsyncClient` keeps a cookie jar for the life of the object, and the `client`
    fixture is shared for the duration of a test. Any earlier login in the same test
    would therefore still be attached, and an assertion about "no session" would
    silently be asserting nothing.
    """
    client.cookies.clear()


def _cookie(token: str) -> dict[str, str]:
    return {"Cookie": f"{SESSION_COOKIE_NAME}={token}"}


def _header(token: str) -> dict[str, str]:
    return {CSRF_HEADER_NAME: csrf_token_for_session(token)}


def test_the_idle_window_is_the_documented_twelve_hours() -> None:
    """One number feeds both the cookie Max-Age and the server-side idle check.

    `set_session_cookie` and `resolve_session` read the same setting, so they
    cannot drift into a cookie that outlives its own server-side window.
    """
    assert get_settings().ADMIN_SESSION_IDLE_SECONDS == 43_200