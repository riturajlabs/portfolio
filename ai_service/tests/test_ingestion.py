"""Ingestion tests: idempotency, stale-content removal, changed-content
replacement, source-aware modes, and answerability — all hermetic (fake
embeddings + tmp Chroma, no network, no API keys)."""
from __future__ import annotations

import copy
import json

import pytest

from config.settings import settings
from services import content_api
from services import knowledge_loader as kl
from services.content_api import ContentAPIError


def _chunks_for_payload(payload: dict) -> list[dict]:
    content = content_api.validate_content_payload(payload)
    return content_api.chunks_from_sections(content_api.sections_from_content(content))


def _without_project(payload: dict, slug: str) -> dict:
    payload = copy.deepcopy(payload)
    payload["projects"] = [p for p in payload["projects"] if p["slug"] != slug]
    return payload


def _new_project() -> dict:
    return {
        "slug": "freshly-shipped",
        "title": "Freshly Shipped Project",
        "description": "A project that was just published through the admin.",
        "image": "https://example.com/fresh.png",
        "image_width": 1600,
        "image_height": 900,
        "imageAlt": "The freshly shipped project",
        "status": "published",
        "seoTitle": "Freshly Shipped Project",
        "seoDescription": "A project that was just published through the admin.",
    }


class TestReconcile:
    def test_idempotent_index(self, chroma, content_chunks):
        assert chroma.load_chunks_into_chromadb(content_chunks) > 0
        count_after_first = chroma._get_collection().count()

        assert chroma.load_chunks_into_chromadb(content_chunks) == 0
        assert chroma._get_collection().count() == count_after_first

    def test_stale_project_removed(self, chroma, canonical_payload):
        full_chunks = _chunks_for_payload(canonical_payload)
        zerodha_ids = [
            c["id"]
            for c in full_chunks
            if c["metadata"]["source"] == "projects" and "Zerodha" in c["text"]
        ]
        assert len(zerodha_ids) == 1  # exactly one chunk holds the Zerodha project

        chroma.load_chunks_into_chromadb(full_chunks)
        chroma.load_chunks_into_chromadb(_chunks_for_payload(_without_project(canonical_payload, "zerodha-clone")))

        ids = set(chroma._get_collection().get()["ids"])
        assert not (ids & set(zerodha_ids))
        # One project's chunk is gone; total dropped by one.
        assert chroma._get_collection().count() == len(full_chunks) - 1

    def test_new_project_added(self, chroma, canonical_payload):
        base_chunks = _chunks_for_payload(canonical_payload)
        chroma.load_chunks_into_chromadb(base_chunks)
        base_count = chroma._get_collection().count()
        base_ids = set(chroma._get_collection().get()["ids"])

        published = copy.deepcopy(canonical_payload)
        published["projects"] = published["projects"] + [_new_project()]
        published_chunks = _chunks_for_payload(published)
        new_ids = {
            c["id"]
            for c in published_chunks
            if c["metadata"]["source"] == "projects" and "Freshly Shipped Project" in c["text"]
        }
        assert len(new_ids) == 1  # one chunk, keyed by the new slug

        assert chroma.load_chunks_into_chromadb(published_chunks) == 1
        ids = set(chroma._get_collection().get()["ids"])
        # Everything already indexed is untouched, and the new project is in.
        assert base_ids <= ids
        assert new_ids <= ids
        assert chroma._get_collection().count() == base_count + 1

    def test_hidden_project_removed(self, chroma, canonical_payload):
        # The public content API only returns `published` projects, so the
        # backend's way of hiding a project is to drop it from the payload.
        # Re-ingesting that payload must purge the hidden project's chunks.
        published = copy.deepcopy(canonical_payload)
        published["projects"] = published["projects"] + [_new_project()]
        full_chunks = _chunks_for_payload(published)
        chroma.load_chunks_into_chromadb(full_chunks)
        hidden_ids = [
            c["id"]
            for c in full_chunks
            if c["metadata"]["source"] == "projects" and "Freshly Shipped Project" in c["text"]
        ]
        assert len(hidden_ids) == 1

        chroma.load_chunks_into_chromadb(_chunks_for_payload(_without_project(published, "freshly-shipped")))

        ids = set(chroma._get_collection().get()["ids"])
        assert not (ids & set(hidden_ids))
        assert chroma._get_collection().count() == len(full_chunks) - 1

    def test_changed_project_replaces_own_ids(self, chroma, canonical_payload):
        original_chunks = _chunks_for_payload(canonical_payload)
        chroma.load_chunks_into_chromadb(original_chunks)
        original_count = chroma._get_collection().count()
        orbit_ids = {c["id"] for c in original_chunks if c["metadata"]["source"] == "projects" and "Orbit" in c["text"]}
        assert len(orbit_ids) == 1

        edited = copy.deepcopy(canonical_payload)
        edited["projects"] = [
            dict(p, longDescription=(p["longDescription"] or "") + "\n- NEW: Revamped architecture")
            if p["slug"] == "orbit-ai" else p
            for p in edited["projects"]
        ]
        chroma.load_chunks_into_chromadb(_chunks_for_payload(edited))

        ids = set(chroma._get_collection().get()["ids"])
        # The ID is derived from (section, key, text): the edit changed the
        # text, so the old ID is deleted and a new one added — total stable.
        assert chroma._get_collection().count() == original_count
        assert not (ids & orbit_ids)
        texts = chroma._get_collection().get(ids=list(ids))["documents"]
        assert any("Revamped architecture" in t for t in texts)

    def test_switching_sources_converges_cleanly(self, chroma, canonical_payload):
        """api -> file -> api: the reconcile step converges the collection to
        exactly whichever source was configured last; neither leaves ghosts.
        (No wipe needed — both sources share the same embedding model, so plain
        add-missing + delete-stale is the correct, idempotent lifecycle.)"""
        api_chunks = _chunks_for_payload(canonical_payload)
        chroma.load_chunks_into_chromadb(api_chunks)
        api_ids = set(chroma._get_collection().get()["ids"])
        assert api_ids

        legacy = {"projects": [{"slug": "only-legacy", "title": "Legacy Project"}]}
        legacy_chunks = kl.chunks_from_sections(legacy)
        chroma.load_chunks_into_chromadb(legacy_chunks)
        legacy_ids = set(chroma._get_collection().get()["ids"])
        assert not (api_ids & legacy_ids)
        assert legacy_ids
        assert chroma._get_collection().count() == len(legacy_chunks)

        chroma.load_chunks_into_chromadb(api_chunks)
        assert set(chroma._get_collection().get()["ids"]) == api_ids


