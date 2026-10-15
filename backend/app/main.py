"""FastAPI application.

Phase 3 scope: liveness, readiness, the database layer and the single public
content endpoint. Phase 4 adds the three admin authentication routes
(`API.md` §6.1) and the admin error envelope (§7.2). Phase 8 adds the public
contact write path and GitHub proxy (`API.md` §2.2–§2.3), which owned the two
endpoints `ai_service` used to serve.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import Settings, get_settings
from app.db.session import dispose_engine, engine_target
from app.errors import (
    ADMIN_PATH_PREFIX,
    INTERNAL,
    NO_STORE_HEADERS,
    NOT_FOUND,
    admin_error_response,
    is_admin_path,
    register_admin_error_handlers,
)
from app.logging import configure_logging, log_event
from app.routes import (
    admin_auth,
    admin_bootstrap,
    admin_content,
    contact,
    github,
    health,
    resume,
)
from app.routes import content as content_routes

logger = logging.getLogger("app")

# Deliberately generic. Diagnostics belong in the log, not in a response body
# (`SECURITY.md` §2.9: no stack traces, SQL, file paths or hostnames).
_GENERIC_INTERNAL_ERROR = "Internal server error."
_GENERIC_NOT_FOUND = "Not found."


def _publish_configuration(settings: Settings) -> dict[str, bool]:
    """Startup snapshot of the publish integration, flags only.

    Only booleans are included. The deploy-hook URL and the AI admin token are
    capability tokens; their presence, not their value, is what an operator needs
    at startup, and nothing here ever prints either.
    """
    return {
        "rebuild_configured": settings.rebuild_configured,
        "reingest_configured": settings.reingest_configured,
    }


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    log_event(
        logger,
        logging.INFO,
        "startup",
        environment=get_settings().ENVIRONMENT,
        database=engine_target(),
    )
    log_event(
        logger,
        logging.INFO,
        "publish_configuration",
        **_publish_configuration(get_settings()),
    )
    try:
        yield
    finally:
        await dispose_engine()
        log_event(logger, logging.INFO, "shutdown")


def _register_cors(application: FastAPI, settings: Settings) -> None:
    """Attach the explicit origin allow-list.

    Three deliberate choices, each from a locked document rather than from habit:

    * **Explicit list, never reflection.** The allow-list comes from
      `ALLOWED_ORIGINS` and nothing reads the request's `Origin` header to decide
      what to allow. Echoing an arbitrary origin back would make this endpoint
      readable from any site, which is the failure mode an allow-list exists to
      prevent.
    * **`allow_credentials=False`.** The public content API takes no cookie and no
      credential; the only caller sending one will be the admin session in Phase 4,
      and enabling credentials now would grant cookie-bearing cross-origin reads
      that nothing needs.
    * **Narrow methods and headers.** `API.md` §8 notes that `["*"]` for both is
      broader than necessary. The content endpoint is a `GET` and needs no custom
      request headers, so it gets `GET` and an empty header list.
    """
    if settings.has_wildcard_origin:
        # Reachable only outside production: `Settings` refuses to construct in
        # production, so this branch is the development convenience `SECURITY.md`
        # §2.3 describes.
        log_event(
            logger,
            logging.WARNING,
            "cors_wildcard_origin",
            detail=(
                "ALLOWED_ORIGINS contains '*'. Every origin may read this API. "
                "Never set this when ENVIRONMENT=production."
            ),
        )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=[],
        # `ETag` is a response header, so a browser can only read it if it is
        # exposed explicitly.
        expose_headers=["ETag"],
        max_age=600,
    )


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.LOG_LEVEL)

    application = FastAPI(
        title="Portfolio API",
        version="0.2.0",
        lifespan=lifespan,
    )
    application.include_router(health.router)
    application.include_router(content_routes.router)
    application.include_router(resume.router)
    application.include_router(contact.router)
    application.include_router(github.router)
    application.include_router(admin_auth.router)
    application.include_router(admin_bootstrap.router)
    application.include_router(admin_content.router)
    _register_cors(application, settings)
    _register_admin_cache_headers(application)
    _register_exception_handlers(application)
    return application


def _is_admin_request_path(path: str) -> bool:
    """Whether `path` is an admin API route, with or without the trailing slash."""
    return path == ADMIN_PATH_PREFIX.rstrip("/") or path.startswith(ADMIN_PATH_PREFIX)


def _register_admin_cache_headers(application: FastAPI) -> None:
    """Mark every `/api/admin/*` response `no-store` and `noindex`.

    `API.md` §7.2 and `SECURITY.md` §3.3: admin responses carry scoped data and a
    session cookie and must not be cached by a browser or intermediary, nor
    indexed. `vercel.json` already covers the admin *HTML*; this covers the admin
    *JSON API*, including authenticated reads, every error envelope and the login
    response that sets the cookie.

    A middleware rather than a per-route dependency so a new admin route cannot
    forget it: the prefix is the contract, not each handler. Error envelopes are
    also stamped in `admin_error_response`, because an unhandled exception is
    rendered by `ServerErrorMiddleware` outside this layer.
    """

    @application.middleware("http")
    async def admin_no_store(request: Request, call_next):  # type: ignore[no-untyped-def]
        response = await call_next(request)
        if _is_admin_request_path(request.url.path):
            response.headers.update(NO_STORE_HEADERS)
        return response


def _register_exception_handlers(application: FastAPI) -> None:
    register_admin_error_handlers(application)

    @application.exception_handler(Exception)
    async def unhandled_exception(request: Request, exc: Exception) -> JSONResponse:
        """Log the cause with a request id; return nothing that identifies it.

        The admin branch lets `admin_error_response` own the logging, so exactly
        one log event carries the `request_id` that the response quotes. Logging
        here *and* there would produce two ids and make the correlation §7.2
        promises useless.
        """
        if is_admin_path(request.url.path):
            return admin_error_response(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                code=INTERNAL,
                message=_GENERIC_INTERNAL_ERROR,
                event="request_failed",
                log_fields={
                    "method": request.method,
                    "path": request.url.path,
                    "error": type(exc).__name__,
                    "exception": str(exc),
                },
            )

        request_id = uuid.uuid4().hex
        log_event(
            logger,
            logging.ERROR,
            "request_failed",
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            error=type(exc).__name__,
            exception=str(exc),
        )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": _GENERIC_INTERNAL_ERROR},
        )

    @application.exception_handler(404)
    async def not_found(request: Request, _exc: Exception) -> JSONResponse:
        """A 404 must not enumerate the available routes.

        §7.2 asks for the enriched envelope on admin paths — including an unknown
        one, so a typo in an admin URL looks like every other admin error to a
        client — while public paths keep the bare body Phase 3 established.
        """
        log_event(
            logger,
            logging.INFO,
            "route_not_found",
            method=request.method,
            path=request.url.path,
        )
        if is_admin_path(request.url.path):
            return admin_error_response(
                status_code=status.HTTP_404_NOT_FOUND,
                code=NOT_FOUND,
                message=_GENERIC_NOT_FOUND,
                event="admin_route_not_found",
                log_fields={"method": request.method, "path": request.url.path},
            )
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content={"detail": _GENERIC_NOT_FOUND},
        )


app = create_app()