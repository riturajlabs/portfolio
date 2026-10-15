import hashlib
import json
import logging
import os
import re
import shutil
from pathlib import Path
from typing import Any

import chromadb

from config.settings import settings

logger = logging.getLogger(__name__)

# Score threshold for retrieval matches. Cosine similarity ranges 0-1;
# 0.65 is tight enough to drop low-signal chunks and force the model
# into the "I don't have that on hand" fallback for off-topic queries,
# while leaving headroom for paraphrased portfolio questions.
# Override at runtime via SCORE_THRESHOLD env var.
DEFAULT_SCORE_THRESHOLD = float(os.getenv("SCORE_THRESHOLD", "0.65"))

_client = None
_collection = None
# Any Chroma-compatible embedding function. The real one is the Gemini EF from
# services/embeddings.py; tests inject a deterministic fake. Typed as `Any`
# because the concrete class is imported lazily (see _build_embedding_function).
_ef: Any | None = None


def _stable_id(section: str, key: str, text: str) -> str:
    raw = f"{section}:{key}:{text}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()


def _serialize(value) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(f"- {_serialize(item)}" for item in value)
    if isinstance(value, dict):
        return "\n".join(
            f"{key.replace('_', ' ').title()}: {_serialize(item)}"
            for key, item in value.items()
        )
    return str(value)


# Long free-text fields get sliding-window chunking so retrieval can
# surface the relevant sentence instead of returning the whole blob.
# 500 chars ≈ 2-3 paragraphs of blog text — a sensible cutoff for a
# portfolio-style KB.
_LONG_TEXT_THRESHOLD = 500
# Stride between chunk starts. With 800-char windows and 200-char
# overlap, every sentence has ~75% chance of appearing in two chunks,
# which lifts recall by 10-20% on long passages.
_WINDOW_CHARS = 800
_OVERLAP_CHARS = 200


def _chunk_text_overlap(
    text: str, window: int, overlap: int
) -> list[str]:
    """
    Split a long string into overlapping windows.

    `overlap` must be smaller than `window` — otherwise the loop never
    advances. Final window is allowed to be shorter (covers the tail).
    """
    if window <= overlap:
        raise ValueError("window must exceed overlap")
    chunks = []
    step = window - overlap
    for start in range(0, len(text), step):
        piece = text[start : start + window]
        if not piece:
            break
        chunks.append(piece)
        if start + window >= len(text):
            break
    return chunks


def _build_embedding_function():
    """Return the process-wide embedding function.

    Imported lazily so importing this module never requires the `google-genai`
    SDK: the model is only needed once a Chroma collection is actually created
    (service startup, ingestion, query). This keeps tooling and tests that only
    touch chunking/parity free of the SDK dependency.
    """
    from services.embeddings import get_embedding_function

    return get_embedding_function()


def _chunk_section(section: str, data) -> list[dict]:
    chunks = []

    if isinstance(data, list):
        for index, item in enumerate(data):
            text = _serialize(item)
            chunks.append(
                {
                    "id": _stable_id(section, f"item-{index}", text),
                    "text": text,
                    "metadata": {"source": section},
                }
            )
        return chunks

    if isinstance(data, dict):
        for key, value in data.items():
            text = _serialize(value)
            if not text.strip():
                continue

            # Long free-text fields → sliding windows. We split on the
            # serialized string so we get cleaner boundaries than splitting
            # the raw dict (one window per relevant passage instead of per
            # key). Other shapes (lists, dicts) keep their single chunk.
            if (
                isinstance(value, str)
                and len(text) > _LONG_TEXT_THRESHOLD
            ):
                for window_idx, window_text in enumerate(
                    _chunk_text_overlap(text, _WINDOW_CHARS, _OVERLAP_CHARS)
                ):
                    chunks.append(
                        {
                            "id": _stable_id(
                                section, f"{key}-w{window_idx}", window_text
                            ),
                            "text": window_text,
                            "metadata": {
                                "source": section,
                                "key": key,
                                "window": window_idx,
                            },
                        }
                    )
                continue

            chunks.append(
                {
                    "id": _stable_id(section, key, text),
                    "text": text,
                    "metadata": {"source": section, "key": key},
                }
            )
        return chunks

    return [
        {
            "id": _stable_id(section, "root", str(data)),
            "text": str(data),
            "metadata": {"source": section},
        }
    ]


