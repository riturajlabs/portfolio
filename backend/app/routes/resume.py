"""`GET /api/resume` — the owner's resume, served from a private bucket.

The resume is a PDF the admin uploads; it lives in the private `uploads` bucket and
has no anonymous URL, so this route is the only way to read it. Two consequences
shape the implementation:

* **Served, not redirected.** A redirect to a presigned URL would hand the object to
  anyone holding the link until it expired, and would move the read outside this
  process. Streaming the bytes keeps the bucket private and leaves exactly one
  place that decides who may read the document.
* **Revalidated, not cached forever.** The URL is stable across a replacement
  upload, so the response is `no-cache` with an `ETag` derived from the object key:
  a returning visitor costs one conditional request, and a replacement is picked up
  immediately instead of after a long `max-age`.

The key is read from `site_profile.resume_key`; the caller never supplies one, so
there is no user-controlled key that could be pointed at another object.

Rate limiting follows `API.md` §8, per IP, on this router only — the same
`FixedWindowLimiter` the content endpoint uses, with a counter of its own so the
two budgets cannot interfere.
"""

from __future__ import annotations

import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.session import get_session
from app.errors import APIError
from app.logging import log_event
from app.models import SiteProfile
from app.rate_limit import FixedWindowLimiter, client_ip, rate_limit_response
from app.services import storage

logger = logging.getLogger("app.resume")

router = APIRouter(prefix="/api", tags=["resume"])

# The stable public path this route answers at. It is also the value stored in
# `site_profile.resume` by an upload; kept here beside the route that serves it.
RESUME_PUBLIC_PATH = "/api/resume"
PDF_MEDIA_TYPE = "application/pdf"
RESUME_FILENAME = "resume.pdf"

_RESUME_MISSING = "Resume not found."
_RESUME_UNAVAILABLE = "The resume is temporarily unavailable."


def _build_limiter() -> FixedWindowLimiter:
    settings = get_settings()
    return FixedWindowLimiter(
        limit=settings.RESUME_RATE_LIMIT,
        window_seconds=settings.RESUME_RATE_WINDOW_SECONDS,
    )


# One limiter per process. Tests reset it; the application never mutates it.
limiter = _build_limiter()


async def enforce_rate_limit(request: Request) -> Response | None:
    """Count this request; return a 429 response when the caller is over budget."""
    decision = limiter.check(client_ip(request))
    if decision.allowed:
        return None

    log_event(
        logger,
        logging.WARNING,
        "resume_rate_limited",
        limit=decision.limit,
        path=request.url.path,
    )
    return rate_limit_response(decision)


def _error(detail: str, status_code: int) -> Response:
    """A bare `{"detail": "..."}` body, matching `API.md` §7.2 for public routes."""
    return Response(
        content=json.dumps({"detail": detail}),
        status_code=status_code,
        media_type="application/json",
        headers={"Cache-Control": "no-store"},
    )


def _matches_if_none_match(header: str | None, etag: str) -> bool:
    """Whether the client's `If-None-Match` already covers this representation.

    Same weak comparison the content endpoint uses: a client holding the same
    object should not re-download it, and `*` means "I hold some representation".
    """
    if not header:
        return False
    candidates = [candidate.strip() for candidate in header.split(",")]
    if "*" in candidates:
        return True
    return any(
        candidate.removeprefix("W/") == etag.removeprefix("W/") for candidate in candidates
    )


@router.get(
    "/resume",
    status_code=status.HTTP_200_OK,
    summary="The owner's resume PDF",
)
async def resume(
    request: Request,
    limit_response: Annotated[Response | None, Depends(enforce_rate_limit)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Stream the uploaded resume, or 404 when there is not one.

    `limit_response` is declared before `session` so an over-budget caller is
    refused before a database connection is taken, exactly as the content route
    orders its dependencies.

    A missing key is a legitimate state — the resume is still the in-repo PDF — so
    it is a plain 404, not a defect. Storage and query failures are reported as a
    bare 503 (never the admin envelope, which is for `/api/admin/*` only).
    """
    if limit_response is not None:
        return limit_response

    try:
        key = await session.scalar(select(SiteProfile.resume_key).limit(1))
    except (SQLAlchemyError, OSError) as exc:
        log_event(
            logger,
            logging.ERROR,
            "resume_query_failed",
            error=type(exc).__name__,
            exception=str(exc),
        )
        return _error(_RESUME_UNAVAILABLE, status.HTTP_503_SERVICE_UNAVAILABLE)

    if key is None:
        return _error(_RESUME_MISSING, status.HTTP_404_NOT_FOUND)

    try:
        body = await storage.read_resume(key)
    except storage.ResumeNotFound:
        # The reference is stale (the object was removed out of band). Fail the
        # link honestly rather than disclosing the storage layer.
        log_event(logger, logging.WARNING, "resume_object_missing", key=key)
        return _error(_RESUME_MISSING, status.HTTP_404_NOT_FOUND)
    except (APIError, SQLAlchemyError, OSError) as exc:
        # `storage.read_resume` raises `APIError(503)` for an unreachable store;
        # convert it to the public bare body, because the `APIError` handler would
        # otherwise render the admin envelope on this public path.
        log_event(
            logger,
            logging.ERROR,
            "resume_storage_failed",
            error=type(exc).__name__,
        )
        return _error(_RESUME_UNAVAILABLE, status.HTTP_503_SERVICE_UNAVAILABLE)

    # The key is unique per upload, so it is a perfect validator: unchanged key
    # means unchanged bytes. Quoted to be a valid ETag.
    etag = f'"{key}"'
    headers = {
        "ETag": etag,
        # Revalidate rather than cache a long time: the URL survives a replacement,
        # so a long max-age would keep serving the old document after an update.
        "Cache-Control": "no-cache",
        "Content-Disposition": f'inline; filename="{RESUME_FILENAME}"',
        # The bytes are a fixed media type; never let a browser guess another.
        "X-Content-Type-Options": "nosniff",
        # The CORS layer varies `Access-Control-Allow-Origin` by request origin.
        "Vary": "Origin",
    }

    if _matches_if_none_match(request.headers.get("if-none-match"), etag):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)

    return Response(content=body, status_code=status.HTTP_200_OK, media_type=PDF_MEDIA_TYPE, headers=headers)


__all__ = ["router", "resume", "enforce_rate_limit", "limiter", "RESUME_PUBLIC_PATH"]
