import hashlib
import json
import logging
from pathlib import Path

import chromadb
# 🚀 Naya Import: ChromaDB ka built-in ONNX function
from chromadb.utils.embedding_functions import ONNXMiniLM_L6_V2

from config.settings import settings

logger = logging.getLogger(__name__)

_client = None
_collection = None

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

def _get_client() -> chromadb.ClientAPI:
    global _client
    if _client is None:
        _client = chromadb.PersistentClient(path=settings.CHROMA_DB_PATH)
    return _client

def _get_collection():
    global _collection
    if _collection is None:
        # 🚀 Initialize ONNX Embedding Function
        onnx_ef = ONNXMiniLM_L6_V2(preferred_providers=['CPUExecutionProvider'])
        
        # Collection banate waqt hi embedding function de diya
        _collection = _get_client().get_or_create_collection(
            name=settings.COLLECTION_NAME,
            embedding_function=onnx_ef,
            metadata={"hnsw:space": "cosine"},
        )
    return _collection


def ensure_embeddings(collection, chunks: list[dict]) -> int:
    """Embeds and upserts only the chunks not already present in ChromaDB."""
    added = 0
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

        # 🚀 No manual encoding needed! ChromaDB ab khud ONNX use karke vectors banayega
        collection.add(
            ids=[c["id"] for c in missing],
            documents=texts,
            metadatas=[c["metadata"] for c in missing],
        )
        added += len(missing)

    return added

def load_knowledge_into_chromadb(force: bool = False) -> int:
    """Loads ./knowledge_base.json into the 'portfolio_knowledge' collection."""
    client = _get_client()

    if force:
        try:
            client.delete_collection(settings.COLLECTION_NAME)
        except Exception:
            pass

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

    # 🚀 Seedha text query bhejo, Chroma khud embed karega!
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