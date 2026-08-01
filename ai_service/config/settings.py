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


settings = Settings()