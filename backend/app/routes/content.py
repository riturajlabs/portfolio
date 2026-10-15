"""`GET /api/content` — the single public content endpoint.

There is no `/api/projects` and no `/api/projects/{slug}`. Both were removed in the
endpoint-minimality review (`API.md` §4.1) because every caller needs more than
projects alone, so one payload containing everything is strictly less work than
several partial ones. The callers are listed in `API.md` §5.1.1.

Caching follows `API.md` §5.1.5: a strong `ETag` over the canonical body,
`Cache-Control: public, max-age=300, stale-while-revalidate=600`, and `304` when the
client already holds that body. The tag is derived from the content, so it changes
only when the content does — which is why `meta.generated_at` is a content timestamp
rather than the request time.

Rate limiting follows `API.md` §8: 300/minute per IP, applied as a dependency on this
router only, so `/health` and `/ready` stay reachable for the platform probes that
use them.
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db.session import engine_target, get_session
from app.logging import log_event
from app.rate_limit import FixedWindowLimiter, client_ip, rate_limit_response
from app.schemas.content import Content
from app.services.content import ContentNotFoundError, load_content

logger = logging.getLogger("app.content")

router = APIRouter(prefix="/api", tags=["content"])

CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=600"

_PROFILE_MISSING = "Site profile not found."
_CONTENT_UNAVAILABLE = "Content is temporarily unavailable."
_INTERNAL_ERROR = "Internal server error."


def _build_limiter() -> FixedWindowLimiter:
    settings = get_settings()
    return FixedWindowLimiter(
        limit=settings.CONTENT_RATE_LIMIT,
        window_seconds=settings.CONTENT_RATE_WINDOW_SECONDS,
    )


# One limiter per process. Tests replace it or call `limiter.reset()`; the
# application never mutates it after import.
limiter = _build_limiter()


def _canonical_json(content: Content) -> bytes:
    """The exact bytes that get hashed, sent and compared.

    Sorted keys and no insignificant whitespace, so the tag depends on the values
    rather than on dictionary ordering. Two processes holding the same content
    produce the same tag, which is what makes the tag usable in a shared cache.
    """
    payload = content.model_dump(mode="json")
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def _etag(body: bytes) -> str:
    return f'"{hashlib.sha256(body).hexdigest()}"'


def _matches_if_none_match(header: str | None, etag: str) -> bool:
    """Whether the client's `If-None-Match` already covers this representation.

    Handles the two forms that matter: a bare tag, and `*`, meaning "I hold some
    representation". Weak comparison is used deliberately — a client holding a
    byte-identical body should not re-download it because the server recomputed
    the tag as weak.
    """
    if not header:
        return False
    candidates = [candidate.strip() for candidate in header.split(",")]
    if "*" in candidates:
        return True
    return any(candidate.removeprefix("W/") == etag.removeprefix("W/") for candidate in candidates)


async def enforce_rate_limit(request: Request) -> Response | None:
    """Count this request; return a 429 response when the caller is over budget."""
    decision = limiter.check(client_ip(request))
    if decision.allowed:
        return None

    log_event(
        logger,
        logging.WARNING,
        "content_rate_limited",
        database=engine_target(),
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


@router.get(
    "/content",
    response_model=Content,
    status_code=status.HTTP_200_OK,
    summary="All public content in one payload",
)
async def content(
    request: Request,
    limit_response: Annotated[Response | None, Depends(enforce_rate_limit)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Return the profile, about, projects, skills, certifications and SEO block.

    Strictly read-only: the statements behind this run in a PostgreSQL read-only
    transaction, so a write here would be refused by the server rather than
    committed.

    `limit_response` is declared before `session` on purpose. FastAPI resolves
    dependencies in declaration order, so this ordering means a request over the
    limit is refused before a session is ever constructed — a throttled caller
    costs no database work, and a database outage cannot stop the limiter from
    counting requests.
    """
    if limit_response is not None:
        return limit_response

    try:
        payload = await load_content(session)
    except ContentNotFoundError:
        # A missing singleton profile is a deployment state, not a crash: the
        # database is reachable and migrated, there is simply no content yet. 404
        # states that honestly; a 500 would page someone for an empty database, and
        # a fabricated profile would let the site build with invented content.
        log_event(logger, logging.WARNING, "content_profile_missing", database=engine_target())
        return _error(_PROFILE_MISSING, status.HTTP_404_NOT_FOUND)
    except ValidationError as exc:
        # The stored content does not match the response contract — an unexpected
        # jsonb key, a missing required field, a wrong type. This is a server-side
        # defect, not a client error, so it is a 500 and nothing about it reaches
        # the client. It is also exactly the failure `extra="forbid"` is meant to
        # cause: a contract violation surfaces here instead of quietly widening the
        # public payload.
        log_event(
            logger,
            logging.ERROR,
            "content_contract_violation",
            database=engine_target(),
            error=type(exc).__name__,
            errors=exc.error_count(),
        )
        return _error(_INTERNAL_ERROR, status.HTTP_500_INTERNAL_SERVER_ERROR)
    except (SQLAlchemyError, OSError) as exc:
        # `SQLAlchemyError` covers query and transaction failures. `OSError` is
        # listed explicitly because asyncpg surfaces a refused connection as a
        # plain `ConnectionRefusedError` before SQLAlchemy can wrap it — the same
        # reason `routes/health.py` catches both.
        # The client learns nothing about the database. The exception type and
        # message go to the log, where they are useful, and stay out of the body,
        # where they would disclose the driver, the host or the schema.
        log_event(
            logger,
            logging.ERROR,
            "content_query_failed",
            database=engine_target(),
            error=type(exc).__name__,
            exception=str(exc),
        )
        # 503, not 500: the service is healthy and the dependency is not, which is
        # the same distinction `/ready` draws.
        return _error(_CONTENT_UNAVAILABLE, status.HTTP_503_SERVICE_UNAVAILABLE)

    body = _canonical_json(payload)
    etag = _etag(body)
    # `Vary: Origin` because the CORS layer varies `Access-Control-Allow-Origin` by
    # request origin, and a shared cache must not serve one origin's CORS headers
    # to another.
    headers = {
        "ETag": etag,
        "Cache-Control": CACHE_CONTROL,
        "Vary": "Origin",
    }

    if _matches_if_none_match(request.headers.get("if-none-match"), etag):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)

    return Response(
        content=body,
        status_code=status.HTTP_200_OK,
        media_type="application/json",
        headers=headers,
    )


__all__ = ["router", "content", "enforce_rate_limit", "CACHE_CONTROL", "limiter"]