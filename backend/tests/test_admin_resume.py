"""`POST /api/admin/profile/resume` and public `GET /api/resume` (Phase 11).

Two layers, deliberately:

* `identify_pdf` is pure, so the signature gate is exercised directly.
* Both routes run end to end against the real schema, with only the S3 round-trips
  stubbed. The session/CSRF dependencies, the size and format gates, the
  transaction that swaps the profile pointer, the audit row and the public route's
  cache behaviour all run for real, as `TESTING.md` §7.2 requires.

The stub is an in-memory bucket rather than a per-call fake, so a test can upload
through the admin route and then download the exact bytes through `GET /api/resume`
— the whole point of a private bucket being reachable only through the API.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine
from support_admin import ADMIN_EMAIL, ADMIN_PASSWORD, audit_rows, session_factory

from app.errors import INTERNAL, APIError
from app.models import AdminUser, SiteProfile
from app.routes import admin_content as admin_routes
from app.routes import resume as resume_routes
from app.services import storage

CSRF_HEADER = "X-CSRF-Token"

PDF_BYTES = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"


@pytest_asyncio.fixture(autouse=True)
async def _ensure_admin(admin_user: AdminUser) -> AdminUser:
    """Every test that reaches the admin API needs an admin; make one automatic."""
    return admin_user


async def _seed_profile(engine: AsyncEngine, **changes: object) -> str:
    """Insert the singleton profile, which the upload mutates."""
    values: dict[str, object] = {
        "name": "Ritu Raj",
        "title": "Full Stack Developer",
        "resume": "/Ritu_Raj_Full_Stack_Developer_Resume.pdf",
        **changes,
    }
    factory = session_factory(engine)
    async with factory() as session:
        row = SiteProfile(**values)
        session.add(row)
        await session.commit()
        return str(row.id)


async def _login(client: AsyncClient) -> None:
    response = await client.post(
        "/api/admin/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    assert response.status_code == 200, response.text


async def _csrf(client: AsyncClient) -> str:
    response = await client.get("/api/admin/me")
    assert response.status_code == 200, response.text
    return response.json()["csrf_token"]


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    await _login(client)
    return {CSRF_HEADER: await _csrf(client)}


class _Settings:
    """Just the two attributes the resume upload route reads."""

    def __init__(self, configured: bool = True, max_bytes: int = 10_000_000) -> None:
        self.object_storage_configured = configured
        self.S3_RESUME_MAX_BYTES = max_bytes


@pytest.fixture
def fake_bucket(monkeypatch: pytest.MonkeyPatch) -> dict[str, bytes]:
    """An in-memory private bucket standing in for the S3 round-trips.

    Only the network seam is replaced: `identify_pdf` runs for real inside
    `fake_store`, so the signature gate the route depends on is never stubbed out.
    """
    objects: dict[str, bytes] = {}
    counter = [0]

    async def fake_store(data: bytes) -> storage.StoredResume:
        storage.identify_pdf(data)
        key = f"resumes/{counter[0]}.pdf"
        counter[0] += 1
        objects[key] = data
        return storage.StoredResume(key=key, content_type="application/pdf", size=len(data))

    async def fake_read(key: str) -> bytes:
        if key not in objects:
            raise storage.ResumeNotFound(key)
        return objects[key]

    async def fake_delete(key: str) -> None:
        objects.pop(key, None)

    monkeypatch.setattr(storage, "store_resume", fake_store)
    monkeypatch.setattr(storage, "read_resume", fake_read)
    monkeypatch.setattr(storage, "delete_resume", fake_delete)
    monkeypatch.setattr(admin_routes, "get_settings", lambda: _Settings())
    return objects


# --------------------------------------------------------------------------
# Pure signature gate
# --------------------------------------------------------------------------


def test_identify_pdf_accepts_a_pdf_signature():
    storage.identify_pdf(b"%PDF-1.4\n...")
    storage.identify_pdf(PDF_BYTES)


def test_identify_pdf_rejects_everything_else():
    for data in (b"", b"not a pdf", b"%PD", b"\x89PNG\r\n\x1a\n"):
        with pytest.raises(storage.UnsupportedResume):
            storage.identify_pdf(data)


# --------------------------------------------------------------------------
# Upload
# --------------------------------------------------------------------------


async def test_upload_points_the_profile_at_the_public_route(
    client: AsyncClient, engine: AsyncEngine, fake_bucket: dict[str, bytes]
) -> None:
    profile_id = await _seed_profile(engine)
    headers = await _auth_headers(client)

    response = await client.post(
        "/api/admin/profile/resume",
        files={"file": ("cv.pdf", PDF_BYTES, "application/pdf")},
        headers=headers,
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["resume"] == "/api/resume"
    assert body["key"] == "resumes/0.pdf"
    assert body["audit_id"]

    # The profile row is the thing that changed; read it back through the admin API.
    fetched = await client.get("/api/admin/profile")
    assert fetched.status_code == 200, fetched.text
    profile = fetched.json()
    assert profile["id"] == profile_id
    assert profile["resume"] == "/api/resume"
    assert profile["resume_key"] == "resumes/0.pdf"


async def test_upload_writes_one_site_profile_audit_row(
    client: AsyncClient, engine: AsyncEngine, fake_bucket: dict[str, bytes]
) -> None:
    await _seed_profile(engine)
    headers = await _auth_headers(client)

    response = await client.post(
        "/api/admin/profile/resume",
        files={"file": ("cv.pdf", PDF_BYTES, "application/pdf")},
        headers=headers,
    )
    assert response.status_code == 201, response.text

    rows = [row for row in await audit_rows(engine, action="update") if row.entity == "site_profile"]
    assert len(rows) == 1
    row = rows[0]
    assert row.before["resume_key"] is None
    assert row.before["resume"] == "/Ritu_Raj_Full_Stack_Developer_Resume.pdf"
    assert row.after["resume"] == "/api/resume"
    assert row.after["resume_key"] == "resumes/0.pdf"


async def test_upload_replaces_and_cleans_up_the_previous_object(
    client: AsyncClient, engine: AsyncEngine, fake_bucket: dict[str, bytes]
) -> None:
    await _seed_profile(engine, resume="/api/resume", resume_key="resumes/old.pdf")
    fake_bucket["resumes/old.pdf"] = b"%PDF-1.4\nold\n"
    headers = await _auth_headers(client)

    response = await client.post(
        "/api/admin/profile/resume",
        files={"file": ("cv.pdf", PDF_BYTES, "application/pdf")},
        headers=headers,
    )
    assert response.status_code == 201, response.text

    # The new object is live and the object it superseded is gone.
    assert response.json()["key"] == "resumes/0.pdf"
    assert "resumes/old.pdf" not in fake_bucket
    assert fake_bucket["resumes/0.pdf"] == PDF_BYTES


async def test_upload_keeps_the_previous_resume_when_the_profile_is_missing(
    client: AsyncClient, engine: AsyncEngine, fake_bucket: dict[str, bytes]
) -> None:
    # No profile row: the swap cannot commit. The freshly stored object must be
    # cleaned up and nothing becomes the active resume.
    headers = await _auth_headers(client)

    response = await client.post(
        "/api/admin/profile/resume",
        files={"file": ("cv.pdf", PDF_BYTES, "application/pdf")},
        headers=headers,
    )

    assert response.status_code == 404, response.text
    assert fake_bucket == {}


async def test_upload_rejects_a_non_pdf_declared_type(
    client: AsyncClient, engine: AsyncEngine, fake_bucket: dict[str, bytes]
) -> None:
    await _seed_profile(engine)
    headers = await _auth_headers(client)

    response = await client.post(
        "/api/admin/profile/resume",
        files={"file": ("cv.txt", PDF_BYTES, "text/plain")},
        headers=headers,
    )

    assert response.status_code == 422, response.text
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert error["fields"][0]["field"] == "file"
    assert fake_bucket == {}


async def test_upload_rejects_bytes_without_the_pdf_signature(
    client: AsyncClient, engine: AsyncEngine, fake_bucket: dict[str, bytes]
) -> None:
    await _seed_profile(engine)
    headers = await _auth_headers(client)

    response = await client.post(
        "/api/admin/profile/resume",
        files={"file": ("cv.pdf", b"this is not a pdf", "application/pdf")},
        headers=headers,
    )

    assert response.status_code == 422, response.text
    assert "Only PDF documents" in response.json()["error"]["fields"][0]["message"]
    assert fake_bucket == {}


async def test_upload_rejects_an_empty_file(
    client: AsyncClient, engine: AsyncEngine, fake_bucket: dict[str, bytes]
) -> None:
    await _seed_profile(engine)
    headers = await _auth_headers(client)

    response = await client.post(
        "/api/admin/profile/resume",
        files={"file": ("cv.pdf", b"", "application/pdf")},
        headers=headers,
    )

    assert response.status_code == 422, response.text
    assert fake_bucket == {}


async def test_upload_rejects_a_body_over_the_cap(
    client: AsyncClient, engine: AsyncEngine, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _seed_profile(engine)
    monkeypatch.setattr(admin_routes, "get_settings", lambda: _Settings(max_bytes=16))
    headers = await _auth_headers(client)

    response = await client.post(
        "/api/admin/profile/resume",
        files={"file": ("cv.pdf", PDF_BYTES, "application/pdf")},
        headers=headers,
    )

    assert response.status_code == 422, response.text
    assert "at most 16 bytes" in response.json()["error"]["fields"][0]["message"]


async def test_upload_reports_503_when_storage_is_unconfigured(
    client: AsyncClient, engine: AsyncEngine, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _seed_profile(engine)
    monkeypatch.setattr(admin_routes, "get_settings", lambda: _Settings(configured=False))
    headers = await _auth_headers(client)

    response = await client.post(
        "/api/admin/profile/resume",
        files={"file": ("cv.pdf", PDF_BYTES, "application/pdf")},
        headers=headers,
    )

    assert response.status_code == 503, response.text
    assert response.json()["error"]["code"] == "INTERNAL"


async def test_upload_storage_failure_leaves_the_profile_unchanged(
    client: AsyncClient,
    engine: AsyncEngine,
    fake_bucket: dict[str, bytes],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Storage accepts configuration but the round-trip fails. The object never
    # lands, so `set_resume` is never reached: the existing resume (profile field
    # *and* object) must survive untouched.
    await _seed_profile(engine, resume="/api/resume", resume_key="resumes/old.pdf")
    fake_bucket["resumes/old.pdf"] = PDF_BYTES
    headers = await _auth_headers(client)

    async def failing_store(_data: bytes) -> storage.StoredResume:
        raise APIError(503, INTERNAL, "storage down")

    monkeypatch.setattr(storage, "store_resume", failing_store)

    response = await client.post(
        "/api/admin/profile/resume",
        files={"file": ("cv.pdf", PDF_BYTES, "application/pdf")},
        headers=headers,
    )

    assert response.status_code == 503, response.text
    profile = (await client.get("/api/admin/profile")).json()
    assert profile["resume"] == "/api/resume"
    assert profile["resume_key"] == "resumes/old.pdf"
    assert fake_bucket["resumes/old.pdf"] == PDF_BYTES


async def test_upload_generates_the_key_on_the_server(
    client: AsyncClient, engine: AsyncEngine, fake_bucket: dict[str, bytes]
) -> None:
    # A client-supplied filename is never used as the object key: a traversal
    # attempt cannot escape the `resumes/` prefix (or reach another object).
    await _seed_profile(engine)
    headers = await _auth_headers(client)

    response = await client.post(
        "/api/admin/profile/resume",
        files={"file": ("../../evil.pdf", PDF_BYTES, "application/pdf")},
        headers=headers,
    )

    assert response.status_code == 201, response.text
    key = response.json()["key"]
    assert key.startswith("resumes/")
    assert ".." not in key and "evil" not in key
    assert list(fake_bucket) == [key]


async def test_upload_rejects_a_request_without_a_file(
    client: AsyncClient, engine: AsyncEngine, fake_bucket: dict[str, bytes]
) -> None:
    # Malformed multipart: the required `file` part is missing entirely.
    await _seed_profile(engine)
    headers = await _auth_headers(client)

    response = await client.post("/api/admin/profile/resume", headers=headers)

    assert response.status_code == 422, response.text
    assert fake_bucket == {}


async def test_upload_requires_a_session(client: AsyncClient) -> None:
    response = await client.post(
        "/api/admin/profile/resume",
        files={"file": ("cv.pdf", PDF_BYTES, "application/pdf")},
    )
    assert response.status_code == 401, response.text


async def test_upload_requires_csrf(
    client: AsyncClient, engine: AsyncEngine, fake_bucket: dict[str, bytes]
) -> None:
    await _seed_profile(engine)
    await _login(client)
    response = await client.post(
        "/api/admin/profile/resume",
        files={"file": ("cv.pdf", PDF_BYTES, "application/pdf")},
    )
    assert response.status_code == 403, response.text


# --------------------------------------------------------------------------
# Download
# --------------------------------------------------------------------------


async def test_download_serves_the_uploaded_bytes(
    client: AsyncClient, engine: AsyncEngine, fake_bucket: dict[str, bytes]
) -> None:
    await _seed_profile(engine)
    headers = await _auth_headers(client)
    uploaded = await client.post(
        "/api/admin/profile/resume",
        files={"file": ("cv.pdf", PDF_BYTES, "application/pdf")},
        headers=headers,
    )
    assert uploaded.status_code == 201, uploaded.text

    # A fresh, unauthenticated client reads it: the route is public and the bucket
    # is only reachable through it.
    response = await client.get("/api/resume")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["content-disposition"] == 'inline; filename="resume.pdf"'
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["etag"] == f'"{uploaded.json()["key"]}"'
    assert response.content == PDF_BYTES


async def test_download_ignores_requester_supplied_object_keys(
    client: AsyncClient, engine: AsyncEngine, fake_bucket: dict[str, bytes]
) -> None:
    # The route resolves the key from `site_profile.resume_key` only. Query
    # parameters that look like an object key or a URL are inert: the requester
    # cannot redirect the read at another object (SSRF / unauthorized access).
    await _seed_profile(engine, resume="/api/resume", resume_key="resumes/active.pdf")
    fake_bucket["resumes/active.pdf"] = PDF_BYTES
    fake_bucket["resumes/other.pdf"] = b"%PDF-1.7\nother document\n%%EOF\n"

    response = await client.get(
        "/api/resume",
        params={"key": "resumes/other.pdf", "url": "http://169.254.169.254/latest/meta-data"},
    )

    assert response.status_code == 200, response.text
    assert response.content == PDF_BYTES
    assert response.headers["etag"] == '"resumes/active.pdf"'


async def test_download_picks_up_a_replacement(
    client: AsyncClient, engine: AsyncEngine, fake_bucket: dict[str, bytes]
) -> None:
    await _seed_profile(engine)
    headers = await _auth_headers(client)
    await client.post(
        "/api/admin/profile/resume",
        files={"file": ("cv.pdf", PDF_BYTES, "application/pdf")},
        headers=headers,
    )
    second = b"%PDF-1.7\nsecond resume\n%%EOF\n"
    await client.post(
        "/api/admin/profile/resume",
        files={"file": ("cv.pdf", second, "application/pdf")},
        headers=headers,
    )

    response = await client.get("/api/resume")
    assert response.status_code == 200
    assert response.content == second
    assert "resumes/0.pdf" not in fake_bucket  # superseded object cleaned up


async def test_download_returns_304_when_the_client_holds_the_object(
    client: AsyncClient, engine: AsyncEngine, fake_bucket: dict[str, bytes]
) -> None:
    await _seed_profile(engine, resume="/api/resume", resume_key="resumes/abc.pdf")
    fake_bucket["resumes/abc.pdf"] = PDF_BYTES

    first = await client.get("/api/resume")
    assert first.status_code == 200
    etag = first.headers["etag"]

    second = await client.get("/api/resume", headers={"If-None-Match": etag})
    assert second.status_code == 304
    assert second.content == b""


async def test_download_is_404_when_the_profile_has_no_uploaded_resume(
    client: AsyncClient, engine: AsyncEngine, fake_bucket: dict[str, bytes]
) -> None:
    await _seed_profile(engine, resume="/api/resume", resume_key=None)

    response = await client.get("/api/resume")

    assert response.status_code == 404, response.text
    assert response.json() == {"detail": "Resume not found."}


async def test_download_is_404_before_any_profile_exists(
    client: AsyncClient, engine: AsyncEngine, fake_bucket: dict[str, bytes]
) -> None:
    response = await client.get("/api/resume")
    assert response.status_code == 404, response.text


async def test_download_is_404_when_the_object_is_gone(
    client: AsyncClient, engine: AsyncEngine, fake_bucket: dict[str, bytes]
) -> None:
    # A stale key: the profile references an object the bucket no longer has.
    await _seed_profile(engine, resume="/api/resume", resume_key="resumes/missing.pdf")

    response = await client.get("/api/resume")

    assert response.status_code == 404, response.text
    assert response.json() == {"detail": "Resume not found."}


async def test_download_is_503_when_storage_is_unreachable(
    client: AsyncClient, engine: AsyncEngine, fake_bucket: dict[str, bytes], monkeypatch: pytest.MonkeyPatch
) -> None:
    await _seed_profile(engine, resume="/api/resume", resume_key="resumes/abc.pdf")

    async def failing_read(key: str) -> bytes:
        raise APIError(503, INTERNAL, "storage down")

    monkeypatch.setattr(storage, "read_resume", failing_read)

    response = await client.get("/api/resume")

    assert response.status_code == 503, response.text
    # The public route keeps the bare body, never the admin envelope.
    assert response.json() == {"detail": "The resume is temporarily unavailable."}


async def test_download_is_rate_limited(
    client: AsyncClient, engine: AsyncEngine, fake_bucket: dict[str, bytes], monkeypatch: pytest.MonkeyPatch
) -> None:
    await _seed_profile(engine, resume="/api/resume", resume_key="resumes/abc.pdf")
    fake_bucket["resumes/abc.pdf"] = PDF_BYTES
    monkeypatch.setattr(
        resume_routes, "limiter", resume_routes.FixedWindowLimiter(limit=1, window_seconds=60)
    )

    first = await client.get("/api/resume")
    assert first.status_code == 200

    second = await client.get("/api/resume")
    assert second.status_code == 429, second.text
    assert second.headers["retry-after"]
    assert second.json() == {"detail": "Too many requests. Please try again shortly."}
