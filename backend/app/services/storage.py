"""Object storage for admin uploads (Neon Object Storage, or any S3-compatible API).

Two kinds of object are stored, in two buckets with deliberately different
visibility:

* **Project cover images** in the `public_read` bucket (`S3_BUCKET`, default
  `media`). The value persisted on the project row is the object's **anonymous
  public URL**, not a signed one. That is a deliberate consequence of the
  architecture: the URL is baked into the static build (`src/generated/content.js`
  → the prerendered `/projects/<slug>/` documents → the sitemap), so it has to be
  fetchable by a browser for as long as the build's HTML lives. A presigned URL
  expires and would 403 on a page nobody rebuilt.
* **The resume** in the private `uploads` bucket (`S3_RESUME_BUCKET`). A resume is
  a document, not a web asset, so it gets no anonymous URL at all: `GET /api/resume`
  reads it with these same credentials and streams the bytes, and the frontend
  links only to that route. The bucket's access mode is fixed at creation, which is
  exactly why the document goes in an already-private bucket rather than the
  public one.

The AWS SDK is synchronous, so every call is pushed onto a thread with
`asyncio.to_thread`; the event loop that is serving a request must not block on a
network round-trip.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass
from functools import lru_cache

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError

from app.config import get_settings
from app.errors import INTERNAL, APIError

logger = logging.getLogger("app.storage")

# The key prefix that identifies an admin-uploaded cover image. Kept here, next to
# the code that writes it, so a lifecycle rule or a support query has one place to
# look.
OBJECT_PREFIX = "project-images"

# The key prefix that identifies an admin-uploaded resume, in the private bucket.
RESUME_PREFIX = "resumes"

# The single media type the resume API serves. A resume is a PDF by contract; the
# upload validates the `%PDF-` signature, so this is not a guess at the body.
_PDF_CONTENT_TYPE = "application/pdf"

# Uploaded image bytes never change under a key, so the public bucket object is
# cached for a year. The resume object's own metadata is irrelevant — it is only
# ever read by the API, which sets the response cache policy itself.
_CACHE_CONTROL = "public, max-age=31536000, immutable"


class UnsupportedImage(ValueError):
    """The uploaded bytes are not a WebP/PNG/JPEG/GIF image we can measure."""


class UnsupportedResume(ValueError):
    """The uploaded bytes are not a PDF (no `%PDF-` signature)."""


class ResumeNotFound(LookupError):
    """The resume object referenced by the profile is not in the bucket.

    A stale key (the object was removed out of band) rather than a client error;
    the route turns it into a 404 so the public link fails honestly instead of
    disclosing the storage layer.
    """


@dataclass(frozen=True, slots=True)
class StoredImage:
    """A stored object and the facts the project row needs from it."""

    key: str
    url: str
    width: int
    height: int
    content_type: str
    size: int


# --------------------------------------------------------------------------
# Dimension parsing
# --------------------------------------------------------------------------
# The server measures the image itself rather than trusting the browser. The
# build cross-checks the persisted width/height against the real file
# (`generate-project-pages.mjs`), so a value the browser guessed would turn into a
# failed production build. Parsing four formats by header is the whole cost.


def _webp_size(data: bytes) -> tuple[int, int]:
    # RIFF....WEBP, then the first chunk. VP8X (extended) carries a canvas size
    # at a fixed offset; VP8L packs it into bit fields; VP8 (lossy) stores the
    # 14-bit dimensions after a start code.
    chunk = data[12:16]
    if chunk == b"VP8X":
        width = 1 + int.from_bytes(data[24:27], "little")
        height = 1 + int.from_bytes(data[27:30], "little")
        return width, height
    if chunk == b"VP8L":
        if len(data) < 25 or data[20] != 0x2F:
            raise UnsupportedImage("Malformed WebP (VP8L) header.")
        bits = int.from_bytes(data[21:25], "little")
        return 1 + (bits & 0x3FFF), 1 + ((bits >> 14) & 0x3FFF)
    if chunk == b"VP8 ":
        if len(data) < 30 or data[23:26] != b"\x9d\x01\x2a":
            raise UnsupportedImage("Malformed WebP (VP8) frame header.")
        width = int.from_bytes(data[26:28], "little") & 0x3FFF
        height = int.from_bytes(data[28:30], "little") & 0x3FFF
        return width, height
    raise UnsupportedImage("Unrecognised WebP variant.")


def _png_size(data: bytes) -> tuple[int, int]:
    # The IHDR chunk is mandatory and first: width/height are big-endian u32 at
    # bytes 16 and 20.
    if len(data) < 24 or data[12:16] != b"IHDR":
        raise UnsupportedImage("Malformed PNG header.")
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")


def _jpeg_size(data: bytes) -> tuple[int, int]:
    # Walk the marker segments until a Start-Of-Frame, which carries the size.
    # SOF0..SOF15 is 0xC0..0xCF minus DHT (0xC4), JPG (0xC8) and DAC (0xCC).
    index = 2
    length = len(data)
    while index + 9 < length:
        if data[index] != 0xFF:
            index += 1
            continue
        marker = data[index + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            index += 2
            continue
        if marker == 0xD9:
            break
        segment_length = int.from_bytes(data[index + 2 : index + 4], "big")
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            height = int.from_bytes(data[index + 5 : index + 7], "big")
            width = int.from_bytes(data[index + 7 : index + 9], "big")
            return width, height
        index += 2 + segment_length
    raise UnsupportedImage("Malformed JPEG: no frame header found.")


def _gif_size(data: bytes) -> tuple[int, int]:
    return int.from_bytes(data[6:8], "little"), int.from_bytes(data[8:10], "little")


def identify_image(data: bytes) -> tuple[str, str, int, int]:
    """Return `(content_type, extension, width, height)` for `data`.

    Raises `UnsupportedImage` for anything that is not a WebP, PNG, JPEG or GIF,
    and for a header that is too short to measure — the caller turns that into the
    `422` the admin sees. The check is a format sniff, not a full decode: a
    truncated body can pass here, but the bundled `public/images/projects/` set is
    all WebP, and a corrupt upload is the owner's to see fail on the page, not a
    reason to link a full decoder into the request path.
    """
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", "webp", *_webp_size(data)
    if len(data) >= 24 and data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png", "png", *_png_size(data)
    if len(data) >= 4 and data[:2] == b"\xff\xd8":
        return "image/jpeg", "jpg", *_jpeg_size(data)
    if len(data) >= 10 and data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif", "gif", *_gif_size(data)
    raise UnsupportedImage("Only WebP, PNG, JPEG and GIF images are supported.")


# --------------------------------------------------------------------------
# S3
# --------------------------------------------------------------------------


@lru_cache(maxsize=1)
def _client():
    """Build the S3 client once, from the explicit settings.

    The credentials are passed explicitly rather than left to boto3's own
    environment chain: pydantic does not export `.env` values into `os.environ`,
    so the default chain would silently see nothing locally. Path-style
    addressing is required — Neon's endpoint puts the bucket in the URL path
    (`<endpoint>/<bucket>/<key>`), which is exactly the public URL shape.

    Cached without arguments because `Settings` is unhashable and
    `get_settings()` is already memoised, so this is still one client per
    process.
    """
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=settings.AWS_ENDPOINT_URL_S3,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        region_name=settings.AWS_REGION or None,
        config=BotoConfig(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


async def store_project_image(data: bytes) -> StoredImage:
    """Measure `data`, store it under a fresh key and return its public facts.

    Raises `UnsupportedImage` (a `ValueError`) when the bytes are not a supported
    image, and `APIError` (503) when object storage is unreachable — the one case
    the admin should retry rather than fix the file for.
    """
    settings = get_settings()
    content_type, extension, width, height = identify_image(data)
    key = f"{OBJECT_PREFIX}/{uuid.uuid4().hex}.{extension}"
    client = _client()
    try:
        await asyncio.to_thread(
            client.put_object,
            Bucket=settings.S3_BUCKET,
            Key=key,
            Body=data,
            ContentType=content_type,
            CacheControl=_CACHE_CONTROL,
        )
    except (BotoCoreError, ClientError) as exc:
        raise APIError(
            503,
            INTERNAL,
            "Object storage is unavailable; the image was not saved. Please retry.",
            event="admin_upload_storage_error",
            log_fields={"error": type(exc).__name__},
        ) from exc
    return StoredImage(
        key=key,
        url=f"{settings.object_public_base_url}/{key}",
        width=width,
        height=height,
        content_type=content_type,
        size=len(data),
    )


# --------------------------------------------------------------------------
# Resume (private bucket, served only through `GET /api/resume`)
# --------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class StoredResume:
    """A stored resume object and the facts the profile row needs from it."""

    key: str
    content_type: str
    size: int


def identify_pdf(data: bytes) -> None:
    """Raise `UnsupportedResume` unless `data` starts with the PDF signature.

    A signature sniff, not a full decode: it rejects a file that is plainly not a
    PDF — a renamed `.docx`, an image, an empty body — which is the caller's
    mistake. A truncated but well-formed PDF is the owner's to see fail rather
    than a reason to link a PDF parser into the request path.
    """
    if not data.startswith(b"%PDF-"):
        raise UnsupportedResume("Only PDF documents are supported.")


def _storage_api_error(action: str, exc: Exception) -> APIError:
    """A retryable `503` for a storage round-trip that failed for any other reason."""
    return APIError(
        503,
        INTERNAL,
        "Object storage is unavailable; the resume was not "
        f"{'saved' if action == 'write' else 'read'}. Please retry.",
        event="admin_resume_storage_error",
        log_fields={"error": type(exc).__name__, "operation": action},
    )


async def store_resume(data: bytes) -> StoredResume:
    """Validate `data` as a PDF, store it under a fresh key and return its facts.

    Raises `UnsupportedResume` (a `ValueError`) when the bytes are not a PDF, and
    `APIError` (503) when object storage is unreachable — the one case the admin
    should retry rather than fix the file for. The key is server-generated; no
    caller-supplied path ever reaches the bucket.
    """
    settings = get_settings()
    identify_pdf(data)
    key = f"{RESUME_PREFIX}/{uuid.uuid4().hex}.pdf"
    client = _client()
    try:
        await asyncio.to_thread(
            client.put_object,
            Bucket=settings.S3_RESUME_BUCKET,
            Key=key,
            Body=data,
            ContentType=_PDF_CONTENT_TYPE,
        )
    except (BotoCoreError, ClientError) as exc:
        raise _storage_api_error("write", exc) from exc
    return StoredResume(key=key, content_type=_PDF_CONTENT_TYPE, size=len(data))


async def read_resume(key: str) -> bytes:
    """Return the bytes of the resume object at `key`.

    `key` comes from `site_profile.resume_key`, never from the caller, so it cannot
    be pointed at another object. Raises `ResumeNotFound` when the object is absent
    (a stale reference) and `APIError` (503) when storage cannot be reached.
    """
    settings = get_settings()
    client = _client()

    def _fetch() -> bytes:
        response = client.get_object(Bucket=settings.S3_RESUME_BUCKET, Key=key)
        return response["Body"].read()

    try:
        return await asyncio.to_thread(_fetch)
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code in ("NoSuchKey", "NoSuchBucket", "NotFound", "404"):
            raise ResumeNotFound(key) from exc
        raise _storage_api_error("read", exc) from exc
    except BotoCoreError as exc:
        raise _storage_api_error("read", exc) from exc


async def delete_resume(key: str) -> None:
    """Best-effort delete of a resume object that is no longer referenced.

    Called only after the database already points at the replacement (or has
    dropped the reference), so a failure here leaves an orphaned object — wasteful,
    never user-visible — rather than a broken or half-swapped resume. It therefore
    logs and returns instead of raising; the caller must not fail its request over
    cleanup.
    """
    settings = get_settings()
    client = _client()
    try:
        await asyncio.to_thread(
            client.delete_object, Bucket=settings.S3_RESUME_BUCKET, Key=key
        )
    except (BotoCoreError, ClientError) as exc:
        logger.warning(
            "resume_cleanup_failed",
            extra={
                "event": "resume_cleanup_failed",
                "key": key,
                "error": type(exc).__name__,
            },
        )
