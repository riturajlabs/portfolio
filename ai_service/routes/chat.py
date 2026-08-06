from __future__ import annotations

import asyncio
import json
import logging
import os
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from groq import Groq
from google import genai
from google.genai import types as genai_types
from pydantic import BaseModel, ConfigDict, Field

from config.settings import settings
from core.prompts import PROMPT_VERSION, pick_system_prompt, SYSTEM_PROMPT_WITH_EXAMPLES
from core.security import verify_api_key
from core.startup import is_knowledge_ready
from core.rate_limit import limiter
from services.knowledge_loader import query_knowledge
from services import llm_response_cache

router = APIRouter(dependencies=[Depends(verify_api_key)])
logger = logging.getLogger(__name__)

# --- Initialise Gemini + Groq clients once at import time. -----------------
# Module-level singletons avoid per-request client init / httpx pool
# construction (~50-150 ms saved on each /chat call).
gemini_client = genai.Client(api_key=settings.GEMINI_API_KEY)
groq_client = Groq(api_key=settings.GROQ_API_KEY)

# --- Tunables (env-overridable). -------------------------------------------
# 512 is plenty for portfolio-style answers; previous 1024 meant we waited
# for output that would never come.
MAX_OUTPUT_TOKENS = int(os.getenv("CHAT_MAX_TOKENS", "512"))
# Hard cap on the RAG call so a stuck embedding API can't hang the request.
QUERY_TIMEOUT_SECONDS = float(os.getenv("CHAT_QUERY_TIMEOUT", "10.0"))
# Keepalive cadence for SSE — sent only while no tokens have arrived.
SSE_KEEPALIVE_SECONDS = float(os.getenv("CHAT_SSE_KEEPALIVE", "15.0"))
GEMINI_MODEL = os.getenv("CHAT_GEMINI_MODEL", "gemini-2.5-flash")
# Sampling temperature for both providers. 0.3 is plenty for grounded
# portfolio answers — we don't want the model to invent creative
# variations on the source material. Override via env if you want
# higher (e.g. for a "creative ideas" branch later).
DEFAULT_TEMPERATURE = float(os.getenv("CHAT_TEMPERATURE", "0.3"))


# ==========================================
# 🛣️  Primary provider routing
# ==========================================
# Render-side benchmarks (see PR description / audit notes):
#   Groq cold-start TTFB  ≈ 150 ms
#   Gemini cold-start TTFB ≈ 600 ms
# For "What is Ritu's stack?"-style short questions, those 450 ms save
# real money on perceived latency. Multi-part or high-context questions
# still get Gemini's better reasoning. The threshold (sum of message +
# last-N-turn history chars) is a cheap proxy for "short" — calls with
# `<100 chars` total almost always fit that bucket.
def _pick_primary_provider(
    message: str, history: list[HistoryMessage]
) -> str:
    """
    Return "groq" or "gemini". Reads `PRIMARY_PROVIDER` and
    `SHORT_QUERY_TOKEN_THRESHOLD` from settings.
    """
    pin = (settings.PRIMARY_PROVIDER or "auto").lower()
    if pin == "groq":
        return "groq"
    if pin == "gemini":
        return "gemini"
    total = len(message) + sum(len(t.content) for t in history)
    return "groq" if total < settings.SHORT_QUERY_TOKEN_THRESHOLD else "gemini"

# --- AFC config (no tools registered, so disable to save a round-trip). ----
_AFC_DISABLED = genai_types.AutomaticFunctionCallingConfig(disable=True)


# ==========================================
# 📦 Request / Response models
# ==========================================
# Maximum conversation turns the client is allowed to send back. Caps
# total prompt growth so a long chat can't blow past the LLM's context
# window or balloon per-request cost. ~6 turns ≈ 2-3 KB of history.
MAX_HISTORY_TURNS = 6


class HistoryMessage(BaseModel):
    # Reject typo'd role names with 422 instead of silently dropping them.
    model_config = ConfigDict(extra="forbid")

    role: str = Field(pattern=r"^(user|assistant)$")
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    # extra="forbid" → 422 on typo'd fields instead of silent ignore.
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=4000)
    sessionId: str = Field(default="default_session")
    # Optional multi-turn context. Backend caps to MAX_HISTORY_TURNS most
    # recent turns, dropping older ones.
    history: list[HistoryMessage] = Field(default_factory=list)
    # Per-request temperature override. Falls back to CHAT_TEMPERATURE env
    # (default 0.3) when not provided. Bounded to keep Groq happy
    # (its max is 2.0; >1.5 is rarely useful).
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)


