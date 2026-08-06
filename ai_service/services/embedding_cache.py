"""
SQLite-backed persistence for query embeddings.

Why switch from the in-memory OrderedDict LRU in `services/embeddings.py`?
  - Render restarts (and even small code redeploys) wipe the process.
  - After the restart, the next 200 unique queries each pay a 100-300 ms
    Gemini round-trip while the in-memory cache fills back up.
  - Persisting to a small SQLite file survives restarts. The first boot
    prewarms cheaply; subsequent boots hit the SQLite cache immediately.

Design:
  - SQLite (stdlib) — no new dependency. Single file at
    `<chroma_parent>/embedding_cache.sqlite`.
  - One-row-per-query model: `query_hash TEXT PRIMARY KEY,
    dim INTEGER, vec BLOB, created_at REAL`. PRIMARY KEY = O(1) lookup.
  - BLOB-encoded float32 (4 bytes/dim). 768 dims × 4 = 3 KB per row —
    negligible. Float32 is the native wire format most embedding
    serializations use; truncating precision below float32 would erode
    cosine similarity on already-similar vectors.
  - Soft cap (`EMBEDDING_CACHE_MAX_ROWS`, default 1000). When the table
    exceeds the cap, oldest rows by `created_at` are pruned in a single
    `DELETE … ORDER BY created_at LIMIT …` statement (cheap in SQLite).
  - Disabled via env `EMBEDDING_CACHE_DISABLED=1` (falls through to the
    underlying Gemini call every time).
  - All operations swallow exceptions and log a warning — losing cache
    hits must never block a chat response.
"""
from __future__ import annotations

import hashlib
import logging
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import List

logger = logging.getLogger(__name__)

EMBEDDING_CACHE_DISABLED = os.getenv("EMBEDDING_CACHE_DISABLED", "0") in (
    "1",
    "true",
    "yes",
)
EMBEDDING_CACHE_MAX_ROWS = int(os.getenv("EMBEDDING_CACHE_MAX_ROWS", "1000"))

# Default cache file location: <repo_chroma_parent>/embedding_cache.sqlite.
# Override via env if Render ephemeral volume wants a different disk path.
_DEFAULT_DB_PATH = os.getenv(
    "EMBEDDING_CACHE_PATH",
    str(Path(__file__).resolve().parent.parent / "embedding_cache.sqlite"),
)


def _normalize_key(queries: list[str]) -> str:
    """
    Collapse whitespace + lowercase across joined queries so "  Orbit AI  "
    and "orbit ai" hit the same slot. Matches the normalization in
    `embed_query` so the two paths can never disagree about what a key is.
    """
    return " ".join(" ".join(q.split()).lower() for q in queries)


def _key_to_hash(queries: list[str]) -> str:
    return hashlib.sha256(_normalize_key(queries).encode("utf-8")).hexdigest()