class TestSourceModes:
    def test_file_mode_uses_knowledge_base_json(self, chroma, tmp_path, monkeypatch):
        kb = {
            "profile": {"name": "Ritu Raj", "title": "Full Stack Developer"},
            "projects": [{"title": "Story Project", "description": "A long enough project description to index."}],
        }
        kb_path = tmp_path / "kb.json"
        kb_path.write_text(json.dumps(kb), encoding="utf-8")
        monkeypatch.setattr(settings, "KNOWLEDGE_FILE", str(kb_path))
        monkeypatch.setattr(settings, "KNOWLEDGE_SOURCE", "file")

        added = kl.load_knowledge_into_chromadb()
        assert added > 0
        assert chroma._get_collection().count() > 0

    def test_api_mode_failure_is_fail_closed(self, chroma, monkeypatch):
        monkeypatch.setattr(settings, "CONTENT_API_URL", "http://127.0.0.1:1/api/content")
        monkeypatch.setattr(settings, "KNOWLEDGE_SOURCE", "api")
        with pytest.raises(ContentAPIError):
            kl.load_knowledge_into_chromadb()
        # Nothing was indexed: `/ready` stays 503, `/chat` stays guarded.
        assert chroma._get_collection().count() == 0

    def test_invalid_source_rejected(self, chroma, monkeypatch):
        monkeypatch.setattr(settings, "KNOWLEDGE_SOURCE", "banana")
        with pytest.raises(ValueError, match="KNOWLEDGE_SOURCE"):
            kl.load_knowledge_into_chromadb()


class TestAnswerability:
    """Plumbing-level retrieval: the classifier + chunk texts surface the
    right sections for representative canonical questions."""

    @pytest.fixture(autouse=True)
    def _indexed(self, chroma, content_chunks):
        chroma.load_chunks_into_chromadb(content_chunks)
        yield chroma

    def test_project_question_returns_project_chunks(self, _indexed):
        results = _indexed.query_knowledge(
            "which projects did Ritu build", top_k=8, score_threshold=0.0
        )
        assert results
        assert all(r["source"] == "projects" for r in results)
        assert any("Zerodha" in r["text"] for r in results)  # canonical 5th project

    def test_skill_question_finds_skill_chunk(self, _indexed):
        results = _indexed.query_knowledge("PyTorch", top_k=8, score_threshold=0.0)
        assert results
        assert "PyTorch" in results[0]["text"]

    def test_certification_question_returns_certification_chunks(self, _indexed):
        results = _indexed.query_knowledge(
            "what certifications does Ritu hold", top_k=8, score_threshold=0.0
        )
        assert results
        assert all(r["source"] == "certifications" for r in results)

    def test_identity_question_finds_profile_facts(self, _indexed):
        results = _indexed.query_knowledge("Ritu Raj", top_k=8, score_threshold=0.0)
        assert results
        assert any("Ritu Raj" in r["text"] for r in results)


