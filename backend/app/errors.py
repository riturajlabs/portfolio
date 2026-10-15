"""The admin error envelope.

`API.md` §7.2 defines the response shape every admin endpoint uses:

    {"error": {"code": "...", "message": "...", "fields": [...], "request_id": "..."}}

with a fixed code list. Public endpoints keep their bare `{"detail": "..."}`
bodies, because the existing frontend already parses that shape and §7.2 says so
explicitly. This module is what makes that split real: the helpers here only ever
touch `/api/admin/*`, so nothing in the Phase 3 public contract can change.

Every envelope carries a `request_id` that is also written to the log with the
event that produced it. That correlation is the point of the field: a user
reporting a failed mutation gives an id, and the operator can grep the exact
event instead of guessing from a timestamp.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from fastapi import FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response

logger = logging.getLogger("app.admin")

ADMIN_PATH_PREFIX = "/api/admin/"

# §7.2's envelope is sensitive: it can name a resource, a field or a session that
# should never sit in a shared cache, and an admin URL should never be indexed.
# Applied to every admin response — success and failure — so a stray cacheable
# 200 cannot leak one.
NO_STORE_HEADERS: dict[str, str] = {
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex",
}

# `API.md` §7.2's code list. Declared here rather than at each raise site so the
# status/code pairing cannot drift: `UNAUTHENTICATED` is 401, `FORBIDDEN` is 403,
# and nothing is free to invent a code outside the documented vocabulary.
VALIDATION_ERROR = "VALIDATION_ERROR"
UNAUTHENTICATED = "UNAUTHENTICATED"
FORBIDDEN = "FORBIDDEN"
NOT_FOUND = "NOT_FOUND"
RATE_LIMITED = "RATE_LIMITED"
INTERNAL = "INTERNAL"

ADMIN_NOT_AUTHENTICATED = "Authentication required."

# Deliberately vague, and identical to `ADMIN_NOT_AUTHENTICATED`: naming the
# failure (no such user / wrong password / account disabled) in the message would
# let a caller enumerate the administrator's email address.
INVALID_CREDENTIALS = ADMIN_NOT_AUTHENTICATED

# §4.2: a missing or wrong CSRF token is 403, not 401. The caller is
# authenticated; it is the request that is not permitted.
INVALID_CSRF_TOKEN = "CSRF token missing or invalid."

TOO_MANY_ATTEMPTS = "Too many requests. Please try again shortly."


@dataclass(frozen=True, slots=True)
class ErrorField:
    """One field-level validation problem, as §7.2 renders it."""

    field: str
    message: str

    def as_dict(self) -> dict[str, str]:
        return {"field": self.field, "message": self.message}


@dataclass(slots=True)
class APIError(Exception):
    """An error that is safe to render to an admin client.

    Raised from dependencies and routes; converted to a response by
    `register_admin_error_handlers`. Raising rather than returning a
    `JSONResponse` keeps the failure on the normal control-flow path, so a route
    cannot accidentally carry on after sending an error.

    Deliberately not `frozen=True`. Combined with `slots=True` the dataclass
    decorator rebuilds the class, and the `__setattr__` it generates for a frozen
    instance then refers to the *original* class — so any attribute assignment
    raises `super(type, obj): obj must be an instance or subtype of type`.
    Assigning `exc.__traceback__` during traceback propagation does exactly that,
    which turned every rejected request into a 500. Nothing mutates this object, so
    immutability bought nothing.
    """

    status_code: int
    code: str
    message: str
    fields: Sequence[ErrorField] = ()
    event: str = "admin_request_rejected"
    log_fields: Mapping[str, object] = field(default_factory=dict)
    headers: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        # Set `args` so `str(exc)` is the message. A dataclass-generated `__init__`
        # never calls `Exception.__init__`, which would otherwise leave an exception
        # with an empty `str()` in every log line.
        Exception.__init__(self, self.message)

    @classmethod
    def unauthenticated(cls, message: str = ADMIN_NOT_AUTHENTICATED, **kwargs: object) -> APIError:
        return cls(401, UNAUTHENTICATED, message, **kwargs)

    @classmethod
    def forbidden(cls, message: str = INVALID_CSRF_TOKEN, **kwargs: object) -> APIError:
        return cls(403, FORBIDDEN, message, **kwargs)

    @classmethod
    def rate_limited(cls, retry_after: int, **kwargs: object) -> APIError:
        """A 429. `Retry-After` is required on every rate-limited response."""
        return cls(429, RATE_LIMITED, TOO_MANY_ATTEMPTS, headers={"Retry-After": str(retry_after)}, **kwargs)


def new_request_id() -> str:
    """Return an opaque id tying one response to one log event."""
    return uuid.uuid4().hex


def is_admin_path(path: str) -> bool:
    """Whether `path` is an admin route, i.e. uses the enriched envelope."""
    return path.startswith(ADMIN_PATH_PREFIX)


def _field_name(location: tuple[object, ...]) -> str:
    """Name a validation failure the way the client addressed it.

    §7.2 renders `{"field": "image_width", ...}` — the field as it appears in the
    request, not FastAPI's internal `("body", "image_width")` path. A `body`
    prefix is dropped for that reason; a `query` or `path` prefix is kept, because
    there the location genuinely tells the caller where to look.
    """
    parts = [str(part) for part in location]
    if parts and parts[0] == "body":
        parts = parts[1:]
    return ".".join(parts) or "body"


def error_payload(
    code: str,
    message: str,
    request_id: str,
    fields: Sequence[ErrorField] = (),
) -> dict[str, object]:
    """Render the §7.2 envelope. `fields` is omitted when there are none."""
    error: dict[str, object] = {"code": code, "message": message, "request_id": request_id}
    if fields:
        error["fields"] = [item.as_dict() for item in fields]
    return {"error": error}


def admin_error_response(
    *,
    status_code: int,
    code: str,
    message: str,
    event: str,
    fields: Sequence[ErrorField] = (),
    log_fields: Mapping[str, object] | None = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    """Log an admin rejection with its `request_id`, then return the envelope.

    The log goes out before the response is built, so an id quoted in a user's
    report is already in the log even if serialisation then fails.
    """
    request_id = new_request_id()
    logger.warning(
        event,
        extra={
            "event": event,
            "request_id": request_id,
            "status_code": status_code,
            "error_code": code,
            **dict(log_fields or {}),
        },
    )
    # The no-store headers are merged here as well as in the admin middleware:
    # an unhandled exception is rendered by `ServerErrorMiddleware`, which sits
    # *outside* the middleware, so this is the only place that reaches it.
    response_headers = {**dict(headers or {}), **NO_STORE_HEADERS}
    return JSONResponse(
        status_code=status_code,
        content=error_payload(code, message, request_id, fields),
        headers=response_headers,
    )


def register_admin_error_handlers(application: FastAPI) -> None:
    """Attach the admin envelope handlers to `application`."""

    @application.exception_handler(APIError)
    async def api_error(_request: Request, exc: APIError) -> JSONResponse:
        return admin_error_response(
            status_code=exc.status_code,
            code=exc.code,
            message=exc.message,
            event=exc.event,
            fields=exc.fields,
            log_fields=exc.log_fields,
            headers=exc.headers,
        )

    @application.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> Response:
        """Render a body/query validation failure as §7.2's `VALIDATION_ERROR`.

        Admin paths get the enriched envelope. Every other path is handed back to
        FastAPI's own handler, so the Phase 3 public contract — including its
        `[{loc, msg, type}]` 422 shape — is untouched.
        """
        if not is_admin_path(request.url.path):
            return await request_validation_exception_handler(request, exc)
        return admin_error_response(
            status_code=422,
            code=VALIDATION_ERROR,
            message="Request validation failed.",
            event="admin_validation_failed",
            fields=[
                ErrorField(field=_field_name(item["loc"]), message=item["msg"])
                for item in exc.errors()
            ],
        )