class EmbeddingCache:
    """Thread-safe SQLite embedding cache. One instance per process."""

    def __init__(self, path: str = _DEFAULT_DB_PATH) -> None:
        self._path = path
        # `check_same_thread=False` lets us hand the connection to worker
        # threads that the embedding function may spawn. We serialize all
        # access via `_lock` anyway.
        self._conn = sqlite3.connect(
            self._path,
            check_same_thread=False,
            isolation_level=None,  # autocommit — we manage transactions manually
        )
        self._lock = threading.Lock()
        self._ensure_schema()

    def _ensure_schema(self) -> None:
        with self._lock:
            try:
                self._conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS embeddings (
                        query_hash TEXT PRIMARY KEY,
                        dim INTEGER NOT NULL,
                        vec BLOB NOT NULL,
                        created_at REAL NOT NULL
                    )
                    """
                )
                self._conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_embeddings_created_at "
                    "ON embeddings(created_at)"
                )
            except sqlite3.DatabaseError as exc:  # pragma: no cover
                logger.error("Failed to create embedding cache schema: %s", exc)
                raise

    # ---- Public API -------------------------------------------------------
    def get(self, queries: list[str]) -> List[List[float]] | None:
        """
        Returns the cached 2D embedding matrix (one row per query) on hit,
        None on miss / disabled / error.
        """
        if EMBEDDING_CACHE_DISABLED:
            return None
        if not queries:
            return None
        key = _key_to_hash(queries)
        rows: list[sqlite3.Row] | None = None
        with self._lock:
            try:
                cur = self._conn.execute(
                    "SELECT dim, vec FROM embeddings WHERE query_hash = ?",
                    (key,),
                )
                rows = cur.fetchall()
            except sqlite3.DatabaseError as exc:
                logger.warning("embedding_cache.get failed: %s", exc)
                return None
        if not rows:
            return None
        # Cache stores a single row keyed on the joined normalized text;
        # the embedding function expects one row *per query* in its
        # input list. For the single-query case this is identical.
        dim, blob = rows[0]
        if dim <= 0 or not blob:
            return None
        # Decode float32 — we know the encoding we wrote.
        import struct

        count = len(blob) // 4
        if count != dim:
            logger.warning(
                "embedding_cache dim mismatch: stored=%d bytes=%d",
                dim,
                count,
            )
            return None
        floats = list(struct.unpack(f"<{count}f", blob))
        # Wrap as one row per query (matches GeminiEmbeddingFunction contract).
        return [floats]

    def put(self, queries: list[str], vectors: List[List[float]]) -> None:
        """
        Persist a query → 2D vector mapping. No-op on disabled cache or
        on any DB error (we never want cache writes to fail the chat).
        """
        if EMBEDDING_CACHE_DISABLED:
            return
        if not queries or not vectors:
            return
        # The `embed_query` path passes a flat 1×dim matrix even when the
        # input had multiple strings, because we currently only ever
        # embed one query string. Take the first row.
        row = vectors[0]
        if not row:
            return
        key = _key_to_hash(queries)
        dim = len(row)
        import struct

        blob = struct.pack(f"<{dim}f", *row)
        now = time.time()
        with self._lock:
            try:
                self._conn.execute(
                    """
                    INSERT INTO embeddings(query_hash, dim, vec, created_at)
                    VALUES(?, ?, ?, ?)
                    ON CONFLICT(query_hash) DO UPDATE SET
                        dim = excluded.dim,
                        vec = excluded.vec,
                        created_at = excluded.created_at
                    """,
                    (key, dim, blob, now),
                )
                self._prune_if_needed()
            except sqlite3.DatabaseError as exc:
                # Log only — never bubble up; losing a cache write is fine.
                logger.warning("embedding_cache.put failed: %s", exc)

    def _prune_if_needed(self) -> None:
        """Delete oldest rows when total exceeds the soft cap. Cheap in SQLite."""
        try:
            cur = self._conn.execute("SELECT COUNT(*) FROM embeddings")
            (count,) = cur.fetchone()
            if count > EMBEDDING_CACHE_MAX_ROWS:
                excess = count - EMBEDDING_CACHE_MAX_ROWS
                self._conn.execute(
                    "DELETE FROM embeddings WHERE query_hash IN ("
                    "  SELECT query_hash FROM embeddings "
                    "  ORDER BY created_at ASC LIMIT ?"
                    ")",
                    (excess,),
                )
        except sqlite3.DatabaseError as exc:
            logger.warning("embedding_cache.prune failed: %s", exc)

    def stats(self) -> dict[str, int | str]:
        with self._lock:
            try:
                cur = self._conn.execute("SELECT COUNT(*) FROM embeddings")
                (count,) = cur.fetchone()
            except sqlite3.DatabaseError:
                count = -1
        return {
            "rows": int(count),
            "max": EMBEDDING_CACHE_MAX_ROWS,
            "path": self._path,
            "enabled": int(not EMBEDDING_CACHE_DISABLED),
        }

    def clear(self) -> int:
        with self._lock:
            try:
                cur = self._conn.execute("SELECT COUNT(*) FROM embeddings")
                (count,) = cur.fetchone()
                self._conn.execute("DELETE FROM embeddings")
            except sqlite3.DatabaseError:
                return 0
        return int(count)


# Module-level singleton so we don't reopen SQLite on every embed call.
_singleton: EmbeddingCache | None = None
_singleton_lock = threading.Lock()


def get_embedding_cache() -> EmbeddingCache | None:
    """
    Return the process-wide embedding cache, opening it lazily. Returns
    None when disabled (so callers can skip the cache branch entirely).
    """
    global _singleton
    if EMBEDDING_CACHE_DISABLED:
        return None
    if _singleton is not None:
        return _singleton
    with _singleton_lock:
        if _singleton is None:
            try:
                _singleton = EmbeddingCache()
            except Exception as exc:  # pragma: no cover
                logger.error(
                    "Could not open embedding cache (%s); continuing without it.",
                    exc,
                )
                return None
    return _singleton
