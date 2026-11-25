"""Contract tests for the AI service's case-study mirror."""

from __future__ import annotations

import copy
import json

import pytest

from services import content_api
from services.content_api import ContentAPIError


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


def _payload_with_case_study(canonical_payload: dict, case_study: object) -> dict:
    payload = copy.deepcopy(canonical_payload)
    payload["projects"][0]["caseStudy"] = case_study
    return payload


def _contract_error(payload: dict) -> str:
    with pytest.raises(ContentAPIError) as exc_info:
        content_api.validate_content_payload(payload)
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


@pytest.mark.parametrize(
    "case_study",
    [None, _valid_case_study()],
    ids=["null", "valid"],
)
def test_project_accepts_null_and_valid_case_study(
    canonical_payload: dict, case_study: object
) -> None:
    payload = _payload_with_case_study(canonical_payload, case_study)

    content = content_api.validate_content_payload(payload)

    if case_study is None:
        assert content.projects[0].caseStudy is None
    else:
        assert content.projects[0].caseStudy is not None
        assert content.projects[0].caseStudy.schemaVersion == 1


def test_old_backend_payload_without_case_study_is_valid(canonical_payload: dict) -> None:
    content = content_api.validate_content_payload(copy.deepcopy(canonical_payload))

    assert content.projects[0].caseStudy is None


def test_unknown_case_study_keys_are_rejected(canonical_payload: dict) -> None:
    case_study = _valid_case_study()
    case_study["unexpected"] = True

    assert "contract" in _contract_error(
        _payload_with_case_study(canonical_payload, case_study)
    )


def test_unknown_nested_case_study_keys_are_rejected(canonical_payload: dict) -> None:
    case_study = _valid_case_study()
    case_study["timeline"]["season"] = "spring"

    assert "contract" in _contract_error(
        _payload_with_case_study(canonical_payload, case_study)
    )


@pytest.mark.parametrize("version", [2, "1"])
def test_unsupported_case_study_version_is_rejected(
    canonical_payload: dict, version: object
) -> None:
    case_study = _valid_case_study()
    case_study["schemaVersion"] = version

    assert "contract" in _contract_error(
        _payload_with_case_study(canonical_payload, case_study)
    )


@pytest.mark.parametrize("version", [True, False, 1.0, 1.5])
def test_non_integer_case_study_version_is_rejected(
    canonical_payload: dict, version: object
) -> None:
    case_study = _valid_case_study()
    case_study["schemaVersion"] = version

    assert "contract" in _contract_error(
        _payload_with_case_study(canonical_payload, case_study)
    )


def test_empty_document_is_rejected(canonical_payload: dict) -> None:
    assert "contract" in _contract_error(
        _payload_with_case_study(canonical_payload, {"schemaVersion": 1})
    )


def test_reversed_timeline_is_rejected(canonical_payload: dict) -> None:
    case_study = _valid_case_study()
    case_study["timeline"] = {"start": "2026-01", "end": "2025"}

    assert "contract" in _contract_error(
        _payload_with_case_study(canonical_payload, case_study)
    )


@pytest.mark.parametrize(
    "value", ["\u0662\u0660\u0662\u0665", "\u0662\u0660\u0662\u0665-\u0660\u0666"]
)
def test_non_ascii_timeline_digits_are_rejected(
    canonical_payload: dict, value: str
) -> None:
    case_study = _valid_case_study()
    case_study["timeline"] = {"start": value}

    assert "contract" in _contract_error(
        _payload_with_case_study(canonical_payload, case_study)
    )


def test_optional_blank_strings_normalize_to_none(canonical_payload: dict) -> None:
    case_study = _valid_case_study()
    case_study["role"] = "   "
    case_study["problem"]["context"] = "   "
    case_study["team"]["note"] = "   "

    content = content_api.validate_content_payload(
        _payload_with_case_study(canonical_payload, case_study)
    )

    assert content.projects[0].caseStudy.role is None
    assert content.projects[0].caseStudy.problem.context is None
    assert content.projects[0].caseStudy.team.note is None


