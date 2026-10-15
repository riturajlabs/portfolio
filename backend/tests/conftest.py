"""Test fixtures.

The schema under test is the real thing. `citext`, `jsonb`, `text[]`, the CHECK
constraints and PostgreSQL's UUID generation cannot be exercised against SQLite,
so `TESTING.md` ("Test database") requires a real PostgreSQL instance and these
tests fail loudly rather than skip when one is not configured.

The test schema is built by running `alembic upgrade head` against the test
database, so the migration is exercised on every run rather than assumed.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import uuid
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import get_settings, normalise_database_url
from app.models import AdminUser
from app.security.passwords import hash_password

BACKEND_ROOT = Path(__file__).resolve().parents[1]

# Application tables, in the order `DATABASE.md` §0 lists them.
EXPECTED_TABLES = (
    "site_profile",
    "project",
    "skill_category",
    "skill",
    "certification",
    "contact_message",
    "admin_user",
    "admin_session",
    "admin_audit_log",
)

# Tables that must never exist: the entities `DATABASE.md` §1.4, §9, §10 and §15
# rejected. A test asserts they are absent so scope cannot creep silently.
FORBIDDEN_TABLES = (
    "project_technology",
    "project_category",
    "social_link",
    "education",
    "about_card",
    "blog_post",
    "redirect",
    "media_asset",
)

# A port nothing listens on, used to prove `/ready` reports 503 rather than
# claiming health it cannot verify.
UNREACHABLE_DATABASE_URL = normalise_database_url("postgresql://nobody:nothing@127.0.0.1:1/nothing")


def _test_database_url() -> str:
    """Resolve the isolated test database URL.

    `TEST_DATABASE_URL` wins. Otherwise the standard libpq environment variables
    are used, which is how CI passes `postgres:16` service credentials without a
    password ever appearing in this repository.
    """
    explicit = os.environ.get("TEST_DATABASE_URL", "").strip()
    if explicit:
        return normalise_database_url(explicit)

    host = os.environ.get("PGHOST", "").strip()
    user = os.environ.get("PGUSER", "").strip()
    database = os.environ.get("PGDATABASE", "").strip()
    if not (host and user and database):
        pytest.fail(
            "No test database configured. Set TEST_DATABASE_URL (see "
            "backend/.env.example) or the PGHOST/PGUSER/PGPASSWORD/PGDATABASE "
            "environment variables. Tests must run against a real PostgreSQL "
            "instance; SQLite is not an acceptable substitute."
        )
    port = os.environ.get("PGPORT", "5432").strip()
    password = os.environ.get("PGPASSWORD", "")
    credentials = f"{user}:{password}" if password else user
    return normalise_database_url(f"postgresql://{credentials}@{host}:{port}/{database}")


TEST_DATABASE_URL = _test_database_url()

# `app.main` builds the application at import time, and building it reads settings.
# Point those settings at the test database first, so a run needs only
# TEST_DATABASE_URL (or the PG* variables) and never a separately exported
# DATABASE_URL. A fixture is too late for this: fixtures run after collection has
# already imported every test module.
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ.setdefault("ENVIRONMENT", "development")
get_settings.cache_clear()

from app.db.session import get_engine, get_session  # noqa: E402  (needs the settings above)
from app.main import app  # noqa: E402  (needs the settings above)


def _run_alembic(arguments: list[str], url: str) -> None:
    """Run the Alembic CLI against `url`.

    A subprocess, not `alembic.command`, because `alembic/env.py` deliberately
    takes the URL from application settings rather than from the Alembic config.
    Invoking the CLI is also what proves the documented commands work:

        alembic upgrade head
        alembic current
    """
    environment = {
        **os.environ,
        "DATABASE_URL": url,
        "ENVIRONMENT": os.environ.get("ENVIRONMENT", "development"),
        "PYTHONPATH": str(BACKEND_ROOT),
    }
    result = subprocess.run(
        [sys.executable, "-m", "alembic", *arguments],
        cwd=BACKEND_ROOT,
        env=environment,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise AssertionError(
            f"alembic {' '.join(arguments)} failed for {url.rsplit('@', 1)[-1]}:\n"
            f"{result.stdout}\n{result.stderr}"
        )


def _with_database(url: str, database: str) -> str:
    """Return `url` pointing at a different database on the same server."""
    parts = urlsplit(url)
    return urlunsplit(parts._replace(path=f"/{database}"))


def _drop_and_create_database(admin_url: str, name: str) -> None:
    """Replace `name` with an empty database on the server behind `admin_url`."""

    async def _run() -> None:
        engine = create_async_engine(admin_url, isolation_level="AUTOCOMMIT")
        try:
            async with engine.connect() as connection:
                await connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
                await connection.execute(text(f'CREATE DATABASE "{name}"'))
        finally:
            await engine.dispose()
            # asyncpg finishes closing a connection in a scheduled callback; let
            # it run before `asyncio.run` closes the loop.
            await asyncio.sleep(0)

    asyncio.run(_run())


def _reset_schema(url: str) -> None:
    """Empty the public schema, then build it from the migration."""

    async def _run() -> None:
        engine = create_async_engine(url, isolation_level="AUTOCOMMIT")
        try:
            async with engine.connect() as connection:
                await connection.execute(text("DROP SCHEMA public CASCADE"))
                await connection.execute(text("CREATE SCHEMA public"))
        finally:
            await engine.dispose()
            # asyncpg finishes closing a connection in a scheduled callback; let
            # it run before `asyncio.run` closes the loop.
            await asyncio.sleep(0)

    asyncio.run(_run())


@pytest.fixture(scope="session")
def test_database_url() -> str:
    return TEST_DATABASE_URL


@pytest.fixture(scope="session")
def admin_database_url(test_database_url: str) -> str:
    return _with_database(test_database_url, "postgres")


@pytest.fixture(scope="session")
def unmigrated_database_url(admin_database_url: str, test_database_url: str) -> Iterator[str]:
    """A real, reachable, never-migrated database.

    Used to prove `/ready` returns 503 on a server that answers but has no
    applied migration — the exact state a fresh deployment starts in.
    """
    name = "portfolio_test_unmigrated"
    _drop_and_create_database(admin_database_url, name)
    try:
        yield _with_database(test_database_url, name)
    finally:
        _drop_and_create_database(admin_database_url, name)


@pytest.fixture(scope="session")
def pristine_database_url(admin_database_url: str, test_database_url: str) -> Iterator[str]:
    """A freshly migrated database that no test has written to.

    The "no seed data" assertion needs a schema nothing else has touched.
    """
    name = "portfolio_test_pristine"
    url = _with_database(test_database_url, name)
    _drop_and_create_database(admin_database_url, name)
    _run_alembic(["upgrade", "head"], url)
    try:
        yield url
    finally:
        _drop_and_create_database(admin_database_url, name)


@pytest.fixture(scope="session")
def migrated_database(test_database_url: str) -> None:
    """Build the test schema from scratch by running the real migration."""
    _reset_schema(test_database_url)
    _run_alembic(["upgrade", "head"], test_database_url)


@pytest_asyncio.fixture
async def engine(migrated_database: None, test_database_url: str) -> AsyncIterator[AsyncEngine]:
    """A migrated, empty database. Every test starts from the same state.

    `TRUNCATE ... CASCADE` clears all nine tables in one statement and leaves the
    schema, constraints and indexes in place, which is what the constraint tests
    need in order to observe the database rejecting a write.
    """
    test_engine = create_async_engine(test_database_url, pool_pre_ping=True)
    try:
        async with test_engine.begin() as connection:
            await connection.exec_driver_sql(
                "TRUNCATE TABLE " + ", ".join(EXPECTED_TABLES) + " CASCADE"
            )
        yield test_engine
    finally:
        await test_engine.dispose()


@pytest.fixture
def application() -> FastAPI:
    """The application under test, for dependency overrides inside a test."""
    return app


@pytest_asyncio.fixture
async def client(engine: AsyncEngine) -> AsyncIterator[AsyncClient]:
    """An HTTP client wired to the application, reading the real test database.

    Both engine dependencies are overridden. `/ready` depends on `get_engine`
    directly; a route that takes a session depends on `get_session`, which builds
    its own factory from the process-wide engine. Overriding only the engine would
    leave session-backed routes pointed at whatever the process cached.
    """
    test_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def _session() -> AsyncIterator[AsyncSession]:
        async with test_factory() as session:
            yield session

    app.dependency_overrides[get_engine] = lambda: engine
    app.dependency_overrides[get_session] = _session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as http_client:
        yield http_client
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def isolated_client() -> AsyncIterator[tuple[AsyncClient, AsyncEngine]]:
    """A client whose database is unreachable, to prove liveness and readiness differ.

    Both engine dependencies are overridden, so a session-backed route fails to
    reach the database exactly as it would in production.

    Returns the client and the dead engine so the caller can dispose of it.
    """
    dead_engine = create_async_engine(UNREACHABLE_DATABASE_URL, pool_pre_ping=True)
    dead_factory = async_sessionmaker(dead_engine, class_=AsyncSession, expire_on_commit=False)

    async def _dead_session() -> AsyncIterator[AsyncSession]:
        async with dead_factory() as session:
            yield session

    app.dependency_overrides[get_engine] = lambda: dead_engine
    app.dependency_overrides[get_session] = _dead_session
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://testserver") as http_client:
            yield http_client, dead_engine
    finally:
        app.dependency_overrides.clear()
        await dead_engine.dispose()


@pytest.fixture
def unique_suffix() -> str:
    """A short unique token for building values that must be unique per test."""
    return uuid.uuid4().hex[:8]

# ---------------------------------------------------------------------------
# Admin authentication fixtures
# ---------------------------------------------------------------------------
# Defined here rather than in the test modules so a fixture and a helper may
# share a name without shadowing one another. They insert through the same ORM the
# application uses; `TESTING.md` §7.2 requires the real schema, not a stand-in.

ADMIN_EMAIL = "admin@example.com"

# Argon2 is deliberately slow — that is the point of it — so the fixture password
# is hashed once per session and reused. A test that needs a distinct hash builds
# its own.
ADMIN_PASSWORD = "correct horse battery staple"


async def _insert_admin(
    engine: AsyncEngine,
    *,
    is_active: bool = True,
    email: str = ADMIN_EMAIL,
) -> AdminUser:
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        user = AdminUser(
            email=email,
            password_hash=hash_password(ADMIN_PASSWORD),
            role="ADMIN",
            is_active=is_active,
            failed_attempts=0,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        session.expunge(user)
        return user


@pytest_asyncio.fixture
async def admin_user(engine: AsyncEngine) -> AdminUser:
    """An active administrator with a real Argon2id hash."""
    return await _insert_admin(engine)


@pytest_asyncio.fixture
async def inactive_admin(engine: AsyncEngine) -> AdminUser:
    """A disabled administrator.

    Needed because a disabled account must be indistinguishable from a wrong
    password at the HTTP layer, and that cannot be demonstrated without one.
    """
    return await _insert_admin(engine, is_active=False)


@pytest.fixture(autouse=True)
def _reset_login_limiter():
    """Clear the process-wide login limiter around every test.

    Its counters are module state, not database state, so `TRUNCATE` cannot reach
    them. Without this, the ten logins one file performs would exhaust the
    per-IP window for the next file — every request in the suite presents the same
    peer address, so the bucket is shared.

    Only the login limiter is touched. `tests/test_rate_limit.py` owns the public
    content limiter's lifecycle and resets it itself.
    """
    from app.rate_limit_login import reset_login_limiter

    reset_login_limiter()
    yield
    reset_login_limiter()


@pytest.fixture(autouse=True)
def _reset_admin_read_limiter():
    """Clear the Phase 5 admin read budget around every test.

    Like the login limiter, it is process memory, so `TRUNCATE` cannot reach it —
    and because it is keyed by the administrator's id, every test in the suite
    shares one bucket between them. Without this, a few hundred authenticated
    `GET`s would exhaust the 600/min window and fail tests that never meant to
    test rate limiting at all.
    """
    from app.dependencies.admin_auth import admin_read_limiter

    admin_read_limiter.reset()
    yield
    admin_read_limiter.reset()


@pytest.fixture(autouse=True)
def _reset_resume_limiter():
    """Clear the public resume limiter around every test.

    Another process-memory counter keyed by the shared test peer address. The
    resume tests legitimately fetch the document more than once, and the login and
    admin-read fixtures above do not touch this one.
    """
    from app.routes.resume import limiter

    limiter.reset()
    yield
    limiter.reset()
