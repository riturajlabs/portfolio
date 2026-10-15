"""
Background knowledge-base ingestion.

Moved out of `app.py` so:
  - The lifespan handler stays minimal (one line).
  - The readiness flag can be imported from anywhere (app.py, routes).
  - Errors don't kill the FastAPI process if ChromaDB can't initialise —
    the API still serves /health, and /chat will return a clean error.

The same ingestion routine is reused by the admin re-ingest route
(`routes/admin.py`): a successful content publish on the backend calls
`POST /admin/reingest` here so the vector store stops returning deleted or
edited content. `reingest_knowledge()` runs it *synchronously and raising*, so
the caller can report a real failure instead of a false success; the startup
path keeps its best-effort, never-crash behaviour.
"""
import asyncio
import logging
import os

logger = logging.getLogger(__name__)

# Module-level readiness flag. Single source of truth for /ready.
_knowledge_ready: bool = False
# Guards against two concurrent ingestions (startup + an admin re-ingest)
# mutating the same Chroma collection at once.
_ingest_lock = asyncio.Lock()


def is_knowledge_ready() -> bool:
    return _knowledge_ready


def _force_requested() -> bool:
    return os.environ.get("FORCE_REINGEST", "").lower() in ("1", "true", "yes")


def _ingest(force: bool) -> dict:
    """Run one ingestion and return its stats.

    Raises on any failure (content fetch, validation, embedding, Chroma) so the
    caller decides how loud to be. A Chroma `force` wipe is destructive; callers
    pass `force=True` only for an embedding-model change or `FORCE_REINGEST`.
    """
    from services.knowledge_loader import (
        _get_collection,
        load_knowledge_into_chromadb,
    )

    # 🧹 Wipe stale ChromaDB data when the embedding model changes,
    # or when the operator opts in via env. Old vectors (different
    # dim / model) would silently degrade retrieval if mixed.
    added = load_knowledge_into_chromadb(force=force)
    collection = _get_collection()
    count = collection.count()
    return {"added": added, "count": count}


def _run_ingestion() -> None:
    """Best-effort startup ingestion; never raises into the event loop."""
    global _knowledge_ready
    try:
        stats = _ingest(_force_requested())
        logger.info(
            "✅ Knowledge base loaded into ChromaDB (+%d chunks, %d total)",
            stats["added"],
            stats["count"],
        )

        # 🟢 Pre-warm `collection.count()` so the first /chat request
        # doesn't pay the ChromaDB init cost (1-3 s on Render wake-up).
        # `get_or_create_collection` was already invoked by
        # `load_knowledge_into_chromadb`, but the underlying HNSW index
        # is lazily touched only on the first query. Calling `count()`
        # here forces it to materialise before traffic arrives.
        _knowledge_ready = True
    except Exception as exc:  # noqa: BLE001  # pragma: no cover
        logger.error("❌ Failed to load knowledge base: %s", exc)
        # Don't set the flag — /ready will keep returning 503 so traffic
        # isn't routed to a broken instance.


def startup_knowledge_loading() -> None:
    """Fire-and-forget: schedule ingestion on the FastAPI event loop."""
    try:
        loop = asyncio.get_running_loop()
        loop.run_in_executor(None, _run_ingestion)
    except RuntimeError:
        # No loop (e.g., running under plain `python app.py` with reload off
        # before uvicorn installs the loop). Fall back to synchronous call.
        _run_ingestion()


def reingest_knowledge() -> dict:
    """Re-run ingestion, raising on failure, and mark the store ready.

    Called from the admin route via `asyncio.to_thread` — this is blocking.
    Deliberately does **not** pass `force=True`: a normal content update must
    reconcile (add new chunks, delete stale ones), not wipe the collection.
    On success the readiness flag is set, so a service that failed its startup
    ingestion can still be brought online by a publish. On failure the flag is
    left untouched and the exception propagates so the caller can report it.
    """
    global _knowledge_ready
    stats = _ingest(force=False)
    _knowledge_ready = True
    logger.info(
        "Re-ingested on request: +%d chunks, %d total",
        stats["added"],
        stats["count"],
    )
    return stats


async def reingest_knowledge_async() -> dict:
    """Async wrapper that serialises concurrent re-ingestions."""
    async with _ingest_lock:
        return await asyncio.to_thread(reingest_knowledge)
