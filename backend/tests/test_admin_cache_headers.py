"""Admin responses must never be cached, and must not be indexed.

`SECURITY.md` §2.2: admin responses carry `Cache-Control: no-store` and
`X-Robots-Tag: noindex`, on success and on error alike. `app/main.py` adds them
to every `/api/admin` response; `app/errors.py` adds them to the admin error
payloads that the exception handlers build. This file pins both, and pins the
path boundary so the middleware cannot leak the headers onto public routes.
"""

from __future__ import annotations

from httpx import AsyncClient, Headers
from support_admin import ADMIN_EMAIL, ADMIN_PASSWORD

from app.main import _is_admin_request_path

NO_STORE = {"cache-control": "no-store", "x-robots-tag": "noindex"}


def _assert_no_store(headers: Headers) -> None:
    for name, value in NO_STORE.items():
        assert headers.get(name) == value, f"{name} missing from {dict(headers)}"


async def test_a_successful_admin_response_is_no_store(
    client: AsyncClient, admin_user: object
) -> None:
    login = await client.post(
        "/api/admin/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    assert login.status_code == 200, login.text

    response = await client.get("/api/admin/me")
    assert response.status_code == 200
    _assert_no_store(response.headers)


async def test_an_admin_error_response_is_no_store(client: AsyncClient) -> None:
    response = await client.get("/api/admin/projects")
    assert response.status_code == 401
    _assert_no_store(response.headers)


def test_the_admin_path_predicate_draws_the_boundary() -> None:
    assert _is_admin_request_path("/api/admin")
    assert _is_admin_request_path("/api/admin/")
    assert _is_admin_request_path("/api/admin/projects")

    assert not _is_admin_request_path("/api/administrate")
    assert not _is_admin_request_path("/api/contact")
    assert not _is_admin_request_path("/api/content")
    assert not _is_admin_request_path("/")
