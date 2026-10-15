"""Reusable authentication and CSRF dependencies.

The point of this module is that a future admin route opts in by naming a
dependency and gets the documented behaviour for free. `TESTING.md` §7.3 makes the
consequence explicit — "a single unprotected route is a breach" — and the only
durable answer to that is to make the insecure option require a deliberate act
rather than a forgotten import.

Two dependencies, two concerns:

* `require_admin_session` answers "is this a live administrator session?". It
  never inspects the method, so it is safe to use on any route.
* `require_csrf_token` builds on it and answers "is this request's intent
  genuine?". It passes safe methods through and enforces the double-submit check
  on everything else.

`GET /api/admin/*` (authenticated, 600/min, keyed by user) from `API.md` §8 was
named in this docstring as a Phase 5 concern. Phase 5 implements it:
`require_admin_read_budget` below bounds authenticated reads per user, applied at
the router level so both admin routers - auth and content - carry it without a
per-route decision to remember. It is safe to apply router-wide because it lets
every non-GET method through without counting: writes are already expensive,
audited and CSRF-bound, and §8 fixes only the read ceiling.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.session import get_session
from app.errors import APIError
from app.rate_limit import FixedWindowLimiter
from app.security.tokens import is_valid_csrf_token
from app.services.auth import AuthenticatedSession, resolve_session
from app.session_cookie import (
    read_session_cookie,
    renew_session_cookie,
    session_cookie_delete_header,
)

# `API.md` §4.2. Browsers treat header names case-insensitively, so a client may
# send `x-csrf-token`; Starlette's header mapping does the matching.
CSRF_HEADER_NAME = "X-CSRF-Token"

# Methods that cannot change state, so CSRF does not apply. `GET`, `HEAD` and
# `OPTIONS` are the whole set; anything not named here is treated as unsafe.
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


async def require_admin_session(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_session)],
) -> AuthenticatedSession:
    """Resolve the caller's session, or raise 401.

    A missing cookie, an unknown token, a revoked one, an idle-expired one, an
    absolute-expired one and a deactivated account all produce the same
    `UNAUTHENTICATED` response with the same message. They differ only in the log
    event, which is where the distinction belongs.

    The cookie is cleared on rejection, so a browser holding a dead session stops
    sending it instead of re-presenting a corpse on every request until it happens
    to expire on its own.

    On success the cookie is re-issued (`renew_session_cookie`): the idle window
    is a sliding one, so the browser's `Max-Age` is slid forward to match the
    server's refreshed `last_used_at`, clamped to the unchanged absolute deadline.
    """
    settings = get_settings()
    delete_header = session_cookie_delete_header(settings)

    raw_token = read_session_cookie(request.cookies)
    if not raw_token:
        raise APIError.unauthenticated(
            event="admin_session_rejected",
            log_fields={"reason": "no_cookie"},
            headers={"set-cookie": delete_header},
        )

    authenticated = await resolve_session(db, raw_token, settings=settings)
    if authenticated is None:
        raise APIError.unauthenticated(
            event="admin_session_rejected",
            log_fields={"reason": "unusable_session", "present": True},
            headers={"set-cookie": delete_header},
        )
    renew_session_cookie(
        response,
        authenticated.raw_token,
        settings,
        expires_at=authenticated.record.expires_at,
    )
    return authenticated


async def require_csrf_token(
    request: Request,
    authenticated: Annotated[AuthenticatedSession, Depends(require_admin_session)],
) -> AuthenticatedSession:
    """Enforce the double-submit check on unsafe methods.

    The presented token must be the one derived from *this* session's token, so a
    token captured from another session is rejected even though it is a valid
    token. That binding is the point; a bare "some token was sent" check would
    pass.

    403 rather than 401: the caller proved who it is, and the request is what is
    not permitted. `TESTING.md` §7.3 requires exactly this code.
    """
    if request.method in SAFE_METHODS:
        return authenticated

    if not is_valid_csrf_token(
        authenticated.raw_token,
        request.headers.get(CSRF_HEADER_NAME),
    ):
        raise APIError.forbidden(
            event="admin_csrf_rejected",
            log_fields={
                "reason": "missing_or_invalid_csrf_token",
                "method": request.method,
                "path": request.url.path,
            },
        )
    return authenticated


# Type aliases so a route declares one import instead of three.
AdminSession = Annotated[AuthenticatedSession, Depends(require_admin_session)]
AdminSessionWithCsrf = Annotated[AuthenticatedSession, Depends(require_csrf_token)]
DatabaseSession = Annotated[AsyncSession, Depends(get_session)]


def _build_admin_read_limiter() -> FixedWindowLimiter:
    settings = get_settings()
    return FixedWindowLimiter(
        limit=settings.ADMIN_READ_RATE_LIMIT,
        window_seconds=settings.ADMIN_READ_RATE_WINDOW_SECONDS,
    )


# One limiter per process; `API.md` §8 fixes this at 600/min per user. Tests
# replace the value via the injectable clock or call `reset()`; the application
# never mutates the limiter after import.
admin_read_limiter = _build_admin_read_limiter()


async def require_admin_read_budget(
    request: Request,
    authenticated: Annotated[AuthenticatedSession, Depends(require_admin_session)],
) -> AuthenticatedSession:
    """Bound authenticated admin reads (`API.md` §8: 600/min per user).

    Safe methods only: a browser refresh spamming `GET /api/admin/messages` must
    not be able to (a) hammer the database or (b) wedge the admin out of its own
    login. Mutations are not counted - they are already CSRF-bound, audited and
    individually expensive, and §8 has no ceiling for them - so the dependency
    is intentionally router-wide and method-gated instead of per-route.
    """
    if request.method not in SAFE_METHODS:
        return authenticated

    decision = admin_read_limiter.check(str(authenticated.user.id))
    if not decision.allowed:
        raise APIError.rate_limited(
            decision.retry_after,
            event="admin_read_rate_limited",
            log_fields={
                "actor_user_id": str(authenticated.user.id),
                "method": request.method,
                "path": request.url.path,
                "limit": decision.limit,
            },
        )
    return authenticated


AdminSessionReadBudget = Annotated[
    AuthenticatedSession, Depends(require_admin_read_budget)
]