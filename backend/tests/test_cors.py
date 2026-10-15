"""CORS — an explicit allow-list, never a wildcard in production.

`SECURITY.md` §2.3 fixes the design: an allow-list that `ALLOWED_ORIGINS` overrides,
a loud warning if `*` is configured, and no credentialed cross-origin access. This
file asserts the parts that decide whether a browser on another site can read the
content API.

The risk being tested is specific: a server that reflects whatever `Origin` it is
given, or that ships `allow_origins=["*"]`, has not protected anything. A test that
only checks a known-good origin passes against that server too.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from fastapi import FastAPI, HTTPException, status
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.config import DEFAULT_ALLOWED_ORIGINS, Settings, get_settings
from app.db.session import get_engine, get_session
from app.routes import content as content_routes
from app.routes import health

PRODUCTION_ORIGIN = "https://riturajlabs.vercel.app"
EVIL_ORIGIN = "https://attacker.example"

BASE_DATABASE_URL = "postgresql://user@localhost:5432/portfolio"


class _UnreachableEngine:
    """A stand-in for `AsyncEngine` that refuses to connect.

    CORS is decided by middleware, before any query runs, so the CORS tests have no
    business opening a socket. A real engine here would add connection latency and
    event-loop teardown noise to assertions that do not depend on either. The route
    catches this and reports its documented failure, which keeps the assertions
    honest about status codes as well.
    """

    def connect(self) -> AsyncIterator[AsyncEngine]:
        raise ConnectionRefusedError(111, "Connection refused")
        yield  # pragma: no cover - unreachable, makes this an async generator


def _build_cors_app(settings: Settings) -> FastAPI:
    """A minimal app carrying the real CORS middleware and the real routers.

    `create_app` reads the process-wide settings singleton, which a test cannot vary
    per case without leaking configuration between tests. This assembles the same
    middleware with the same arguments, so what is asserted here is what ships.
    """
    from fastapi.middleware.cors import CORSMiddleware

    application = FastAPI()
    application.include_router(health.router)
    application.include_router(content_routes.router)

    application.dependency_overrides[get_session] = _refuse_session
    application.dependency_overrides[get_engine] = lambda: _UnreachableEngine()

    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=[],
        expose_headers=["ETag"],
        max_age=600,
    )
    return application


async def _refuse_session() -> AsyncIterator[AsyncSession]:
    """A session dependency that never yields, standing in for a real one.

    `HTTPException` is raised rather than a service error on purpose: FastAPI
    resolves dependencies before the route body runs, so an exception from here would
    bypass the route's own handlers and test the wrong layer. Raising the documented
    empty-database 404 reproduces exactly what the real app returns against a
    migrated but empty database, with no connection involved.
    """
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail="Site profile not found."
    )
    yield  # pragma: no cover - unreachable, makes this an async generator


def _client_for(allowed_origins: str, environment: str) -> AsyncClient:
    settings = Settings(
        DATABASE_URL=BASE_DATABASE_URL,
        ENVIRONMENT=environment,
        ALLOWED_ORIGINS=allowed_origins,
    )
    return AsyncClient(
        transport=ASGITransport(app=_build_cors_app(settings)),
        base_url="http://testserver",
    )


# ---------------------------------------------------------------------------
# Configuration parsing
# ---------------------------------------------------------------------------


def test_default_origins_match_the_security_document() -> None:
    """`SECURITY.md` §2.3 lists the same three origins `ai_service` allows."""
    assert DEFAULT_ALLOWED_ORIGINS == (
        "https://riturajlabs.vercel.app",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    )


def test_comma_separated_origins_are_parsed() -> None:
    settings = Settings(
        DATABASE_URL=BASE_DATABASE_URL,
        ALLOWED_ORIGINS="https://a.example,https://b.example",
    )

    assert settings.allowed_origins == ["https://a.example", "https://b.example"]


def test_trailing_commas_and_spaces_are_tolerated() -> None:
    """A stray comma in a secret editor must not take the service down."""
    settings = Settings(
        DATABASE_URL=BASE_DATABASE_URL,
        ALLOWED_ORIGINS=" https://a.example , ,https://b.example, ",
    )

    assert settings.allowed_origins == ["https://a.example", "https://b.example"]


def test_trailing_slashes_are_normalised() -> None:
    settings = Settings(
        DATABASE_URL=BASE_DATABASE_URL, ALLOWED_ORIGINS="https://a.example/"
    )

    assert settings.allowed_origins == ["https://a.example"]


@pytest.mark.parametrize(
    "value",
    ["localhost:5173", "not-a-url", "https://a.example/path", "https://a.example?q=1"],
)
def test_a_malformed_origin_is_rejected_at_startup(value: str) -> None:
    """A typo must fail loudly rather than silently excluding a real origin."""
    with pytest.raises(ValueError, match="ALLOWED_ORIGINS"):
        Settings(DATABASE_URL=BASE_DATABASE_URL, ALLOWED_ORIGINS=value)


def test_wildcard_is_allowed_in_development() -> None:
    settings = Settings(
        DATABASE_URL=BASE_DATABASE_URL,
        ENVIRONMENT="development",
        ALLOWED_ORIGINS="*",
    )

    assert settings.has_wildcard_origin is True


def test_wildcard_is_impossible_in_production() -> None:
    """The service refuses to start rather than degrading quietly.

    A wildcard origin in production lets any website read this API through the
    visitor's browser. That is a configuration mistake, not a mode to support.
    """
    with pytest.raises(ValueError, match="must not contain"):
        Settings(
            DATABASE_URL=BASE_DATABASE_URL,
            ENVIRONMENT="production",
            ALLOWED_ORIGINS="*",
        )


def test_wildcard_is_rejected_in_staging_too() -> None:
    """Staging is not production, but it is not a development scratchpad either."""
    with pytest.raises(ValueError, match="must not contain"):
        Settings(
            DATABASE_URL=BASE_DATABASE_URL,
            ENVIRONMENT="staging",
            ALLOWED_ORIGINS="*",
        )


def test_production_accepts_an_explicit_list() -> None:
    settings = Settings(
        DATABASE_URL=BASE_DATABASE_URL,
        ENVIRONMENT="production",
        ALLOWED_ORIGINS=PRODUCTION_ORIGIN,
    )

    assert settings.allowed_origins == [PRODUCTION_ORIGIN]
    assert settings.is_production is True


def test_every_environment_is_configurable() -> None:
    """development, staging and production each accept their own list."""
    for environment, origin in (
        ("development", "http://localhost:5173"),
        ("staging", "https://staging.example"),
        ("production", PRODUCTION_ORIGIN),
    ):
        settings = Settings(
            DATABASE_URL=BASE_DATABASE_URL,
            ENVIRONMENT=environment,
            ALLOWED_ORIGINS=origin,
        )
        assert settings.allowed_origins == [origin]


# ---------------------------------------------------------------------------
# Allowed origins
# ---------------------------------------------------------------------------


async def test_allowed_development_origin_is_echoed_back() -> None:
    async with _client_for("http://localhost:5173", "development") as client:
        response = await client.get("/api/content", headers={"Origin": "http://localhost:5173"})

    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


async def test_allowed_production_origin_is_echoed_back() -> None:
    async with _client_for(PRODUCTION_ORIGIN, "production") as client:
        response = await client.get("/api/content", headers={"Origin": PRODUCTION_ORIGIN})

    assert response.headers["access-control-allow-origin"] == PRODUCTION_ORIGIN


async def test_unallowed_origin_receives_no_cors_grant() -> None:
    """No `Access-Control-Allow-Origin` means the browser blocks the read.

    The response is still served — CORS is a browser policy, and a non-browser
    client is unaffected — but the page cannot read it.
    """
    async with _client_for(PRODUCTION_ORIGIN, "production") as client:
        response = await client.get("/api/content", headers={"Origin": EVIL_ORIGIN})

    assert "access-control-allow-origin" not in response.headers
    assert "access-control-allow-credentials" not in response.headers


async def test_missing_origin_header_is_not_an_error() -> None:
    """A same-origin or non-browser request sends no `Origin` and must succeed."""
    async with _client_for(PRODUCTION_ORIGIN, "production") as client:
        response = await client.get("/api/content")

    assert response.status_code == 404  # empty database; the CORS layer did not interfere
    assert "access-control-allow-origin" not in response.headers


async def test_one_allowlisted_origin_does_not_admit_another() -> None:
    """Two origins in the list are two grants, not a prefix match."""
    async with _client_for("https://a.example,https://b.example", "production") as client:
        allowed = await client.get("/api/content", headers={"Origin": "https://a.example"})
        denied = await client.get("/api/content", headers={"Origin": "https://b.example"})
        lookalike = await client.get("/api/content", headers={"Origin": "https://a.example.evil"})

    assert allowed.headers["access-control-allow-origin"] == "https://a.example"
    assert denied.headers["access-control-allow-origin"] == "https://b.example"
    assert "access-control-allow-origin" not in lookalike.headers


# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------


async def test_preflight_from_an_allowed_origin_is_permitted() -> None:
    async with _client_for("http://localhost:5173", "development") as client:
        response = await client.options(
            "/api/content",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert response.headers["access-control-allow-methods"] == "GET"


async def test_preflight_from_an_unallowed_origin_is_refused() -> None:
    async with _client_for(PRODUCTION_ORIGIN, "production") as client:
        response = await client.options(
            "/api/content",
            headers={"Origin": EVIL_ORIGIN, "Access-Control-Request-Method": "GET"},
        )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


async def test_preflight_does_not_allow_a_write_method() -> None:
    """Only `GET` is permitted, so a cross-origin `POST` cannot preflight through.

    The content API is read-only; allowing `POST` in CORS would imply a write path
    that does not exist.
    """
    async with _client_for("http://localhost:5173", "development") as client:
        response = await client.options(
            "/api/content",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
            },
        )

    assert "POST" not in response.headers.get("access-control-allow-methods", "")


# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------


async def test_credentials_are_never_allowed() -> None:
    """The public content API takes no cookie, so no credentialed CORS.

    Enabling it would let a cookie-bearing cross-origin request read the API, and
    the admin session in Phase 4 has no reason to inherit that posture.
    """
    async with _client_for(PRODUCTION_ORIGIN, "production") as client:
        response = await client.get("/api/content", headers={"Origin": PRODUCTION_ORIGIN})

    assert "access-control-allow-credentials" not in response.headers


async def test_wildcard_origin_never_pairs_with_credentials() -> None:
    """`*` with credentials is rejected by browsers; the server must not offer it."""
    async with _client_for("*", "development") as client:
        response = await client.get("/api/content", headers={"Origin": "https://any.example"})

    assert "access-control-allow-credentials" not in response.headers


# ---------------------------------------------------------------------------
# Health endpoints
# ---------------------------------------------------------------------------


async def test_health_endpoints_do_not_need_cors() -> None:
    """A platform probe sends no `Origin`; it must never be CORS-gated."""
    async with _client_for(PRODUCTION_ORIGIN, "production") as client:
        health = await client.get("/health")
        ready = await client.get("/ready")

    assert health.status_code == 200
    assert ready.status_code in (200, 503)


async def test_etag_is_exposed_so_a_browser_can_read_it() -> None:
    """`ETag` is a response header, invisible to JS unless it is exposed."""
    async with _client_for(PRODUCTION_ORIGIN, "production") as client:
        response = await client.get("/api/content", headers={"Origin": PRODUCTION_ORIGIN})

    assert "etag" in response.headers["access-control-expose-headers"].lower()


# ---------------------------------------------------------------------------
# The live application
# ---------------------------------------------------------------------------


async def test_the_real_application_has_cors_middleware_configured() -> None:
    """The shipped app — not just the test helper — carries an allow-list."""
    from app.main import app as application

    middlewares = [
        getattr(m, "cls", None) for m in application.user_middleware  # type: ignore[union-attr]
    ]

    from fastapi.middleware.cors import CORSMiddleware

    assert CORSMiddleware in middlewares


def test_the_real_application_does_not_use_a_wildcard() -> None:
    settings = get_settings()

    assert settings.has_wildcard_origin is False
    assert "*" not in settings.allowed_origins


async def test_the_real_application_serves_content_with_cors_headers(client: AsyncClient) -> None:
    """End to end through the actual app object, using its configured origins."""
    origin = get_settings().allowed_origins[0]

    response = await client.get("/api/content", headers={"Origin": origin})

    assert response.headers["access-control-allow-origin"] == origin