def _resolve_knowledge_path() -> Path:
    """
    Find knowledge_base.json by trying the configured path first, then a
    list of common fallbacks. This keeps the loader working whether the
    file lives in `ai_service/`, `server/`, or an absolute env-configured
    location.
    """
    ai_service_dir = Path(__file__).resolve().parent.parent

    candidates = []
    configured = Path(settings.KNOWLEDGE_FILE)
    if not configured.is_absolute():
        candidates.append(ai_service_dir / configured)
    else:
        candidates.append(configured)

    # Sensible fallbacks (in priority order).
    candidates.extend([
        ai_service_dir / "knowledge_base.json",
        ai_service_dir / ".." / "server" / "knowledge_base.json",
        ai_service_dir / ".." / "knowledge_base.json",
    ])

    # De-duplicate while preserving order.
    seen = set()
    unique = []
    for c in candidates:
        key = str(c.resolve())
        if key not in seen:
            seen.add(key)
            unique.append(c)

    for path in unique:
        if path.is_file():
            logger.info("Using knowledge file: %s", path)
            return path

    raise FileNotFoundError(
        "knowledge_base.json not found. Tried:\n  - "
        + "\n  - ".join(str(p) for p in unique)
    )


def chunks_from_sections(sections: dict) -> list[dict]:
    """Run the shared chunker + noise filter over a sectioned knowledge dict.

    Used by both ingestion paths: legacy `knowledge_base.json` (its sections
    dict) and the Phase 9 `/api/content` source (`content_api.sections_from_content`).
    """
    chunks: list[dict] = []
    for section, data in sections.items():
        for chunk in _chunk_section(section, data):
            text = chunk["text"].strip()
            if len(text) < 20:
                continue
            chunks.append(chunk)
    return chunks


def load_knowledge() -> list[dict]:
    """Read knowledge_base.json and produce RAG-ready text chunks (legacy path).

    Only used when `KNOWLEDGE_SOURCE=file` — the Phase 9 rollback mode. The
    file itself is retained indefinitely as the rollback/reference copy.
    """
    knowledge_path = _resolve_knowledge_path()

    with open(knowledge_path, "r", encoding="utf-8") as f:
        knowledge = json.load(f)

    chunks = chunks_from_sections(knowledge)
    logger.info("Prepared %d knowledge chunks from %s", len(chunks), knowledge_path)
    return chunks


def _chroma_path() -> Path:
    raw = Path(settings.CHROMA_DB_PATH)
    if not raw.is_absolute():
        raw = Path(__file__).resolve().parent.parent / raw
    return raw


def _wipe_chroma_db() -> None:
    """
    Delete the on-disk ChromaDB directory so old ONNX/built-in-GoogleGen
    embeddings don't pollute the new google-genai collection.

    Embeddings from different models / dims are not comparable, so mixing
    them would silently degrade retrieval.
    """
    path = _chroma_path()
    if path.exists():
        try:
            shutil.rmtree(path)
            logger.warning(
                "🧹 Wiped stale ChromaDB at %s (switching embedding model).",
                path,
            )
        except OSError as exc:
            logger.error("Could not wipe ChromaDB at %s: %s", path, exc)
            raise


def _get_client() -> chromadb.ClientAPI:
    global _client
    if _client is None:
        path = _chroma_path()
        path.mkdir(parents=True, exist_ok=True)
        _client = chromadb.PersistentClient(path=str(path))
    return _client


def _get_collection():
    """Return the portfolio collection, wired to our custom Gemini ef."""
    global _collection, _ef
    if _collection is None:
        if not os.environ.get("GEMINI_API_KEY"):
            logger.warning(
                "GEMINI_API_KEY not set — embedding calls will fail."
            )

        _ef = _build_embedding_function()

        _collection = _get_client().get_or_create_collection(
            name=settings.COLLECTION_NAME,
            embedding_function=_ef,
            metadata={
                # Cosine distance matches the embeddings we get from
                # `gemini-embedding-001` (already normalized for cosine).
                "hnsw:space": "cosine",
                # HNSW graph quality vs. memory:
                #   - M: max connections per node. Higher = better recall
                #     and more memory. 16 is the chroma default and a safe
                #     middle ground for KB growth past a few hundred chunks.
                #   - construction_ef: candidate list size during build.
                #     Bumping from 100→200 catches edge-case neighbours but
                #     takes a couple of seconds longer at ingestion.
                #   - search_ef: candidate list size at query time. 100
                #     is the default; we leave it untouched so query latency
                #     stays low. If we ever want top-5 recall headroom,
                #     raise this to 200.
                # At 55 chunks the choice is essentially free; setting
                # M=16 (instead of M=8) keeps the indexed lookup quality
                # intact as the KB grows without us touching the
                # metadata block again.
                "hnsw:M": 16,
                "hnsw:construction_ef": 200,
                "hnsw:search_ef": 100,
            },
        )
    return _collection