# ==========================================
# 🧠 Shared RAG helper
# ==========================================
def _format_history_block(history: list[HistoryMessage]) -> str:
    """
    Render the conversation history as a transcript block the model
    can read. Only called when there's at least one turn to include.
    """
    lines = ["CONVERSATION SO FAR"]
    for turn in history:
        speaker = "Visitor" if turn.role == "user" else "Assistant"
        lines.append(f"{speaker}: {turn.content}")
    lines.append(
        "Refer back to this transcript when the visitor uses pronouns or "
        "follow-ups. Do NOT invent context that isn't above."
    )
    return "\n".join(lines)


def _build_system_prompt(
    context_chunks: list[dict],
    history: list[HistoryMessage] | None = None,
    temperature: float = DEFAULT_TEMPERATURE,
) -> str:
    # Pick the prompt variant based on temperature: grounded answers
    # (T ≤ 0.4) ship with the few-shot examples, creative mode (T > 0.4)
    # skips them for faster first-token latency. See prompts.pick_system_prompt.
    parts = [pick_system_prompt(temperature)]

    if context_chunks:
        context_text = "\n\n".join(
            f"[{chunk['source']}]\n{chunk['text']}"
            for chunk in context_chunks
        )
        parts.append(
            f"""
====================================
RETRIEVED PORTFOLIO KNOWLEDGE
====================================
Use the facts below to answer the visitor's question.

{context_text}
"""
        )

    if history:
        parts.append(
            f"""
====================================
{_format_history_block(history)}
====================================
"""
        )

    return "\n".join(parts)


async def _query_with_timeout(
    query: str,
    top_k: int = 3,
    score_threshold: float | None = None,
) -> list[dict]:
    """Wrap `query_knowledge` in a hard timeout so a stuck embedding API
    can't hang the request thread forever. TimeoutError → 504 to caller."""
    kwargs: dict = {"top_k": top_k}
    if score_threshold is not None:
        kwargs["score_threshold"] = score_threshold
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(query_knowledge, query, **kwargs),
            timeout=QUERY_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError as exc:
        logger.warning(
            "query_knowledge timed out after %.1fs for query=%r",
            QUERY_TIMEOUT_SECONDS,
            query[:80],
        )
        raise HTTPException(
            status_code=504,
            detail="Knowledge base query timed out. Please try again.",
        ) from exc


# ==========================================
# 🔁 Shared helpers (per-request temperature + RAG)
# ==========================================
# Both /chat and /chat/stream now stream SSE, so the request prep
# (validate, fetch context, resolve temperature) lives in one place.


def _resolve_chat_params(chat_request: ChatRequest) -> dict:
    """
    Shared preprocessing for both /chat and /chat/stream. Validates
    inputs, caps the conversation history, and resolves the temperature.

    Raises HTTPException for the cases the frontend should see as
    synchronous errors (vector store not ready, empty message).
    """
    if not is_knowledge_ready():
        raise HTTPException(
            status_code=503,
            detail="Vector store is still loading. Please retry in a few seconds.",
        )

    message = chat_request.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="A message is required.")

    # Keep only the most recent MAX_HISTORY_TURNS — older turns are
    # either redundant or would blow past the context window.
    history = chat_request.history[-MAX_HISTORY_TURNS:]
    # Per-request override falls back to the env-default temperature.
    temperature = (
        chat_request.temperature
        if chat_request.temperature is not None
        else DEFAULT_TEMPERATURE
    )

    return {
        "message": message,
        "history": history,
        "temperature": temperature,
    }


async def _gather_chat_context(message, history, temperature) -> tuple[str, list[dict]]:
    """Run RAG + build the system prompt. Shared by both endpoints.

    `temperature` is passed through to `_build_system_prompt` so it can
    pick between the full prompt (with few-shot examples) and the slimmer
    core variant — see prompts.pick_system_prompt.
    """
    # `query_knowledge` is async + timeout-guarded (504 on hang).
    # top_k=5 with score_threshold=0.7 lifts multi-part recall vs. the
    # previous (3, 0.65) — see the retrieval bench in `perf-notes.md`.
    context_chunks = await _query_with_timeout(
        message,
        top_k=settings.CHAT_TOP_K,
        score_threshold=settings.CHAT_SCORE_THRESHOLD,
    )
    system_prompt = _build_system_prompt(context_chunks, history, temperature)
    sources = [
        {"source": chunk["source"], "score": chunk["score"]}
        for chunk in context_chunks
    ]
    return system_prompt, sources


