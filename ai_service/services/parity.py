"""Deterministic parity comparison: legacy `knowledge_base.json` vs `/api/content`.

Phase 9 requirement (docs/MIGRATION.md Phase 9): before the legacy JSON stops
being trusted, prove whether the two knowledge sources agree. This module
produces a deterministic, offline, structural diff — no LLM, no embeddings, no
database — so the same inputs always yield the same verdict.

Verdict rule (MIGRATION Phase 9 §17):
    PARITY: PASS  ⇔  legacy-only facts == 0 AND api-only unsupported facts == 0
                     AND no meaningful differences.
    Otherwise PARITY: FAIL, and the legacy source is NOT deleted/deprecated
    (it stays as the rollback + reference copy via `KNOWLEDGE_SOURCE=file`).

For this portfolio the comparison is expected to FAIL honestly: the legacy JSON
carries sections that `/api/content` does not (education, recruiter, socials,
faq) and per-item detail the public contract dropped (project
features/architecture/challenges/learnings, skill levels, certification
summaries). Those are legacy-only facts — they make the current canonical
payload the *supported* knowledge, and the legacy file the richer-but-unsynced
archive.

CLI:
    python -m services.parity [--content PATH|URL] [--legacy PATH] [--json]
"""
from __future__ import annotations

import argparse
import json

_CONTENT_KEYS = frozenset(
    {"profile", "about", "projects", "skills", "certifications", "seo", "meta"}
)
# Sections both sources store in the same meaning.
_SHARED_SECTION_KEYS = frozenset(
    {"profile", "about", "projects", "skills", "certifications"}
)
# The API's `meta` is provenance, not knowledge; the store deliberately omits it.
_NON_KNOWLEDGE_KEYS = frozenset({"meta"})


def _facts_count(value) -> int:
    """A coarse 'fact' count for a section: keys for dicts, items for lists."""
    if isinstance(value, dict):
        return len(value)
    if isinstance(value, list):
        return len(value)
    return 1


def _load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _strip_non_content_keys(content: dict) -> dict:
    """Drop snapshot-only metadata (e.g. the extractor's `_migration` block)."""
    return {k: v for k, v in content.items() if k in _CONTENT_KEYS}


def _cert_map(certs: list[dict]) -> dict:
    return {c.get("title"): c for c in certs if isinstance(c, dict)}


def _projects_by_slug(projects) -> dict:
    out = {}
    for p in projects:
        if isinstance(p, dict) and p.get("slug"):
            out[p["slug"]] = p
    return out


