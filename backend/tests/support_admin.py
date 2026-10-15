"""Shared helpers for the admin authentication tests.

Constants and query helpers only — the `admin_user` and `inactive_admin`
fixtures live in `conftest.py`, because a fixture imported into a test module
shadows the module-level helper of the same name and `ruff` rightly objects.

`TESTING.md` §7.2 requires the real schema, so everything here reads and writes
through the same ORM the application uses rather than mocking the session away.

Nothing here creates an administrator for the running application.
`SECURITY.md` §4.4 makes first-user creation an explicit CLI step that refuses to
run in production, and Phase 4 does not add that command. A test needs an
administrator, a CLI needs one, and neither should happen by accident at import
time.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.models import AdminAuditLog, AdminSession
from app.session_cookie import SESSION_COOKIE_NAME

ADMIN_EMAIL = "admin@example.com"

# Argon2 is deliberately slow — that is the point of it — so these long values
# exist to make a test's own inputs obviously not the credential.
ADMIN_PASSWORD = "correct horse battery staple"
WRONG_PASSWORD = "wrong horse battery staple"


def session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """A session factory bound to the test engine.

    Not a fixture: helpers here and a few tests need one outside the fixture
    graph, and pytest fixtures cannot be called from plain functions.
    """
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def sessions_for(engine: AsyncEngine) -> list[AdminSession]:
    """Every session row, oldest first. For asserting on persistence."""
    factory = session_factory(engine)
    async with factory() as session:
        result = await session.execute(select(AdminSession).order_by(AdminSession.issued_at))
        return list(result.scalars())


async def audit_rows(engine: AsyncEngine, action: str | None = None) -> list[AdminAuditLog]:
    """Audit rows, optionally filtered by action."""
    factory = session_factory(engine)
    query = select(AdminAuditLog).order_by(AdminAuditLog.at)
    if action is not None:
        query = query.where(AdminAuditLog.action == action)
    async with factory() as session:
        result = await session.execute(query)
        return list(result.scalars())


async def age_session(engine: AsyncEngine, session_id: Any, **changes: Any) -> None:
    """Force a session row into an aged or dead state.

    Rows are edited directly rather than by waiting or injecting a clock: this
    reaches the exact state the timeout logic has to handle without spending twelve
    hours of test runtime on it.
    """
    factory = session_factory(engine)
    async with factory() as session:
        await session.execute(
            update(AdminSession).where(AdminSession.id == session_id).values(**changes)
        )
        await session.commit()


def hours_ago(hours: float) -> datetime:
    """A UTC timestamp `hours` in the past, for `last_used_at` and friends."""
    return datetime.now(UTC) - timedelta(hours=hours)


def cookie_header(token: str) -> dict[str, str]:
    """Build a Cookie header carrying `token` as the session cookie."""
    return {"Cookie": f"{SESSION_COOKIE_NAME}={token}"}