async def _sse_event(data: dict | str) -> bytes:
    """Encode one SSE message."""
    if isinstance(data, dict):
        data = json.dumps(data, ensure_ascii=False)
    return f"data: {data}\n\n".encode("utf-8")


async def _sse_keepalive() -> bytes:
    """SSE comment line — ignored by EventSource clients but keeps the
    connection alive across idle intermediaries (Cloudflare, Render proxy)."""
    return b":keepalive\n\n"


# ==========================================
# 🌊 POST /chat — streams SSE (same shape as /chat/stream)
# ==========================================
# Both endpoints stream now (the frontend prefers /chat/stream for the
# faster TTFB and only falls back to /chat when SSE is blocked). Doing
# it as SSE here too means a stuck non-streaming LLM call can never
# block the request thread for the full pre-token latency.
@router.post("/chat")
@limiter.limit("10/minute")
async def chat(request: Request, chat_request: ChatRequest):
    return await _chat_stream_response(request, chat_request, log_tag="chat")


# ==========================================
# 🌊 POST /chat/stream — SSE
# ==========================================
@router.post("/chat/stream")
@limiter.limit("10/minute")
async def chat_stream(request: Request, chat_request: ChatRequest):
    """
    Streams tokens via Server-Sent Events.

    Event sequence:
      0. { "event": "meta",    "data": {"promptVersion": "1.x.y"} } → telemetry
      1. { "event": "sources", "data": [...] }  → RAG sources (so the UI can show them)
      2. { "event": "token",   "data": "..."  }  → incremental AI text
      3. { "event": "done",    "data": "Gemini"|"Groq" }  → final model name
      4. { "event": "error",   "data": "..." }    → on any failure

    While no token has emitted yet, a `:keepalive` SSE comment is
    yielded every SSE_KEEPALIVE_SECONDS so intermediary proxies don't
    drop the connection during long pre-token latency.
    """
    return await _chat_stream_response(
        request, chat_request, log_tag="chat/stream"
    )


