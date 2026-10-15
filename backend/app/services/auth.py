"""Domain services for admin authentication.

Everything that reads a password hash, mints a session, decides whether a session
is still alive, revokes one, or writes an `admin_audit_log` row lives here. The
route layer stays a thin translation of HTTP into these calls, and the dependency
layer reuses them, so the rules are written once.

Two design points worth stating up front, because both look like omissions:

**`failed_attempts` and `locked_until` are a record, not the enforcement point.**
`ADR-014` and `API.md` §8 mandate an in-memory TTL store, so the limiter in
`app.rate_limit_login` is what actually refuses an attempt, and it expires on its
own. The two columns exist because `DATABASE.md` §11.1 defines them: an operator
inspecting the row needs to see that five failures happened and when the window
closes. Nothing reads them to *allow* an attempt, because two sources of truth
that can disagree produce exactly the permanent lockout §5 forbids.

**Session lifetimes are computed from `issued_at`, never from `last_used_at`.**
That is what makes the absolute timeout absolute. An active session refreshing
`last_used_at` every request must still die at seven days.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.logging import log_event
from app.models import AdminAuditLog, AdminSession, AdminUser
from app.security.passwords import (
    DUMMY_PASSWORD_HASH,
    hash_password,
    needs_rehash,
    verify_password,
)
from app.security.tokens import (
    csrf_token_for_session,
    generate_session_token,
    hash_session_token,
)
from app.session_cookie import USER_AGENT_MAX_LENGTH

logger = logging.getLogger("app.admin.auth")

# `admin_audit_log.action` is a varchar with no CHECK, but the values below are
# the documented vocabulary; keeping them as constants means a log consumer can
# rely on the spelling.
ACTION_LOGIN = "login"
ACTION_LOGOUT = "logout"

ENTITY_ADMIN_USER = "admin_user"
ENTITY_ADMIN_SESSION = "admin_session"

# Reasons recorded in the audit row. These never reach a client — the 401 body is
# identical for all of them — but an operator reading the table absolutely needs
# to distinguish "someone guessed a password" from "the address does not exist".
REASON_UNKNOWN_EMAIL = "unknown_email"
REASON_WRONG_PASSWORD = "wrong_password"
REASON_INACTIVE = "inactive_account"
REASON_UNEXPECTED = "unexpected"

# A process-local key for the daily IP hash. See `client_ip_hash`.
_IP_HASH_KEY = secrets.token_bytes(32)

# Refreshing `last_used_at` on every request would make each authenticated admin
# call a write, for a value only read to enforce a 12-hour window. Sixty seconds
# of slack against 43,200 is 0.14%, and in exchange an admin browsing the site
# costs no writes at all.
IDLE_REFRESH_INTERVAL_SECONDS = 60


def _utcnow() -> datetime:
    return datetime.now(UTC)


def client_ip_hash(ip: str, now: datetime | None = None) -> str | None:
    """Return a daily-rotating keyed hash of `ip`, or `None` for an unknown peer.

    The IPv4 space is only 2^32 wide, so a bare SHA-256 of an address is
    reversible in seconds by anyone holding the database — hashing alone does not
    satisfy "the raw IP is not stored".     Keying with a secret that never leaves the
    process does: a database dump becomes unlinkable and undecodable, which is the
    property `DATABASE.md` §15 wants for contact messages.

    A configured `IP_HASH_SALT` was considered and **withdrawn**
    (`DEPLOYMENT.md` §3.1): requiring it would add a secret no locked requirement
    needs, so the process-local key is used instead and this limitation is
    documented rather than hidden — hashes are comparable within one process and
    one day, and no longer.
    """
    if not ip:
        return None
    moment = now or _utcnow()
    day = moment.strftime("%Y-%m-%d")
    return hmac.new(_IP_HASH_KEY, f"{day}:{ip}".encode(), hashlib.sha256).hexdigest()


@dataclass(frozen=True, slots=True)
class AuthenticatedSession:
    """A live session and the administrator it belongs to."""

    user: AdminUser
    record: AdminSession
    raw_token: str

    @property
    def csrf_token(self) -> str:
        return csrf_token_for_session(self.raw_token)


async def load_user_by_email(db: AsyncSession, email: str) -> AdminUser | None:
    """Return the administrator with this address, or `None`.

    `admin_user.email` is `citext`, so the comparison is case-insensitive in the
    database; `normalise_email` has already stripped and case-folded the input, so
    the two layers agree and one person cannot end up with two identities.
    """
    result = await db.execute(select(AdminUser).where(AdminUser.email == email))
    return result.scalar_one_or_none()


async def authenticate(db: AsyncSession, email: str, password: str) -> AdminUser | None:
    """Return the user when the credentials are valid and the account is active.

    Returns `None` for every failure — unknown address, wrong password, inactive
    account — because the caller must not be able to tell them apart any more
    than the HTTP client can.

    Argon2 runs exactly once on every path. When the address is unknown the cost
    is paid against `DUMMY_PASSWORD_HASH`, so response time does not answer
    "does this administrator exist?" any more than the 401 body does.
    """
    user = await load_user_by_email(db, email)
    stored_hash = user.password_hash if user is not None else DUMMY_PASSWORD_HASH
    password_matches = verify_password(stored_hash, password)

    if user is None:
        return None
    if not password_matches:
        return None
    if not user.is_active:
        return None
    return user


async def record_login_failure(
    db: AsyncSession,
    *,
    user: AdminUser | None,
    reason: str,
    email: str,
    ip_hash: str | None,
) -> None:
    """Write the audit row for a failed login and update the durable counters.

    Called for every failure, including one against an address with no row: the
    attempt is the thing an operator investigating credential stuffing needs to
    see, and `actor_user_id` is nullable precisely so it can be recorded with no
    actor.

    Only a wrong password advances the counters. An attempt that reached a valid
    password on a disabled account, or against an address that does not exist,
    leaves `failed_attempts` alone — otherwise anyone who already knows the
    password could deliberately lock the owner out, which is the denial-of-service
    §5 rules out.

    The counters are recorded here but never consulted to allow or refuse an
    attempt; see the module docstring.
    """
    if user is not None and reason == REASON_WRONG_PASSWORD:
        user.failed_attempts = (user.failed_attempts or 0) + 1
        if user.failed_attempts >= get_settings().ADMIN_LOGIN_EMAIL_FAILURE_LIMIT:
            user.locked_until = _utcnow() + timedelta(
                seconds=get_settings().ADMIN_LOGIN_EMAIL_WINDOW_SECONDS
            )

    db.add(
        AdminAuditLog(
            actor_user_id=user.id if user is not None else None,
            action=ACTION_LOGIN,
            entity=ENTITY_ADMIN_USER,
            entity_id=str(user.id) if user is not None else None,
            after={"outcome": "failure", "reason": reason, "email": email},
        )
    )
    await db.commit()

    log_event(
        logger,
        logging.WARNING,
        "admin_login_failed",
        reason=reason,
        actor_user_id=user.id if user is not None else None,
        ip_hash=ip_hash,
    )


async def clear_expired_lock(db: AsyncSession, user: AdminUser) -> bool:
    """Reset the durable failure counters once their window has passed.

    Called before the password check, so the row an operator reads reflects the
    current window rather than one that closed an hour ago. Returns whether
    anything changed, so the caller knows whether a write is coming anyway.
    """
    now = _utcnow()
    if user.locked_until is not None and user.locked_until <= now:
        user.failed_attempts = 0
        user.locked_until = None
        await db.commit()
        return True
    return False


async def issue_session(
    db: AsyncSession,
    *,
    user: AdminUser,
    ip: str,
    user_agent: str | None,
    settings: Settings | None = None,
) -> str:
    """Create a session for `user` and return the raw token to put in the cookie.

    The raw token exists only in this return value and in the cookie. What reaches
    the database is its SHA-256, so a dump of `admin_session` cannot be replayed
    as a set of working cookies.

    The session row and its audit entry are written in one transaction, and the
    row is flushed before the audit entry is built so the audit can name the
    session it describes instead of a placeholder.
    """
    resolved = settings or get_settings()
    now = _utcnow()
    raw_token = generate_session_token()
    record = AdminSession(
        user_id=user.id,
        token_hash=hash_session_token(raw_token),
        issued_at=now,
        last_used_at=now,
        expires_at=now + timedelta(seconds=resolved.ADMIN_SESSION_ABSOLUTE_SECONDS),
        ip_hash=client_ip_hash(ip, now),
        user_agent=user_agent[:USER_AGENT_MAX_LENGTH] if user_agent else None,
    )
    db.add(record)
    # Assigns the server-generated UUID without ending the transaction, so the
    # audit row can carry a real session id.
    await db.flush()

    user.last_login_at = now
    user.failed_attempts = 0
    user.locked_until = None

    db.add(
        AdminAuditLog(
            actor_user_id=user.id,
            action=ACTION_LOGIN,
            entity=ENTITY_ADMIN_SESSION,
            entity_id=str(record.id),
            after={"outcome": "success"},
        )
    )
    await db.commit()

    log_event(
        logger,
        logging.INFO,
        "admin_login_succeeded",
        actor_user_id=user.id,
        session_id=str(record.id),
        expires_at=record.expires_at.isoformat(),
        ip_hash=record.ip_hash,
    )
    return raw_token


async def resolve_session(
    db: AsyncSession,
    raw_token: str,
    *,
    settings: Settings | None = None,
) -> AuthenticatedSession | None:
    """Return the live session for `raw_token`, or `None`.

    Checks, in order: the row exists, it is not revoked, the absolute deadline has
    not passed, the idle window has not elapsed, and the account is still active.
    Returns `None` for all of them — the caller answers 401 identically.

    A revoked or expired token fails *here*, on the first request after the fact,
    rather than on the next login. That is why revocation is a `revoked_at`
    column and not the deletion of a deny-list entry.
    """
    resolved = settings or get_settings()
    result = await db.execute(
        select(AdminSession).where(AdminSession.token_hash == hash_session_token(raw_token))
    )
    record = result.scalar_one_or_none()
    if record is None:
        log_event(logger, logging.INFO, "admin_session_unknown")
        return None

    now = _utcnow()
    idle_deadline = record.last_used_at + timedelta(seconds=resolved.ADMIN_SESSION_IDLE_SECONDS)

    reason: str | None = None
    if record.revoked_at is not None:
        reason = "revoked"
    elif now >= record.expires_at:
        reason = "absolute_expired"
    elif now >= idle_deadline:
        reason = "idle_expired"

    if reason is not None:
        log_event(
            logger,
            logging.INFO,
            "admin_session_rejected",
            reason=reason,
            session_id=str(record.id),
        )
        return None

    user = await db.get(AdminUser, record.user_id)
    if user is None or not user.is_active:
        # Deactivating the account must end the session immediately, exactly like
        # a logout: an admin who is no longer an admin cannot keep an open cookie.
        log_event(
            logger,
            logging.WARNING,
            "admin_session_rejected",
            reason="account_inactive",
            session_id=str(record.id),
        )
        return None

    if (now - record.last_used_at).total_seconds() >= IDLE_REFRESH_INTERVAL_SECONDS:
        record.last_used_at = now
        await db.commit()

    return AuthenticatedSession(user=user, record=record, raw_token=raw_token)


async def revoke_session(db: AsyncSession, record: AdminSession) -> None:
    """Mark `record` revoked and write the audit row.

    Idempotent: a second logout of an already-revoked session finds nothing to
    revoke, because `resolve_session` refuses to return one.
    """
    now = _utcnow()
    record.revoked_at = record.revoked_at or now
    db.add(
        AdminAuditLog(
            actor_user_id=record.user_id,
            action=ACTION_LOGOUT,
            entity=ENTITY_ADMIN_SESSION,
            entity_id=str(record.id),
            after={"outcome": "success"},
        )
    )
    await db.commit()
    log_event(
        logger,
        logging.INFO,
        "admin_logout_succeeded",
        actor_user_id=record.user_id,
        session_id=str(record.id),
    )


async def record_logout_without_session(db: AsyncSession, reason: str) -> None:
    """Audit a logout that had nothing to revoke.

    Logout is deliberately idempotent and safe, so a client that retries it, or
    fires it after its cookie expired, gets 200 and a cleared cookie. The attempt
    is still recorded: an unexplained burst of them is worth seeing.
    """
    db.add(
        AdminAuditLog(
            actor_user_id=None,
            action=ACTION_LOGOUT,
            entity=ENTITY_ADMIN_SESSION,
            entity_id=None,
            after={"outcome": "no_session", "reason": reason},
        )
    )
    await db.commit()
    log_event(logger, logging.INFO, "admin_logout_without_session", reason=reason)


async def rehash_if_needed(db: AsyncSession, user: AdminUser, password: str) -> bool:
    """Re-hash on this login if the stored hash predates the current parameters.

    A successful login is the only moment the plaintext password exists, which is
    what makes an upgrade path possible at all: raising the Argon2 cost does not
    invalidate existing hashes, it only means the next correct password silently
    brings the row up to date. No user is locked out and no reset email is needed.

    The replacement is persisted by the `issue_session` commit that follows, so
    this adds no transaction of its own. Costs a second Argon2 run, and only on
    the first login after a parameter change.
    """
    if not needs_rehash(user.password_hash):
        return False
    user.password_hash = hash_password(password)
    log_event(
        logger,
        logging.INFO,
        "admin_password_rehash",
        actor_user_id=user.id,
    )
    return True


__all__ = [
    "ACTION_LOGIN",
    "ACTION_LOGOUT",
    "AuthenticatedSession",
    "authenticate",
    "clear_expired_lock",
    "client_ip_hash",
    "issue_session",
    "load_user_by_email",
    "record_login_failure",
    "record_logout_without_session",
    "resolve_session",
    "revoke_session",
]