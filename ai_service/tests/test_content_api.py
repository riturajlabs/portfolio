"""Fetch + validation tests for the `/api/content` client boundary.

Phase 9 fail-closed contract: any transport / HTTP / decode / schema /
semantic failure raises `ContentAPIError`; nothing partial is ever returned and
nothing silently falls back to the legacy JSON.
"""
from __future__ import annotations

import httpx
import pytest

from services import content_api
from services.content_api import ContentAPIError

_SNAPSHOT = content_api  # keep import visible in coverage tooling


def _make_client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def _ok_response(payload: dict) -> httpx.Response:
    return httpx.Response(200, json=payload)


class TestFetch:
    def test_successful_fetch_validates_and_transforms(self, canonical_payload):
        client = _make_client(lambda request: _ok_response(canonical_payload))
        result = content_api.fetch_validated_content(client)

        assert result.profile.name == "Ritu Raj"
        assert len(result.projects) == 5
        slugs = {p.slug for p in result.projects}
        assert slugs == {
            "webchat-ai",
            "orbit-ai",
            "stayora",
            "zerodha-clone",
            "scientific-calculator",
        }
        assert len(result.skills) == 16
        assert len(result.certifications) == 3

        sections = content_api.sections_from_content(result)
        assert set(sections) == {"profile", "about", "projects", "skills", "certifications", "seo"}
        # meta is provenance, not knowledge — must never enter the store.
        assert "meta" not in sections

        chunks = content_api.chunks_from_sections(sections)
        project_chunks = [c for c in chunks if c["metadata"]["source"] == "projects"]
        assert len(project_chunks) == 5  # one chunk per published project, keyed by slug

        # A project chunk id is derived from (section, slug, text) — stable.
        zerodha = next(
            c for c in project_chunks if "zerodha" in c["id"] or "Title: Zerodha" in c["text"]
        )
        assert "Zerodha" in zerodha["text"]

    def test_api_down_raises_unreachable(self, monkeypatch):
        monkeypatch.setattr(content_api.settings, "CONTENT_API_URL", "http://127.0.0.1:1/api/content")
        with pytest.raises(ContentAPIError, match="unreachable"):
            content_api.fetch_validated_content()

    def test_http_500_raises(self):
        client = _make_client(lambda request: httpx.Response(500, json={"detail": "boom"}))
        with pytest.raises(ContentAPIError, match="HTTP 500"):
            content_api.fetch_validated_content(client)

    def test_http_404_raises(self):
        client = _make_client(lambda request: httpx.Response(404, json={"detail": "nope"}))
        with pytest.raises(ContentAPIError, match="HTTP 404"):
            content_api.fetch_validated_content(client)

    def test_invalid_json_raises(self):
        client = _make_client(lambda request: httpx.Response(200, text="<html>not json</html>"))
        with pytest.raises(ContentAPIError, match="non-JSON"):
            content_api.fetch_validated_content(client)


class TestValidation:
    def test_unknown_top_level_key_rejected(self, canonical_payload):
        payload = {**canonical_payload, "contact_message": {"a": 1}}
        with pytest.raises(ContentAPIError, match="contract"):
            content_api.validate_content_payload(payload)

    def test_missing_profile_rejected(self, canonical_payload):
        payload = {k: v for k, v in canonical_payload.items() if k != "profile"}
        with pytest.raises(ContentAPIError, match="contract"):
            content_api.validate_content_payload(payload)

    def test_admin_field_inside_project_rejected(self, canonical_payload):
        payload = dict(canonical_payload)
        payload["projects"] = [dict(payload["projects"][0], isAdmin=True)]
        with pytest.raises(ContentAPIError, match="contract"):
            content_api.validate_content_payload(payload)

    def test_unknown_field_inside_profile_rejected(self, canonical_payload):
        payload = dict(canonical_payload)
        payload["profile"] = dict(payload["profile"], phone="+91")
        with pytest.raises(ContentAPIError, match="contract"):
            content_api.validate_content_payload(payload)

    def test_duplicate_project_slug_rejected(self, canonical_payload):
        payload = dict(canonical_payload)
        payload["projects"] = [payload["projects"][0], dict(payload["projects"][0])]
        with pytest.raises(ContentAPIError, match="duplicate project slug"):
            content_api.validate_content_payload(payload)

    def test_bad_project_status_rejected(self, canonical_payload):
        payload = dict(canonical_payload)
        payload["projects"] = [dict(payload["projects"][0], status="draft")]
        with pytest.raises(ContentAPIError, match="status"):
            content_api.validate_content_payload(payload)

    def test_empty_slug_rejected(self, canonical_payload):
        payload = dict(canonical_payload)
        payload["projects"] = [dict(payload["projects"][0], slug="")]
        with pytest.raises(ContentAPIError, match="empty project slug"):
            content_api.validate_content_payload(payload)

    def test_zero_projects_is_valid_content(self, canonical_payload):
        """Documented decision: the backend serialises empty collections as `[]`
        (a fresh database is valid), so zero projects is valid content that
        indexes no project chunks — not a contract violation."""
        payload = dict(canonical_payload, projects=[])
        content = content_api.validate_content_payload(payload)
        sections = content_api.sections_from_content(content)
        assert sections["projects"] == {}
        assert not [c for c in content_api.chunks_from_sections(sections) if c["metadata"]["source"] == "projects"]

    def test_hidden_status_accepted(self, canonical_payload):
        payload = dict(canonical_payload)
        payload["projects"] = [dict(payload["projects"][0], status="hidden")]
        assert content_api.validate_content_payload(payload).projects[0].status == "hidden"