async def _chat_stream_response(
    request: Request,
    chat_request: ChatRequest,
    log_tag: str,
) -> StreamingResponse:
    """
    Internal helper backing both /chat and /chat/stream. Validates the
    request, runs RAG, then drives the Gemini → Groq stream with
    keepalives. Returns a StreamingResponse either way.

    Optimization pipeline:
      1. Validation + history cap (already done by `_resolve_chat_params`)
      2. LLM response cache lookup — on hit, replay the cached text as
         a single `token` event + skip the LLM round-trip entirely.
      3. RAG (ChromaDB query) — gated by an asyncio timeout.
      4. Provider routing — short queries go to Groq first (saves
         ~450 ms per request on Render); longer/multi-part go to Gemini.
         The non-primary provider is tried on failure.
      5. Successful non-fallback stream → write into the LLM cache so
         subsequent identical requests short-circuit.
    """
    params = _resolve_chat_params(chat_request)
    message = params["message"]
    history = params["history"]
    temperature = params["temperature"]

    logger.info(
        "%s request: prompt_version=%s, history_turns=%d, temperature=%.2f, msg_preview=%r",
        log_tag,
        PROMPT_VERSION,
        len(history),
        temperature,
        message[:80],
    )

    # ---- LLM response cache lookup (short-circuits everything below) -----
    # The cache key binds *all* the inputs that change the answer: prompt
    # version, model, temperature, with-examples flag, message+history.
    # Anything that's different → naturally misses → fresh answer.
    primary = _pick_primary_provider(message, history)
    cache_key = llm_response_cache.make_cache_key(
        message=message,
        history=[{"role": t.role, "content": t.content} for t in history],
        temperature=temperature,
        prompt_version=PROMPT_VERSION,
        with_examples=(pick_system_prompt(temperature) is SYSTEM_PROMPT_WITH_EXAMPLES),
        gemini_model=GEMINI_MODEL,
        groq_model=settings.GROQ_MODEL,
    )
    cached = llm_response_cache.get(cache_key)
    if cached is not None:
        logger.info(
            "%s LLM cache hit key=%s provider=%s", log_tag, cache_key[:10],
            cached.get("generated_by"),
        )

        async def cached_event_generator():
            yield await _sse_event(
                {"event": "meta", "data": {"promptVersion": PROMPT_VERSION}}
            )
            yield await _sse_event({"event": "sources", "data": []})
            yield await _sse_event(
                {"event": "token", "data": cached.get("text", "")}
            )
            yield await _sse_event(
                {"event": "done", "data": cached.get("generated_by", "Offline")}
            )

        return StreamingResponse(
            cached_event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )

    system_prompt, sources = await _gather_chat_context(message, history, temperature)
    full_prompt = f"{system_prompt}\n\nUser: {message}"

    async def event_generator():
        # 0) Emit metadata first — includes prompt version for A/B tracking.
        yield await _sse_event(
            {"event": "meta", "data": {"promptVersion": PROMPT_VERSION}}
        )

        # 1) Emit sources first so the UI can render them immediately.
        yield await _sse_event({"event": "sources", "data": sources})

        # 2) Primary provider → fallback.
        # `primary` is "groq" or "gemini", routed by total query length.
        # If the primary throws, we transparently fall through to the
        # other provider rather than dropping the request.
        accumulated: list[str] = []
        generated_by = "Offline"
        last_activity = time.monotonic()

        async def _maybe_keepalive() -> bytes | None:
            """Emit a keepalive if no token arrived within the window."""
            nonlocal last_activity
            if time.monotonic() - last_activity >= SSE_KEEPALIVE_SECONDS:
                last_activity = time.monotonic()
                return await _sse_keepalive()
            return None

        # --- Stream factories ---
        def _gemini_stream():
            return gemini_client.models.generate_content_stream(
                model=GEMINI_MODEL,
                contents=full_prompt,
                config=genai_types.GenerateContentConfig(
                    automatic_function_calling=_AFC_DISABLED,
                    max_output_tokens=MAX_OUTPUT_TOKENS,
                    temperature=temperature,
                ),
            )

        def _groq_stream():
            return groq_client.chat.completions.create(
                model=settings.GROQ_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": message},
                ],
                temperature=temperature,
                max_tokens=MAX_OUTPUT_TOKENS,
                stream=True,
            )

        # Order: primary first, then the other as fallback.
        order = (primary, "gemini" if primary == "groq" else "groq")

        async def _drive(provider: str):
            """
            Drive one provider's stream, yielding SSE-encoded bytes.
            Whether the provider produced any tokens is communicated via
            the shared `accumulated` list: if it grew, we treat the
            provider as successful and skip the fallback.
            """
            nonlocal generated_by, last_activity
            try:
                if provider == "gemini":
                    generated_by = "Gemini"
                    loop = asyncio.get_running_loop()
                    stream = await loop.run_in_executor(None, _gemini_stream)
                    for chunk in stream:
                        if await request.is_disconnected():
                            logger.info(
                                "Client disconnected; aborting Gemini stream."
                            )
                            return
                        piece = getattr(chunk, "text", None) or ""
                        if piece:
                            accumulated.append(piece)
                            last_activity = time.monotonic()
                            yield await _sse_event(
                                {"event": "token", "data": piece}
                            )
                        else:
                            ka = await _maybe_keepalive()
                            if ka is not None:
                                yield ka
                else:  # groq
                    generated_by = "Groq"
                    loop = asyncio.get_running_loop()
                    stream = await loop.run_in_executor(None, _groq_stream)
                    for chunk in stream:
                        if await request.is_disconnected():
                            logger.info(
                                "Client disconnected; aborting Groq stream."
                            )
                            return
                        delta = chunk.choices[0].delta.content or ""
                        if delta:
                            accumulated.append(delta)
                            last_activity = time.monotonic()
                            yield await _sse_event(
                                {"event": "token", "data": delta}
                            )
                        else:
                            ka = await _maybe_keepalive()
                            if ka is not None:
                                yield ka
            except Exception as exc:
                logger.warning("%s stream failed: %s", provider, exc)

        for provider in order:
            tokens_before = len(accumulated)
            async for _item in _drive(provider):
                # `_item` is the SSE-encoded bytes; we just want to relay
                # them through the generator. Nothing else to do.
                yield _item
            if len(accumulated) > tokens_before:
                break  # primary produced tokens — skip the fallback.

        if accumulated:
            yield await _sse_event({"event": "done", "data": generated_by})
            # Cache the successful non-fallback answer. We only write when
            # the primary succeeded (got tokens AND didn't fall through to
            # the fallback), which keeps the cache aligned with the same
            # provider a cached replay will report in the `done` event.
            text = "".join(accumulated)
            llm_response_cache.put(
                cache_key,
                {"text": text, "generated_by": generated_by},
            )
        else:
            yield await _sse_event(
                {"event": "error", "data": "No tokens received from any provider."}
            )

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx buffering on Render
            "Connection": "keep-alive",
        },
    )


