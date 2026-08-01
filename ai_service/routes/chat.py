import asyncio
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from groq import Groq
from google import genai  # Modern GenAI SDK
from pydantic import BaseModel, Field

from config.settings import settings
from core.prompts import SYSTEM_PROMPT
from core.security import verify_api_key
from core.startup import is_knowledge_ready
from core.rate_limit import limiter
from services.formatter import format_groq_response
from services.knowledge_loader import query_knowledge

router = APIRouter(dependencies=[Depends(verify_api_key)])
logger = logging.getLogger(__name__)

# --- Initialise Gemini client once at import time ---
gemini_client = genai.Client(api_key=settings.GEMINI_API_KEY)


# ==========================================
# 📦 Request / Response models
# ==========================================
class ChatRequest(BaseModel):
    message: str
    sessionId: str = Field(default="default_session")


# ==========================================
# 🧠 Shared RAG helper
# ==========================================
def _build_system_prompt(context_chunks: list[dict]) -> str:
    if not context_chunks:
        return SYSTEM_PROMPT

    context_text = "\n\n".join(
        f"[{chunk['source']}]\n{chunk['text']}" for chunk in context_chunks
    )

    return f"""{SYSTEM_PROMPT}

====================================
RETRIEVED PORTFOLIO KNOWLEDGE
====================================
Use the facts below to answer the visitor's question.

{context_text}
"""


async def _generate_with_failover(
    message: str, system_prompt: str
) -> tuple[str, str]:
    """
    Try Gemini → Groq. Returns (content, generatedBy).
    Raises HTTPException(503) if both providers fail.
    """
    loop = asyncio.get_running_loop()

    def _call_gemini() -> str:
        full_prompt = f"{system_prompt}\n\nUser: {message}"
        resp = gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=full_prompt,
        )
        return resp.text or ""

    def _call_groq() -> str:
        client = Groq(api_key=settings.GROQ_API_KEY)
        resp = client.chat.completions.create(
            model=settings.GROQ_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": message},
            ],
            temperature=0.3,
            max_tokens=1024,
        )
        return resp.choices[0].message.content or ""

    # 1) Try Gemini (primary)
    try:
        logger.info("Attempting primary AI: Gemini")
        content = await loop.run_in_executor(None, _call_gemini)
        return format_groq_response(content), "Gemini"
    except Exception as gemini_err:
        logger.warning("Gemini failed, falling back to Groq: %s", gemini_err)

    # 2) Fallback to Groq
    try:
        content = await loop.run_in_executor(None, _call_groq)
        return format_groq_response(content), "Groq"
    except Exception as groq_err:
        logger.error("Groq also failed: %s", groq_err)

    raise HTTPException(
        status_code=503,
        detail="All AI providers are currently unavailable. Please try again.",
    )


# ==========================================
# 💬 POST /chat — non-streaming (existing contract)
# ==========================================
@router.post("/chat")
@limiter.limit("10/minute")
async def chat(request: Request, chat_request: ChatRequest):
    if not is_knowledge_ready():
        # Refuse early — saves an LLM call while ChromaDB is still ingesting.
        raise HTTPException(
            status_code=503,
            detail="Vector store is still loading. Please retry in a few seconds.",
        )

    message = chat_request.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="A message is required.")

    try:
        context_chunks = query_knowledge(message, top_k=5)
        system_prompt = _build_system_prompt(context_chunks)

        sources = [
            {"source": chunk["source"], "score": chunk["score"]}
            for chunk in context_chunks
        ]

        response, generated_by = await _generate_with_failover(
            message, system_prompt
        )

        return {
            "response": response,
            "sources": sources,
            "generatedBy": generated_by,
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Chat request failed: %s", exc)
        raise HTTPException(
            status_code=500, detail="AI service is temporarily unavailable."
        ) from exc


# ==========================================
# 🌊 POST /chat/stream — SSE (new)
# ==========================================
async def _sse_event(data: dict | str) -> bytes:
    """Encode one SSE message."""
    if isinstance(data, dict):
        data = json.dumps(data, ensure_ascii=False)
    return f"data: {data}\n\n".encode("utf-8")


@router.post("/chat/stream")
@limiter.limit("10/minute")
async def chat_stream(request: Request, chat_request: ChatRequest):
    """
    Streams tokens via Server-Sent Events.

    Event sequence:
      1. { "event": "sources", "data": [...] }  → RAG sources (so the UI can show them)
      2. { "event": "token",   "data": "..."  }  → incremental AI text
      3. { "event": "done",    "data": "Gemini"|"Groq" }  → final model name
      4. { "event": "error",   "data": "..." }    → on any failure
    """
    if not is_knowledge_ready():
        raise HTTPException(
            status_code=503,
            detail="Vector store is still loading. Please retry in a few seconds.",
        )

    message = chat_request.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="A message is required.")

    context_chunks = query_knowledge(message, top_k=5)
    system_prompt = _build_system_prompt(context_chunks)

    sources = [
        {"source": chunk["source"], "score": chunk["score"]}
        for chunk in context_chunks
    ]

    full_prompt = f"{system_prompt}\n\nUser: {message}"

    async def event_generator():
        # 1) Emit sources first so the UI can render them immediately.
        yield await _sse_event({"event": "sources", "data": sources})

        # 2) Try Gemini streaming → fall back to Groq streaming.
        accumulated: list[str] = []
        generated_by = "Offline"

        # --- Gemini stream ---
        def _gemini_stream():
            return gemini_client.models.generate_content_stream(
                model="gemini-2.5-flash",
                contents=full_prompt,
            )

        # --- Groq stream ---
        def _groq_stream():
            client = Groq(api_key=settings.GROQ_API_KEY)
            return client.chat.completions.create(
                model=settings.GROQ_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": message},
                ],
                temperature=0.3,
                max_tokens=1024,
                stream=True,
            )

        tried_gemini = False
        try:
            tried_gemini = True
            generated_by = "Gemini"
            loop = asyncio.get_running_loop()
            stream = await loop.run_in_executor(None, _gemini_stream)
            for chunk in stream:
                if await request.is_disconnected():
                    logger.info("Client disconnected; aborting Gemini stream.")
                    return
                piece = getattr(chunk, "text", None) or ""
                if piece:
                    accumulated.append(piece)
                    yield await _sse_event({"event": "token", "data": piece})
        except Exception as gemini_err:
            logger.warning("Gemini stream failed: %s", gemini_err)

            # --- Groq fallback stream ---
            try:
                generated_by = "Groq"
                loop = asyncio.get_running_loop()
                stream = await loop.run_in_executor(None, _groq_stream)
                for chunk in stream:
                    if await request.is_disconnected():
                        logger.info("Client disconnected; aborting Groq stream.")
                        return
                    delta = chunk.choices[0].delta.content or ""
                    if delta:
                        accumulated.append(delta)
                        yield await _sse_event({"event": "token", "data": delta})
            except Exception as groq_err:
                logger.error("Groq stream also failed: %s", groq_err)
                if not tried_gemini and not accumulated:
                    yield await _sse_event(
                        {"event": "error", "data": "All AI providers unavailable."}
                    )
                    return
                # If we got partial output from Gemini before failure, still finish gracefully.

        if accumulated:
            yield await _sse_event({"event": "done", "data": generated_by})
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