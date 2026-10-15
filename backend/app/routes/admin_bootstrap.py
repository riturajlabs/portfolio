"""One-time administrative bootstrap endpoint.

Phase 3: Secure bootstrap mechanism for first-time production deployment on
free-tier hosting where interactive shells, one-off jobs, and pre-deploy hooks
are unavailable.

Guards:
* High-entropy ADMIN_BOOTSTRAP_TOKEN (>= 32 chars) configured in environment.
* Constant-time token verification (hmac.compare_digest).
* Endpoint disabled (404 Not Found) if ADMIN_BOOTSTRAP_TOKEN is empty/unset.
* Strict HTTPS enforcement in production and staging environments.
* In-process rate limiting against brute force attempts.
* Module-level concurrency lock preventing race conditions.
* Atomic database transaction — failure leaves the database completely clean.
* Permanent lockout once an administrator account exists (409 Conflict).
* Strict payload validation (admin credentials + complete CMS content snapshot).
* No secrets, tokens, passwords, or hashes in logs or responses.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import math
import threading
import time
from typing import Any

from fastapi import APIRouter, Header, Request, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import func, select, text

from app.config import get_settings
from app.db.migrations import expected_head
from app.dependencies.admin_auth import DatabaseSession
from app.errors import (
    FORBIDDEN,
    NOT_FOUND,
    RATE_LIMITED,
    UNAUTHENTICATED,
    VALIDATION_ERROR,
    APIError,
)
from app.logging import log_event
from app.models import AdminUser
from app.security.client_ip import client_ip
from app.security.passwords import hash_password
from app.services.seed import (
    SeedError,
    seed_content,
    validate_snapshot,
)

MIN_PASSWORD_LENGTH = 12

logger = logging.getLogger("app.admin.bootstrap")
router = APIRouter(prefix="/api/admin", tags=["admin-bootstrap"])

_bootstrap_lock = asyncio.Lock()
MAX_BOOTSTRAP_PAYLOAD_BYTES = 1_048_576  # 1 MB

# A stable, arbitrary 64-bit key for a PostgreSQL transaction-scoped advisory
# lock. The in-process `_bootstrap_lock` serializes concurrent attempts within
# one worker; this lock serializes them across workers/processes, which is what
# makes "prevent concurrent bootstrap" true rather than merely likely. Derived
# from a fixed label so every worker computes the same key without coordination
# and no value needs configuring.
_BOOTSTRAP_ADVISORY_LOCK_KEY = int.from_bytes(
    hashlib.sha256(b"portfolio.admin.bootstrap").digest()[:8], "big", signed=True
)


# --------------------------------------------------------------------------
# Brute-force attempt limiter
# --------------------------------------------------------------------------


class BootstrapLimiter:
    """In-memory rate limiter for bootstrap attempts."""

    def __init__(self, limit: int = 5, window_seconds: int = 900) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self._lock = threading.Lock()
        self._attempts: dict[str, list[float]] = {}

    def is_blocked(self, ip: str, now: float | None = None) -> tuple[bool, int]:
        current = now if now is not None else time.monotonic()
        with self._lock:
            timestamps = self._attempts.get(ip, [])
            cutoff = current - self.window_seconds
            valid = [t for t in timestamps if t > cutoff]
            self._attempts[ip] = valid
            if len(valid) >= self.limit:
                retry_after = max(1, math.ceil(valid[0] + self.window_seconds - current))
                return True, retry_after
            return False, 0

    def record_attempt(self, ip: str, now: float | None = None) -> None:
        current = now if now is not None else time.monotonic()
        with self._lock:
            self._attempts.setdefault(ip, []).append(current)

    def reset(self) -> None:
        with self._lock:
            self._attempts.clear()


_limiter = BootstrapLimiter()


def get_bootstrap_limiter() -> BootstrapLimiter:
    return _limiter


# --------------------------------------------------------------------------
# Request & Response Schemas
# --------------------------------------------------------------------------


class BootstrapAdminIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str = Field(min_length=MIN_PASSWORD_LENGTH)


class BootstrapRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    admin: BootstrapAdminIn
    content: dict[str, Any]


class BootstrapSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    projects: int
    skills: int
    categories: int
    certifications: int


class BootstrapResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ok: bool
    status: str
    admin_email: str
    summary: BootstrapSummary


# --------------------------------------------------------------------------
# Endpoint
# --------------------------------------------------------------------------


@router.post(
    "/bootstrap",
    response_model=BootstrapResponse,
    status_code=status.HTTP_200_OK,
)
async def bootstrap(
    payload: BootstrapRequest,
    request: Request,
    db: DatabaseSession,
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_bootstrap_token: str | None = Header(default=None, alias="X-Bootstrap-Token"),
) -> BootstrapResponse:
    """Execute one-time administrative setup and initial CMS content seeding.

    Requires ADMIN_BOOTSTRAP_TOKEN in backend environment variables and
    Authorization: Bearer <token> (or X-Bootstrap-Token: <token>).
    """
    settings = get_settings()
    configured_token = settings.ADMIN_BOOTSTRAP_TOKEN.strip()

    # 1. Feature flag / configuration presence
    if not configured_token:
        log_event(logger, logging.INFO, "admin_bootstrap_disabled")
        raise APIError(
            status_code=status.HTTP_404_NOT_FOUND,
            code=NOT_FOUND,
            message="Bootstrap endpoint not found.",
            event="admin_bootstrap_not_configured",
        )

    # 2. Enforce HTTPS in staging and production
    if settings.ENVIRONMENT in ("production", "staging"):
        proto = request.headers.get("x-forwarded-proto", request.url.scheme).lower()
        if proto != "https":
            log_event(logger, logging.WARNING, "admin_bootstrap_https_required", proto=proto)
            raise APIError(
                status_code=status.HTTP_403_FORBIDDEN,
                code=FORBIDDEN,
                message="HTTPS is required for bootstrap.",
                event="admin_bootstrap_non_https",
            )

    # 3. Payload size verification
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_BOOTSTRAP_PAYLOAD_BYTES:
                raise APIError(
                    status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                    code="PAYLOAD_TOO_LARGE",
                    message="Bootstrap payload exceeds size limit (1 MB).",
                    event="admin_bootstrap_payload_too_large",
                )
        except ValueError:
            pass

    # 4. Extract token from Authorization or X-Bootstrap-Token
    provided_token: str | None = None
    if authorization and authorization.lower().startswith("bearer "):
        provided_token = authorization[7:].strip()
    elif x_bootstrap_token:
        provided_token = x_bootstrap_token.strip()

    ip = client_ip(request)

    # 5. Check rate limit
    blocked, retry_after = _limiter.is_blocked(ip)
    if blocked:
        log_event(logger, logging.WARNING, "admin_bootstrap_rate_limited", retry_after=retry_after)
        raise APIError(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            code=RATE_LIMITED,
            message="Too many bootstrap attempts. Please retry later.",
            headers={"Retry-After": str(retry_after)},
            event="admin_bootstrap_rate_limited",
        )

    # 6. Verify token using constant-time comparison
    if not provided_token or not hmac.compare_digest(provided_token, configured_token):
        _limiter.record_attempt(ip)
        log_event(logger, logging.WARNING, "admin_bootstrap_unauthenticated")
        raise APIError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code=UNAUTHENTICATED,
            message="Invalid or missing bootstrap token.",
            headers={"WWW-Authenticate": "Bearer"},
            event="admin_bootstrap_auth_failed",
        )

    # 7. Concurrency lock ensures single in-flight execution in this process.
    async with _bootstrap_lock:
        # 8. Check schema readiness, holding a transaction-scoped advisory lock.
        #
        # The advisory lock is the cross-worker half of the concurrency guard:
        # it is taken (blocking) before the count check and released by the
        # commit/rollback below, so a second worker's attempt waits its turn and
        # then observes the committed administrator instead of racing to create a
        # second one. `pg_advisory_xact_lock` needs no cleanup: the transaction
        # ends, the lock is gone.
        try:
            await db.execute(
                text("SELECT pg_advisory_xact_lock(:key)"),
                {"key": _BOOTSTRAP_ADVISORY_LOCK_KEY},
            )
            version_result = await db.execute(text("SELECT version_num FROM alembic_version"))
            applied = version_result.scalars().all()
            head = expected_head()
            if set(applied) != {head}:
                raise APIError(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    code="NOT_READY",
                    message="Database schema migrations have not been completed.",
                    event="admin_bootstrap_unmigrated_db",
                )
        except Exception as exc:
            if isinstance(exc, APIError):
                raise
            raise APIError(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                code="NOT_READY",
                message="Database is not reachable or not migrated.",
                event="admin_bootstrap_db_error",
            ) from exc

        # 9. Verify no admin user exists
        admin_count = (await db.execute(select(func.count(AdminUser.id)))).scalar_one()
        if admin_count > 0:
            log_event(logger, logging.WARNING, "admin_bootstrap_already_exists")
            raise APIError(
                status_code=status.HTTP_409_CONFLICT,
                code="ALREADY_BOOTSTRAPPED",
                message="Bootstrap has already been executed. Administrator account already exists.",
                event="admin_bootstrap_conflict",
            )

        # 10. Validate snapshot payload
        try:
            seed_data = validate_snapshot(payload.content)
        except SeedError as exc:
            log_event(logger, logging.WARNING, "admin_bootstrap_validation_failed", error=str(exc))
            raise APIError(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                code=VALIDATION_ERROR,
                message=f"Snapshot validation error: {exc}",
                event="admin_bootstrap_invalid_snapshot",
            ) from exc

        # 11. Atomic transaction: create admin and seed content
        try:
            admin_user = AdminUser(
                email=str(payload.admin.email).casefold(),
                password_hash=hash_password(payload.admin.password),
                role="ADMIN",
                is_active=True,
                failed_attempts=0,
            )
            db.add(admin_user)
            await db.flush()

            await seed_content(db, seed_data)
            await db.commit()
        except Exception:
            await db.rollback()
            raise

        log_event(
            logger,
            logging.INFO,
            "admin_bootstrap_complete",
            admin_email=admin_user.email,
            projects=len(seed_data.projects),
            skills=len(seed_data.skills),
        )

        summary = BootstrapSummary(
            projects=len(seed_data.projects),
            skills=len(seed_data.skills),
            categories=len({s.category.name for s in seed_data.skills}),
            certifications=len(seed_data.certifications),
        )

        return BootstrapResponse(
            ok=True,
            status="bootstrapped",
            admin_email=admin_user.email,
            summary=summary,
        )
