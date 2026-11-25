"""Contract tests for the versioned project case-study document."""

from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from app.schemas.content import CaseStudy, Project


def _valid_case_study() -> dict:
    return {
        "schemaVersion": 1,
        "role": "Solo full-stack developer",
        "timeline": {
            "label": "Jan - Mar 2025",
            "start": "2025",
            "end": "2025-03",
            "duration": "10 weeks",
        },
        "team": {
            "size": 1,
            "roles": ["Frontend", "Backend"],
            "note": "Solo build",
        },
        "problem": {
            "summary": "Support teams had no way to answer repeat questions.",
            "context": "The product needed a self-serve assistant.",
        },
        "constraints": ["No paid vector database at launch."],
        "approach": [
            {
                "heading": "Ingestion",
                "body": "Documents were normalized, chunked, and embedded.",
            }
        ],
        "architecture": {
            "summary": "A React dashboard talks to an API and an AI service.",
            "components": [
                {
                    "name": "Dashboard",
                    "role": "Tenant-facing chat",
                    "technology": "React, Vite",
                }
            ],
            "diagram": {
                "src": "https://media.example.com/project-images/diagram.webp",
                "alt": "Architecture diagram",
                "width": 1600,
                "height": 900,
                "caption": "Request path.",
            },
        },
        "keyDecisions": [
            {
                "decision": "Use server-sent events.",
                "rationale": "The browser needed incremental tokens.",
                "tradeoff": "One-way streaming only.",
            }
        ],
        "challenges": [
            {
                "problem": "Tenant isolation.",
                "resolution": "Every chunk carried a tenant identifier.",
                "lesson": "Enforce isolation in the data model.",
            }
        ],
        "outcomes": [
            {
                "kind": "quantitative",
                "statement": "Reduced first-token latency.",
                "metric": "first-token latency",
                "value": "420",
                "unit": "ms",
                "baseline": "1.8 s",
                "direction": "lower",
                "evidence": {
                    "status": "verified",
                    "source": "Server timing report captured on 2025-03-14.",
                    "url": "https://example.com/evidence/latency",
                    "note": "Reference deployment only.",
                },
            },
            {
                "kind": "qualitative",
                "statement": "A non-engineer updated the knowledge base.",
                "evidence": None,
            },
        ],
        "learnings": ["Grounding the prompt was valuable."],
        "gallery": [
            {
                "src": "/images/projects/webchat-ai.webp",
                "alt": "Chat panel",
                "width": 1600,
                "height": 900,
                "caption": "Streamed answer.",
            }
        ],
        "links": [
            {
                "label": "Source code",
                "url": "https://github.com/riturajlabs/webchat-AI",
                "kind": "source",
            }
        ],
    }


def _error_text(data: dict) -> str:
    with pytest.raises(ValidationError) as exc_info:
        CaseStudy.model_validate(data)
    return str(exc_info.value)


CASE_STUDY_WHITESPACE_CODEPOINTS = [
    "\u0009",
    "\u000a",
    "\u000b",
    "\u000c",
    "\u000d",
    "\u0020",
    "\u0085",
    "\u00a0",
    "\u1680",
    "\u2000",
    "\u2001",
    "\u2002",
    "\u2003",
    "\u2004",
    "\u2005",
    "\u2006",
    "\u2007",
    "\u2008",
    "\u2009",
    "\u200a",
    "\u2028",
    "\u2029",
    "\u202f",
    "\u205f",
    "\u3000",
]

NON_WHITESPACE_CODEPOINTS = [
    "\u001c",
    "\u001d",
    "\u001e",
    "\u001f",
    "\ufeff",
    "\u180e",
    "\u200b",
]


def _boundary_case_study(context_length: int) -> dict:
    return {
        "schemaVersion": 1,
        "role": "r" * 120,
        "problem": {
            "summary": "s" * 600,
            "context": "c" * context_length,
        },
        "approach": [
            {"heading": "A", "body": "x" * 2000} for _ in range(12)
        ],
        "constraints": ["c" * 240 for _ in range(12)],
        "learnings": ["l" * 300 for _ in range(12)],
    }


def test_project_exposes_case_study() -> None:
    assert "caseStudy" in Project.model_fields


def test_valid_full_document_is_accepted() -> None:
    case_study = CaseStudy.model_validate(_valid_case_study())

    assert case_study.schemaVersion == 1
    assert case_study.role == "Solo full-stack developer"
    assert case_study.timeline.start == "2025"
    assert case_study.architecture.diagram.width == 1600
    assert case_study.outcomes[0].evidence.status == "verified"
    assert case_study.outcomes[1].evidence is None


