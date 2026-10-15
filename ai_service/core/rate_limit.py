"""
Rate limiting via slowapi.

Configurable via env vars:
  CHAT_RATE_LIMIT         → requests per window (default: "10")
  CHAT_RATE_WINDOW        → window in seconds (default: "60")

Both values select the *enforced* limit: the `/chat` and `/chat/stream` routes
are decorated with the limit string built here, so changing an env var changes
what the limiter actually counts (and what a throttled client is told its limit
is). A value that is not a positive whole number is refused at import rather than
silently ignored — a limit an operator believes is in force must never be a
no-op. This mirrors the backend's pydantic validation of `CONTENT_RATE_LIMIT`.

Callers are bucketed by `core.client_ip.client_ip`, which trusts the signed
client-IP header Vercel's edge stamps and otherwise falls back to the socket
peer. On Render the peer is a load balancer shared by every caller, so the
signed header is what makes the bucket per-client rather than per-service.

Uses slowapi's in-memory storage by default. On Render free tier with a
single instance this is fine. For multi-instance deployments, swap
`storage_uri="memory://"` for `storage_uri="redis://..."`.
"""
import logging
import os

from fastapi import Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded

from core.client_ip import client_ip

logger = logging.getLogger(__name__)


def _build_key(request: Request) -> str:
    """
    Identify the caller for bucketing. Delegates to `client_ip`, which returns
    the signed edge-supplied client IP when it verifies and the socket peer
    otherwise — so a direct caller cannot mint a fresh bucket by sending a
    header of their own.
    """
    return client_ip(request)


# The default is 10 requests/minute; override via env. Both values are validated
# so a bad setting fails loudly at import instead of silently enforcing the
# default while the 429 body advertises something else.
def _read_positive_int(name: str, default: str) -> int:
    """Parse a positive-integer env var, refusing anything else.

    Mirrors the backend's pydantic guard on `CONTENT_RATE_LIMIT`: a
    misconfiguration is a startup error, not a silently-ignored value.
    """
    raw = os.getenv(name, default)
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise ValueError(
            f"{name}={raw!r} is not an integer. Set it to a positive whole "
            "number (e.g. CHAT_RATE_LIMIT=10)."
        ) from None
    if value < 1:
        raise ValueError(
            f"{name}={value} must be at least 1; a non-positive limit would "
            "either block every request or disable enforcement."
        )
    return value


_RATE_LIMIT = _read_positive_int("CHAT_RATE_LIMIT", "10")
_RATE_WINDOW_SECONDS = _read_positive_int("CHAT_RATE_WINDOW", "60")
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
    # The window is the validated integer, so `Retry-After` is exact.
    retry_after = _RATE_WINDOW_SECONDS

    logger.warning(
        "Rate limit exceeded for %s on %s (limit=%s)",
        client_ip(request),
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