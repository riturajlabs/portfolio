"""Tests for the one-time admin bootstrap endpoint (POST /api/admin/bootstrap).

Phase 3 validation covering:
* Unauthenticated requests (missing/malformed auth header)
* Invalid secrets (wrong token)
* Bootstrap disabled (ADMIN_BOOTSTRAP_TOKEN unset)
* Password length and email validation
* Payload size limit (413)
* Non-HTTPS rejection in production/staging
* Successful one-time initialization (creates admin + seeds content)
* Conflict prevention on repeat attempt (409)
* Atomic rollback on failure
* Rate limiting on repeated bad attempts
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.config import Settings, get_settings
from app.db.session import get_engine, get_session
from app.main import create_app
from app.models import AdminUser, Project, SiteProfile
from app.routes.admin_bootstrap import get_bootstrap_limiter
from app.security.passwords import verify_password
from db.seed import DEFAULT_SNAPSHOT, load_snapshot

VALID_BOOTSTRAP_TOKEN = "a" * 32
SAMPLE_PASSWORD = "CorrectHorseBatteryStaple123!"
SAMPLE_EMAIL = "owner@example.com"


@pytest.fixture(autouse=True)
def _reset_limiter():
    limiter = get_bootstrap_limiter()
    limiter.reset()
    yield
    limiter.reset()


def _valid_content() -> dict[str, Any]:
    return load_snapshot(DEFAULT_SNAPSHOT)


def _bootstrap_settings(**overrides: Any) -> Settings:
    base = get_settings().model_dump()
    base.update(
        {
            "ADMIN_BOOTSTRAP_TOKEN": VALID_BOOTSTRAP_TOKEN,
            "ENVIRONMENT": "development",
            **overrides,
        }
    )
    return Settings.model_validate(base)


@asynccontextmanager
async def _bootstrap_client(
    engine: AsyncEngine, settings: Settings
) -> AsyncIterator[AsyncClient]:
    """A client whose app is wired to the per-test `engine`.

    These tests build their own app (to inject `settings`), so — unlike the
    shared `client` fixture — they must install the session overrides
    themselves. Without this, `get_session` resolves the process-wide cached
    engine, whose asyncpg connections are bound to whichever event loop first
    opened them. pytest-asyncio gives every test a fresh loop, so the second
    test that reaches the database gets a spurious 503 unless the app is
    pointed at the fixture engine that runs in *this* loop.
    """
    with patch("app.main.get_settings", return_value=settings), patch(
        "app.routes.admin_bootstrap.get_settings", return_value=settings
    ):
        app = create_app()
        factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        async def _session() -> AsyncIterator[AsyncSession]:
            async with factory() as session:
                yield session

        app.dependency_overrides[get_engine] = lambda: engine
        app.dependency_overrides[get_session] = _session
        try:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                yield client
        finally:
            app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_bootstrap_disabled_returns_404(engine: AsyncEngine):
    settings = _bootstrap_settings(ADMIN_BOOTSTRAP_TOKEN="")
    with patch("app.main.get_settings", return_value=settings), patch(
        "app.routes.admin_bootstrap.get_settings", return_value=settings
    ):
        app = create_app()
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/api/admin/bootstrap",
                headers={"Authorization": f"Bearer {VALID_BOOTSTRAP_TOKEN}"},
                json={
                    "admin": {"email": SAMPLE_EMAIL, "password": SAMPLE_PASSWORD},
                    "content": _valid_content(),
                },
            )
            assert response.status_code == 404
            data = response.json()
            assert data["error"]["code"] == "NOT_FOUND"


@pytest.mark.asyncio
async def test_bootstrap_missing_token_returns_401(engine: AsyncEngine):
    settings = _bootstrap_settings()
    with patch("app.main.get_settings", return_value=settings), patch(
        "app.routes.admin_bootstrap.get_settings", return_value=settings
    ):
        app = create_app()
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/api/admin/bootstrap",
                json={
                    "admin": {"email": SAMPLE_EMAIL, "password": SAMPLE_PASSWORD},
                    "content": _valid_content(),
                },
            )
            assert response.status_code == 401
            assert response.headers["WWW-Authenticate"] == "Bearer"
            data = response.json()
            assert data["error"]["code"] == "UNAUTHENTICATED"


@pytest.mark.asyncio
async def test_bootstrap_invalid_token_returns_401(engine: AsyncEngine):
    settings = _bootstrap_settings()
    with patch("app.main.get_settings", return_value=settings), patch(
        "app.routes.admin_bootstrap.get_settings", return_value=settings
    ):
        app = create_app()
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/api/admin/bootstrap",
                headers={"Authorization": "Bearer wrong_token_value_that_is_32_chars!"},
                json={
                    "admin": {"email": SAMPLE_EMAIL, "password": SAMPLE_PASSWORD},
                    "content": _valid_content(),
                },
            )
            assert response.status_code == 401
            data = response.json()
            assert data["error"]["code"] == "UNAUTHENTICATED"


@pytest.mark.asyncio
async def test_bootstrap_requires_https_in_production(engine: AsyncEngine):
    settings = _bootstrap_settings(ENVIRONMENT="production")
    with patch("app.main.get_settings", return_value=settings), patch(
        "app.routes.admin_bootstrap.get_settings", return_value=settings
    ):
        app = create_app()
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/api/admin/bootstrap",
                headers={
                    "Authorization": f"Bearer {VALID_BOOTSTRAP_TOKEN}",
                    "x-forwarded-proto": "http",
                },
                json={
                    "admin": {"email": SAMPLE_EMAIL, "password": SAMPLE_PASSWORD},
                    "content": _valid_content(),
                },
            )
            assert response.status_code == 403
            data = response.json()
            assert data["error"]["code"] == "FORBIDDEN"


@pytest.mark.asyncio
async def test_bootstrap_validates_password_length(engine: AsyncEngine):
    settings = _bootstrap_settings()
    with patch("app.main.get_settings", return_value=settings), patch(
        "app.routes.admin_bootstrap.get_settings", return_value=settings
    ):
        app = create_app()
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/api/admin/bootstrap",
                headers={"Authorization": f"Bearer {VALID_BOOTSTRAP_TOKEN}"},
                json={
                    "admin": {"email": SAMPLE_EMAIL, "password": "short"},
                    "content": _valid_content(),
                },
            )
            assert response.status_code == 422
            data = response.json()
            assert data["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_bootstrap_validates_email_format(engine: AsyncEngine):
    settings = _bootstrap_settings()
    with patch("app.main.get_settings", return_value=settings), patch(
        "app.routes.admin_bootstrap.get_settings", return_value=settings
    ):
        app = create_app()
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/api/admin/bootstrap",
                headers={"Authorization": f"Bearer {VALID_BOOTSTRAP_TOKEN}"},
                json={
                    "admin": {"email": "not-an-email", "password": SAMPLE_PASSWORD},
                    "content": _valid_content(),
                },
            )
            assert response.status_code == 422
            data = response.json()
            assert data["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_bootstrap_rejects_payload_too_large(engine: AsyncEngine):
    settings = _bootstrap_settings()
    with patch("app.main.get_settings", return_value=settings), patch(
        "app.routes.admin_bootstrap.get_settings", return_value=settings
    ):
        app = create_app()
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/api/admin/bootstrap",
                headers={
                    "Authorization": f"Bearer {VALID_BOOTSTRAP_TOKEN}",
                    "content-length": "2000000",
                },
                json={
                    "admin": {"email": SAMPLE_EMAIL, "password": SAMPLE_PASSWORD},
                    "content": _valid_content(),
                },
            )
            assert response.status_code == 413
            data = response.json()
            assert data["error"]["code"] == "PAYLOAD_TOO_LARGE"


@pytest.mark.asyncio
async def test_bootstrap_rate_limiting(engine: AsyncEngine):
    settings = _bootstrap_settings()
    with patch("app.main.get_settings", return_value=settings), patch(
        "app.routes.admin_bootstrap.get_settings", return_value=settings
    ):
        app = create_app()
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            for _ in range(5):
                res = await client.post(
                    "/api/admin/bootstrap",
                    headers={"Authorization": "Bearer bad-token-that-is-not-correct!"},
                    json={
                        "admin": {"email": SAMPLE_EMAIL, "password": SAMPLE_PASSWORD},
                        "content": _valid_content(),
                    },
                )
                assert res.status_code == 401

            blocked_res = await client.post(
                "/api/admin/bootstrap",
                headers={"Authorization": f"Bearer {VALID_BOOTSTRAP_TOKEN}"},
                json={
                    "admin": {"email": SAMPLE_EMAIL, "password": SAMPLE_PASSWORD},
                    "content": _valid_content(),
                },
            )
            assert blocked_res.status_code == 429
            assert "Retry-After" in blocked_res.headers
            data = blocked_res.json()
            assert data["error"]["code"] == "RATE_LIMITED"


@pytest.mark.asyncio
async def test_bootstrap_success_and_conflict_repeat(engine: AsyncEngine):
    # Ensure database is clean of admin users
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        existing = (await session.execute(select(AdminUser))).scalars().all()
        for u in existing:
            await session.delete(u)
        await session.commit()

    settings = _bootstrap_settings()
    async with _bootstrap_client(engine, settings) as client:
        # First bootstrap attempt -> Success 200
        response = await client.post(
            "/api/admin/bootstrap",
            headers={"Authorization": f"Bearer {VALID_BOOTSTRAP_TOKEN}"},
            json={
                "admin": {"email": SAMPLE_EMAIL, "password": SAMPLE_PASSWORD},
                "content": _valid_content(),
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["ok"] is True
        assert data["status"] == "bootstrapped"
        assert data["admin_email"] == SAMPLE_EMAIL
        assert data["summary"]["projects"] == 5
        assert data["summary"]["skills"] == 16

        # Verify admin user created in DB with Argon2id hash
        async with session_factory() as session:
            admin = (
                await session.execute(
                    select(AdminUser).where(AdminUser.email == SAMPLE_EMAIL)
                )
            ).scalar_one_or_none()
            assert admin is not None
            assert admin.role == "ADMIN"
            assert verify_password(admin.password_hash, SAMPLE_PASSWORD)

            # Verify content was seeded
            profile = await session.scalar(select(SiteProfile))
            assert profile is not None
            projects_count = (await session.execute(select(func.count(Project.id)))).scalar_one()
            assert projects_count == 5

        # Second bootstrap attempt -> 409 Conflict
        repeat = await client.post(
            "/api/admin/bootstrap",
            headers={"Authorization": f"Bearer {VALID_BOOTSTRAP_TOKEN}"},
            json={
                "admin": {"email": "another@example.com", "password": SAMPLE_PASSWORD},
                "content": _valid_content(),
            },
        )
        assert repeat.status_code == 409
        repeat_data = repeat.json()
        assert repeat_data["error"]["code"] == "ALREADY_BOOTSTRAPPED"


@pytest.mark.asyncio
async def test_bootstrap_atomic_rollback_on_content_failure(engine: AsyncEngine):
    # Ensure database is clean of admin users
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        existing = (await session.execute(select(AdminUser))).scalars().all()
        for u in existing:
            await session.delete(u)
        await session.commit()

    bad_content = _valid_content()
    # Invalidate content: remove projects
    bad_content.pop("projects")

    settings = _bootstrap_settings()
    async with _bootstrap_client(engine, settings) as client:
        response = await client.post(
            "/api/admin/bootstrap",
            headers={"Authorization": f"Bearer {VALID_BOOTSTRAP_TOKEN}"},
            json={
                "admin": {"email": SAMPLE_EMAIL, "password": SAMPLE_PASSWORD},
                "content": bad_content,
            },
        )
        assert response.status_code == 422
        data = response.json()
        assert data["error"]["code"] == "VALIDATION_ERROR"

        # Assert no admin was created because validation failed before transaction
        async with session_factory() as session:
            admin_count = (await session.execute(select(func.count(AdminUser.id)))).scalar_one()
            assert admin_count == 0


@pytest.mark.asyncio
async def test_bootstrap_is_atomic_under_concurrent_attempts(engine: AsyncEngine):
    """Two simultaneous valid bootstraps must not create two administrators.

    The in-process lock serialises them and the transaction-scoped advisory lock
    serialises them across workers; either way only one request can observe an
    empty `admin_user` table. The other must see the winner's committed row and
    answer 409 — never insert a second administrator.
    """
    settings = _bootstrap_settings()

    async with _bootstrap_client(engine, settings) as client:

        def _attempt(email: str):
            return client.post(
                "/api/admin/bootstrap",
                headers={"Authorization": f"Bearer {VALID_BOOTSTRAP_TOKEN}"},
                json={
                    "admin": {"email": email, "password": SAMPLE_PASSWORD},
                    "content": _valid_content(),
                },
            )

        first, second = await asyncio.gather(
            _attempt("first@example.com"),
            _attempt("second@example.com"),
        )

    assert sorted([first.status_code, second.status_code]) == [200, 409], (
        first.status_code,
        second.status_code,
    )

    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        admin_count = (await session.execute(select(func.count(AdminUser.id)))).scalar_one()
    assert admin_count == 1