def test_unknown_keys_are_rejected_at_every_level() -> None:
    top_level = _valid_case_study()
    top_level["unexpected"] = True
    assert "extra_forbidden" in _error_text(top_level)

    timeline = _valid_case_study()
    timeline["timeline"]["season"] = "spring"
    assert "extra_forbidden" in _error_text(timeline)

    evidence = _valid_case_study()
    evidence["outcomes"][0]["evidence"]["artifact"] = "report"
    assert "extra_forbidden" in _error_text(evidence)


@pytest.mark.parametrize("document", [{}, {"schemaVersion": 2, "role": "Dev"}])
def test_schema_version_is_required_and_exactly_one(document: dict) -> None:
    assert "schemaVersion" in _error_text(document)


@pytest.mark.parametrize("value", [True, False, 1.0, 1.5, "1"])
def test_schema_version_rejects_non_integer_json_types(value: object) -> None:
    document = _valid_case_study()
    document["schemaVersion"] = value

    assert "schemaVersion" in _error_text(document)


def test_empty_document_is_rejected() -> None:
    assert "at least one substantive field" in _error_text({"schemaVersion": 1})


def test_optional_blank_strings_normalize_to_none() -> None:
    document = _valid_case_study()
    document["role"] = "   "
    document["problem"]["context"] = "   "
    document["team"]["note"] = "   "

    case_study = CaseStudy.model_validate(document)

    assert case_study.role is None
    assert case_study.problem.context is None
    assert case_study.team.note is None


@pytest.mark.parametrize(
    "timeline",
    [
        {"start": "2025", "end": "2025-12"},
        {"start": "2025-06", "end": "2025"},
        {"start": "2025", "end": "2025"},
        {"start": "2025-06", "end": "2025-06"},
    ],
)
def test_timeline_accepts_normalized_endpoints(timeline: dict) -> None:
    document = _valid_case_study()
    document["timeline"] = timeline

    assert CaseStudy.model_validate(document).timeline.start is not None


@pytest.mark.parametrize(
    "timeline",
    [
        {"start": "2026-01", "end": "2025"},
        {"start": "2025-12", "end": "2025-06"},
        {"start": "2025-13"},
        {"end": "2025-00"},
        {"start": "2025-1"},
        {"start": "2025-01-01"},
        {},
    ],
)
def test_timeline_rejects_invalid_ranges_and_dates(timeline: dict) -> None:
    document = _valid_case_study()
    document["timeline"] = timeline

    assert "timeline" in _error_text(document)


@pytest.mark.parametrize("value", ["\u0662\u0660\u0662\u0665", "\u0662\u0660\u0662\u0665-\u0660\u0666"])
def test_timeline_rejects_non_ascii_digits(value: str) -> None:
    document = _valid_case_study()
    document["timeline"] = {"start": value}

    assert "timeline.start" in _error_text(document)


def test_team_requires_content_and_bounded_size() -> None:
    empty = _valid_case_study()
    empty["team"] = {}
    assert "at least one field" in _error_text(empty)

    too_large = _valid_case_study()
    too_large["team"] = {"size": 1001}
    assert "team.size" in _error_text(too_large)


@pytest.mark.parametrize("value", ["1", True, False, 1.0, 1.5])
def test_team_size_rejects_non_integer_json_types(value: object) -> None:
    document = _valid_case_study()
    document["team"]["size"] = value

    assert "team.size" in _error_text(document)


@pytest.mark.parametrize(
    ("section", "replacement"),
    [
        ("problem", {"context": "No summary."}),
        ("approach", [{"heading": "Ingestion"}]),
        ("architecture", {"components": []}),
        ("keyDecisions", [{"decision": "Use SSE."}]),
        ("challenges", [{"problem": "Isolation."}]),
    ],
)
def test_required_nested_fields_are_enforced(section: str, replacement: object) -> None:
    document = _valid_case_study()
    document[section] = replacement

    assert section in _error_text(document)


def test_quantitative_outcomes_require_metric_value_and_evidence() -> None:
    document = _valid_case_study()
    document["outcomes"] = [
        {
            "kind": "quantitative",
            "statement": "Reduced latency.",
            "metric": "latency",
            "value": "420",
        }
    ]
    assert "require metric, value, and evidence" in _error_text(document)


def test_qualitative_outcomes_reject_metric_fields() -> None:
    document = _valid_case_study()
    document["outcomes"][1]["metric"] = "users"

    assert "must not include metric" in _error_text(document)