def test_bare_url_evidence_source_is_rejected(canonical_payload: dict) -> None:
    case_study = _valid_case_study()
    case_study["outcomes"][0]["evidence"]["source"] = "https://example.com/report"

    assert "contract" in _contract_error(
        _payload_with_case_study(canonical_payload, case_study)
    )


def test_quantitative_outcome_requires_evidence(canonical_payload: dict) -> None:
    case_study = _valid_case_study()
    case_study["outcomes"][0]["evidence"] = None

    assert "contract" in _contract_error(
        _payload_with_case_study(canonical_payload, case_study)
    )


def test_qualitative_outcome_rejects_metric_fields(canonical_payload: dict) -> None:
    case_study = _valid_case_study()
    case_study["outcomes"][1]["metric"] = "users"

    assert "contract" in _contract_error(
        _payload_with_case_study(canonical_payload, case_study)
    )


def test_nested_local_gallery_path_is_rejected(canonical_payload: dict) -> None:
    case_study = _valid_case_study()
    case_study["gallery"][0]["src"] = "/images/projects/webchat-ai/gallery.webp"

    assert "contract" in _contract_error(
        _payload_with_case_study(canonical_payload, case_study)
    )


@pytest.mark.parametrize("field", ["width", "height"])
def test_image_dimensions_must_be_positive(
    canonical_payload: dict, field: str
) -> None:
    case_study = _valid_case_study()
    case_study["gallery"][0][field] = 0

    assert "contract" in _contract_error(
        _payload_with_case_study(canonical_payload, case_study)
    )


@pytest.mark.parametrize("field", ["width", "height"])
@pytest.mark.parametrize("value", ["1600", True, False, 1600.0, 1600.5])
def test_image_dimensions_reject_non_integer_json_types(
    canonical_payload: dict, field: str, value: object
) -> None:
    case_study = _valid_case_study()
    case_study["gallery"][0][field] = value

    assert "contract" in _contract_error(
        _payload_with_case_study(canonical_payload, case_study)
    )


@pytest.mark.parametrize("value", ["1", True, False, 1.0, 1.5])
def test_team_size_rejects_non_integer_json_types(
    canonical_payload: dict, value: object
) -> None:
    case_study = _valid_case_study()
    case_study["team"]["size"] = value

    assert "contract" in _contract_error(
        _payload_with_case_study(canonical_payload, case_study)
    )


def test_bounded_strings_use_unicode_code_points(canonical_payload: dict) -> None:
    at_limit = _valid_case_study()
    at_limit["role"] = "\U0001f600" * 120
    at_limit["constraints"] = ["\U0001f600" * 240]
    content = content_api.validate_content_payload(
        _payload_with_case_study(canonical_payload, at_limit)
    )
    assert content.projects[0].caseStudy.role == "\U0001f600" * 120

    over_role = _valid_case_study()
    over_role["role"] = "\U0001f600" * 121
    assert "contract" in _contract_error(
        _payload_with_case_study(canonical_payload, over_role)
    )

    over_constraint = _valid_case_study()
    over_constraint["constraints"] = ["\U0001f600" * 241]
    assert "contract" in _contract_error(
        _payload_with_case_study(canonical_payload, over_constraint)
    )


@pytest.mark.parametrize(
    ("body_length", "accepted"),
    [(1800, True), (1805, False), (1810, False)],
)
def test_document_size_uses_normalized_canonical_json(
    canonical_payload: dict, body_length: int, accepted: bool
) -> None:
    case_study = {
        "schemaVersion": 1,
        "approach": [
            {"heading": "A", "body": "\u6f22" * body_length} for _ in range(6)
        ],
    }
    raw_bytes = len(
        json.dumps(case_study, ensure_ascii=False, separators=(",", ":")).encode(
            "utf-8"
        )
    )
    assert raw_bytes <= 32 * 1024

    if accepted:
        content = content_api.validate_content_payload(
            _payload_with_case_study(canonical_payload, case_study)
        )
        assert content.projects[0].caseStudy is not None
    else:
        assert "contract" in _contract_error(
            _payload_with_case_study(canonical_payload, case_study)
        )


