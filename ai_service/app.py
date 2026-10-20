import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded

from core.rate_limit import limiter, rate_limit_exceeded_handler
from core.startup import is_knowledge_ready, startup_knowledge_loading
from routes.admin import router as admin_router
from routes.chat import router
from routes.contact import router as contact_router
from routes.github import router as github_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 🟢 Fire-and-forget ChromaDB ingestion so the server can accept
    # requests immediately. /ready returns 503 until ingestion completes.
    startup_knowledge_loading()

    # 🟢 Warm the embedding function + genai.Client at startup so the first
    # /chat request doesn't pay the cold-start init cost (~100-300 ms).
    # Ingestion itself is already kicked off above; this only ensures the
    # genai.Client object exists in memory.
    try:
        from services.embeddings import get_embedding_function

        get_embedding_function()
        logger.info("✅ Embedding function warmed at startup.")
    except Exception as exc:  # noqa: BLE001  # pragma: no cover
        # Don't crash the app if warm-up fails — first request will retry.
        logger.warning("⚠️ Embedding function warm-up failed: %s", exc)

    yield


app = FastAPI(
    title="Ritu Raj Portfolio AI Assistant",
    description="RAG-powered portfolio assistant built with FastAPI, ChromaDB, and Groq",
    version="1.0.0",
    lifespan=lifespan,
)

# 🛡️ Rate limiting: slowapi Limiter is stored on app.state so decorators
#    like @limiter.limit("10/minute") can find it from any route module.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)


# ==========================================
# 🌐 CORS — locked down by default; configurable via env.
# ==========================================
# SECURITY POLICY:
#   - Default = ONLY the deployed Vercel domain + local dev origins.
#   - Override via ALLOWED_ORIGINS env var (comma-separated list, no spaces).
#   - To explicitly allow any origin (NOT recommended in production),
#     set ALLOWED_ORIGINS="*".
#
# LEAST-PRIVILEGE (U7 / AI-1). The verified browser→AI-service surface is
# narrow:
#   * In production the browser never calls this service cross-origin — chat
#     goes same-origin to `/api/chat/*` and Vercel's edge middleware rewrites
#     it to the Render origin. `/contact`, `/github` and `/admin/*` are
#     server-to-server calls from the backend (`AI_SERVICE_URL`) that send no
#     `Origin` header, so CORS does not apply to them.
#   * The only cross-origin browser flow is local dev
#     (`VITE_BACKEND_URL=http://localhost:8000` → this service). That flow is
#     exclusively `POST` to `/chat` and `/chat/stream`, sending
#     `Content-Type: application/json` and `Accept: text/event-stream`.
# Therefore: methods are POST-only, request headers are Content-Type-only, and
# credentials stay off (the chat client sends no cookies; the shared
# `X-API-Key` is injected by the edge, never by the browser). SSE is a response
# stream over the same POST — no extra method or header is required.
# ==========================================
_DEFAULT_ORIGINS = (
    "https://riturajlabs.vercel.app,"
    "http://localhost:5173,"
    "http://127.0.0.1:5173"
)

_allowed_origins_env = os.getenv("ALLOWED_ORIGINS", _DEFAULT_ORIGINS)

if _allowed_origins_env.strip() == "*":
    # Operator opted into wildcard — log a loud warning so it's visible in logs.
    logger.warning(
        "⚠️  CORS is set to '*' (wildcard). This is unsafe for production. "
        "Set ALLOWED_ORIGINS to your frontend domain(s)."
    )
    allow_origins = ["*"]
else:
    allow_origins = [
        o.strip() for o in _allowed_origins_env.split(",") if o.strip()
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    # The chat client never sends cookies or auth headers from the browser, so
    # credentialed CORS is unnecessary and stays off (it is also incompatible
    # with a wildcard origin).
    allow_credentials=False,
    # Only the chat endpoints are ever called cross-origin, and only via POST.
    allow_methods=["POST"],
    # The browser sets exactly this request header; `Accept` is a CORS-safelisted
    # header and needs no allow-list entry.
    allow_headers=["Content-Type"],
)

app.include_router(router)
app.include_router(github_router)
app.include_router(contact_router)
app.include_router(admin_router)


# ==========================================
# 🩺 Liveness vs Readiness
# ==========================================
# /health  → liveness: "is the process alive?" (Render health-check target)
# /ready  → readiness: "has ChromaDB finished ingesting?" (gates /chat)
# ==========================================
@app.api_route("/", methods=["GET", "HEAD"])
async def root():
    return {
        "status": "Ritu Raj Portfolio AI Assistant Running",
        "vector_store": "Ready" if is_knowledge_ready() else "Loading",
    }


@app.api_route("/health", methods=["GET", "HEAD"])
async def health():
    return {"status": "healthy", "service": "portfolio-ai-assistant", "version": "1.0.0"}


@app.api_route("/ready", methods=["GET", "HEAD"])
async def ready():
    """Returns 200 only when ChromaDB ingestion has completed."""
    if is_knowledge_ready():
        return {"status": "ready", "vector_store": "Ready"}
    # 503 tells Render / load balancers: don't route traffic here yet.
    return JSONResponse(
        status_code=503,
        content={"status": "loading", "vector_store": "Loading"},
    )


# ==========================================
# 🚀 LOCAL DEV ENTRYPOINT (Render uses uvicorn via Procfile / start command)
# ==========================================
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("ENV", "development") == "development",
    )