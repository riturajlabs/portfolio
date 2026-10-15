"""`GET /api/github` — server-side GitHub proxy.

Phase 8 moves this endpoint from `ai_service` to `backend/`. The contract is
unchanged (`API.md` §2.2): profile + repositories in one payload, `cached`
reflecting the in-process 300 s TTL cache, public, no rate limit — the cache is
what keeps a chat widget's per-page-view fetches from exhausting the GitHub API
quota. Error mapping is preserved exactly (network → 502, 403 rate limit → 429,
404 user → 404, other errors → upstream status).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.services import github as github_service

router = APIRouter(prefix="/api", tags=["github"])

_NOT_FOUND_DETAIL = "GitHub user not found."


class GithubProfileResponse(BaseModel):
    profile: dict[str, Any]
    repositories: list[dict[str, Any]]
    cached: bool


@router.get("/github", response_model=GithubProfileResponse)
async def get_github_data() -> GithubProfileResponse:
    """Return the configured user's profile + public repos, with the cache flag."""
    try:
        profile, repositories, cached = await github_service.fetch_profile_and_repositories()
    except HTTPException as exc:
        if exc.status_code == 404:
            # The application registers a global handler for the 404 *status code*
            # (main.py), which would otherwise rewrite the documented upstream
            # "user not found" body into a generic route-not-found message. Return
            # the intended body directly so the API.md §2.2 mapping survives.
            return JSONResponse(
                status_code=404,
                content={"detail": _NOT_FOUND_DETAIL},
                headers={"Cache-Control": "no-store"},
            )
        raise
    return GithubProfileResponse(profile=profile, repositories=repositories, cached=cached)