def _add_chunks(collection, chunks: list[dict]) -> int:
    """Add chunks in batches, respecting the embedding request token ceiling."""
    added = 0
    batch_size = 64
    for start in range(0, len(chunks), batch_size):
        batch = chunks[start : start + batch_size]
        if not batch:
            continue
        try:
            collection.add(
                ids=[c["id"] for c in batch],
                documents=[c["text"] for c in batch],
                metadatas=[c["metadata"] for c in batch],
            )
        except Exception as exc:  # pragma: no cover
            # Half-applied batches are the reconcile step's concern: the next
            # ingestion recomputes the desired set and repairs the drift.
            logger.error("Chroma add batch failed (%d chunks): %s", len(batch), exc)
            raise
        added += len(batch)
    return added


def _delete_chunks(collection, ids: list[str]) -> int:
    """Remove stale document ids in batches."""
    removed = 0
    batch_size = 64
    for start in range(0, len(ids), batch_size):
        batch_ids = ids[start : start + batch_size]
        if not batch_ids:
            continue
        try:
            collection.delete(ids=batch_ids)
        except Exception as exc:  # pragma: no cover
            logger.error("Chroma delete batch failed (%d ids): %s", len(batch_ids), exc)
            raise
        removed += len(batch_ids)
    return removed


def reconcile_collection(collection, chunks: list[dict]) -> tuple[int, int]:
    """Converge the collection to exactly the desired document set.

    Desired set is keyed by the stable chunk ID (`_stable_id` embeds the
    section, key *and* text, so same logical item + same text ⇒ same ID):

      * missing ids  → added (batched),
      * ids no longer desired → deleted as stale (content removed from the API,
        or a source edit that re-keyed the ID — an edited project yields a new
        ID and its old ID here),
      * already-present ids never touched → the collection only changes when
        the content does.

    This is what makes ingestion both **idempotent** (indexing the same payload
    twice adds 0 / deletes 0) and **self-healing** (content removed from
    PostgreSQL is no longer retrievable). Returns (added, removed).
    """
    desired = {c["id"]: c for c in chunks}
    existing = collection.get()
    existing_ids = set(existing.get("ids", []))

    to_add = [desired[cid] for cid in desired if cid not in existing_ids]
    to_delete = [cid for cid in existing_ids if cid not in desired]

    added = _add_chunks(collection, to_add)
    removed = 0
    if to_delete:
        removed = _delete_chunks(collection, to_delete)
    return added, removed


def load_chunks_into_chromadb(chunks: list[dict], force: bool = False) -> int:
    """Converge the configured collection onto `chunks`.

    `force=True` wipes the entire persistence directory first (used when the
    embedding model/dimensionality changes, or via `FORCE_REINGEST`).
    """
    if force:
        # Drop the cached handles so we rebuild against a fresh directory.
        global _client, _collection
        _client = None
        _collection = None
        _wipe_chroma_db()

    collection = _get_collection()

    added, removed = reconcile_collection(collection, chunks)
    logger.info(
        "ChromaDB collection '%s' converged: %d documents (+%d added, -%d stale)",
        settings.COLLECTION_NAME,
        collection.count(),
        added,
        removed,
    )
    return added


