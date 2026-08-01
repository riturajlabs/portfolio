"""
Rate limiting via slowapi.

Configurable via env vars:
  CHAT_RATE_LIMIT         → requests per window (default: "10")
  CHAT_RATE_WINDOW        → window in seconds (default: "60")

Uses slowapi's in-memory storage by default. On Render free tier with a
single instance this is fine. For multi-instance deployments, swap
`storage_uri="memory://"` for `storage_uri="redis://..."`.
"""
import logging
import os

from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from slowapi.middleware import SlowAPIMiddleware
from fastapi.responses import JSONResponse
from fastapi import Request

logger = logging.getLogger(__name__)


def _build_key(request: Request) -> str:
    """
    Identify the caller. For `/chat` we want to bucket by IP, but if the
    API key is present we prefer keying on (IP + API key) so that bots
    rotating keys can't share the bucket — but a legitimate user changing
    networks doesn't share with themselves either.

    Plain IP is fine for the portfolio use case.
    """
    return get_remote_address(request)


# "10/minute" is the default; override via env if needed.
_RATE_LIMIT = os.getenv("CHAT_RATE_LIMIT", "10")
_RATE_WINDOW_SECONDS = os.getenv("CHAT_RATE_WINDOW", "60")
_RATE_LIMIT_STR = f"{_RATE_LIMIT}/{_RATE_WINDOW_SECONDS} seconds"

limiter = Limiter(
    key_func=_build_key,
    default_limits=[],  # No global default; we apply per-route.
    headers_enabled=False,  # Off: slowapi's header injection breaks SSE/Streaming.
    strategy="fixed-window",
)


async def rate_limit_exceeded_handler(
    request: Request, exc: RateLimitExceeded
) -> JSONResponse:
    """
    Returns a clean JSON 429 with Retry-After so the frontend can show
    a friendly "please slow down" message.
    """
    # `exc.detail` looks like "10 per 1 second" or "10 per 60 seconds".
    # Parse the seconds for the Retry-After header.
    retry_after = _RATE_WINDOW_SECONDS
    try:
        retry_after = int(_RATE_WINDOW_SECONDS)
    except ValueError:
        retry_after = 60

    logger.warning(
        "Rate limit exceeded for %s on %s (limit=%s)",
        get_remote_address(request),
        request.url.path,
        _RATE_LIMIT_STR,
    )

    return JSONResponse(
        status_code=429,
        content={
            "error": "Too many requests. Please slow down.",
            "retry_after_seconds": retry_after,
            "limit": _RATE_LIMIT_STR,
        },
        headers={"Retry-After": str(retry_after)},
    )