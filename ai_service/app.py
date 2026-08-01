import logging
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from slowapi.errors import RateLimitExceeded

from routes.chat import router
from routes.github import router as github_router
from core.startup import startup_knowledge_loading, is_knowledge_ready
from core.rate_limit import limiter, rate_limit_exceeded_handler

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 🟢 Fire-and-forget ChromaDB ingestion so the server can accept
    # requests immediately. /ready returns 503 until ingestion completes.
    startup_knowledge_loading()
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
    allow_credentials = False  # browsers reject credentials + wildcard
else:
    allow_origins = [
        o.strip() for o in _allowed_origins_env.split(",") if o.strip()
    ]
    allow_credentials = True  # allow cookies/auth headers from trusted origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(github_router)


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
        port=int(os.getenv("PORT", 8000)),
        reload=os.getenv("ENV", "development") == "development",
    )