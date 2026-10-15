"""Trigger the two downstream effects of a content publish (`ADR-017`).

A publish is not just a static rebuild. The public site is prerendered from the
content API *and* the AI assistant answers from a ChromaDB collection built from
the same API. A content change is therefore only fully visible once:

1. the public site's next build has run (Vercel Deploy Hook), and
2. the AI service has re-ingested the content API (its `/admin/reingest` route),
   which reconciles the vector store — adding new chunks and *deleting* chunks
   for hidden or removed content — so chat can no longer quote stale data.

This module is the one place the backend reaches out to start either. Invariants:

* **Secrets never leave the server.** Both the deploy-hook URL and the AI admin
  token are capability tokens; the browser calls `POST /api/admin/publish` and
  this module makes the outbound requests with values read from settings. No route
  returns them, and neither is ever logged.
* **Failure is reported, not concealed.** Every step yields a result object that
  distinguishes "not configured" from "configured but failed", so the owner learns
  which problem they actually have. Nothing here raises for an expected failure.

This service is intentionally side-effect-free with respect to the database — the
audit row is written by `app.services.admin_content.record_publish`, so the
outbound calls and their audit record stay in separate layers.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

import httpx

from app.config import get_settings

logger = logging.getLogger("app.publish")

# Per-step statuses.
STATUS_TRIGGERED = "triggered"
STATUS_UPDATED = "updated"
STATUS_NOT_CONFIGURED = "not_configured"
STATUS_FAILED = "failed"

# Overall statuses.
OVERALL_OK = "ok"
OVERALL_PARTIAL = "partial"
OVERALL_FAILED = "failed"


@dataclass(frozen=True, slots=True)
class PublishStep:
    """The outcome of one downstream step (rebuild or re-ingestion)."""

    name: str
    configured: bool
    ok: bool
    status: str
    message: str


@dataclass(frozen=True, slots=True)
class PublishOutcome:
    """The outcome of a publish: both steps plus a combined verdict."""

    ok: bool
    status: str
    message: str
    rebuild: PublishStep
    reingest: PublishStep


async def trigger_deploy() -> PublishStep:
    """Start a production rebuild, returning a result instead of raising.

    `GET` is used because the Vercel deploy hook accepts an unauthenticated `GET`
    and that is the form documented for manual triggering; a `POST` with no body
    works identically but the `GET` is the least surprising for an operator who
    also calls the URL by hand from a browser.
    """
    settings = get_settings()
    url = settings.DEPLOY_HOOK_URL.strip()
    if not url:
        return PublishStep(
            name="rebuild",
            configured=False,
            ok=False,
            status=STATUS_NOT_CONFIGURED,
            message=(
                "Rebuild is not configured on the server. Set DEPLOY_HOOK_URL to "
                "enable it."
            ),
        )

    try:
        async with httpx.AsyncClient(timeout=settings.DEPLOY_HOOK_TIMEOUT_SECONDS) as client:
            response = await client.get(url)
    except httpx.HTTPError as exc:
        # The URL is never logged: it is a capability token. Only the fact of the
        # failure and its type are recorded.
        logger.warning("publish_deploy_hook_unreachable", extra={"error_type": type(exc).__name__})
        if isinstance(exc, httpx.TimeoutException):
            message = "The deploy hook did not respond in time. Check the server and retry."
        else:
            message = "Could not reach the deploy hook. Check the server and retry."
        return PublishStep(
            name="rebuild",
            configured=True,
            ok=False,
            status=STATUS_FAILED,
            message=message,
        )

    if not (200 <= response.status_code < 300):
        logger.warning(
            "publish_deploy_hook_rejected", extra={"status_code": response.status_code}
        )
        return PublishStep(
            name="rebuild",
            configured=True,
            ok=False,
            status=STATUS_FAILED,
            message=f"The deploy hook rejected the request (HTTP {response.status_code}).",
        )

    return PublishStep(
        name="rebuild",
        configured=True,
        ok=True,
        status=STATUS_TRIGGERED,
        message="Rebuild started. The site will update in a few minutes.",
    )


async def trigger_reingest() -> PublishStep:
    """Ask the AI service to re-ingest, returning a result instead of raising.

    The AI service reconciles its vector store against the live content API, so
    hidden/removed content is deleted from the collection and edited content is
    replaced. It also clears its LLM response cache, so an answer built from the
    old data is not served for the cache's remaining TTL.

    The admin token travels in the `X-Admin-Token` header and is never logged. A
    non-2xx response is a failure: the AI service returns 502 when ingestion
    itself fails, and we must not report a successful publish over stale
    knowledge.
    """
    settings = get_settings()
    base = settings.AI_SERVICE_URL.strip().rstrip("/")
    token = settings.AI_SERVICE_ADMIN_TOKEN.strip()
    if not base or not token:
        return PublishStep(
            name="reingest",
            configured=False,
            ok=False,
            status=STATUS_NOT_CONFIGURED,
            message=(
                "AI re-ingestion is not configured on the server. Set "
                "AI_SERVICE_URL and AI_SERVICE_ADMIN_TOKEN to enable it."
            ),
        )

    url = f"{base}/admin/reingest"
    try:
        async with httpx.AsyncClient(timeout=settings.AI_SERVICE_TIMEOUT_SECONDS) as client:
            response = await client.post(url, headers={"X-Admin-Token": token})
    except httpx.HTTPError as exc:
        # The base URL and token are never logged. Only the failure type is.
        logger.warning("publish_reingest_unreachable", extra={"error_type": type(exc).__name__})
        if isinstance(exc, httpx.TimeoutException):
            message = (
                "The AI service did not respond in time. Its knowledge may be "
                "stale until it restarts or is retried."
            )
        else:
            message = "Could not reach the AI service to update its knowledge. Retry."
        return PublishStep(
            name="reingest",
            configured=True,
            ok=False,
            status=STATUS_FAILED,
            message=message,
        )

    if not (200 <= response.status_code < 300):
        logger.warning(
            "publish_reingest_rejected", extra={"status_code": response.status_code}
        )
        return PublishStep(
            name="reingest",
            configured=True,
            ok=False,
            status=STATUS_FAILED,
            message=(
                f"The AI service rejected the re-ingestion (HTTP {response.status_code}). "
                "Its knowledge may be stale until it restarts or is retried."
            ),
        )

    # A 2xx tells us the request was accepted, not that ingestion succeeded. The
    # AI service answers `{"ok": true, "added", "count", "cache_cleared"}` only on
    # real success; anything else (or an unreadable body) is an unconfirmed
    # re-ingestion and must not be reported as success over possibly-stale data.
    try:
        body = response.json()
    except ValueError:
        body = None
    if not isinstance(body, dict) or body.get("ok") is not True:
        logger.warning("publish_reingest_not_confirmed")
        return PublishStep(
            name="reingest",
            configured=True,
            ok=False,
            status=STATUS_FAILED,
            message=(
                "The AI service did not confirm the re-ingestion. Its knowledge "
                "may be stale; retry the publish."
            ),
        )

    return PublishStep(
        name="reingest",
        configured=True,
        ok=True,
        status=STATUS_UPDATED,
        message="AI knowledge updated.",
    )


def _combine(rebuild: PublishStep, reingest: PublishStep) -> PublishOutcome:
    """Fold two step results into one honest verdict.

    `ok` is true only when *no* step failed. A not-configured step is not a
    failure (the operator simply has not wired that integration), so it yields a
    `partial` overall status rather than `failed` — but it is still not a success,
    so the admin UI never claims the publish fully completed.
    """
    steps = (rebuild, reingest)
    if any(step.status == STATUS_FAILED for step in steps):
        status = OVERALL_FAILED
    elif any(step.status == STATUS_NOT_CONFIGURED for step in steps):
        status = OVERALL_PARTIAL
    else:
        status = OVERALL_OK
    message = " ".join(step.message for step in steps)
    return PublishOutcome(
        ok=status == OVERALL_OK,
        status=status,
        message=message,
        rebuild=rebuild,
        reingest=reingest,
    )


async def publish_all() -> PublishOutcome:
    """Run the rebuild and re-ingestion steps and combine their results.

    The two calls are independent, so they run concurrently — a slow AI
    re-ingestion must not delay starting the (much faster) build trigger.
    """
    rebuild, reingest = await asyncio.gather(trigger_deploy(), trigger_reingest())
    return _combine(rebuild, reingest)
