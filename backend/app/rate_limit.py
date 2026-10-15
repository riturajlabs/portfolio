"""In-process fixed-window rate limiting for the public content API.

`API.md` §8 sets one limit for this endpoint: **300 requests/minute per IP**.
`ADR-014` keeps rate limiting in-process and rejects Redis, so this module is a
plain in-memory counter with no infrastructure behind it.

**Deployment limitation, stated plainly.** The counter lives in one process's
memory. Two instances behind a load balancer enforce 300/minute *each*, so the
effective ceiling is `300 × instances`. The documented deployment is a
single-instance service, where this is exact. A multi-instance deployment would
need a shared store, and that is a decision for the deployment phase, not one to
pre-empt with new infrastructure now.

**Deliberately not applied globally.** The limiter is a dependency on the content
router only. `/health` and `/ready` are infrastructure probes: if a probe were
throttled, a restart loop would look like a rate-limit problem and an operator
would debug the wrong thing.

The window is injectable so tests can assert behaviour without sleeping.
"""

from __future__ import annotations

import logging
import math
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass

from fastapi import Request, status
from fastapi.responses import JSONResponse

from app.logging import log_event
from app.security.client_ip import client_ip as security_client_ip

logger = logging.getLogger("app.ratelimit")

# `API.md` §8: "a 429 body is human-readable".
_RATE_LIMITED_MESSAGE = "Too many requests. Please try again shortly."


@dataclass(frozen=True)
class RateLimitDecision:
    """The outcome of one check."""

    allowed: bool
    limit: int
    remaining: int
    retry_after: int


class FixedWindowLimiter:
    """Counts requests per key within a fixed window.

    A fixed window can admit up to twice the limit across a window boundary (299
    requests at 59.9 s and 299 more at 60.1 s). That is an accepted trade for a
    public read endpoint protected by a CDN cache; a sliding window would cost
    per-request bookkeeping to remove an edge case that does not matter here.
    """

    def __init__(
        self,
        limit: int,
        window_seconds: int,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._limit = limit
        self._window = window_seconds
        self._clock = clock
        self._hits: dict[str, tuple[float, int]] = {}
        self._lock = threading.Lock()

    @property
    def limit(self) -> int:
        return self._limit

    @property
    def window_seconds(self) -> int:
        return self._window

    def check(self, key: str) -> RateLimitDecision:
        """Count this request against `key` and report whether it may proceed."""
        now = self._clock()
        with self._lock:
            window_start, count = self._hits.get(key, (now, 0))
            if now - window_start >= self._window:
                window_start, count = now, 0

            count += 1
            self._hits[key] = (window_start, count)

            if len(self._hits) > _SWEEP_THRESHOLD:
                self._sweep(now)

        remaining = max(self._limit - count, 0)
        # Seconds until the window resets, rounded up so a client that obeys the
        # value never wakes up inside the same window and is throttled again. The
        # cap keeps a fresh window from advertising a second longer than it is.
        seconds_left = min(self._window, self._window - (now - window_start))
        retry_after = max(1, math.ceil(seconds_left))
        return RateLimitDecision(
            allowed=count <= self._limit,
            limit=self._limit,
            remaining=remaining,
            retry_after=retry_after,
        )

    def reset(self) -> None:
        """Clear all counters. Used by tests; never called by the application."""
        with self._lock:
            self._hits.clear()

    def _sweep(self, now: float) -> None:
        """Drop entries whose window has fully elapsed. Caller holds the lock."""
        self._hits = {
            key: value
            for key, value in self._hits.items()
            if now - value[0] < self._window
        }


# A window that has fully elapsed can never be hit again, so its entry is pure
# memory. Sweeping only when the table is large keeps the common path O(1).
_SWEEP_THRESHOLD = 10_000


def client_ip(request: Request) -> str:
    """The caller's IP, for bucketing.

    Re-exported from `app.security.client_ip` rather than reimplemented: there is
    one function in the codebase that answers "what is this client's IP", because
    two copies of a trust decision are one copy too many.

    The socket peer is a proxy address in the documented deployment, so the
    resolver reads the configured `TRUSTED_PROXY_HEADER` (Cloudflare's
    `CF-Connecting-IP`) when the operator has declared it, and the peer otherwise.
    `X-Forwarded-For` is never consulted — see `app.security.client_ip`.
    """
    return security_client_ip(request)


def rate_limit_response(decision: RateLimitDecision) -> JSONResponse:
    """The documented 429: bare `detail`, plus `Retry-After`.

    `API.md` §7.2 keeps public endpoints on the bare `{"detail": "..."}` shape, and
    §8 asks for a human-readable body with `Retry-After`. The limiter's own state —
    the counter, the window, the limit — is not disclosed; `Retry-After` is the only
    hint a client needs, and the rest goes to the log.
    """
    log_event(
        logger,
        logging.WARNING,
        "rate_limit_exceeded",
        limit=decision.limit,
        retry_after=decision.retry_after,
    )
    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={"detail": _RATE_LIMITED_MESSAGE},
        headers={
            "Retry-After": str(decision.retry_after),
            # A client that ignores Retry-After still gets a hint from the standard
            # quota headers rather than hammering blindly.
            "X-RateLimit-Limit": str(decision.limit),
            "X-RateLimit-Remaining": "0",
        },
    )


__all__ = [
    "FixedWindowLimiter",
    "RateLimitDecision",
    "client_ip",
    "rate_limit_response",
]