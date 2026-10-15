"""`POST /api/contact` — the public contact write path.

Phase 8 moves this endpoint from `ai_service` to `backend/`. The observable
behavior for the frontend that exists today must not change (`API.md` §2.3):
same request fields, same validation, same `200`/`422`/`429`/`502` spread, same
`{"success": true, "message": "..."}` success body.

What is new is persistence. The message is stored before Resend is called
(`DATABASE.md` §5.6), so a send outage loses nothing: the row exists with
`delivery_status='failed'`, and the client still gets the documented `502`.

Public by design. No `X-API-Key` is required or checked — the header the edge
middleware injects for `/api/contact` is redundant here, exactly as it was on
`ai_service`. Controls: server-side validation, a honeypot field, and the
per-IP fixed-window limiter (5/minute, `API.md` §8).
"""

from __future__ import annotations

import logging
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.session import get_session
from app.logging import log_event
from app.rate_limit import FixedWindowLimiter, client_ip, rate_limit_response
from app.services import contact as contact_service
from app.services.auth import client_ip_hash
from app.session_cookie import USER_AGENT_MAX_LENGTH

logger = logging.getLogger("app.contact")

router = APIRouter(prefix="/api", tags=["contact"])

# The two 502 bodies `ai_service` used, verbatim. They are deliberately generic:
# nothing about the provider, configuration or error reaches the client
# (`SECURITY.md` §2.9 — no server internals in a response body).
_RESEND_UNAVAILABLE = "Contact form is temporarily unavailable. Please email me directly."
_SEND_FAILED = "Failed to send message. Please try again or email me directly."
_CONTACT_UNAVAILABLE = "Contact is temporarily unavailable. Please try again later."

# The honeypot response is deliberately indistinguishable from a real success.
_SUCCESS_MESSAGE = "Message sent successfully."


class ContactRequest(BaseModel):
    """The documented request shape (`API.md` §2.3), with two optional extras.

    `subject` is part of the documented API but absent from the form that ships
    today, so it is optional and the server derives it when omitted — otherwise
    an unmodified `emailService` would start receiving 422s on a working form.
    `website` is the honeypot: a non-empty value means a bot, and the request is
    answered with the indistinguishable 200 while storing and sending nothing.

    `name` and `subject` are the two values that can reach an outbound email
    header, so CR/LF (and NUL) are rejected here — a 422, not a silent strip, so
    legitimate input is never quietly altered. `message` is a body, where newlines
    are legitimate, and never reaches a header.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    message: str = Field(min_length=10, max_length=2000)
    subject: str | None = Field(default=None, min_length=3, max_length=150)
    website: str | None = Field(default=None)

    @field_validator("name", "subject")
    @classmethod
    def _no_header_control_characters(cls, value: str | None) -> str | None:
        if value is not None and any(char in value for char in "\r\n\x00"):
            raise ValueError("must not contain line breaks or control characters")
        return value


class ContactResponse(BaseModel):
    success: bool
    message: str


def _build_limiter() -> FixedWindowLimiter:
    settings = get_settings()
    return FixedWindowLimiter(
        limit=settings.CONTACT_RATE_LIMIT,
        window_seconds=settings.CONTACT_RATE_WINDOW_SECONDS,
    )


# One limiter per process. Tests reset it via `limiter.reset()` (see
# `tests/test_contact_api.py`); the application never mutates it after import.
limiter = _build_limiter()


async def enforce_rate_limit(request: Request) -> Response | None:
    """Count this request; return a `429` response when the caller is over budget."""
    decision = limiter.check(client_ip(request))
    if decision.allowed:
        return None

    log_event(
        logger,
        logging.WARNING,
        "contact_rate_limited",
        limit=decision.limit,
        retry_after=decision.retry_after,
    )
    return rate_limit_response(decision)


@router.post("/contact", response_model=ContactResponse, status_code=status.HTTP_200_OK)
async def send_contact(
    request: Request,
    rate_limited: Annotated[Response | None, Depends(enforce_rate_limit)],
    session: Annotated[AsyncSession, Depends(get_session)],
    payload: ContactRequest,
) -> ContactResponse:
    """Validate, store, then deliver; a honeypot is swallowed silently."""
    if rate_limited is not None:
        return rate_limited

    if payload.website and payload.website.strip():
        log_event(logger, logging.INFO, "contact_honeypot")
        return ContactResponse(success=True, message=_SUCCESS_MESSAGE)

    subject = payload.subject or contact_service.derive_subject(payload.name)
    ip_hash = client_ip_hash(client_ip(request))
    user_agent = (request.headers.get("user-agent") or "")[:USER_AGENT_MAX_LENGTH] or None

    # Store first. A missing or unreachable database is a dependency problem —
    # the service is alive, the dependency is not — so it is a 503, the same
    # distinction `/ready` draws and `GET /api/content` already uses.
    try:
        record = await contact_service.create_message(
            session,
            name=payload.name,
            email=payload.email,
            subject=subject,
            message=payload.message,
            source_ip_hash=ip_hash,
            user_agent=user_agent,
        )
    except (SQLAlchemyError, OSError) as exc:
        log_event(
            logger,
            logging.ERROR,
            "contact_storage_failed",
            error=type(exc).__name__,
            exception=str(exc),
        )
        raise HTTPException(status_code=503, detail=_CONTACT_UNAVAILABLE) from exc

    try:
        await contact_service.send_via_resend(
            name=payload.name,
            email=payload.email,
            message=payload.message,
        )
    except RuntimeError as exc:
        # Misconfiguration (missing RESEND_API_KEY). Log loud, mark the row, and
        # answer with the same generic 502 as a transient failure.
        log_event(logger, logging.ERROR, "contact_misconfigured", error=str(exc))
        await _mark_failed(session, record)
        raise HTTPException(status_code=502, detail=_RESEND_UNAVAILABLE) from exc
    except httpx.HTTPError as exc:
        log_event(
            logger,
            logging.ERROR,
            "contact_send_failed",
            error=type(exc).__name__,
            exception=str(exc),
        )
        await _mark_failed(session, record)
        raise HTTPException(status_code=502, detail=_SEND_FAILED) from exc

    await contact_service.mark_delivery(session, record, "sent")
    log_event(
        logger,
        logging.INFO,
        "contact_delivered",
        from_name=payload.name,
        from_email=payload.email,
    )
    return ContactResponse(success=True, message=_SUCCESS_MESSAGE)


async def _mark_failed(session: AsyncSession, record: object) -> None:
    """Flip the row to `failed`; keep going even if that write itself fails.

    The row is already committed as `pending`, so an outage here loses nothing —
    and the client must still get its 502.
    """
    try:
        await contact_service.mark_delivery(session, record, "failed")
    except (SQLAlchemyError, OSError) as exc:
        log_event(
            logger,
            logging.ERROR,
            "contact_failed_update_failed",
            error=type(exc).__name__,
            exception=str(exc),
        )