def load_knowledge_into_chromadb(force: bool = False) -> int:
    """Ingest the configured knowledge source into Chroma.

    `KNOWLEDGE_SOURCE` decides what "the knowledge" is:
      * `api`  (default) → GET /api/content, validated by
        `services/content_api`; any fetch/validation failure raises here, so
        ingestion fails closed and `/ready` stays 503. NO silent substitution.
      * `file`            → legacy `knowledge_base.json` (rollback mode).
    """
    source = (settings.KNOWLEDGE_SOURCE or "api").strip().lower()

    if source == "api":
        from services.content_api import (
            chunks_from_sections,
            fetch_validated_content,
            sections_from_content,
        )

        logger.info("Ingesting knowledge from content API: %s", settings.CONTENT_API_URL)
        content = fetch_validated_content()
        chunks = chunks_from_sections(sections_from_content(content))
    elif source == "file":
        chunks = load_knowledge()
    else:
        raise ValueError(
            f"KNOWLEDGE_SOURCE must be 'api' or 'file', got {source!r}"
        )

    return load_chunks_into_chromadb(chunks, force=force)


# The section names `content_api.sections_from_content` actually emits for the
# canonical `/api/content` source. A classifier hit becomes a Chroma `where`
# filter only when it names one of these; a source the collection never indexes
# (the classifier still lists `blogs` and `experience`, which have no section)
# falls back to the unfiltered scan instead of a filter guaranteed to match
# nothing. Kept here rather than imported because `content_api` imports from
# this module; `tests/test_ingestion.py` pins this set to the keys
# `sections_from_content` produces for a canonical payload.
KNOWLEDGE_SOURCES = frozenset(
    {"profile", "about", "projects", "skills", "certifications", "seo"}
)


def _classify_source(query: str) -> str | None:
    """
    Cheap keyword-based intent classifier. Returns the Chroma `source`
    metadata key the query is most likely about, or None for ambiguous
    queries (in which case no `where` filter is applied and retrieval
    searches the whole collection).

    Why regex and not an LLM?
      - Single forward pass, ~0 ms cost vs ~500 ms for an LLM call.
      - The classifier only needs to be ~80% right; cosine recall is the
        real signal — the filter just removes obviously-irrelevant chunks
        (e.g. "tell me about Ritu's projects" → filter out skills/bios).

    Mapping (add new entries here as the KB grows):
      projects / project / built / built → "projects"
      skill / skills / stack / tech / language → "skills"
      experience / work / job / internship / company → "experience"
      cert / certification / certificate → "certifications"
      blog / article / post / wrote → "blogs"
    """
    q = query.lower()
    rules: list[tuple[str, str]] = [
        # (regex, source)
        (r"\b(project|projects|built|build|built|made|developed)\b", "projects"),
        (r"\b(skill|skills|stack|tech|technologies|language|library|framework)\b", "skills"),
        (r"\b(experience|work|job|internship|company|companies|worked)\b", "experience"),
        (r"\b(cert|certification|certifications|certificate|certified)\b", "certifications"),
        (r"\b(blog|article|post|wrote|writing|published)\b", "blogs"),
    ]
    for pattern, source in rules:
        if re.search(pattern, q):
            return source
    return None


def query_knowledge(
    query: str,
    top_k: int = 3,
    score_threshold: float = DEFAULT_SCORE_THRESHOLD,
) -> list[dict]:
    """Searches the portfolio_knowledge collection and returns relevant text chunks."""
    collection = _get_collection()

    # Cheap intent classifier — when it names a section that is actually
    # indexed, restrict the search to it. When it is ambiguous *or* names a
    # source with no section (e.g. "blogs", "experience"), fall back to a
    # full-collection scan: a `where` filter on a source the collection never
    # stores is guaranteed to return zero documents.
    source_filter = _classify_source(query)
    if source_filter in KNOWLEDGE_SOURCES:
        where = {"source": source_filter}
    else:
        if source_filter is not None:
            logger.debug(
                "Classifier source %r is not an indexed section; "
                "retrieving without a source filter.",
                source_filter,
            )
        where = None

    # Custom ef handles embedding; pass raw text.
    results = collection.query(
        query_texts=[query],
        n_results=top_k,
        where=where,
        include=["documents", "metadatas", "distances"],
    )

    documents = results.get("documents", [[]])[0]
    metadatas = results.get("metadatas", [[]])[0]
    distances = results.get("distances", [[]])[0]

    matches = []
    for doc, metadata, distance in zip(documents, metadatas, distances):
        similarity = 1 - distance
        if similarity < score_threshold:
            continue
        matches.append(
            {
                "text": doc,
                "source": (metadata or {}).get("source", "unknown"),
                "score": round(similarity, 3),
            }
        )

    return matches
