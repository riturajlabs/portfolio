"""`GET /health` and `GET /ready`.

The two endpoints answer different questions and must not be conflated:

* `/health` — is the process alive? No database query at all. A slow or missing
  dependency must never trigger a restart loop, so liveness stays dependency-free.
* `/ready` — may traffic be routed here? The database must be reachable *and* the
  expected Alembic revision must be applied. A migrated-but-wrong schema, or a
  reachable database with no `alembic_version`, returns 503.

Responses stay minimal and disclose nothing about the environment
(`SECURITY.md` §2.10). The reason for a 503 goes to the log, never to the client.
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine

from app.db.migrations import expected_head
from app.db.session import engine_target, get_engine
from app.logging import log_event
from app.models import expected_table_names

router = APIRouter(tags=["health"])
logger = logging.getLogger("app.health")

_NOT_READY = "database not ready"


@router.get("/health", status_code=status.HTTP_200_OK)
async def health() -> dict[str, str]:
    """Liveness. Answers 200 as long as the process can serve a request."""
    return {"status": "ok"}


async def check_database(engine: AsyncEngine) -> tuple[bool, str]:
    """Return `(ready, reason)`. `reason` is for the log, never for the client."""
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))

            applied = (
                await connection.execute(
                    text("SELECT version_num FROM alembic_version")
                )
            ).scalars().all()
    except SQLAlchemyError as exc:
        return False, f"database unreachable: {type(exc).__name__}"
    except Exception as exc:  # driver-level failures are not always SQLAlchemyError
        return False, f"database unreachable: {type(exc).__name__}"

    if not applied:
        return False, "alembic_version is empty or absent: migrations have not been applied"

    try:
        head = expected_head()
    except Exception as exc:
        return False, f"cannot read the expected Alembic revision: {type(exc).__name__}"

    applied_set = set(applied)
    if applied_set != {head}:
        return False, f"schema revision {sorted(applied_set)} does not match head {head}"

    try:
        async with engine.connect() as connection:
            present = set(
(
                        await connection.execute(
                            text(
                                "SELECT table_name FROM information_schema.tables "
                                "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
                            )
                        )
                    ).scalars()
            )
    except Exception as exc:
        return False, f"cannot list tables: {type(exc).__name__}"

    expected = expected_table_names()
    missing = sorted(expected - present)
    if missing:
        return False, f"application tables missing: {missing}"

    return True, "ok"


@router.get("/ready", status_code=status.HTTP_200_OK)
async def ready(engine: Annotated[AsyncEngine, Depends(get_engine)]) -> dict[str, str]:
    """Readiness. 200 only when the database is reachable and migrated."""
    is_ready, reason = await check_database(engine)
    if not is_ready:
        log_event(
            logger,
            logging.WARNING,
            "readiness_failed",
            database=engine_target(),
            reason=reason,
        )
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=_NOT_READY)

    log_event(logger, logging.DEBUG, "readiness_ok", database=engine_target())
    return {"status": "ready"}


__all__ = ["router", "health", "ready", "check_database"]