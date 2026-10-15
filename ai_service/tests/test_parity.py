"""Deterministic parity tests: legacy knowledge_base.json vs /api/content.

The expected outcome is an honest PARITY: FAIL — the legacy JSON carries
sections `/api/content` does not (education/recruiter/socials/faq) plus per-item
detail the public contract dropped. The tests pin the *determinism* of that
verdict, not its "PASSness".
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

from services import parity


def _legacy() -> dict:
    path = Path(__file__).resolve().parent.parent / "knowledge_base.json"
    return json.loads(path.read_text(encoding="utf-8"))


def test_verdict_is_honest_fail(canonical_payload):
    result = parity.compare(_legacy(), canonical_payload)

    assert result["verdict"] == "FAIL"
    # The driver: legacy-only sections can't come from /api/content.
    assert result["legacy_only_facts"] > 0
    assert set(result["sections"]["legacy_only"]) >= {"education", "recruiter", "socials", "faq"}
    # Every /api/content fact IS indexable (meta is provenance, excluded by design).
    assert result["api_only_unsupported_facts"] == 0

    # Canonical 5th project exists only on the API side.
    assert result["projects"]["api_only_slugs"] == ["zerodha-clone"]

    # Shared identity fact agrees.
    assert result["profile"]["name_matches"] is True


def test_certification_issuer_drift_detected(canonical_payload):
    result = parity.compare(_legacy(), canonical_payload)
    titles = {diff["title"] for diff in result["certifications"]["issuer_diffs"]}
    assert titles >= {
        "Python for Data Science and Machine Learning",
        "Artificial Intelligence Foundations: Machine Learning",
    }


def test_compare_is_deterministic(canonical_payload):
    legacy = _legacy()
    assert parity.compare(legacy, canonical_payload) == parity.compare(legacy, canonical_payload)


def test_compare_ignores_section_order(canonical_payload):
    """Reordering /api/content lists (the API's ORDER BY is total, but a
    consumer must not depend on byte order) yields the same verdict."""
    legacy = _legacy()
    shuffled = copy.deepcopy(canonical_payload)
    shuffled["projects"] = list(reversed(shuffled["projects"]))
    shuffled["skills"] = list(reversed(shuffled["skills"]))
    shuffled["certifications"] = list(reversed(shuffled["certifications"]))

    a = parity.compare(legacy, canonical_payload)
    b = parity.compare(legacy, shuffled)
    assert a == b
    assert a["projects"]["api_only_slugs"] == b["projects"]["api_only_slugs"]


def test_snapshot_bookkeeping_stripped(canonical_payload):
    """The comparison strips non-content keys (e.g. the extractor's
    `_migration` block) before classifying sections."""
    dirty = dict(canonical_payload, _migration={"tool": "x"})
    assert parity.compare(_legacy(), dirty) == parity.compare(_legacy(), canonical_payload)