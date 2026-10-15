"""The session cookie.

One place builds and clears `portfolio_admin_session`, so the attribute set in
the response can never disagree with the attribute set documented in
`SECURITY.md` §3.3.

The cookie is a *transport*: the value is an opaque token whose hash is the
database row. Nothing about the administrator is encoded in it, so there is
nothing in a cookie to tamper with — changing a byte simply makes the lookup miss
and yields 401.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import Response

from app.config import Settings

SESSION_COOKIE_NAME = "portfolio_admin_session"

# §3.3: `Path=/` so the cookie is sent to every admin route. A narrower path
# would make a future route silently unauthenticated because the browser omitted
# the cookie — a failure that looks exactly like a broken admin UI.
SESSION_COOKIE_PATH = "/"

# §3.3: `SameSite=Strict`. The admin is same-origin (§2.1), so Strict costs
# nothing and removes the cross-site request vector entirely.
SESSION_COOKIE_SAMESITE = "strict"

# `DATABASE.md` §11.2: `user_agent` is `text(300)`. Truncating to the same bound
# means an over-long header is stored as far as the schema allows rather than
# failing the insert.
USER_AGENT_MAX_LENGTH = 300


def _apply_session_cookie(
    response: Response, token: str, settings: Settings, max_age: int
) -> None:
    """Write the session cookie with one explicit `Max-Age`.

    The single place the cookie attributes are set, so `set_session_cookie` and
    `renew_session_cookie` cannot drift from `clear_session_cookie` or from the
    attribute set documented in `SECURITY.md` §3.3. `Secure` follows
    `Settings.admin_cookie_secure`, which withholds it in development only —
    there, the frontend is plain `http://localhost` and a browser would discard a
    `Secure` cookie, which tests the local flow rather than protecting it.
    """
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=max_age,
        path=SESSION_COOKIE_PATH,
        httponly=True,
        secure=settings.admin_cookie_secure,
        samesite=SESSION_COOKIE_SAMESITE,
    )


def set_session_cookie(response: Response, token: str, settings: Settings) -> None:
    """Attach the session cookie to `response` at issuance.

    `max_age` is the idle window, matching the `admin_session.last_used_at`
    arithmetic in the service layer. The absolute deadline is longer, so an
    active session renews the cookie on each authenticated request
    (`renew_session_cookie`) rather than carrying the seven-day value from
    issuance — that would leave a cookie in the browser for a week after the
    session had idled out.
    """
    _apply_session_cookie(response, token, settings, settings.ADMIN_SESSION_IDLE_SECONDS)


def renew_session_cookie(
    response: Response,
    token: str,
    settings: Settings,
    *,
    expires_at: datetime,
    now: datetime | None = None,
) -> None:
    """Slide the session cookie's `Max-Age` forward on authenticated activity.

    The browser cookie and the server-side session must agree on how long the
    session lasts. The idle window slides with activity on the server
    (`admin_session.last_used_at` is refreshed every
    `IDLE_REFRESH_INTERVAL_SECONDS`), so the cookie is re-issued on every
    authenticated request too.

    `Max-Age` is clamped to the time left before the *absolute* deadline
    (`admin_session.expires_at`), so the browser drops the cookie no later than
    the server stops accepting it. Renewing therefore extends the sliding idle
    window but never the absolute ceiling — recomputing `expires_at` from
    activity would make the seven-day cap decoration (`services/auth.py`).
    """
    moment = now or datetime.now(UTC)
    remaining = int((expires_at - moment).total_seconds())
    if remaining <= 0:
        # Never emit a non-positive Max-Age short of deletion; a session at or
        # past its absolute deadline is cleared, exactly as on rejection.
        clear_session_cookie(response, settings)
        return
    _apply_session_cookie(
        response,
        token,
        settings,
        min(settings.ADMIN_SESSION_IDLE_SECONDS, remaining),
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    """Instruct the browser to drop the session cookie.

    The attributes must match `set_session_cookie` exactly, or the browser keeps
    the original cookie. `max_age=0` is what deletes it; an expired `expires` is
    not enough on every browser.
    """
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path=SESSION_COOKIE_PATH,
        httponly=True,
        secure=settings.admin_cookie_secure,
        samesite=SESSION_COOKIE_SAMESITE,
    )


def read_session_cookie(cookies: dict[str, str]) -> str | None:
    """Return the raw session token from a request's cookies, if present."""
    return cookies.get(SESSION_COOKIE_NAME)


def session_cookie_delete_header(settings: Settings) -> str:
    """Render the `Set-Cookie` header that deletes the session cookie.

    Needed because a dependency that rejects a request raises rather than
    returning a `Response`, and `ARCHITECTURE.md`'s login sequence says an
    expired or revoked session is answered with 401 *and* a cleared cookie.

    The header is produced by Starlette's own `delete_cookie` on a throwaway
    response rather than assembled by hand here, so the attributes cannot drift
    from `set_session_cookie`. A browser only replaces a cookie when the
    deletion's name, path and flags all match the original.
    """
    response = Response()
    clear_session_cookie(response, settings)
    return response.headers["set-cookie"]


def truncate_user_agent(user_agent: str | None) -> str | None:
    """Return `user_agent` within the column's 300-character bound."""
    if user_agent is None:
        return None
    return user_agent[:USER_AGENT_MAX_LENGTH]