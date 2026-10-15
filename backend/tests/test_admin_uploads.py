"""`POST /api/admin/uploads` and the object-storage image contract (Phase 10).

Two layers, deliberately:

* `identify_image` is pure, so the four supported formats are exercised directly
  with hand-built headers. No network and no fake is involved in the measurement
  the build depends on.
* The route is exercised end to end against the real schema, with only the S3
  call stubbed (`app.services.storage.store_project_image`). Everything else —
  the session/CSRF dependencies, the audit row, the size and format gates — runs
  for real, exactly as `TESTING.md` §7.2 requires.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine
from support_admin import ADMIN_EMAIL, ADMIN_PASSWORD, audit_rows

from app.models import AdminUser
from app.services import storage

CSRF_HEADER = "X-CSRF-Token"


@pytest_asyncio.fixture(autouse=True)
async def _ensure_admin(admin_user: AdminUser) -> AdminUser:
    """Every test here reaches the admin API, so every test needs an admin.

    `test_admin_content.py` makes the same fixture automatic for the same reason.
    """
    return admin_user


# --------------------------------------------------------------------------
# Minimal image bytes, enough for the header sniff
# --------------------------------------------------------------------------


def _png(width: int, height: int) -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n"
        + b"\x00\x00\x00\x0d"
        + b"IHDR"
        + width.to_bytes(4, "big")
        + height.to_bytes(4, "big")
        + b"\x08\x02\x00\x00\x00"
    )


def _jpeg(width: int, height: int) -> bytes:
    return (
        b"\xff\xd8"
        + b"\xff\xc0"
        + b"\x00\x11"
        + b"\x08"
        + height.to_bytes(2, "big")
        + width.to_bytes(2, "big")
        + b"\x03"
        + b"\x00" * 9
    )


def _webp_vp8l(width: int, height: int) -> bytes:
    bits = (width - 1) | ((height - 1) << 14)
    return (
        b"RIFF"
        + b"\x00\x00\x00\x00"
        + b"WEBP"
        + b"VP8L"
        + b"\x00\x00\x00\x00"
        + b"\x2f"
        + bits.to_bytes(4, "little")
    )


def _gif(width: int, height: int) -> bytes:
    return b"GIF89a" + width.to_bytes(2, "little") + height.to_bytes(2, "little") + b"\x00\x00\x00"


def test_identify_image_reads_each_supported_format():
    assert storage.identify_image(_png(800, 600)) == ("image/png", "png", 800, 600)
    assert storage.identify_image(_jpeg(1200, 750)) == ("image/jpeg", "jpg", 1200, 750)
    assert storage.identify_image(_webp_vp8l(1200, 750)) == ("image/webp", "webp", 1200, 750)
    assert storage.identify_image(_gif(64, 48)) == ("image/gif", "gif", 64, 48)


def test_identify_image_rejects_bytes_that_are_not_an_image():
    with pytest.raises(storage.UnsupportedImage):
        storage.identify_image(b"this is not an image at all")
    with pytest.raises(storage.UnsupportedImage):
        storage.identify_image(b"")


# --------------------------------------------------------------------------
# Endpoint
# --------------------------------------------------------------------------


class _Settings:
    """Just the two attributes the upload route reads."""

    def __init__(self, configured: bool = True, max_bytes: int = 5_000_000) -> None:
        self.object_storage_configured = configured
        self.S3_IMAGE_MAX_BYTES = max_bytes


@pytest.fixture
def stub_storage(monkeypatch: pytest.MonkeyPatch) -> dict[str, object]:
    """Replace the S3 round-trip, keeping the real format sniff.

    `store_project_image` is the single network seam, so stubbing it leaves the
    dimension parsing (the thing the build trusts) running for real.
    """
    captured: dict[str, object] = {}

    async def fake_store(data: bytes) -> storage.StoredImage:
        content_type, extension, width, height = storage.identify_image(data)
        captured.update(
            content_type=content_type,
            extension=extension,
            width=width,
            height=height,
            size=len(data),
        )
        key = f"project-images/test.{extension}"
        return storage.StoredImage(
            key=key,
            url=f"https://storage.example/media/{key}",
            width=width,
            height=height,
            content_type=content_type,
            size=len(data),
        )

    from app.routes import admin_content as routes

    monkeypatch.setattr(storage, "store_project_image", fake_store)
    monkeypatch.setattr(routes, "get_settings", lambda: _Settings())
    return captured


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


async def test_upload_returns_image_url_and_measured_dimensions(
    client: AsyncClient, stub_storage: dict[str, object]
) -> None:
    headers = await _auth_headers(client)

    response = await client.post(
        "/api/admin/uploads",
        files={"file": ("cover.png", _png(1600, 900), "image/png")},
        headers=headers,
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["image"] == "https://storage.example/media/project-images/test.png"
    assert body["image_width"] == 1600
    assert body["image_height"] == 900
    assert body["key"] == "project-images/test.png"
    assert body["audit_id"]
    assert stub_storage["content_type"] == "image/png"


async def test_upload_writes_one_audit_row(
    client: AsyncClient, stub_storage: dict[str, object], engine: AsyncEngine
) -> None:
    headers = await _auth_headers(client)

    response = await client.post(
        "/api/admin/uploads",
        files={"file": ("cover.webp", _webp_vp8l(1200, 750), "image/webp")},
        headers=headers,
    )
    assert response.status_code == 201, response.text

    rows = [row for row in await audit_rows(engine) if row.entity == "upload"]
    assert len(rows) == 1
    row = rows[0]
    assert row.action == "create"
    assert row.entity_id == "project-images/test.webp"
    assert row.after["width"] == 1200
    assert row.after["height"] == 750
    assert row.before is None


async def test_upload_rejects_unreadable_bytes(
    client: AsyncClient, stub_storage: dict[str, object]
) -> None:
    headers = await _auth_headers(client)

    response = await client.post(
        "/api/admin/uploads",
        files={"file": ("notes.txt", b"not an image", "text/plain")},
        headers=headers,
    )

    assert response.status_code == 422, response.text
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert error["fields"][0]["field"] == "file"


async def test_upload_rejects_an_empty_file(
    client: AsyncClient, stub_storage: dict[str, object]
) -> None:
    headers = await _auth_headers(client)

    response = await client.post(
        "/api/admin/uploads",
        files={"file": ("empty.png", b"", "image/png")},
        headers=headers,
    )

    assert response.status_code == 422, response.text


async def test_upload_rejects_a_body_over_the_cap(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.routes import admin_content as routes

    async def fake_store(data: bytes) -> storage.StoredImage:  # pragma: no cover - not reached
        raise AssertionError("size gate must run before storage")

    monkeypatch.setattr(storage, "store_project_image", fake_store)
    monkeypatch.setattr(routes, "get_settings", lambda: _Settings(max_bytes=16))

    headers = await _auth_headers(client)
    response = await client.post(
        "/api/admin/uploads",
        files={"file": ("big.png", _png(2000, 2000), "image/png")},
        headers=headers,
    )

    assert response.status_code == 422, response.text
    assert "at most 16 bytes" in response.json()["error"]["fields"][0]["message"]


async def test_upload_reports_503_when_storage_is_unconfigured(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.routes import admin_content as routes

    monkeypatch.setattr(routes, "get_settings", lambda: _Settings(configured=False))

    headers = await _auth_headers(client)
    response = await client.post(
        "/api/admin/uploads",
        files={"file": ("cover.png", _png(800, 600), "image/png")},
        headers=headers,
    )

    assert response.status_code == 503, response.text
    assert response.json()["error"]["code"] == "INTERNAL"


async def test_upload_requires_a_session(client: AsyncClient) -> None:
    response = await client.post(
        "/api/admin/uploads",
        files={"file": ("cover.png", _png(800, 600), "image/png")},
    )
    assert response.status_code == 401, response.text


async def test_upload_requires_csrf(
    client: AsyncClient, stub_storage: dict[str, object]
) -> None:
    # Authenticated, but no CSRF header: an authenticated caller still cannot
    # mutate without the token (403, not 401).
    await _login(client)
    response = await client.post(
        "/api/admin/uploads",
        files={"file": ("cover.png", _png(800, 600), "image/png")},
    )
    assert response.status_code == 403, response.text


# --------------------------------------------------------------------------
# The stored URL is a valid project.image through the public API
# --------------------------------------------------------------------------


async def test_a_stored_url_is_accepted_as_a_project_image(
    client: AsyncClient, stub_storage: dict[str, object]
) -> None:
    headers = await _auth_headers(client)

    response = await client.post(
        "/api/admin/projects",
        json={
            "slug": "uploaded-image",
            "title": "Uploaded image",
            "short_description": "A project whose cover came from object storage.",
            "image": "https://storage.example/media/project-images/test.webp",
            "image_width": 1200,
            "image_height": 750,
            "image_alt": "Screenshot",
            "seo_title": "Uploaded image",
            "seo_description": "A description.",
        },
        headers=headers,
    )

    # The relaxed `image_path` CHECK must admit the URL the upload returns.
    assert response.status_code == 201, response.text
    assert response.json()["entity"]["image"] == (
        "https://storage.example/media/project-images/test.webp"
    )
