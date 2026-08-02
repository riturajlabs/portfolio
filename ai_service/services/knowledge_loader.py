import hashlib
import json
import logging
import os
import shutil
from pathlib import Path

import chromadb

from config.settings import settings
from services.embeddings import (
    GeminiEmbeddingFunction,
    get_embedding_function,
)

logger = logging.getLogger(__name__)

_client = None
_collection = None
_ef: GeminiEmbeddingFunction | None = None


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


def load_knowledge() -> list[dict]:
    """Reads knowledge_base.json and produces RAG-ready text chunks."""
    knowledge_path = _resolve_knowledge_path()

    with open(knowledge_path, "r", encoding="utf-8") as f:
        knowledge = json.load(f)

    chunks: list[dict] = []
    for section, data in knowledge.items():
        for chunk in _chunk_section(section, data):
            text = chunk["text"].strip()
            if len(text) < 20:
                continue
            chunks.append(chunk)

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

        _ef = get_embedding_function()

        _collection = _get_client().get_or_create_collection(
            name=settings.COLLECTION_NAME,
            embedding_function=_ef,
            metadata={"hnsw:space": "cosine"},
        )
    return _collection


def ensure_embeddings(collection, chunks: list[dict]) -> int:
    """Embeds and upserts only the chunks not already present in ChromaDB."""
    added = 0
    # Batch size for a single `embed_content` call. The Gemini SDK handles
    # internal chunking, so 64 keeps the request count low without hitting
    # the per-request input token ceiling.
    batch_size = 64

    for start in range(0, len(chunks), batch_size):
        batch = chunks[start : start + batch_size]
        ids = [c["id"] for c in batch]

        existing = collection.get(ids=ids)
        existing_ids = set(existing.get("ids", []))
        missing = [c for c in batch if c["id"] not in existing_ids]

        if not missing:
            continue

        texts = [c["text"] for c in missing]

        # Chroma will call our custom ef's __call__ once with `texts`.
        collection.add(
            ids=[c["id"] for c in missing],
            documents=texts,
            metadatas=[c["metadata"] for c in missing],
        )
        added += len(missing)

    return added


def load_knowledge_into_chromadb(force: bool = False) -> int:
    """
    Loads ./knowledge_base.json into the configured Chroma collection.

    If `force=True` (or the on-disk DB predates the current embedding
    model), the entire persistence directory is wiped before re-ingestion.
    """
    if force:
        # Drop the cached handles so we rebuild against a fresh directory.
        global _client, _collection
        _client = None
        _collection = None
        _wipe_chroma_db()

    client = _get_client()
    collection = _get_collection()

    chunks = load_knowledge()
    added = ensure_embeddings(collection, chunks)
    logger.info(
        "ChromaDB collection '%s' now has %d documents (+%d added)",
        settings.COLLECTION_NAME,
        collection.count(),
        added,
    )
    return added


def query_knowledge(query: str, top_k: int = 5, score_threshold: float = 0.4) -> list[dict]:
    """Searches the portfolio_knowledge collection and returns relevant text chunks."""
    collection = _get_collection()

    # Custom ef handles embedding; pass raw text.
    results = collection.query(
        query_texts=[query],
        n_results=top_k,
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
