"""
Background knowledge-base ingestion.

Moved out of `app.py` so:
  - The lifespan handler stays minimal (one line).
  - The readiness flag can be imported from anywhere (app.py, routes).
  - Errors don't kill the FastAPI process if ChromaDB can't initialise —
    the API still serves /health, and /chat will return a clean error.
"""
import asyncio
import logging

logger = logging.getLogger(__name__)

# Module-level readiness flag. Single source of truth for /ready.
_knowledge_ready: bool = False


def is_knowledge_ready() -> bool:
    return _knowledge_ready


def _run_ingestion() -> None:
    """Blocking ingestion; safe to run in a thread executor."""
    global _knowledge_ready
    try:
        from services.knowledge_loader import load_knowledge_into_chromadb
        added = load_knowledge_into_chromadb()
        logger.info("✅ Knowledge base loaded into ChromaDB (+%d chunks)", added)
        _knowledge_ready = True
    except Exception as exc:  # pragma: no cover
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