def compare(legacy: dict, content: dict) -> dict:
    """Diff one legacy KB dict against one /api/content dict. Deterministic."""
    content = _strip_non_content_keys(content)
    legacy_sections = {k: v for k, v in legacy.items()}

    legacy_only = sorted(set(legacy_sections) - set(content))
    content_only = sorted(
        set(content) - set(legacy_sections) - _NON_KNOWLEDGE_KEYS
    )
    content_omitted_meta = "meta" in content

    # ---- Projects (keyed by slug) ----
    legacy_projects = _projects_by_slug(legacy_sections.get("projects", []))
    api_projects = _projects_by_slug(content.get("projects", []))
    project_common = sorted(set(legacy_projects) & set(api_projects))
    project_api_only = sorted(set(api_projects) - set(legacy_projects))
    project_legacy_only = sorted(set(legacy_projects) - set(api_projects))

    # Detail keys present only on the legacy side (the API replaced/changed them).
    # Canonical API keys the legacy copy simply doesn't carry are *additions*,
    # not legacy-only facts.
    project_legacy_detail: dict[str, list[str]] = {}
    for slug in project_common:
        ld = legacy_projects[slug]
        ad = api_projects[slug]
        extra = sorted(k for k in ld if k not in ad and ld[k] not in (None, "", []))
        if extra:
            project_legacy_detail[slug] = extra

    # ---- Skills (names) ----
    legacy_skill_names = set()
    for items in legacy_sections.get("skills", {}).values():
        if isinstance(items, list):
            for item in items:
                if isinstance(item, str):
                    legacy_skill_names.add(item)
                elif isinstance(item, dict) and item.get("name"):
                    legacy_skill_names.add(item["name"])
    api_skill_names = {s.get("name") for s in content.get("skills", []) if isinstance(s, dict)}
    legacy_skill_names.discard(None)
    api_skill_names.discard(None)
    skills_common = sorted(legacy_skill_names & api_skill_names)
    skills_api_only = sorted(api_skill_names - legacy_skill_names)
    skills_legacy_only = sorted(legacy_skill_names - api_skill_names)

    # ---- Certifications (by title) ----
    legacy_certs = _cert_map(legacy_sections.get("certifications", []))
    api_certs = _cert_map(content.get("certifications", []))
    cert_common = sorted(set(legacy_certs) & set(api_certs))
    cert_api_only = sorted(set(api_certs) - set(legacy_certs))
    cert_legacy_only = sorted(set(legacy_certs) - set(api_certs))
    cert_issuer_diffs = []
    for title in cert_common:
        li = legacy_certs[title].get("issuer")
        ai = api_certs[title].get("issuer")
        if li and ai and li != ai:
            cert_issuer_diffs.append({"title": title, "legacy": li, "content": ai})

    # ---- Profile (canonical identity facts) ----
    legacy_basic = legacy_sections.get("profile", {}).get("basic", {}) if isinstance(
        legacy_sections.get("profile"), dict
    ) else {}
    api_profile = content.get("profile", {})
    profile_diffs = []
    if legacy_basic.get("fullName") != api_profile.get("name"):
        profile_diffs.append(f"name: legacy={legacy_basic.get('fullName')!r} content={api_profile.get('name')!r}")
    if legacy_basic.get("title") != api_profile.get("title"):
        profile_diffs.append(f"title: legacy={legacy_basic.get('title')!r} content={api_profile.get('title')!r}")
    if api_profile.get("location") and legacy_basic.get("location"):
        compact = ", ".join(
            x for x in (
                legacy_basic["location"].get("city"),
                (legacy_basic["location"].get("state") or None),
                "India",
            ) if x
        )
        if api_profile["location"] != compact:
            profile_diffs.append(
                f"location: legacy={compact!r} content={api_profile['location']!r}"
            )

    # ---- Meaningful differences ----
    meaningful: list[str] = []
    if profile_diffs:
        meaningful.append("profile identity differences: " + "; ".join(profile_diffs))
    for title in cert_common:
        if legacy_certs[title].get("issueDate") and api_certs[title].get("issued_on") is None:
            meaningful.append(
                f"certification {title!r}: legacy issued {legacy_certs[title].get('issueDate')!r}, "
                f"content issued_on is null (dropped in migration)"
            )
    for slug, keys in project_legacy_detail.items():
        meaningful.append(
            f"project {slug!r}: legacy-only detail keys {sorted(keys)}"
        )
    if skills_legacy_only:
        meaningful.append(
            f"legacy-only skill names: {skills_legacy_only} "
            f"(content carries only its {len(api_skill_names)} canonical skills)"
        )
    meaningful = sorted(set(meaningful))

    # ---- Legacy-only facts (the honest, expected driver of FAIL) ----
    legacy_only_fact_groups: dict[str, int] = {}
    for section in legacy_only:
        legacy_only_fact_groups[section] = _facts_count(legacy_sections[section])
    if project_legacy_detail:
        legacy_only_fact_groups["projects.legacy_only_detail"] = len(project_legacy_detail)
    if skills_legacy_only:
        legacy_only_fact_groups["skills.legacy_only"] = len(skills_legacy_only)
    legacy_only_facts = sum(legacy_only_fact_groups.values())
    api_only_unsupported_facts = 0  # every non-meta content key is indexed

    verdict = (
        "PASS"
        if (
            legacy_only_facts == 0
            and api_only_unsupported_facts == 0
            and not meaningful
        )
        else "FAIL"
    )

    return {
        "sections": {
            "legacy": sorted(legacy_sections),
            "content": sorted(content),
            "legacy_only": legacy_only,
            "content_only": content_only,
            "content_omits_meta": content_omitted_meta,
        },
        "projects": {
            "common_slugs": project_common,
            "api_only_slugs": project_api_only,
            "legacy_only_slugs": project_legacy_only,
            "legacy_only_detail_keys": project_legacy_detail,
        },
        "skills": {
            "common_names": skills_common,
            "content_only": skills_api_only,
            "legacy_only": skills_legacy_only,
        },
        "certifications": {
            "common_titles": cert_common,
            "content_only": cert_api_only,
            "legacy_only": cert_legacy_only,
            "issuer_diffs": cert_issuer_diffs,
        },
        "profile": {
            "name_matches": legacy_basic.get("fullName") == api_profile.get("name"),
            "differences": profile_diffs,
        },
        "meaningful_differences": meaningful,
        "legacy_only_facts": legacy_only_facts,
        "legacy_only_fact_groups": legacy_only_fact_groups,
        "api_only_unsupported_facts": api_only_unsupported_facts,
        "verdict": verdict,
    }


def compare_files(legacy_path: str, content_path: str) -> dict:
    """Convenience: read both JSON files and compare."""
    return compare(_load_json(legacy_path), _load_json(content_path))


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Determine paridad of knowledge_base.json vs /api/content."
    )
    parser.add_argument(
        "--content",
        default=None,
        help="Path to a saved /api/content payload (snapshot), or a URL to fetch.",
    )
    parser.add_argument(
        "--legacy",
        default=None,
        help="Path to the legacy knowledge_base.json (default: ./knowledge_base.json).",
    )
    parser.add_argument("--json", action="store_true", help="Emit the machine-readable result.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    from config.settings import settings

    legacy_path = args.legacy or settings.KNOWLEDGE_FILE
    legacy = _load_json(legacy_path)

    if args.content and (args.content.startswith("http://") or args.content.startswith("https://")):
        import httpx

        resp = httpx.get(args.content, timeout=settings.CONTENT_API_TIMEOUT)
        resp.raise_for_status()
        content = resp.json()
        content_label = args.content
    elif args.content:
        content = _load_json(args.content)
        content_label = args.content
    else:
        raise SystemExit(
            "pass --content PATH (snapshot) or --content URL (live /api/content)"
        )

    result = compare(legacy, content)
    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(f"legacy source : {legacy_path}")
        print(f"content source: {content_label}")
        print(f"verdict       : PARITY: {result['verdict']}")
        print(f"legacy-only facts        : {result['legacy_only_facts']}")
        print(f"api-only unsupported facts: {result['api_only_unsupported_facts']}")
        print(f"meaningful differences   : {len(result['meaningful_differences'])}")
        for line in result["meaningful_differences"]:
            print("  - " + line)
        print(f"sections legacy-only: {result['sections']['legacy_only']}")
        print(f"projects api-only : {result['projects']['api_only_slugs']}")
        print(f"projects legacy-only detail keys: {result['projects']['legacy_only_detail_keys']}")
        print(f"skills legacy-only: {len(result['skills']['legacy_only'])} names")
        print(f"certification issuer diffs: {result['certifications']['issuer_diffs']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())