@pytest.mark.parametrize("status", ["verified", "reported"])
def test_verified_and_reported_evidence_require_source(status: str) -> None:
    document = _valid_case_study()
    document["outcomes"][0]["evidence"] = {"status": status}

    assert "source is required" in _error_text(document)


def test_unverified_quantitative_evidence_may_omit_source() -> None:
    document = _valid_case_study()
    document["outcomes"][0]["evidence"] = {"status": "unverified"}

    outcome = CaseStudy.model_validate(document).outcomes[0]

    assert outcome.evidence.status == "unverified"
    assert outcome.evidence.source is None


def test_bare_url_is_not_an_evidence_source() -> None:
    document = _valid_case_study()
    document["outcomes"][0]["evidence"]["source"] = "https://example.com/report"

    assert "not just a URL" in _error_text(document)


@pytest.mark.parametrize(
    "src",
    [
        "https://media.example.com/project-images/gallery.webp",
        "/images/projects/webchat-ai.webp",
    ],
)
def test_image_sources_accept_flat_paths_and_absolute_urls(src: str) -> None:
    document = _valid_case_study()
    document["gallery"][0]["src"] = src

    assert CaseStudy.model_validate(document).gallery[0].src == src


@pytest.mark.parametrize(
    "src",
    [
        "/images/projects/webchat-ai/gallery.webp",
        "data:image/webp;base64,AAAA",
        "javascript:alert(1)",
        "https://media.example.com/image.webp?x=1 2",
    ],
)
def test_image_sources_reject_nested_and_unsafe_values(src: str) -> None:
    document = _valid_case_study()
    document["gallery"][0]["src"] = src

    assert "src must be" in _error_text(document)


@pytest.mark.parametrize("field", ["width", "height"])
@pytest.mark.parametrize("value", [0, -1])
def test_image_dimensions_must_be_positive(field: str, value: int) -> None:
    document = _valid_case_study()
    document["gallery"][0][field] = value

    assert field in _error_text(document)


@pytest.mark.parametrize("field", ["width", "height"])
@pytest.mark.parametrize("value", ["1600", True, False, 1600.0, 1600.5])
def test_image_dimensions_reject_non_integer_json_types(
    field: str, value: object
) -> None:
    document = _valid_case_study()
    document["gallery"][0][field] = value

    assert field in _error_text(document)


def test_duplicate_link_urls_are_rejected() -> None:
    document = _valid_case_study()
    document["links"].append(
        {
            "label": "Demo",
            "url": document["links"][0]["url"],
            "kind": "demo",
        }
    )

    assert "duplicates an earlier link" in _error_text(document)


def test_bounded_strings_use_unicode_code_points() -> None:
    at_limit = _valid_case_study()
    at_limit["role"] = "\U0001f600" * 120
    at_limit["constraints"] = ["\U0001f600" * 240]
    assert CaseStudy.model_validate(at_limit).role == "\U0001f600" * 120

    over_role = _valid_case_study()
    over_role["role"] = "\U0001f600" * 121
    assert "role" in _error_text(over_role)

    over_constraint = _valid_case_study()
    over_constraint["constraints"] = ["\U0001f600" * 241]
    assert "constraints" in _error_text(over_constraint)


@pytest.mark.parametrize(
    ("body_length", "accepted"),
    [(1800, True), (1805, False), (1810, False)],
)
def test_document_size_uses_normalized_canonical_json(
    body_length: int, accepted: bool
) -> None:
    document = {
        "schemaVersion": 1,
        "approach": [
            {"heading": "A", "body": "\u6f22" * body_length} for _ in range(6)
        ],
    }
    raw_bytes = len(
        json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode(
            "utf-8"
        )
    )
    assert raw_bytes <= 32 * 1024

    if accepted:
        assert CaseStudy.model_validate(document)
    else:
        assert "32768 bytes or fewer" in _error_text(document)


def test_document_size_is_capped_at_32_kib() -> None:
    document = _valid_case_study()
    document["approach"] = [
        {"heading": f"Approach {index}", "body": "x" * 2000}
        for index in range(12)
    ]
    document["challenges"] = [
        {
            "problem": f"Problem {index} " + "x" * 580,
            "resolution": "x" * 1200,
            "lesson": "x" * 600,
        }
        for index in range(10)
    ]

    assert "32768 bytes or fewer" in _error_text(document)