def test_document_size_is_capped(canonical_payload: dict) -> None:
    case_study = _valid_case_study()
    case_study["approach"] = [
        {"heading": f"Approach {index}", "body": "x" * 2000}
        for index in range(12)
    ]
    case_study["challenges"] = [
        {
            "problem": f"Problem {index} " + "x" * 580,
            "resolution": "x" * 1200,
            "lesson": "x" * 600,
        }
        for index in range(10)
    ]

    assert "contract" in _contract_error(
        _payload_with_case_study(canonical_payload, case_study)
    )


def test_sections_exclude_case_study_from_project_summary(
    canonical_payload: dict,
) -> None:
    payload = _payload_with_case_study(canonical_payload, _valid_case_study())
    content = content_api.validate_content_payload(payload)

    sections = content_api.sections_from_content(content)

    assert "caseStudy" not in sections["projects"][content.projects[0].slug]
    assert "project_case_studies" not in sections


def test_absent_and_null_case_study_produce_identical_sections(
    canonical_payload: dict,
) -> None:
    absent = content_api.validate_content_payload(copy.deepcopy(canonical_payload))
    explicit_null = content_api.validate_content_payload(
        _payload_with_case_study(canonical_payload, None)
    )

    assert content_api.sections_from_content(absent) == content_api.sections_from_content(
        explicit_null
    )


@pytest.mark.parametrize(
    ("context_length", "accepted"),
    [(953, True), (954, True), (955, False)],
)
def test_exact_32_kib_boundary_uses_normalized_canonical_json(
    canonical_payload: dict, context_length: int, accepted: bool
) -> None:
    case_study = _boundary_case_study(context_length)
    payload = _payload_with_case_study(canonical_payload, case_study)

    if accepted:
        content = content_api.validate_content_payload(payload)
        expected_bytes = 32767 + (context_length - 953)
        assert (
            len(
                content.projects[0].caseStudy.model_dump_json().encode("utf-8")
            )
            == expected_bytes
        )
    else:
        assert "contract" in _contract_error(payload)


@pytest.mark.parametrize("whitespace", CASE_STUDY_WHITESPACE_CODEPOINTS)
def test_shared_whitespace_is_trimmed_from_text(
    canonical_payload: dict, whitespace: str
) -> None:
    case_study = _valid_case_study()
    case_study["role"] = f"{whitespace}Solo{whitespace}"
    content = content_api.validate_content_payload(
        _payload_with_case_study(canonical_payload, case_study)
    )
    assert content.projects[0].caseStudy.role == "Solo"

    blank = _valid_case_study()
    blank["role"] = whitespace
    content = content_api.validate_content_payload(
        _payload_with_case_study(canonical_payload, blank)
    )
    assert content.projects[0].caseStudy.role is None

    required = _valid_case_study()
    required["constraints"] = [f"{whitespace}Keep{whitespace}"]
    content = content_api.validate_content_payload(
        _payload_with_case_study(canonical_payload, required)
    )
    assert content.projects[0].caseStudy.constraints == ["Keep"]

    required_blank = _valid_case_study()
    required_blank["constraints"] = [whitespace]
    assert "contract" in _contract_error(
        _payload_with_case_study(canonical_payload, required_blank)
    )


@pytest.mark.parametrize("character", NON_WHITESPACE_CODEPOINTS)
def test_non_whitespace_codepoints_are_retained_as_content(
    canonical_payload: dict, character: str
) -> None:
    case_study = _valid_case_study()
    case_study["role"] = f"{character}Solo{character}"
    content = content_api.validate_content_payload(
        _payload_with_case_study(canonical_payload, case_study)
    )
    assert content.projects[0].caseStudy.role == f"{character}Solo{character}"

    blank = _valid_case_study()
    blank["constraints"] = [character]
    content = content_api.validate_content_payload(
        _payload_with_case_study(canonical_payload, blank)
    )
    assert content.projects[0].caseStudy.constraints == [character]

    only_character = content_api.validate_content_payload(
        _payload_with_case_study(
            canonical_payload, {"schemaVersion": 1, "role": character}
        )
    )
    assert only_character.projects[0].caseStudy.role == character


