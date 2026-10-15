"""The session cookie's `Max-Age` arithmetic, without a database.

`tests/test_sessions.py` covers the HTTP path; these unit tests pin the boundary
behaviour of `renew_session_cookie` itself, including the branch that clears the
cookie when the absolute deadline has passed — reachable only if the clock moves
between the session lookup and the renewal.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

from fastapi import Response

from app.config import get_settings
from app.session_cookie import (
    SESSION_COOKIE_NAME,
    renew_session_cookie,
    set_session_cookie,
)


def _header(response: Response) -> str:
    return response.headers["set-cookie"]


def test_set_session_cookie_uses_the_idle_window() -> None:
    settings = get_settings()
    response = Response()

    set_session_cookie(response, "tok", settings)

    header = _header(response)
    assert f"{SESSION_COOKIE_NAME}=tok" in header
    assert f"Max-Age={settings.ADMIN_SESSION_IDLE_SECONDS}" in header


def test_renew_uses_the_idle_window_when_the_absolute_deadline_is_far() -> None:
    settings = get_settings()
    now = datetime.now(UTC)
    response = Response()

    renew_session_cookie(
        response, "tok", settings, expires_at=now + timedelta(days=7), now=now
    )

    assert f"Max-Age={settings.ADMIN_SESSION_IDLE_SECONDS}" in _header(response)


def test_renew_clamps_to_the_remaining_absolute_lifetime() -> None:
    settings = get_settings()
    now = datetime.now(UTC)
    response = Response()

    renew_session_cookie(
        response, "tok", settings, expires_at=now + timedelta(seconds=90), now=now
    )

    assert "Max-Age=90" in _header(response)


def test_renew_clears_the_cookie_once_the_absolute_deadline_has_passed() -> None:
    settings = get_settings()
    now = datetime.now(UTC)
    response = Response()

    renew_session_cookie(
        response, "tok", settings, expires_at=now - timedelta(seconds=1), now=now
    )

    header = _header(response)
    assert re.search(r"Max-Age=0(?:[;]|$)", header), header
