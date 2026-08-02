"""
Custom ChromaDB embedding function backed by the modern `google-genai` SDK.

Why custom?
  - ChromaDB's built-in `GoogleGenerativeAiEmbeddingFunction` uses the
    deprecated `google.generativeai` package, which conflicts with the
    modern `google-genai` SDK on `ClientOptions` (`ClientOptions does not
    accept an option 'headers'`). Importing the built-in crashes at startup.
  - Our `google-genai` client is already constructed at app init, so we
    reuse it instead of standing up a second one.

Wire contract (ChromaDB):
  - `__call__(input: Documents) -> Embeddings` — sync entry point.
  - `name()` returns a deterministic name so Chroma collections can be
    reconstructed on subsequent runs without re-embedding unchanged rows.
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
            # Lazy construction: only here if the caller forgot to pass
            # the shared client (e.g. ad-hoc scripts / tests).
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
        """Sync entry point required by ChromaDB.

        ChromaDB passes a list of documents; we batch them into a single
        `embed_content` call so the API handles internal rate limits.
        """
        texts = list(input)
        if not texts:
            return []

        # Run the async batch from sync context. Each call sends the full
        # batch in one HTTP request — the SDK handles chunking server-side.
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            # We're inside a FastAPI request/ingestion thread that already
            # has a loop. Run the coroutine and wait — safe because the
            # underlying client uses its own httpx pool, not the loop.
            import concurrent.futures

            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
                future = ex.submit(
                    asyncio.run,
                    self._aembed(texts, _TASK_TYPE_DOCUMENT),
                )
                return future.result()
        else:
            return asyncio.run(self._aembed(texts, _TASK_TYPE_DOCUMENT))

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

    # ---- Helper for query-time embedding ---------------------------------
    async def embed_query(self, text: str) -> list[float]:
        """Embed a single query string with the retrieval-query task type."""
        results = await self._aembed([text], _TASK_TYPE_QUERY)
        return results[0] if results else []


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
