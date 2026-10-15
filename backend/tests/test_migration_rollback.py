"""`alembic downgrade base` must actually undo the schema.

`DATABASE.md` §16 requires `downgrade base` to succeed, but nothing asserted that
it leaves the database empty rather than merely updating `alembic_version`.
`0001_initial`'s `downgrade()` drops the nine tables, `0002_certification_unique`
drops its constraint, so this test migrates a throwaway database up, down, and up
again and inspects `information_schema` and `pg_extension` after each step.

`citext` is database-level infrastructure, not migration-owned state: `upgrade()`
ensures it exists with `CREATE EXTENSION IF NOT EXISTS`, but `downgrade()` leaves
it in place so it can neither destroy an extension the migration did not create
nor fail on a role that cannot drop a shared one. Both cases are covered below —
one database where the migration creates `citext`, one where it pre-exists.
"""

from __future__ import annotations

import asyncio

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from tests.conftest import (
    EXPECTED_TABLES,
    _drop_and_create_database,
    _run_alembic,
    _with_database,
)

ROLLBACK_DATABASE = "portfolio_test_rollback"
ROLLBACK_DATABASE_PREEXISTING = "portfolio_test_rollback_preexisting"


def _application_tables(url: str) -> set[str]:
    """Base tables in `public`, excluding Alembic's own bookkeeping table."""

    async def _run() -> set[str]:
        engine = create_async_engine(url)
        try:
            async with engine.connect() as connection:
                result = await connection.execute(
                    text(
                        "SELECT table_name FROM information_schema.tables "
                        "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' "
                        "AND table_name <> 'alembic_version'"
                    )
                )
                return {row[0] for row in result}
        finally:
            await engine.dispose()
            # asyncpg closes a connection in a scheduled callback; let it run
            # before `asyncio.run` closes the loop.
            await asyncio.sleep(0)

    return asyncio.run(_run())


def _extensions(url: str) -> set[str]:
    async def _run() -> set[str]:
        engine = create_async_engine(url)
        try:
            async with engine.connect() as connection:
                result = await connection.execute(text("SELECT extname FROM pg_extension"))
                return {row[0] for row in result}
        finally:
            await engine.dispose()
            await asyncio.sleep(0)

    return asyncio.run(_run())


def _create_extension(url: str, name: str = "citext") -> None:
    """Install an extension directly, simulating a DBA pre-creating it.

    Reproduces the managed-instance path documented in `backend/README.md`: the
    extension exists before the migration runs, so `CREATE EXTENSION IF NOT
    EXISTS` inside `upgrade()` is a no-op.
    """

    async def _run() -> None:
        engine = create_async_engine(url)
        try:
            async with engine.begin() as connection:
                await connection.execute(text(f"CREATE EXTENSION IF NOT EXISTS {name}"))
        finally:
            await engine.dispose()
            await asyncio.sleep(0)

    asyncio.run(_run())


def test_downgrade_base_removes_every_application_table(
    admin_database_url: str, test_database_url: str
) -> None:
    url = _with_database(test_database_url, ROLLBACK_DATABASE)
    _drop_and_create_database(admin_database_url, ROLLBACK_DATABASE)
    try:
        _run_alembic(["upgrade", "head"], url)
        assert _application_tables(url) == set(EXPECTED_TABLES)
        assert "citext" in _extensions(url)

        _run_alembic(["downgrade", "base"], url)
        assert _application_tables(url) == set(), "downgrade left application tables behind"
        # `citext` is infrastructure: the downgrade removes the tables, not the
        # extension (0001_initial.downgrade() deliberately does not drop it).
        assert "citext" in _extensions(url), "downgrade removed the citext extension"

        # Rebuilding from base proves the down migration left nothing that makes a
        # second upgrade fail — the failure mode a partial downgrade would cause.
        _run_alembic(["upgrade", "head"], url)
        assert _application_tables(url) == set(EXPECTED_TABLES)
        assert "citext" in _extensions(url)
    finally:
        _drop_and_create_database(admin_database_url, ROLLBACK_DATABASE)


def test_downgrade_base_is_safe_when_citext_pre_exists(
    admin_database_url: str, test_database_url: str
) -> None:
    """A DBA pre-created `citext`: upgrade must tolerate it, downgrade must keep it.

    This is the managed-instance case (`backend/README.md`): the application role
    cannot create the extension, so it exists before the first migration. The
    migration's `CREATE EXTENSION IF NOT EXISTS` must be a no-op, and the
    downgrade must leave the extension behind rather than dropping an object it
    did not create.
    """
    url = _with_database(test_database_url, ROLLBACK_DATABASE_PREEXISTING)
    _drop_and_create_database(admin_database_url, ROLLBACK_DATABASE_PREEXISTING)
    try:
        _create_extension(url)
        assert "citext" in _extensions(url)

        _run_alembic(["upgrade", "head"], url)
        assert _application_tables(url) == set(EXPECTED_TABLES)
        assert "citext" in _extensions(url)

        _run_alembic(["downgrade", "base"], url)
        assert _application_tables(url) == set()
        assert "citext" in _extensions(url), "downgrade dropped a pre-existing citext"

        _run_alembic(["upgrade", "head"], url)
        assert _application_tables(url) == set(EXPECTED_TABLES)
        assert "citext" in _extensions(url)
    finally:
        _drop_and_create_database(admin_database_url, ROLLBACK_DATABASE_PREEXISTING)
