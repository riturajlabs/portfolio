"""Server-side GitHub proxy.

`GET /api/github` moved here in Phase 8 (`API.md` §2.2). The rationale is
unchanged: the GitHub REST API allows 60 unauthenticated requests per hour per
IP, and a chat widget fetching on every page view would exhaust that quota. A
server-side `GITHUB_TOKEN` raises the ceiling to 5000/hour and keeps the token
out of the browser bundle.

Behavior mirrors `ai_service/routes/github.py` exactly: profile + repositories
fetched concurrently, 300 s in-process TTL cache, and the same upstream error
mapping (network → 502, rate limit → 429, missing user → 404, other errors →
upstream status). The cache is process-local per `ADR-014`: no Redis, no extra
infrastructure, and the documented single-instance deployment makes it exact.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx
from fastapi import HTTPException

from app.config import get_settings

logger = logging.getLogger("app.github")

_GITHUB_BASE_URL = "https://api.github.com"
_CACHE_TTL_SECONDS = 300

# The public detail for an upstream failure that is not one of the mapped cases
# (network, rate limit, missing user). The upstream body is never reflected to a
# client (`SECURITY.md` §2.9): it can name endpoints, limits or internal
# identifiers. Diagnostics go to the log instead.
_UPSTREAM_ERROR_DETAIL = "GitHub API error. Please try again later."

# Keyed by API path, exactly as `ai_service` did. Five minutes is enough to
# absorb refresh-spam from one visitor without serving stale data.
_CACHE: dict[str, tuple[float, Any]] = {}


def _cache_clear() -> None:
    """Drop every cached entry. Tests use this; the application never calls it."""
    _CACHE.clear()


def _cache_get(key: str) -> Any | None:
    hit = _CACHE.get(key)
    if not hit:
        return None
    ts, value = hit
    if time.time() - ts > _CACHE_TTL_SECONDS:
        _CACHE.pop(key, None)
        return None
    return value


def _cache_set(key: str, value: Any) -> None:
    _CACHE[key] = (time.time(), value)


async def _github_get(path: str) -> Any:
    """Authenticated GitHub GET with cache + error mapping."""
    cached = _cache_get(path)
    if cached is not None:
        return cached

    settings = get_settings()
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "riturajlabs-portfolio",
    }
    if settings.GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {settings.GITHUB_TOKEN}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{_GITHUB_BASE_URL}{path}", headers=headers)
    except httpx.HTTPError as exc:
        logger.error("GitHub upstream error: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="Unable to reach GitHub. Please try again later.",
        ) from exc

    if response.status_code == 403 and "rate limit" in response.text.lower():
        raise HTTPException(status_code=429, detail="GitHub API rate limit reached.")
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="GitHub user not found.")
    if not response.is_success:
        # Status mapping is preserved (upstream status, including 401); only the
        # body is withheld. The body is logged, truncated, for diagnosis — it
        # never contains our `Authorization` token, which travels in a header.
        logger.error(
            "GitHub upstream returned %s: %s",
            response.status_code,
            response.text[:500],
        )
        raise HTTPException(
            status_code=response.status_code,
            detail=_UPSTREAM_ERROR_DETAIL,
        )

    data = response.json()
    _cache_set(path, data)
    return data


async def fetch_profile_and_repositories() -> tuple[dict[str, Any], list[dict[str, Any]], bool]:
    """The configured user's profile and repositories, plus whether either was cached."""
    user = get_settings().GITHUB_USERNAME

    # Capture cache state before the concurrent fetch: `cached` must report
    # whether the *responses* were served from cache, which has to be decided
    # before the fetch repopulates it.
    profile_cached_before = _cache_get(f"/users/{user}") is not None
    repos_cached_before = _cache_get(f"/users/{user}/repos") is not None

    profile, repositories = await asyncio.gather(
        _github_get(f"/users/{user}"),
        _github_get(f"/users/{user}/repos?sort=updated&per_page=100"),
    )

    return profile, repositories, profile_cached_before or repos_cached_before


__all__ = ["_cache_clear", "fetch_profile_and_repositories"]