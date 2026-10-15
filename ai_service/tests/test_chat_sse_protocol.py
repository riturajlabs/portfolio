"""SSE protocol regression for `/chat` and `/chat/stream`.

Phase 9 changes the *knowledge source*, not the chat transport. This test pins
the protocol contract so an ingestion refactor can never silently change the
event shape the frontend parses:

    meta → sources → token* → done       (success)
    meta → sources → token → done        (LLM response-cache hit)
    meta → sources → error               (no provider produced tokens)

Everything is hermetic: the `google-genai`/`groq` SDK modules are stubbed in
`sys.modules` before `routes.chat` imports (they aren't installed in this dev
env), and the provider clients, RAG context and LLM cache are monkeypatched.
"""
from __future__ import annotations

import asyncio
import json
import sys
import types

import pytest

from services import (
    knowledge_loader,  # noqa: F401  (import chromadb while no stubs are installed)
)

# ---------------------------------------------------------------------------
# Stub the SDK modules `routes.chat` imports. Careful with ordering:
#   * `knowledge_loader` (→ chromadb) must be imported FIRST, because this
#     environment lacks `google-genai` but chromadb's telemetry stack also
#     imports `google.*` internals — a stub for `google` would break it.
#   * install stubs → import `routes.chat` → remove stubs from sys.modules.
#     The chat module keeps its own live references, while the rest of the
#     suite sees a clean `google` namespace again.
# ---------------------------------------------------------------------------
google = types.ModuleType("google")
genai = types.ModuleType("google.genai")
genai_types = types.ModuleType("google.genai.types")


class _Client:
    def __init__(self, *args, **kwargs):
        pass


class _AFCConfig:
    def __init__(self, *args, **kwargs):
        pass


class _GenerateContentConfig:
    def __init__(self, *args, **kwargs):
        pass


genai.Client = _Client
genai_types.AutomaticFunctionCallingConfig = _AFCConfig
genai_types.GenerateContentConfig = _GenerateContentConfig

groq_module = types.ModuleType("groq")


class _Groq:
    def __init__(self, *args, **kwargs):
        pass


groq_module.Groq = _Groq

_STUB_NAMES = ("google", "google.genai", "google.genai.types", "groq")
for _name, _module in (
    ("google", google),
    ("google.genai", genai),
    ("google.genai.types", genai_types),
    ("groq", groq_module),
):
    sys.modules[_name] = _module

from routes import chat

for _name in _STUB_NAMES:
    sys.modules.pop(_name, None)
del _name, _module


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------
class _FakeRequest:
    """Minimal Request stand-in: only `is_disconnected()` is used by the stream."""

    async def is_disconnected(self) -> bool:
        return False


class _GeminiChunk:
    def __init__(self, text: str) -> None:
        self.text = text


class _GroqDelta:
    def __init__(self, content: str) -> None:
        self.content = content


class _GroqChoice:
    def __init__(self, content: str) -> None:
        self.delta = _GroqDelta(content)


class _GroqChunk:
    def __init__(self, content: str) -> None:
        self.choices = [_GroqChoice(content)]


class _FakeGeminiClient:
    def __init__(self, texts: tuple[str, ...] = ()) -> None:
        self.models = types.SimpleNamespace(
            generate_content_stream=lambda **kwargs: iter(_GeminiChunk(t) for t in texts)
        )


class _FakeGroqClient:
    def __init__(self, texts: tuple[str, ...] = ()) -> None:
        self.chat = types.SimpleNamespace(
            completions=types.SimpleNamespace(
                create=lambda **kwargs: iter(_GroqChunk(t) for t in texts)
            )
        )


class _FakeCache:
    def __init__(self, cached=None) -> None:
        self._cached = cached

    def make_cache_key(self, **kwargs) -> str:
        return f"key:{kwargs.get('message', '')}"

    def get(self, key: str):
        return self._cached

    def put(self, key: str, value: dict) -> None:
        return None


