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
      calls `embed_query(input: str) -> list[float]` — note the kwarg is
      `input`, not `text`. Earlier we had the right name but our wrapper
      raised `TypeError: ... unexpected keyword argument 'input'`
      because we never actually exposed `embed_query` to ChromaDB (only
      `__call__`). ChromaDB's CollectionCommon dispatches to
      `embed_query` at query time, so the method must exist with the
      exact signature `embed_query(self, input: str)`.

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

logger = logging.getLogger(__name__)

# gemini-embedding-001 (a.k.a. text-embedding-005) — official Google
# replacement for the now-shutdown text-embedding-004.
# Configurable output dimensionality; we pin to 768 to match the existing
# vector space (changing dim requires a Chroma re-ingestion).
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

    def embed_query(self, input: str) -> list[float]:
        """Called by ChromaDB at query time.

        ⚠️  Argument name MUST be `input` — that's what ChromaDB passes.
        Earlier versions of this file used `text`, which raised
        `TypeError: embed_query() got an unexpected keyword argument 'input'`.

        Routes through the same batched path with `RETRIEVAL_QUERY`.
        """
        if not input:
            return []
        results = self._embed_sync([input], _TASK_TYPE_QUERY)
        return results[0] if results else []

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