@pytest.mark.parametrize(
    ("context_length", "accepted"),
    [(953, True), (954, True), (955, False)],
)
def test_exact_32_kib_boundary_uses_normalized_canonical_json(
    context_length: int, accepted: bool
) -> None:
    document = _boundary_case_study(context_length)

    if accepted:
        case_study = CaseStudy.model_validate(document)
        expected_bytes = 32767 + (context_length - 953)
        assert len(case_study.model_dump_json().encode("utf-8")) == expected_bytes
    else:
        assert "32768 bytes or fewer" in _error_text(document)


@pytest.mark.parametrize("whitespace", CASE_STUDY_WHITESPACE_CODEPOINTS)
def test_shared_whitespace_is_trimmed_from_text(whitespace: str) -> None:
    document = _valid_case_study()
    document["role"] = f"{whitespace}Solo{whitespace}"
    assert CaseStudy.model_validate(document).role == "Solo"

    blank = _valid_case_study()
    blank["role"] = whitespace
    assert CaseStudy.model_validate(blank).role is None

    required = _valid_case_study()
    required["constraints"] = [f"{whitespace}Keep{whitespace}"]
    assert CaseStudy.model_validate(required).constraints == ["Keep"]

    required_blank = _valid_case_study()
    required_blank["constraints"] = [whitespace]
    assert "constraints" in _error_text(required_blank)


@pytest.mark.parametrize("character", NON_WHITESPACE_CODEPOINTS)
def test_non_whitespace_codepoints_are_retained_as_content(character: str) -> None:
    document = _valid_case_study()
    document["role"] = f"{character}Solo{character}"
    assert CaseStudy.model_validate(document).role == f"{character}Solo{character}"

    blank = _valid_case_study()
    blank["constraints"] = [character]
    assert CaseStudy.model_validate(blank).constraints == [character]

    only_character = {"schemaVersion": 1, "role": character}
    assert CaseStudy.model_validate(only_character).role == character


@pytest.mark.parametrize("whitespace", CASE_STUDY_WHITESPACE_CODEPOINTS)
def test_shared_whitespace_only_text_is_not_substantive(whitespace: str) -> None:
    assert "at least one substantive field" in _error_text(
        {"schemaVersion": 1, "role": whitespace}
    )


@pytest.mark.parametrize("whitespace", CASE_STUDY_WHITESPACE_CODEPOINTS)
def test_urls_reject_shared_whitespace_in_every_position(whitespace: str) -> None:
    for url in (
        f"{whitespace}https://example.com/a",
        f"https://example.com/a{whitespace}b",
        f"https://example.com/a{whitespace}",
    ):
        optional_url = _valid_case_study()
        optional_url["outcomes"][0]["evidence"]["url"] = url
        assert "url" in _error_text(optional_url)

        image = _valid_case_study()
        image["gallery"][0]["src"] = url
        assert "src" in _error_text(image)

        link = _valid_case_study()
        link["links"][0]["url"] = url
        assert "url" in _error_text(link)


@pytest.mark.parametrize("character", NON_WHITESPACE_CODEPOINTS)
def test_urls_allow_non_whitespace_codepoints(character: str) -> None:
    url = f"https://example.com/a{character}b"
    document = _valid_case_study()
    document["outcomes"][0]["evidence"]["url"] = url
    document["gallery"][0]["src"] = url
    document["links"][0]["url"] = url

    case_study = CaseStudy.model_validate(document)

    assert case_study.outcomes[0].evidence.url == url
    assert case_study.gallery[0].src == url
    assert case_study.links[0].url == url


def test_optional_url_rejects_whitespace_but_normalizes_empty_string() -> None:
    empty = _valid_case_study()
    empty["outcomes"][0]["evidence"]["url"] = ""
    assert CaseStudy.model_validate(empty).outcomes[0].evidence.url is None

    whitespace_only = _valid_case_study()
    whitespace_only["outcomes"][0]["evidence"]["url"] = "\u0085"
    assert "url" in _error_text(whitespace_only)


@pytest.mark.parametrize(
    ("wrapper", "accepted"),
    [("\u0020", True), ("\u0085", True), ("\u001c", False), ("\ufeff", False)],
)
def test_size_uses_shared_whitespace_after_normalization(
    wrapper: str, accepted: bool
) -> None:
    document = _boundary_case_study(954)
    document["problem"]["context"] = (
        f"{wrapper}{document['problem']['context']}{wrapper}"
    )

    if accepted:
        case_study = CaseStudy.model_validate(document)
        assert len(case_study.model_dump_json().encode("utf-8")) == 32768
    else:
        assert "32768 bytes or fewer" in _error_text(document)
