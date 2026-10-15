"""In-process login abuse protection.

`SECURITY.md` §4.4 sets two independent controls on
`POST /api/admin/auth/login`, and §5 lists them again as the credential-stuffing
defence:

============  =====================  ==========  ====================================
Dimension     Limit                  Key         What it counts
============  =====================  ==========  ====================================
Per IP        10 attempts / 15 min   IP          **Every** attempt, successful too
Per email     5 failures / 15 min    email       **Failed** attempts only
============  =====================  ==========  ====================================

The asymmetry between the two rows is the whole design. A correct password must
never be counted as a failure — otherwise a legitimate owner who mistypes twice
joins a real attacker in the same penalty box, and the lockout becomes a denial of
service against the one person who can fix it. The per-IP counter deliberately
does count successes, because that dimension exists to bound the total Argon2
work an address can request, not to judge the password.

**Deliberately separate from `app.rate_limit`.** That module limits reads of the
public content endpoint (300/min) and has no notion of an account, a password or
a success. Reusing its counter for login would count the wrong events against the
wrong key and let a caller walk past the per-email limit by varying a header.
Same in-process mechanism, different security control, no shared state.

**Deployment limitation, inherited from `ADR-014` and identical to Phase 3's:** the
counters live in one process's memory. Multiple instances would each allow the
full limit. The documented deployment is a single instance.

**No global ban list.** §5 rules it out: with one admin behind CGNAT it is a
self-inflicted denial of service with no security benefit.

The clock is injectable so tests assert window behaviour without sleeping.
"""

from __future__ import annotations

import logging
import math
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass

from app.logging import log_event

logger = logging.getLogger("app.ratelimit.login")

# Sweep only once the tables are large, so the common path stays O(1) and the
# memory an unattended process holds is bounded.
_SWEEP_THRESHOLD = 10_000


@dataclass(frozen=True, slots=True)
class LoginAttemptDecision:
    """Whether a login may proceed, and how long to wait if it may not."""

    allowed: bool
    retry_after: int
    dimension: str | None = None
    limit: int = 0

    @property
    def blocked(self) -> bool:
        return not self.allowed


class _Window:
    """A fixed-window counter for one key.

    The window is anchored at the first counted event rather than at wall-clock
    boundaries, so there is no shared "top of the minute" across keys and no
    synchronisation between them.
    """

    __slots__ = ("_started", "count")

    def __init__(self, now: float) -> None:
        self._started = now
        self.count = 1

    @property
    def started(self) -> float:
        return self._started


