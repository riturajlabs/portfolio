"""The payload snapshot — the single most important test in this migration.

`TESTING.md` §7.1 calls for one, and the reason is specific: every key name in this
payload is a contract with `src/data/*.js`, the prerender bundle and
`scripts/seo/discovery.mjs`. A field renamed in a Pydantic model is invisible until
2 a.m., when `generate-project-pages.mjs` fails on an undefined `image_width` and
nobody remembers the change. A committed snapshot turns that into a diff in review.

Deliberately implemented with the standard library rather than `syrupy` or another
snapshot plugin. The whole job is "serialise this dict, compare it to a file",
and a test dependency would have to be audited, pinned and kept compatible for
those twenty lines.

**What is snapshotted:** the entire response body except `meta.generated_at`.
**Why that one field is excluded:** it is the newest row's `updated_at`, so it moves
whenever the seed timestamps move. Pinning it would make the test fail for a
non-change; the value has its own three tests in `test_content_api.py`.

**Regenerating.** The test writes the file when it is missing and fails, so the
first run is deliberate rather than silent. To accept an intended change, re-run
and read the diff.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.test_content_api import (
    _insert_category,
    _insert_certification,
    _insert_profile,
    _insert_project,
    _insert_skill,
)

SNAPSHOT_PATH = Path(__file__).parent / "snapshots" / "content_payload.json"

# Every timestamp is pinned so two runs of the seed produce identical bytes. Without
# this the snapshot would churn on `now()` alone.
FIXED_TIMESTAMP = datetime(2026, 1, 15, 9, 30, tzinfo=UTC)

TABLES_WITH_TIMESTAMPS = (
    "site_profile",
    "project",
    "skill",
    "skill_category",
    "certification",
)


async def _seed_snapshot_dataset(engine: AsyncEngine) -> None:
    """A dataset exercising every branch of the response shape.

    Not the real five-project content — Phase 6 seeds that. This exists to cover the
    contract: two visibility states, a nested category, a project with and without a
    `long_description`, and an `indexable=false` project that must survive.
    """
    await _insert_profile(engine)
    await _insert_project(engine, slug="alpha", title="Alpha")
    await _insert_project(
        engine,
        slug="beta",
        title="Beta",
        long_description="First highlight.\nSecond highlight.\n\nThird highlight.",
    )
    await _insert_project(
        engine,
        slug="gamma-not-indexed",
        title="Gamma",
        status="hidden",
    )
    await _insert_project(
        engine,
        slug="delta-homepage-only",
        title="Delta",
        indexable=False,
    )
    for order, (category, skill_names) in enumerate(
        (("Frontend Development", ("React", "Node.js")), ("Backend Development", ("PostgreSQL",)))
    ):
        await _insert_category(engine, category, display_order=order)
        for skill_order, skill in enumerate(skill_names):
            await _insert_skill(engine, category, skill, display_order=skill_order)
    await _insert_certification(engine, "Certification Alpha", display_order=0)
    await _insert_certification(engine, "Certification Beta", display_order=1)

    async with engine.begin() as connection:
        for table in TABLES_WITH_TIMESTAMPS:
            await connection.execute(
                text(
                    f"UPDATE {table} SET updated_at = :stamp, created_at = :stamp"  # noqa: S608
                ),
                {"stamp": FIXED_TIMESTAMP},
            )


def _normalise(payload: dict[str, Any]) -> dict[str, Any]:
    """The payload as compared, with the volatile timestamp removed."""
    meta = dict(payload["meta"])
    meta["generated_at"] = "<pinned: asserted separately>"
    return {**payload, "meta": meta}


async def test_payload_matches_the_committed_snapshot(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """The response shape is a hard contract. This is what holds it still."""
    await _seed_snapshot_dataset(engine)

    response = await client.get("/api/content")

    assert response.status_code == 200
    actual = _normalise(response.json())

    if not SNAPSHOT_PATH.exists():
        SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
        SNAPSHOT_PATH.write_text(_serialise(actual) + "\n")
        pytest.fail(
            f"{SNAPSHOT_PATH.name} did not exist and has been written. Read it, then "
            "re-run to compare against it."
        )

    expected = json.loads(SNAPSHOT_PATH.read_text())

    if actual != expected:
        pytest.fail(_describe_difference(expected, actual))


def _serialise(payload: dict[str, Any]) -> str:
    """Sorted, indented JSON so the diff in review is readable."""
    return json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False)


def _describe_difference(expected: dict[str, Any], actual: dict[str, Any]) -> str:
    """Point at the exact keys that changed, not just 'they differ'.

    A whole-payload dump of a 20 KB response buries a single renamed field, which
    defeats the purpose of the test.
    """
    differences: list[str] = []

    def walk(path: str, left: Any, right: Any) -> None:
        if isinstance(left, dict) and isinstance(right, dict):
            for key in sorted(set(left) | set(right)):
                if key not in left:
                    differences.append(f"  + {path}.{key} (added)")
                elif key not in right:
                    differences.append(f"  - {path}.{key} (removed)")
                else:
                    walk(f"{path}.{key}", left[key], right[key])
            return
        if isinstance(left, list) and isinstance(right, list):
            if len(left) != len(right):
                differences.append(f"  ~ {path} length {len(left)} -> {len(right)}")
            for index, (item, other) in enumerate(zip(left, right, strict=False)):
                walk(f"{path}[{index}]", item, other)
            return
        if left != right:
            differences.append(f"  ~ {path}: {left!r} -> {right!r}")

    walk("", expected, actual)

    body = "\n".join(differences) if differences else "  (no structural difference found)"
    return (
        f"{SNAPSHOT_PATH.name} does not match the response.\n{body}\n\n"
        "If the change is intended, re-run the test to rewrite the snapshot and "
        "commit it."
    )


async def test_the_snapshot_is_deterministic_for_unchanged_content(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """A snapshot is only meaningful if the same state always yields the same bytes.

    If two consecutive reads disagreed — a set iteration leaking into the payload, a
    clock used instead of a column, an unspecified `ORDER BY` — then a snapshot diff
    could be noise, and a real change could hide inside it.
    """
    await _seed_snapshot_dataset(engine)

    first = await client.get("/api/content")
    second = await client.get("/api/content")

    assert first.content == second.content
    assert first.headers["etag"] == second.headers["etag"]
    assert (
        datetime.fromisoformat(second.json()["meta"]["generated_at"].replace("Z", "+00:00"))
        == FIXED_TIMESTAMP
    )