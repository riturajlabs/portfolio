"""Async engine and session factory.

The engine is created lazily so that importing the application never opens a
socket: `/health` must answer 200 while the database is unreachable, and a test
run must be able to point the process at a different database before the first
connection is made.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.config import Settings, get_settings
from app.logging import log_event

logger = logging.getLogger("app.db")

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def create_engine(settings: Settings | None = None) -> AsyncEngine:
    """Build a new async engine. Prefer `get_engine`."""
    resolved = settings or get_settings()
    return create_async_engine(
        resolved.DATABASE_URL,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=5,
        echo=False,
    )


def get_engine() -> AsyncEngine:
    """Return the process-wide engine, creating it on first use."""
    global _engine, _session_factory
    if _engine is None:
        _engine = create_engine()
        _session_factory = async_sessionmaker(_engine, class_=AsyncSession, expire_on_commit=False)
        log_event(logger, logging.INFO, "engine_created", database=engine_target())
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Return the process-wide session factory, creating the engine on first use."""
    get_engine()
    assert _session_factory is not None
    return _session_factory


async def dispose_engine() -> None:
    """Close all pooled connections and drop the cached engine."""
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
        log_event(logger, logging.INFO, "engine_disposed")
    _engine = None
    _session_factory = None


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a request-scoped session."""
    async with get_session_factory()() as session:
        yield session


def engine_target() -> str:
    """A redacted `host:port/database` string, safe to log."""
    try:
        url = get_settings().redacted_database_url
    except Exception:  # pragma: no cover - settings are validated at startup
        return "unknown"
    return url