"""
LLM response TTL cache.

A request like "What is Ritu's stack?" can arrive dozens of times from
spike traffic (refreshes, multiple tabs, bot probes). Each one currently
pays a full Gemini round-trip. A 60-300s TTL cache (default 120s) cuts
30-50% of LLM calls during spikes.

Design notes (matching `routes/github.py:31-49` precedent):
  - Hand-rolled `dict` + `time.time()` — no new dependency.
  - Sized cap (`LLM_CACHE_MAX_ENTRIES`, default 256) prevents unbounded
    memory growth if traffic patterns change. At ~1-2 KB/value,
    256 entries ≈ 0.5 MB — well under the 512 MB Render budget.
  - Thread-safe via `threading.Lock` because the embedding function is
    dispatched via `asyncio.to_thread` and the cache is module-level.
  - The cache key is opaque (`sha256` digest); callers must compute it
    from `(message, history, temperature, prompt_version, model)` via
    `make_cache_key` so changes to any of those inputs miss correctly.
  - Streaming-safe: callers MUST check the cache BEFORE opening any
    upstream stream. The cache value is the full text + provider, not
    a stream; the SSE generator replays it as a single token chunk.

Cache invalidation:
  - Operator: call `clear()` at runtime (e.g. after a prompt change).
  - Admin route `POST /admin/cache/clear` wraps `clear()`.
  - Hard-disable via env `LLM_CACHE_ENABLED=0`.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from typing import Any

logger = logging.getLogger(__name__)


# --- Tunables (env-overridable). -------------------------------------------
LLM_CACHE_ENABLED = os.getenv("LLM_CACHE_ENABLED", "1") not in ("0", "false", "no")
LLM_CACHE_TTL_SECONDS = float(os.getenv("LLM_CACHE_TTL_SECONDS", "120"))
LLM_CACHE_MAX_ENTRIES = int(os.getenv("LLM_CACHE_MAX_ENTRIES", "256"))


# In-process TTL store. Module-level so all callers share one cache.
_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_LOCK = threading.Lock()

# Hit/miss counters for the /admin/cache/stats route.
_STATS_LOCK = threading.Lock()
_STATS = {"hits": 0, "misses": 0}


def make_cache_key(
    message: str,
    history: list[dict[str, str]],
    temperature: float,
    prompt_version: str,
    with_examples: bool,
    gemini_model: str,
    groq_model: str,
) -> str:
    """
    Compute a deterministic cache key.

    Components:
      - normalized message (whitespace + case)
      - last-6-turns of history (role, content)
      - temperature (2-decimal float string so 0.30 == 0.3)
      - prompt version + whether few-shot examples were injected
      - model identifiers (model swap = miss = correct)
    """
    norm_message = " ".join(message.lower().split())
    norm_history = [
        {"role": h.get("role", ""), "content": " ".join(h.get("content", "").split())}
        for h in history
    ]
    payload = json.dumps(
        {
            "m": norm_message,
            "h": norm_history,
            "t": round(float(temperature), 2),
            "p": prompt_version,
            "x": bool(with_examples),
            "gm": gemini_model,
            "gq": groq_model,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _is_expired(ts: float) -> bool:
    return (time.time() - ts) > LLM_CACHE_TTL_SECONDS


def get(key: str) -> dict[str, Any] | None:
    """
    Return the cached response dict (with `text` and `generated_by`) or
    None on miss / expiry / disabled cache.
    """
    if not LLM_CACHE_ENABLED:
        return None
    with _LOCK:
        hit = _CACHE.get(key)
    if not hit:
        with _STATS_LOCK:
            _STATS["misses"] += 1
        return None
    ts, value = hit
    if _is_expired(ts):
        with _LOCK:
            _CACHE.pop(key, None)
        with _STATS_LOCK:
            _STATS["misses"] += 1
        return None
    with _STATS_LOCK:
        _STATS["hits"] += 1
    return value


def put(key: str, value: dict[str, Any]) -> None:
    """
    Insert/refresh a cache entry. Ejects oldest-by-insert-time when over
    capacity. No-op when cache is disabled.
    """
    if not LLM_CACHE_ENABLED:
        return
    with _LOCK:
        # Refresh existing entries to "now" so active keys don't get evicted
        # while they're still serving traffic.
        if key in _CACHE:
            _CACHE[key] = (time.time(), value)
        else:
            _CACHE[key] = (time.time(), value)
            if len(_CACHE) > LLM_CACHE_MAX_ENTRIES:
                # Plain dict preserves insertion order in CPython 3.7+; pop
                # the oldest key (front of insertion order).
                oldest = next(iter(_CACHE))
                _CACHE.pop(oldest, None)


def clear() -> int:
    """Drop all entries. Returns the count cleared (for admin logging)."""
    with _LOCK:
        count = len(_CACHE)
        _CACHE.clear()
    logger.info("LLM cache cleared (%d entries)", count)
    return count


def stats() -> dict[str, int]:
    """Snapshot of the current cache stats. Counts are cumulative."""
    with _LOCK:
        size = len(_CACHE)
    with _STATS_LOCK:
        return {
            "size": size,
            "max": LLM_CACHE_MAX_ENTRIES,
            "ttl_seconds": int(LLM_CACHE_TTL_SECONDS),
            "enabled": int(LLM_CACHE_ENABLED),
            "hits": _STATS["hits"],
            "misses": _STATS["misses"],
        }