def _collect_events(response) -> list[tuple[str, object]]:
    async def _collect():
        body = b"".join([chunk async for chunk in response.body_iterator])
        events = []
        for line in body.decode("utf-8").splitlines():
            line = line.strip()
            if line.startswith("data: "):
                payload = json.loads(line[len("data: ") :])
                events.append((payload["event"], payload["data"]))
        return events

    return asyncio.run(_collect())


async def _fake_gather_context(message, history, temperature):
    return ("SYSTEM", [{"source": "projects", "score": 0.95}])


def _patch_protocol_environment(monkeypatch: pytest.MonkeyPatch, *, groq_texts, gemini_texts, cache=None):
    from config.settings import settings

    monkeypatch.setattr(settings, "PRIMARY_PROVIDER", "groq")  # via config.settings, used by chat.settings
    monkeypatch.setattr(chat, "is_knowledge_ready", lambda: True)
    monkeypatch.setattr(
        chat,
        "_pick_primary_provider",
        lambda message, history: "groq",
    )
    monkeypatch.setattr(chat, "gemini_client", _FakeGeminiClient(gemini_texts))
    monkeypatch.setattr(chat, "groq_client", _FakeGroqClient(groq_texts))
    fake_cache = cache if cache is not None else _FakeCache(cached=None)
    monkeypatch.setattr(chat, "llm_response_cache", fake_cache)
    monkeypatch.setattr(
        chat,
        "_gather_chat_context",
        _fake_gather_context,
    )


@pytest.mark.parametrize(
    "groq_texts,gemini_texts,expected_events,expected_done",
    [
        # Primary succeeds → tokens emitted, sourced from the (patched) RAG layer.
        (("Hello", " world"), (),
         ["meta", "sources", "token", "token", "done"], "Groq"),
        # Primary empty → fallback Gemini succeeds.
        ((), ("Hello", " world"),
         ["meta", "sources", "token", "token", "done"], "Gemini"),
    ],
)
def test_stream_protocol_sequence(monkeypatch, groq_texts, gemini_texts, expected_events, expected_done):
    _patch_protocol_environment(monkeypatch, groq_texts=groq_texts, gemini_texts=gemini_texts)

    request = _FakeRequest()
    chat_request = chat.ChatRequest(message="hello", sessionId="s1", history=[], temperature=0.2)
    response = asyncio.run(chat._chat_stream_response(request, chat_request, log_tag="test"))

    events = _collect_events(response)
    assert [event for event, _ in events] == expected_events
    assert events[-1][1] == expected_done
    # sources event carries the RAG context the (new) knowledge base produced.
    assert events[1][1] == [{"source": "projects", "score": 0.95}]


def test_stream_error_when_no_provider_tokens(monkeypatch):
    _patch_protocol_environment(monkeypatch, groq_texts=(), gemini_texts=())

    request = _FakeRequest()
    chat_request = chat.ChatRequest(message="hello", sessionId="s1", history=[])
    response = asyncio.run(chat._chat_stream_response(request, chat_request, log_tag="test"))

    events = _collect_events(response)
    assert [event for event, _ in events] == ["meta", "sources", "error"]
    assert events[-1][1] == "No tokens received from any provider."


def test_stream_cache_hit_protocol(monkeypatch):
    _patch_protocol_environment(
        monkeypatch,
        groq_texts=(),
        gemini_texts=(),
        cache=_FakeCache(cached={"text": "cached answer", "generated_by": "Gemini"}),
    )

    request = _FakeRequest()
    chat_request = chat.ChatRequest(message="hello", sessionId="s1", history=[])
    response = asyncio.run(chat._chat_stream_response(request, chat_request, log_tag="test"))

    events = _collect_events(response)
    assert [event for event, _ in events] == ["meta", "sources", "token", "done"]
    # Cache-hit path replays a single token + no RAG context.
    assert events[1][1] == []
    assert events[2][1] == "cached answer"
    assert events[3][1] == "Gemini"


def test_cost_of_imported_chat_router_is_stub_safe():
    """Sanity: module-level singletons built with the stubbed SDK clients."""
    assert isinstance(chat.gemini_client, _Client)
    assert isinstance(chat.groq_client, _Groq)