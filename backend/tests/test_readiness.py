"""`GET /ready` — readiness.

The four cases `TESTING.md` §7.6 requires: healthy, no database, unmigrated
database. Each must be decided by the database, never by the fact that the
Python process happened to start.
"""

from __future__ import annotations

from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.db.migrations import expected_head
from app.db.session import get_engine


async def test_ready_returns_200_when_the_database_is_migrated(client: AsyncClient) -> None:
    response = await client.get("/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


async def test_ready_returns_503_when_the_database_is_unreachable(isolated_client) -> None:
    http_client, _dead_engine = isolated_client

    response = await http_client.get("/ready")

    assert response.status_code == 503


async def test_ready_returns_503_when_no_migration_is_applied(
    client: AsyncClient, application: FastAPI, unmigrated_database_url: str
) -> None:
    """A reachable server with no `alembic_version` must not pass as ready."""
    unmigrated_engine = create_async_engine(unmigrated_database_url)
    application.dependency_overrides[get_engine] = lambda: unmigrated_engine
    try:
        response = await client.get("/ready")
    finally:
        application.dependency_overrides.clear()
        await unmigrated_engine.dispose()

    assert response.status_code == 503


async def test_ready_returns_503_when_the_applied_revision_is_behind_head(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """A stale `alembic_version` means the schema is not what the code expects."""
    async with engine.begin() as connection:
        await connection.execute(text("UPDATE alembic_version SET version_num = '0000_stale'"))

    try:
        response = await client.get("/ready")
    finally:
        async with engine.begin() as connection:
            await connection.execute(
                text("UPDATE alembic_version SET version_num = :version"),
                {"version": expected_head()},
            )

    assert response.status_code == 503


async def test_ready_returns_503_when_an_application_table_is_missing(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """Migrations stamped but tables gone must still fail."""
    async with engine.begin() as connection:
        await connection.exec_driver_sql("ALTER TABLE certification RENAME TO certification_hidden")

    try:
        response = await client.get("/ready")
    finally:
        async with engine.begin() as connection:
            await connection.exec_driver_sql(
                "ALTER TABLE certification_hidden RENAME TO certification"
            )

    assert response.status_code == 503


async def test_ready_failure_body_leaks_nothing(isolated_client) -> None:
    http_client, _dead_engine = isolated_client

    body = (await http_client.get("/ready")).text.lower()

    assert "password" not in body
    assert "postgresql" not in body
    assert "traceback" not in body
    assert "127.0.0.1" not in body
    assert "asyncpg" not in body


async def test_ready_is_get_only(client: AsyncClient) -> None:
    assert (await client.post("/ready")).status_code == 405


async def test_readiness_and_liveness_agree_only_when_the_database_is_ready(
    isolated_client,
) -> None:
    """The distinction that matters: alive is not the same as ready."""
    http_client, _dead_engine = isolated_client

    alive = await http_client.get("/health")
    ready = await http_client.get("/ready")

    assert alive.status_code == 200
    assert ready.status_code == 503