class LoginAttemptLimiter:
    """The two login windows, with the event semantics §4.4 requires."""

    def __init__(
        self,
        ip_limit: int,
        ip_window_seconds: int,
        email_failure_limit: int,
        email_window_seconds: int,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._ip_limit = ip_limit
        self._ip_window = ip_window_seconds
        self._email_limit = email_failure_limit
        self._email_window = email_window_seconds
        self._clock = clock
        self._ip_attempts: dict[str, _Window] = {}
        self._email_failures: dict[str, _Window] = {}
        self._lock = threading.Lock()

    def check(self, ip: str, email: str) -> LoginAttemptDecision:
        """Report whether a login attempt may proceed. Mutates nothing.

        Checking without counting is deliberate. A blocked request is refused
        before Argon2 runs, so it must not also extend the window it is stuck in —
        otherwise an attacker retrying every second would keep the lock alive
        indefinitely and the per-account control would become a permanent lockout.
        The window has to be allowed to expire on its own.
        """
        now = self._clock()
        with self._lock:
            ip_block = self._seconds_left(self._ip_attempts.get(ip), now, self._ip_window, self._ip_limit)
            email_block = self._seconds_left(
                self._email_failures.get(email),
                now,
                self._email_window,
                self._email_limit,
            )

        if ip_block is None and email_block is None:
            return LoginAttemptDecision(allowed=True, retry_after=0)

        # When both are exhausted, report the longer wait: a client that honours
        # only this value will not be throttled again by the other dimension.
        if email_block is None or (ip_block is not None and ip_block > email_block):
            return LoginAttemptDecision(
                allowed=False,
                retry_after=ip_block or 1,
                dimension="ip",
                limit=self._ip_limit,
            )
        return LoginAttemptDecision(
            allowed=False,
            retry_after=email_block or 1,
            dimension="email",
            limit=self._email_limit,
        )

    def record_failure(self, ip: str, email: str) -> None:
        """Count a failed attempt against both dimensions."""
        now = self._clock()
        with self._lock:
            self._count(self._ip_attempts, ip, now, self._ip_window)
            self._count(self._email_failures, email, now, self._email_window)
            self._sweep(now)

    def record_success(self, ip: str, email: str) -> None:
        """Count a successful login against the IP budget only, and clear failures.

        The email window is discarded outright: the documented penalty is for
        failures, and a correct password is proof that whoever holds the address
        can authenticate, so carrying the old failure count forward would punish a
        solved problem.
        """
        now = self._clock()
        with self._lock:
            self._count(self._ip_attempts, ip, now, self._ip_window)
            self._email_failures.pop(email, None)
            self._sweep(now)

    def reset(self) -> None:
        """Clear both tables. For tests only; the application never calls it."""
        with self._lock:
            self._ip_attempts.clear()
            self._email_failures.clear()

    @staticmethod
    def _count(table: dict[str, _Window], key: str, now: float, window: int) -> None:
        entry = table.get(key)
        if entry is None or now - entry.started >= window:
            table[key] = _Window(now)
            return
        entry.count += 1

    @staticmethod
    def _seconds_left(entry: _Window | None, now: float, window: int, limit: int) -> int | None:
        """Seconds until `entry` frees up, or `None` if it may proceed.

        Two conditions both mean "allowed", and both are checked here:

        * the window has fully elapsed — an entry that is never discarded would keep
          reporting itself blocked forever, turning a fifteen-minute control into a
          permanent one;
        * the count is still under the limit. The comparison is `count >= limit`
          because `record_*` has already counted the attempts that happened before
          this one: after five recorded failures the *next* attempt is the sixth, and
          it is the one that must be refused.

        `None` for "not blocked" rather than `0`, so a caller cannot mistake "no
        wait" for "blocked, retry immediately".
        """
        if entry is None or now - entry.started >= window or entry.count < limit:
            return None
        return max(1, math.ceil(window - (now - entry.started)))

    def _sweep(self, now: float) -> None:
        """Drop fully elapsed windows. Caller holds the lock."""
        if len(self._ip_attempts) + len(self._email_failures) <= _SWEEP_THRESHOLD:
            return
        self._ip_attempts = {
            key: entry
            for key, entry in self._ip_attempts.items()
            if now - entry.started < self._ip_window
        }
        self._email_failures = {
            key: entry
            for key, entry in self._email_failures.items()
            if now - entry.started < self._email_window
        }


_limiter: LoginAttemptLimiter | None = None
_limiter_lock = threading.Lock()


def get_login_limiter() -> LoginAttemptLimiter:
    """Return the process-wide limiter, built from settings on first use.

    Built lazily rather than at import so the limits come from the same
    `Settings` object the rest of the request uses, and so importing this module
    does not require a configuration to be present.
    """
    global _limiter
    if _limiter is None:
        with _limiter_lock:
            if _limiter is None:
                from app.config import get_settings

                settings = get_settings()
                _limiter = LoginAttemptLimiter(
                    ip_limit=settings.ADMIN_LOGIN_IP_LIMIT,
                    ip_window_seconds=settings.ADMIN_LOGIN_IP_WINDOW_SECONDS,
                    email_failure_limit=settings.ADMIN_LOGIN_EMAIL_FAILURE_LIMIT,
                    email_window_seconds=settings.ADMIN_LOGIN_EMAIL_WINDOW_SECONDS,
                )
                log_event(
                    logger,
                    logging.INFO,
                    "login_limiter_created",
                    ip_limit=settings.ADMIN_LOGIN_IP_LIMIT,
                    ip_window_seconds=settings.ADMIN_LOGIN_IP_WINDOW_SECONDS,
                    email_failure_limit=settings.ADMIN_LOGIN_EMAIL_FAILURE_LIMIT,
                    email_window_seconds=settings.ADMIN_LOGIN_EMAIL_WINDOW_SECONDS,
                )
    return _limiter


def reset_login_limiter() -> None:
    """Drop the process-wide limiter. For tests only."""
    global _limiter
    with _limiter_lock:
        _limiter = None