@pytest.mark.parametrize("whitespace", CASE_STUDY_WHITESPACE_CODEPOINTS)
def test_shared_whitespace_only_text_is_not_substantive(
    canonical_payload: dict, whitespace: str
) -> None:
    assert "contract" in _contract_error(
        _payload_with_case_study(
            canonical_payload, {"schemaVersion": 1, "role": whitespace}
        )
    )


@pytest.mark.parametrize("whitespace", CASE_STUDY_WHITESPACE_CODEPOINTS)
def test_urls_reject_shared_whitespace_in_every_position(
    canonical_payload: dict, whitespace: str
) -> None:
    for url in (
        f"{whitespace}https://example.com/a",
        f"https://example.com/a{whitespace}b",
        f"https://example.com/a{whitespace}",
    ):
        optional_url = _valid_case_study()
        optional_url["outcomes"][0]["evidence"]["url"] = url
        assert "contract" in _contract_error(
            _payload_with_case_study(canonical_payload, optional_url)
        )

        image = _valid_case_study()
        image["gallery"][0]["src"] = url
        assert "contract" in _contract_error(
            _payload_with_case_study(canonical_payload, image)
        )

        link = _valid_case_study()
        link["links"][0]["url"] = url
        assert "contract" in _contract_error(
            _payload_with_case_study(canonical_payload, link)
        )


@pytest.mark.parametrize("character", NON_WHITESPACE_CODEPOINTS)
def test_urls_allow_non_whitespace_codepoints(
    canonical_payload: dict, character: str
) -> None:
    url = f"https://example.com/a{character}b"
    case_study = _valid_case_study()
    case_study["outcomes"][0]["evidence"]["url"] = url
    case_study["gallery"][0]["src"] = url
    case_study["links"][0]["url"] = url

    content = content_api.validate_content_payload(
        _payload_with_case_study(canonical_payload, case_study)
    )

    assert content.projects[0].caseStudy.outcomes[0].evidence.url == url
    assert content.projects[0].caseStudy.gallery[0].src == url
    assert content.projects[0].caseStudy.links[0].url == url


def test_optional_url_rejects_whitespace_but_normalizes_empty_string(
    canonical_payload: dict,
) -> None:
    empty = _valid_case_study()
    empty["outcomes"][0]["evidence"]["url"] = ""
    content = content_api.validate_content_payload(
        _payload_with_case_study(canonical_payload, empty)
    )
    assert content.projects[0].caseStudy.outcomes[0].evidence.url is None

    whitespace_only = _valid_case_study()
    whitespace_only["outcomes"][0]["evidence"]["url"] = "\u0085"
    assert "contract" in _contract_error(
        _payload_with_case_study(canonical_payload, whitespace_only)
    )


@pytest.mark.parametrize(
    ("wrapper", "accepted"),
    [("\u0020", True), ("\u0085", True), ("\u001c", False), ("\ufeff", False)],
)
def test_size_uses_shared_whitespace_after_normalization(
    canonical_payload: dict, wrapper: str, accepted: bool
) -> None:
    case_study = _boundary_case_study(954)
    case_study["problem"]["context"] = (
        f"{wrapper}{case_study['problem']['context']}{wrapper}"
    )
    payload = _payload_with_case_study(canonical_payload, case_study)

    if accepted:
        content = content_api.validate_content_payload(payload)
        assert (
            len(
                content.projects[0].caseStudy.model_dump_json().encode("utf-8")
            )
            == 32768
        )
    else:
        assert "contract" in _contract_error(payload)
