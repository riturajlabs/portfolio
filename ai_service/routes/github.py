"""
Server-side GitHub proxy.

Why a proxy?
  - The GitHub REST API allows 60 unauthenticated requests/hour per IP.
    For a portfolio with a chat widget that calls fetch on every page view,
    a single visitor session can exhaust that quota.
  - With a personal access token (PAT), the limit jumps to 5000/hour.
  - Putting the PAT on the backend keeps it off the frontend bundle.

The proxy:
  - Adds GITHUB_TOKEN if configured.
  - Caches successful responses in-memory for 5 minutes.
  - On GitHub 403/429, returns a structured error so the frontend can
    fall back to "last known" data without spamming the upstream API.
"""
import asyncio
import logging
import time
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config.settings import settings

router = APIRouter(prefix="/api", tags=["github"])
logger = logging.getLogger(__name__)

# Simple in-process TTL cache. Five minutes is enough to absorb refresh-spam
# from a single visitor without serving truly stale data.
_CACHE: dict[str, tuple[float, Any]] = {}
_CACHE_TTL_SECONDS = 300


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


async def _github_get(path: str) -> dict[str, Any]:
    """Authenticated GitHub GET with cache + error mapping."""
    cached = _cache_get(path)
    if cached is not None:
        return cached

    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "riturajlabs-portfolio",
    }
    if settings.GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {settings.GITHUB_TOKEN}"

    url = f"https://api.github.com{path}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        logger.error("GitHub upstream error: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="Unable to reach GitHub. Please try again later.",
        ) from exc

    if resp.status_code == 403 and "rate limit" in resp.text.lower():
        raise HTTPException(
            status_code=429,
            detail="GitHub API rate limit reached.",
        )
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="GitHub user not found.")
    if not resp.is_success:
        raise HTTPException(
            status_code=resp.status_code,
            detail=f"GitHub API error: {resp.text[:200]}",
        )

    data = resp.json()
    _cache_set(path, data)
    return data


class GithubProfileResponse(BaseModel):
    profile: dict[str, Any]
    repositories: list[dict[str, Any]]
    cached: bool


@router.get("/github", response_model=GithubProfileResponse)
async def get_github_data():
    """
    Returns the GitHub profile + public repos for the configured user.
    `cached` is true if at least one of the upstream responses was served
    from the in-memory TTL cache.
    """
    user = settings.GITHUB_USERNAME

    # Hit profile + repos concurrently — they're independent.
    profile_cached_before = _cache_get(f"/users/{user}") is not None
    repos_cached_before = _cache_get(f"/users/{user}/repos") is not None

    profile, repositories = await asyncio.gather(
        _github_get(f"/users/{user}"),
        _github_get(f"/users/{user}/repos?sort=updated&per_page=100"),
    )

    was_cached = profile_cached_before or repos_cached_before
    return GithubProfileResponse(
        profile=profile,
        repositories=repositories,
        cached=was_cached,
    )