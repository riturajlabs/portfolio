import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    # --- Auth ---
    # Shared secret between frontend and backend. Must be set in production.
    AI_SERVICE_KEY: str = os.getenv("AI_SERVICE_KEY", "")

    # --- AI API Keys ---
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    GROQ_MODEL: str = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

    # 🚀 Gemini API Key Variable
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")

    # --- GitHub (used by /api/github proxy) ---
    # Optional but recommended. With a token: 5000 req/hr; without: 60 req/hr/IP.
    GITHUB_TOKEN: str = os.getenv("GITHUB_TOKEN", "")
    GITHUB_USERNAME: str = os.getenv("GITHUB_USERNAME", "riturajlabs")

    # --- Database & Knowledge Settings ---
    CHROMA_DB_PATH: str = os.getenv("CHROMA_DB_PATH", "./chroma_db")
    # Default path is relative to the ai_service/ directory at runtime.
    # knowledge_loader.py additionally searches ./knowledge_base.json and
    # ../server/knowledge_base.json as fallbacks to remain backward-compatible
    # with legacy layouts.
    KNOWLEDGE_FILE: str = os.getenv("KNOWLEDGE_FILE", "./knowledge_base.json")
    COLLECTION_NAME: str = os.getenv("COLLECTION_NAME", "portfolio_knowledge")

    # --- Retrieval tuning ---
    # top_k=5 + score_threshold=0.7 outperforms (3, 0.65) on multi-part
    # questions (better recall) without losing precision: a slightly
    # stricter threshold keeps low-signal chunks out of the prompt, so
    # the model has fewer chances to hallucinate. See the retrieval bench
    # in perf-notes.md for the eval queries that justify these values.
    # Override at runtime via CHAT_TOP_K / CHAT_SCORE_THRESHOLD env vars.
    CHAT_TOP_K: int = int(os.getenv("CHAT_TOP_K", "5"))
    CHAT_SCORE_THRESHOLD: float = float(
        os.getenv("CHAT_SCORE_THRESHOLD", "0.7")
    )

    # --- Caching ---
    # LLM response TTL cache. TTL 60-300s is the sweet spot for portfolio
    # traffic — long enough to absorb refresh-spam and multi-tab spikes,
    # short enough to recover from prompt drift automatically.
    LLM_CACHE_ENABLED: bool = os.getenv("LLM_CACHE_ENABLED", "1") not in (
        "0",
        "false",
        "no",
    )
    LLM_CACHE_TTL_SECONDS: float = float(os.getenv("LLM_CACHE_TTL_SECONDS", "120"))
    LLM_CACHE_MAX_ENTRIES: int = int(os.getenv("LLM_CACHE_MAX_ENTRIES", "256"))

    # Embedding cache (SQLite-backed).
    EMBEDDING_CACHE_DISABLED: bool = os.getenv(
        "EMBEDDING_CACHE_DISABLED", "0"
    ) in ("1", "true", "yes")
    EMBEDDING_CACHE_MAX_ROWS: int = int(os.getenv("EMBEDDING_CACHE_MAX_ROWS", "1000"))
    EMBEDDING_CACHE_PATH: str = os.getenv(
        "EMBEDDING_CACHE_PATH", "./embedding_cache.sqlite"
    )

    # --- Provider routing ---
    # Queries whose total length (message + last-N-turn history) is below
    # this threshold go to Groq first; longer queries go to Gemini first.
    # Render's measurements: Groq TTFB ~150ms vs Gemini ~600ms cold-start,
    # so short questions get Groq and we save ~450ms per request. Long
    # multi-part questions still prefer Gemini for reasoning quality.
    SHORT_QUERY_TOKEN_THRESHOLD: int = int(
        os.getenv("SHORT_QUERY_TOKEN_THRESHOLD", "100")
    )
    # Hard override: pin the primary provider regardless of length.
    # "auto" | "groq" | "gemini". Use "gemini" to roll back cleanly.
    PRIMARY_PROVIDER: str = os.getenv("PRIMARY_PROVIDER", "auto")

    # --- Admin (cache management) ---
    # Token required by the `/admin/cache/*` endpoints. If empty, admin
    # routes are disabled (404). Distinct from AI_SERVICE_KEY so a
    # leaked chat key never grants cache-purge rights.
    ADMIN_TOKEN: str = os.getenv("ADMIN_TOKEN", "")


settings = Settings()