"""Operator-only admin endpoints, guarded by `ADMIN_TOKEN`.

Kept separate from the chat API key (`AI_SERVICE_KEY`): a leaked chat key must
not grant cache-purge or re-ingest rights. When `ADMIN_TOKEN` is empty every
route here returns 404, so an unconfigured deployment exposes no admin surface
at all.

Routes:
  * `POST /admin/reingest`  — re-run knowledge ingestion from the content API
    and clear the LLM response cache. Called by the backend after a successful
    content publish so the vector store can't keep serving deleted/edited
    content, and stale cached answers are dropped.
  * `POST /admin/cache/clear` — drop the LLM response cache only.
"""
from __future__ import annotations

import hmac
import logging

from fastapi import APIRouter, Depends, Header, HTTPException, status

from config.settings import settings
from core.startup import reingest_knowledge_async
from services import llm_response_cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


def require_admin_token(
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> None:
    """Reject unless `X-Admin-Token` matches `ADMIN_TOKEN`.

    Empty `ADMIN_TOKEN` disables the whole surface (404) rather than allowing
    anonymous access. The comparison is constant-time so the token can't be
    probed byte-by-byte through timing.
    """
    expected = settings.ADMIN_TOKEN
    if not expected:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
    if not x_admin_token or not hmac.compare_digest(x_admin_token, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing admin token.",
        )


@router.post("/reingest", dependencies=[Depends(require_admin_token)])
async def reingest():
    """Re-ingest the content API and clear the LLM response cache.

    Runs the blocking ingestion in a worker thread and serialises concurrent
    calls. Failures surface as 502 so the backend records an honest failure
    instead of reporting a successful publish over stale knowledge.
    """
    try:
        stats = await reingest_knowledge_async()
    except Exception as exc:  # noqa: BLE001 — report the failure to the caller
        logger.error("Admin re-ingest failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Knowledge re-ingestion failed.",
        )

    cleared = llm_response_cache.clear()
    return {
        "ok": True,
        "added": stats["added"],
        "count": stats["count"],
        "cache_cleared": cleared,
    }


@router.post("/cache/clear", dependencies=[Depends(require_admin_token)])
async def clear_cache():
    """Drop the LLM response cache; returns the number of entries cleared."""
    return {"ok": True, "cleared": llm_response_cache.clear()}
