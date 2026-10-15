"""Shared pytest fixtures for ai_service.

Brings `ai_service/` onto `sys.path` so `config`, `core`, `services` and
`routes` import normally, and provides:
  * the canonical `/api/content` payload (from `.cache/content-snapshot.json`),
  * a hermetic Chroma environment (tmp dir + deterministic fake embeddings),
  * helpers that turn that payload into validated Content / RAG chunks.
"""
from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path

import pytest

AI_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = AI_ROOT.parent
if str(AI_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_ROOT))


class FakeEmbeddingFunction:
    """Deterministic, offline, token-overlap (normalized bag-of-words) embedding.

    Satisfies the ChromaDB embedding-function contract exactly like the real
    Gemini function (`services/embeddings.py`):
      * `__call__(input: Iterable[str]) -> list[list[float]]` — ingestion,
      * `embed_query(input) -> list[list[float]]` (input may be str or list) —
        query time,
      * `name() -> str` for Chroma's collection/EF identity.

    Cosine similarity here is a proxy for term overlap, which is enough to
    assert plumbing-level answerability (classifier source filters, chunk text
    presence) without any network or API key. The production Gemini embeddings
    provide the real semantic quality; these tests never measure that.
    """

    def __init__(self, dim: int = 512) -> None:
        self._dim = dim

    def name(self) -> str:
        return "fake/fake-bow-512"

    def _embed(self, texts: list[str]) -> list[list[float]]:
        out = []
        for text in texts:
            vec = [0.0] * self._dim
            for token in text.lower().split():
                index = int(hashlib.md5(token.encode("utf-8")).hexdigest(), 16) % self._dim
                vec[index] += 1.0
            norm = math.sqrt(sum(x * x for x in vec)) or 1.0
            out.append([x / norm for x in vec])
        return out

    def __call__(self, input):
        return self._embed(list(input))

    def embed_query(self, input):
        queries = input if isinstance(input, list) else [input]
        return self._embed(queries)


def _canonical_payload_dict() -> dict:
    """The canonical `/api/content` payload for tests.

    `content-snapshot.json` is byte-deterministic and deliberately omits
    `meta.generated_at` and its `_migration` bookkeeping key; the live API adds
    `meta`, so we strip the bookkeeping and inject `meta` exactly as the API
    would.
    """
    data = json.loads((REPO_ROOT / ".cache" / "content-snapshot.json").read_text(encoding="utf-8"))
    data.pop("_migration", None)
    data.setdefault(
        "meta",
        {"generated_at": "2026-01-01T00:00:00+00:00", "version": 1},
    )
    return data


@pytest.fixture(scope="session")
def canonical_payload() -> dict:
    return _canonical_payload_dict()


@pytest.fixture(scope="session")
def content(canonical_payload):
    """The validated Content object for the canonical payload."""
    from services.content_api import validate_content_payload

    return validate_content_payload(canonical_payload)


@pytest.fixture(scope="session")
def content_chunks(content):
    """The RAG chunk set the Phase 9 transformation produces for canonical content."""
    from services import content_api

    return content_api.chunks_from_sections(content_api.sections_from_content(content))


@pytest.fixture
def chroma(monkeypatch, tmp_path):
    """A hermetic Chroma environment: tmp dir, unique collection, fake EF.

    Rewires `knowledge_loader` globals so each test starts from a clean
    collection and nothing touches a real network or the on-disk `chroma_db/`.
    `knowledge_loader` is yielded for direct manipulation (e.g. source mode).
    """
    from config.settings import settings
    from services import knowledge_loader as kl

    monkeypatch.setattr(settings, "CHROMA_DB_PATH", str(tmp_path / "chroma"))
    monkeypatch.setattr(settings, "COLLECTION_NAME", "test_knowledge")
    monkeypatch.setattr(kl, "_build_embedding_function", lambda: FakeEmbeddingFunction())

    kl._client = None
    kl._collection = None
    kl._ef = None
    yield kl

    kl._client = None
    kl._collection = None
    kl._ef = None