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
CASE_STUDY_DATABASE = "portfolio_test_case_study"


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


def _project_case_study_column(url: str) -> tuple[str, str] | None:
    async def _run() -> tuple[str, str] | None:
        engine = create_async_engine(url)
        try:
            async with engine.connect() as connection:
                row = (
                    await connection.execute(
                        text(
                            "SELECT is_nullable, udt_name "
                            "FROM information_schema.columns "
                            "WHERE table_schema = 'public' AND table_name = 'project' "
                            "AND column_name = 'case_study'"
                        )
                    )
                ).one_or_none()
                return (row[0], row[1]) if row is not None else None
        finally:
            await engine.dispose()
            await asyncio.sleep(0)

    return asyncio.run(_run())


def _project_case_study_constraint(url: str) -> str | None:
    async def _run() -> str | None:
        engine = create_async_engine(url)
        try:
            async with engine.connect() as connection:
                row = (
                    await connection.execute(
                        text(
                            "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                            "WHERE conname = 'ck_project_case_study_object' "
                            "AND conrelid = 'project'::regclass"
                        )
                    )
                ).one_or_none()
                return row[0] if row is not None else None
        finally:
            await engine.dispose()
            await asyncio.sleep(0)

    return asyncio.run(_run())


def _insert_existing_project(url: str) -> None:
    async def _run() -> None:
        engine = create_async_engine(url)
        try:
            async with engine.begin() as connection:
                await connection.execute(
                    text(
                        "INSERT INTO project ("
                        "slug, title, short_description, image, image_width, "
                        "image_height, image_alt, seo_title, seo_description"
                        ") VALUES ("
                        "'existing-project', 'Existing Project', 'Existing description.', "
                        "'/images/projects/existing-project.webp', 1200, 800, "
                        "'Screenshot', 'Existing Project', 'Existing description.'"
                        ")"
                    )
                )
        finally:
            await engine.dispose()
            await asyncio.sleep(0)

    asyncio.run(_run())


def _project_title_and_case_study(url: str) -> tuple[str, object]:
    async def _run() -> tuple[str, object]:
        engine = create_async_engine(url)
        try:
            async with engine.connect() as connection:
                row = (
                    await connection.execute(
                        text("SELECT title, case_study FROM project WHERE slug = 'existing-project'")
                    )
                ).one()
                return row[0], row[1]
        finally:
            await engine.dispose()
            await asyncio.sleep(0)

    return asyncio.run(_run())


def _project_title(url: str) -> str:
    async def _run() -> str:
        engine = create_async_engine(url)
        try:
            async with engine.connect() as connection:
                return (
                    await connection.execute(
                        text("SELECT title FROM project WHERE slug = 'existing-project'")
                    )
                ).scalar_one()
        finally:
            await engine.dispose()
            await asyncio.sleep(0)

    return asyncio.run(_run())


def _set_project_case_study(url: str, case_study: str) -> None:
    async def _run() -> None:
        engine = create_async_engine(url)
        try:
            async with engine.begin() as connection:
                await connection.execute(
                    text(
                        "UPDATE project SET case_study = CAST(:case_study AS jsonb) "
                        "WHERE slug = 'existing-project'"
                    ),
                    {"case_study": case_study},
                )
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


def test_case_study_migration_preserves_rows_and_round_trips(
    admin_database_url: str, test_database_url: str
) -> None:
    """`0005` adds one nullable column, never backfills, and undoes cleanly."""
    url = _with_database(test_database_url, CASE_STUDY_DATABASE)
    _drop_and_create_database(admin_database_url, CASE_STUDY_DATABASE)
    try:
        _run_alembic(["upgrade", "0004_profile_resume_key"], url)
        _insert_existing_project(url)
        assert _project_case_study_column(url) is None
        assert _project_case_study_constraint(url) is None

        _run_alembic(["upgrade", "0005_project_case_study"], url)
        assert _project_case_study_column(url) == ("YES", "jsonb")
        constraint = _project_case_study_constraint(url)
        assert constraint is not None
        assert "case_study IS NULL" in constraint
        assert "jsonb_typeof(case_study) = 'object'" in constraint

        title, case_study = _project_title_and_case_study(url)
        assert title == "Existing Project"
        assert case_study is None, "0005 must not backfill existing rows"

        _set_project_case_study(url, '{"schemaVersion": 1}')
        _title, case_study = _project_title_and_case_study(url)
        assert case_study == {"schemaVersion": 1}

        _run_alembic(["downgrade", "0004_profile_resume_key"], url)
        assert _project_case_study_column(url) is None
        assert _project_case_study_constraint(url) is None
        assert _project_title(url) == "Existing Project"

        _run_alembic(["upgrade", "0005_project_case_study"], url)
        assert _project_case_study_column(url) == ("YES", "jsonb")
        assert _project_case_study_constraint(url) is not None
        _title, case_study = _project_title_and_case_study(url)
        assert case_study is None
    finally:
        _drop_and_create_database(admin_database_url, CASE_STUDY_DATABASE)
