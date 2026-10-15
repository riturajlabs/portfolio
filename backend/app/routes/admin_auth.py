"""Admin authentication routes.

Exactly the three endpoints `API.md` §6.1 fixes:

===================================  ==========================================
`POST /api/admin/auth/login`         establish a session from email + password
`POST /api/admin/auth/logout`        revoke the current session
`GET  /api/admin/me`                 the current administrator + CSRF token
===================================  ==========================================

No aliases, no token refresh, no password reset. `ANALYSIS.md`'s scope note for
Phase 4 is authentication only, and a second way in is a second thing to audit.

Every failure path raises an `APIError`, so the response shape comes from
`app.errors` and cannot drift between these three routes.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request, Response, status

from app.config import get_settings
from app.dependencies.admin_auth import (
    AdminSessionReadBudget,
    AdminSessionWithCsrf,
    DatabaseSession,
)
from app.errors import INVALID_CREDENTIALS, APIError
from app.logging import log_event
from app.models import AdminUser
from app.rate_limit_login import LoginAttemptLimiter, get_login_limiter
from app.schemas.admin_auth import AdminUserOut, LoginRequest, LoginResponse, MeResponse
from app.security.client_ip import client_ip
from app.services import auth
from app.session_cookie import clear_session_cookie, set_session_cookie

logger = logging.getLogger("app.admin")

# The read budget (600/min per user, `API.md` §8) applies to `GET /api/admin/me`
# like every other admin read, so the `/me` handler takes `AdminSessionReadBudget`
# rather than the plain session dependency. Login and logout are not reads: login
# cannot be under a session dependency at all, and logout is a CSRF-bound
# mutation.
router = APIRouter(prefix="/api/admin", tags=["admin"])


def _user_out(user: AdminUser) -> AdminUserOut:
    """Project a user row onto the four identity fields `API.md` §6.1 documents.

    Explicit rather than `model_validate(user)`, so adding a column to
    `admin_user` cannot widen this response by accident.
    """
    return AdminUserOut(
        id=str(user.id),
        email=user.email,
        role=user.role,
        last_login_at=user.last_login_at,
    )


@router.post("/auth/login", response_model=LoginResponse, status_code=status.HTTP_200_OK)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: DatabaseSession,
) -> LoginResponse:
    """Exchange credentials for a session cookie.

    The order of the steps is load-bearing:

    1. **Rate limit, before any hashing.** An over-limit attempt is refused without
       spending Argon2 time, so this endpoint cannot be used to make the server do
       unbounded work for free.
    2. **Clear an expired lock**, so the durable counters reflect the current
       window before the password is compared.
    3. **Authenticate**, which runs Argon2 exactly once — against a dummy hash when
       the address is unknown, so response time does not answer "does this
       administrator exist?".
    4. **Issue the session and audit it** in one transaction.
    """
    limiter: LoginAttemptLimiter = get_login_limiter()
    settings = get_settings()
    ip = client_ip(request)

    decision = limiter.check(ip, payload.email)
    if decision.blocked:
        log_event(
            logger,
            logging.WARNING,
            "admin_login_rate_limited",
            dimension=decision.dimension,
            limit=decision.limit,
            retry_after=decision.retry_after,
            ip_hash=auth.client_ip_hash(ip),
        )
        raise APIError.rate_limited(decision.retry_after)

    ip_hash = auth.client_ip_hash(ip)
    existing = await auth.load_user_by_email(db, payload.email)
    if existing is not None:
        await auth.clear_expired_lock(db, existing)

    user = await auth.authenticate(db, payload.email, payload.password)

    if user is None:
        # The reason is recorded in the audit row and the log. It is never
        # reflected in the response, which is identical for all three failures.
        if existing is None:
            reason = auth.REASON_UNKNOWN_EMAIL
        elif not existing.is_active:
            reason = auth.REASON_INACTIVE
        else:
            reason = auth.REASON_WRONG_PASSWORD

        limiter.record_failure(ip, payload.email)
        await auth.record_login_failure(
            db,
            user=existing,
            reason=reason,
            email=payload.email,
            ip_hash=ip_hash,
        )
        raise APIError.unauthenticated(
            INVALID_CREDENTIALS,
            event="admin_login_rejected",
            log_fields={"reason": reason},
        )

    # A success counts against the per-IP attempt budget and clears the per-email
    # failure window. It is never counted as a password failure.
    limiter.record_success(ip, payload.email)
    await auth.rehash_if_needed(db, user, payload.password)

    raw_token = await auth.issue_session(
        db,
        user=user,
        ip=ip,
        user_agent=request.headers.get("user-agent"),
        settings=settings,
    )
    set_session_cookie(response, raw_token, settings)
    return LoginResponse(user=_user_out(user))


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    response: Response,
    db: DatabaseSession,
    authenticated: AdminSessionWithCsrf,
) -> None:
    """Revoke the current session and clear the cookie.

    Logout is a mutation, so it requires the CSRF token like any other: §4.2
    requires it on *every* mutating admin request, and `SameSite=Strict` is a
    second layer rather than a substitute.

    Idempotent by construction. `require_csrf_token` has already rejected a
    missing, dead or borrowed session, so this only ever runs against a session
    that was genuinely live a moment ago, and `revoke_session` cannot be reached
    twice for the same row.
    """
    await auth.revoke_session(db, authenticated.record)
    clear_session_cookie(response, get_settings())
    log_event(
        logger,
        logging.INFO,
        "admin_logout",
        actor_user_id=authenticated.user.id,
        method=request.method,
    )


@router.get("/me", response_model=MeResponse)
async def me(authenticated: AdminSessionReadBudget) -> MeResponse:
    """The current administrator and this session's CSRF token.

    The CSRF token is issued here rather than by `POST /api/admin/auth/login`,
    because §6.1's documented login body is `{"user": {...}}` and nothing else.
    A client therefore calls `/me` after logging in to obtain a token before its
    first mutation — one extra GET per session, and the only point at which a
    client can learn a token bound to the session it now holds.
    """
    return MeResponse(
        user=_user_out(authenticated.user),
        csrf_token=authenticated.csrf_token,
    )