class _RecordingCollection:
    """Minimal Chroma stand-in that records the `where` filter it was given."""

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def query(self, **kwargs):
        self.calls.append(kwargs)
        return {"documents": [[]], "metadatas": [[]], "distances": [[]]}


class TestSourceGuard:
    """The classifier can name a source the collection never indexes (`blogs`,
    `experience`). Retrieval must then scan the whole collection instead of
    applying a `where` filter guaranteed to match nothing. The indexed source
    set is pinned to `content_api.sections_from_content`."""

    @pytest.fixture
    def recorded(self, monkeypatch):
        collection = _RecordingCollection()
        monkeypatch.setattr(kl, "_get_collection", lambda: collection)
        return collection

    def test_known_source_constant_matches_ingested_sections(self, content):
        sections = content_api.sections_from_content(content)
        assert kl.KNOWLEDGE_SOURCES == set(sections)

    @pytest.mark.parametrize(
        "query",
        [
            "what did Ritu write in his blog",
            "has he published any articles",
            "tell me about his work experience",
            "which companies did he intern at",
        ],
    )
    def test_source_with_no_indexed_section_is_not_filtered(self, recorded, query):
        assert kl.query_knowledge(query) == []
        assert recorded.calls[0]["where"] is None

    @pytest.mark.parametrize(
        "query, expected",
        [
            ("which projects did Ritu build", "projects"),
            ("what skills does he know", "skills"),
            ("what certifications does he hold", "certifications"),
            ("who is Ritu Raj", None),  # identity → ambiguous → unfiltered
        ],
    )
    def test_indexed_source_still_applies_its_filter(self, recorded, query, expected):
        kl.query_knowledge(query)
        where = recorded.calls[0]["where"]
        assert where == ({"source": expected} if expected else None)

    @pytest.mark.parametrize(
        "query",
        [
            "which projects did Ritu build",
            "what skills does he know",
            "what certifications does he hold",
            "what did Ritu write in his blog",
            "tell me about his work experience",
            "who is Ritu Raj",
            "hello there",
        ],
    )
    def test_effective_filter_is_always_indexed_or_unfiltered(self, recorded, query):
        kl.query_knowledge(query)
        where = recorded.calls[0]["where"]
        assert where is None or where["source"] in kl.KNOWLEDGE_SOURCES

    def test_empty_collection_returns_no_results_without_raising(self, chroma):
        assert kl.query_knowledge("which projects did Ritu build") == []

    def test_no_matching_chunks_stays_empty(self, chroma, content_chunks):
        # An impossible similarity threshold filters every candidate, so the
        # honest no-content behaviour holds and no chunk is fabricated.
        chroma.load_chunks_into_chromadb(content_chunks)
        assert (
            kl.query_knowledge("which projects did Ritu build", score_threshold=1.1)
            == []
        )


class TestReingest:
    """`core.startup.reingest_knowledge` — the admin publish path.

    A content publish asks the AI service to re-ingest so deleted/edited content
    stops being retrievable. That path must index and mark the store ready on
    success, and raise (never silently succeed) on failure so the backend can
    report the publish honestly.
    """

    def test_success_indexes_and_marks_ready(self, chroma, monkeypatch, tmp_path):
        from core import startup

        kb = {
            "profile": {"name": "Ritu Raj", "title": "Full Stack Developer"},
            "projects": [
                {"title": "Story", "description": "A long enough description to index."}
            ],
        }
        kb_path = tmp_path / "kb.json"
        kb_path.write_text(json.dumps(kb), encoding="utf-8")
        monkeypatch.setattr(settings, "KNOWLEDGE_FILE", str(kb_path))
        monkeypatch.setattr(settings, "KNOWLEDGE_SOURCE", "file")

        startup._knowledge_ready = False
        stats = startup.reingest_knowledge()

        assert stats["count"] > 0
        assert stats["added"] > 0
        assert startup.is_knowledge_ready() is True

    def test_failure_raises_and_leaves_not_ready(self, chroma, monkeypatch):
        from core import startup

        monkeypatch.setattr(settings, "CONTENT_API_URL", "http://127.0.0.1:1/api/content")
        monkeypatch.setattr(settings, "KNOWLEDGE_SOURCE", "api")

        startup._knowledge_ready = False
        with pytest.raises(ContentAPIError):
            startup.reingest_knowledge()
        assert startup.is_knowledge_ready() is False