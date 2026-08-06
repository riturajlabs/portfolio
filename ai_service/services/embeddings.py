"""
Custom ChromaDB embedding function backed by the modern `google-genai` SDK.

Why custom?
  - ChromaDB's built-in `GoogleGenerativeAiEmbeddingFunction` uses the
    deprecated `google.generativeai` package, which conflicts with the
    modern `google-genai` SDK on `ClientOptions` (`ClientOptions does not
    accept an option 'headers'`). Importing the built-in crashes at startup.
  - Our `google-genai` client is already constructed at app init, so we
    reuse it instead of standing up a second one.

ChromaDB contract (verified against chromadb 0.5+):
  - Ingestion (`collection.add` / `get_or_create_collection(...).add`):
      calls `__call__(input: list[str]) -> list[list[float]]`.
      No `is_query` flag is passed at ingestion time.
  - Query (`collection.query(query_texts=...)`):
      calls `embed_query(input: str) -> list[list[float]]` — note:
        (a) the kwarg is `input`, not `text`, and
        (b) the return is 2D (one row per query), NOT a flat 1D vector.
            Earlier we returned `list[float]`, which raised
            `TypeError: 'float' object cannot be converted to 'Sequence'`.

Task-type handling:
  - For retrieval, Gemini has separate `RETRIEVAL_DOCUMENT` and
    `RETRIEVAL_QUERY` task types. We route based on which method
    ChromaDB called: `__call__` → document, `embed_query` → query.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Iterable

from google import genai
from google.genai import types as genai_types

# Persistent query-embedding cache (SQLite). Replaces the previous
# in-process OrderedDict LRU so warm caches survive Render restarts.
# See `services/embedding_cache.py` for the storage layout and pruning
# policy. The cache is opened lazily on first use; errors degrade to
# "no cache" so a corrupt DB never breaks `/chat`.
from services.embedding_cache import get_embedding_cache

logger = logging.getLogger(__name__)

# gemini-embedding-001 (a.k.a. text-embedding-005) — official Google
# replacement for the now-shutdown text-embedding-004.
#
# Why pin output_dimensionality to 768 instead of the model default (3072)?
#   - Render free tier has 512 MB RAM. Each chunk vector = 768 × 4 bytes
#     = 3 KB vs. 12 KB at 3072. At 55 chunks the savings are ~500 KB —
#     modest, but HNSW index memory grows faster than linear as the KB
#     scales. Pinning now avoids a forced re-ingestion later.
#   - Retrieval quality at 768 vs. 3072 on a 55-chunk portfolio KB is
#     indistinguishable in practice (embeddings saturate quickly for
#     small, well-curated corpora). We can re-evaluate if the KB grows
#     past ~500 chunks or if eval shows precision regressions.
#   - Changing this constant requires a forced re-ingestion (different
#     dim = different vector space), so the loader wipes Chroma on the
#     next startup when this changes.
_MODEL_NAME = "models/gemini-embedding-001"
_OUTPUT_DIM = 768
_TASK_TYPE_DOCUMENT = "RETRIEVAL_DOCUMENT"
_TASK_TYPE_QUERY = "RETRIEVAL_QUERY"


class GeminiEmbeddingFunction:
    """
    ChromaDB-compatible embedding function.

    Accepts an existing `genai.Client` so we don't create a duplicate
    auth client at startup. Falls back to constructing one from
    `GEMINI_API_KEY` if the caller passes None.
    """

    def __init__(self, client: genai.Client | None = None) -> None:
        if client is None:
            import os

            client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))
        self._client = client

    # ---- ChromaDB-required methods ---------------------------------------
    @staticmethod
    def name() -> str:
        # Stable identifier so Chroma can reuse the same collection across
        # restarts. Includes the model name so swapping models forces a
        # re-ingestion (matching the wipe-on-startup policy).
        return f"google-genai/{_MODEL_NAME}"

    def __call__(self, input: Iterable[str]) -> list[list[float]]:
        """Sync entry point — called by ChromaDB at ingestion time.

        ChromaDB passes a list of documents; we batch them into a single
        `embed_content` call so the API handles internal rate limits.
        """
        texts = list(input)
        if not texts:
            return []

        # ChromaDB requires `RETRIEVAL_DOCUMENT` for indexed chunks.
        return self._embed_sync(texts, _TASK_TYPE_DOCUMENT)

    def embed_query(self, input: str | list[str]) -> list[list[float]]:
        """Called by ChromaDB at query time.

        Contract (verified against chromadb 0.5+ AND 1.x):
          - Argument name MUST be `input` (not `text`).
          - ChromaDB 0.5.x passes a plain `str`; ChromaDB 1.x passes a
            list of query texts (`[query_text]`). Accept both.
          - Return type MUST be `list[list[float]]` (2D, one row per
            query). Returning a flat `list[float]` raises
            `TypeError: 'float' object cannot be converted to 'Sequence'`.
          - The actual type of `input` is `list[str]` (one entry per
            query in `query_texts=...`). Older ChromaDB versions passed
            a bare string, so we normalize to a list internally.

        Routes through the same batched path with `RETRIEVAL_QUERY`.
        Wrapped in a SQLite-backed cache (see `services/embedding_cache.py`)
        keyed on the normalized query — identical repeat questions re-use
        the first embed, saving a 100-300 ms Gemini round-trip per hit.
        """
        # Normalize to list[str]. Render's ChromaDB builds pass `input`
        # as a one-element list (the query_texts list passed to .query);
        # earlier versions passed a bare string. Handle both.
        queries = input if isinstance(input, list) else [input]
        # Flatten any nested lists defensively, then drop empties.
        queries = [
            q for q in queries
            if isinstance(q, str) and q
        ]
        if not queries:
            return [[]]

        # The SQLite cache is keyed on a single normalized query, so it
        # only serves the single-query path (what ChromaDB actually uses).
        # Multi-query batches bypass the cache and embed directly.
        use_cache = len(queries) == 1

        cache = get_embedding_cache() if use_cache else None
        if cache is not None:
            cached = cache.get(queries)
            if cached is not None and cached:
                return cached

        results = self._embed_sync(queries, _TASK_TYPE_QUERY)
        if not results:
            results = [[]] * len(queries)

        if use_cache and cache is not None and results[0]:
            cache.put(queries, [results[0]])

        return results

    # ---- Internals -------------------------------------------------------
    def _embed_sync(self, texts: list[str], task_type: str) -> list[list[float]]:
        """
        Run the async batched `embed_content` call from sync context.

        ChromaDB can call us from a worker thread (ingestion) or from
        the FastAPI event loop (query). Both paths must work:
          - No running loop → `asyncio.run` is fine.
          - Loop already running → we offload to a private thread so we
            don't try to nest event loops. The underlying genai client
            uses its own httpx pool, so cross-thread invocation is safe.
        """
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            import concurrent.futures

            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
                future = ex.submit(
                    asyncio.run,
                    self._aembed(texts, task_type),
                )
                return future.result()
        else:
            return asyncio.run(self._aembed(texts, task_type))

    async def _aembed(
        self, texts: list[str], task_type: str
    ) -> list[list[float]]:
        """Async batch embed. One network call for all inputs."""
        config = genai_types.EmbedContentConfig(
            task_type=task_type,
            output_dimensionality=_OUTPUT_DIM,
        )
        response = await self._client.aio.models.embed_content(
            model=_MODEL_NAME,
            contents=texts,
            config=config,
        )
        # Response.embeddings is a list of ContentEmbedding objects, each
        # with a `.values` attribute holding the float vector.
        return [list(e.values or []) for e in (response.embeddings or [])]


# Module-level singleton so we only build one client per process.
_client: genai.Client | None = None
_function: GeminiEmbeddingFunction | None = None


# ==========================================
# 🗃️  Query embedding cache (now SQLite-backed)
# ==========================================
# The in-process OrderedDict LRU that used to live here has been replaced
# by `services/embedding_cache.py` so warm caches survive process restarts
# (Render redeploys, cold starts). Operations degrade gracefully — a
# missing/corrupt cache file just means we re-embed from Gemini on the
# next call.
#
# Quick test helper to drop the persisted cache during local dev:
def clear_query_cache() -> None:
    """Test helper: drop all cached embeddings."""
    cache = get_embedding_cache()
    if cache is not None:
        cache.clear()


def get_embedding_function() -> GeminiEmbeddingFunction:
    """Return the process-wide embedding function (lazy-initialised)."""
    global _client, _function
    if _function is None:
        import os

        _client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))
        _function = GeminiEmbeddingFunction(client=_client)
    return _function


def reset_embedding_function_for_tests() -> None:
    """Allow tests to rebuild the singleton after env mutation."""
    global _client, _function
    _client = None
    _function = None