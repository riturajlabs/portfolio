"""Phase 6 — the content seed (`db.seed`) against the real test database.

`MIGRATION.md` §Phase 6 and `TESTING.md` §7.1. The pipeline under test is the
one that ships: `.cache/content-snapshot.json` (produced from `src/data/*.js` by
`scripts/extract-content.mjs`) → `validate_snapshot` → `run_seed` →
`GET /api/content`. Every assertion reads back through the API or the database,
never a fixture, so a green run means PostgreSQL holds what the sources said.

Covered here:

* validation rejects content with no column or no entity (`extra="forbid"`)
* row counts 5/4/16/3/1 plus the about block, per `MIGRATION.md` Phase 6
* idempotency: a second run reports `unchanged` and byte-identical timestamps
* a mid-seed failure rolls the whole transaction back
* orphan rows are reported, not deleted; operational tables are never touched
* `image_width`/`image_height` match the real WebP headers on disk
* the API payload deep-equals the snapshot (the Python twin of
  `scripts/compare-content.mjs`)
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine

from db.seed import (
    DEFAULT_SNAPSHOT,
    SeedEnvironmentError,
    SeedError,
    load_snapshot,
    preflight,
    run_seed,
    validate_snapshot,
)

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent

EXPECTED_COUNTS = {
    "site_profile": 1,
    "project": 5,
    "skill_category": 4,
    "skill": 16,
    "certification": 3,
}


def _snapshot() -> Any:
    """Validate the real snapshot exactly the way the CLI does."""
    return validate_snapshot(load_snapshot(DEFAULT_SNAPSHOT))


async def _count(engine: AsyncEngine, table: str) -> int:
    async with engine.connect() as connection:
        result = await connection.execute(text(f"SELECT count(*) FROM {table}"))
        return int(result.scalar_one())


async def _fingerprint(engine: AsyncEngine) -> list[tuple[str, list[tuple[Any, ...]]]]:
    """Every seeded row's business columns plus both timestamps.

    Equality of two fingerprints taken after two runs is the strongest possible
    idempotency statement: not merely "same values" but "the database does not
    know a second run happened".
    """
    queries = {
        "site_profile": "SELECT name, resume, created_at, updated_at FROM site_profile",
        "project": "SELECT slug, title, created_at, updated_at FROM project ORDER BY slug",
        "skill_category": (
            "SELECT name, icon_key, created_at, updated_at FROM skill_category ORDER BY name"
        ),
        "skill": (
            "SELECT category_id, name, created_at, updated_at "
            "FROM skill ORDER BY category_id, name"
        ),
        "certification": (
            "SELECT title, issuer, created_at, updated_at "
            "FROM certification ORDER BY title, issuer"
        ),
    }
    fingerprint: list[tuple[str, list[tuple[Any, ...]]]] = []
    async with engine.connect() as connection:
        for name, query in queries.items():
            rows = await connection.execute(text(query))
            fingerprint.append((name, [tuple(row) for row in rows.all()]))
    return fingerprint


def _assert_deep_equal(snapshot_value: Any, api_value: Any, path: str = "") -> None:
    """Strict structural equality — `True` never equals `1` here."""
    where = path or "(root)"
    if isinstance(snapshot_value, dict) or isinstance(api_value, dict):
        assert isinstance(snapshot_value, dict), f"{where}: snapshot is not an object"
        assert isinstance(api_value, dict), f"{where}: API is not an object"
        assert set(snapshot_value) == set(api_value), (
            f"{where}: keys differ — snapshot {sorted(snapshot_value)}, "
            f"API {sorted(api_value)}"
        )
        for key in sorted(snapshot_value):
            _assert_deep_equal(snapshot_value[key], api_value[key], f"{where}.{key}")
        return
    if isinstance(snapshot_value, list) or isinstance(api_value, list):
        assert isinstance(snapshot_value, list), f"{where}: snapshot is not an array"
        assert isinstance(api_value, list), f"{where}: API is not an array"
        assert len(snapshot_value) == len(api_value), (
            f"{where}: length {len(snapshot_value)} != {len(api_value)}"
        )
        for index, item in enumerate(snapshot_value):
            _assert_deep_equal(item, api_value[index], f"{where}[{index}]")
        return
    assert type(snapshot_value) is type(api_value), (
        f"{where}: type {type(snapshot_value).__name__} != {type(api_value).__name__}"
    )
    assert snapshot_value == api_value, f"{where}: {snapshot_value!r} != {api_value!r}"


def _webp_size(path: Path) -> tuple[int, int]:
    """Read `(width, height)` from a real WebP header.

    The three formats the project ships: VP8X (extended), VP8L (lossless) and
    VP8 (lossy). Mirrors `scripts/extract-content.mjs` so a wrong dimension can
    fail on either side of the language boundary.
    """
    header = path.read_bytes()[:64]
    if header[:4] != b"RIFF" or header[8:12] != b"WEBP":
        raise AssertionError(f"{path}: not a WebP file")
    chunk = header[12:16]
    if chunk == b"VP8X":
        canvas_width = int.from_bytes(header[24:27], "little") + 1
        canvas_height = int.from_bytes(header[27:30], "little") + 1
        return canvas_width, canvas_height
    if chunk == b"VP8L":
        if header[20] != 0x2F:
            raise AssertionError(f"{path}: VP8L signature byte missing")
        bits = int.from_bytes(header[21:25], "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    if chunk == b"VP8 ":
        if header[23:26] != b"\x9d\x01\x2a":
            raise AssertionError(f"{path}: VP8 start code missing")
        width = int.from_bytes(header[26:28], "little") & 0x3FFF
        height = int.from_bytes(header[28:30], "little") & 0x3FFF
        return width, height
    raise AssertionError(f"{path}: unknown WebP chunk {chunk!r}")


# ---------------------------------------------------------------------------
# Validation (no database)
# ---------------------------------------------------------------------------


def test_real_snapshot_validates_with_phase6_counts() -> None:
    data = _snapshot()
    assert len(data.projects) == EXPECTED_COUNTS["project"]
    assert len(data.certifications) == EXPECTED_COUNTS["certification"]
    assert len(data.skills) == EXPECTED_COUNTS["skill"]
    assert len({skill.category.name for skill in data.skills}) == EXPECTED_COUNTS[
        "skill_category"
    ]
    assert data.profile.resume == "/Ritu_Raj_Full_Stack_Developer_Resume.pdf"
    assert len(data.about.cards) == 4
    assert len(data.about.paragraphs) == 2
    assert data.omitted, "the snapshot must carry its documented omissions"


@pytest.mark.parametrize(
    ("mutation", "label"),
    [
        (
            lambda snap: snap["certifications"][0].__setitem__("description", "nope"),
            "certifications[].description has no column",
        ),
        (
            lambda snap: snap["profile"].__setitem__("seo", {}),
            "profile.seo is a dead key",
        ),
        (
            lambda snap: snap.__setitem__("blog_posts", []),
            "blog_post has no entity or table",
        ),
        (
            lambda snap: snap["projects"][0].__setitem__("id", 7),
            "projects[].id is not part of the payload contract",
        ),
    ],
)
def test_validation_rejects_content_that_has_nowhere_to_live(
    mutation: Any, label: str
) -> None:
    snapshot = load_snapshot(DEFAULT_SNAPSHOT)
    mutation(snapshot)
    with pytest.raises(SeedError):
        validate_snapshot(snapshot)


# ---------------------------------------------------------------------------
# Seed → API end to end
# ---------------------------------------------------------------------------


async def test_seed_writes_expected_counts(
    engine: AsyncEngine, client: AsyncClient, test_database_url: str
) -> None:
    report = await run_seed(test_database_url, _snapshot())
    for table, expected in EXPECTED_COUNTS.items():
        assert report[table].inserted == expected, f"{table}: wrong inserted count"
        assert report[table].orphans == [], f"{table}: unexpected orphans on a fresh database"
        assert await _count(engine, table) == expected, f"{table}: wrong row count"

    response = await client.get("/api/content")
    assert response.status_code == 200
    payload = response.json()

    assert len(payload["projects"]) == 5
    assert len(payload["skills"]) == 16
    assert len(payload["certifications"]) == 3
    assert len({skill["category"]["name"] for skill in payload["skills"]}) == 4
    assert len(payload["about"]["cards"]) == 4
    assert len(payload["about"]["paragraphs"]) == 2
    assert payload["profile"]["resume"] == "/Ritu_Raj_Full_Stack_Developer_Resume.pdf"
    assert payload["meta"]["version"] == 1

    # Dead keys and omitted fields never reach the wire.
    for key in ("seo", "techStack", "profileImage"):
        assert key not in payload["profile"], f"profile.{key} must not migrate"
    assert "blog_posts" not in payload
    for certification in payload["certifications"]:
        assert "description" not in certification, (
            "certifications[].description has no column (docs/CONTENT_MAPPING.md §8)"
        )
    for project in payload["projects"]:
        assert "updatedAt" not in project
        assert "publishedAt" not in project
    assert "url" not in payload["seo"]
    assert "verification" not in payload["seo"]


async def test_seed_is_idempotent_across_three_runs(
    engine: AsyncEngine, test_database_url: str
) -> None:
    await run_seed(test_database_url, _snapshot())
    first = await _fingerprint(engine)

    for run in (2, 3):
        report = await run_seed(test_database_url, _snapshot())
        for table, counts in report.items():
            assert counts.inserted == 0, f"run {run}: {table} inserted again"
            assert counts.updated == 0, f"run {run}: {table} updated again"
            assert counts.unchanged == EXPECTED_COUNTS[table], (
                f"run {run}: {table} not reported unchanged"
            )
        second = await _fingerprint(engine)
        assert second == first, f"run {run}: rows or timestamps changed"


async def test_seed_never_touches_operational_tables(
    engine: AsyncEngine, test_database_url: str
) -> None:
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "INSERT INTO contact_message (name, email, subject, message) "
                "VALUES ('Ops', 'ops@example.com', 'Hello', "
                "'This row must survive the seed untouched')"
            )
        )

    await run_seed(test_database_url, _snapshot())

    assert await _count(engine, "contact_message") == 1
    async with engine.connect() as connection:
        row = (
            await connection.execute(
                text("SELECT email, status FROM contact_message")
            )
        ).one()
    assert row.email == "ops@example.com"
    assert row.status == "unread"

    for table in ("admin_user", "admin_session", "admin_audit_log"):
        assert await _count(engine, table) == 0, f"{table} must stay empty"

    async with engine.connect() as connection:
        present = {
            row[0]
            for row in (
                await connection.execute(
                    text(
                        "SELECT table_name FROM information_schema.tables "
                        "WHERE table_schema = 'public'"
                    )
                )
            ).all()
        }
    forbidden = present & {
        "project_technology",
        "project_category",
        "social_link",
        "education",
        "about_card",
        "blog_post",
        "redirect",
        "media_asset",
    }
    assert not forbidden, f"forbidden tables exist: {sorted(forbidden)}"


async def test_seed_failure_rolls_back_the_whole_transaction(
    engine: AsyncEngine, test_database_url: str
) -> None:
    data = _snapshot()
    # Bypass `validate_snapshot` on purpose: this is the database's CHECK
    # failing after rows have already been flushed, which is the case that
    # proves "one transaction" is not a comment but a rollback.
    data.projects[0].slug = "Bad Slug!"

    with pytest.raises(SQLAlchemyError):
        await run_seed(test_database_url, data)

    for table in EXPECTED_COUNTS:
        assert await _count(engine, table) == 0, (
            f"{table}: partial rows survived the rollback"
        )


async def test_seed_reports_orphans_without_deleting_them(
    engine: AsyncEngine, test_database_url: str
) -> None:
    await run_seed(test_database_url, _snapshot())

    async with engine.begin() as connection:
        await connection.execute(
            text(
                "INSERT INTO project (slug, title, short_description, image, "
                "image_width, image_height, image_alt, seo_title, seo_description) "
                "SELECT 'legacy-project', title, short_description, "
                "'/images/projects/legacy-project.webp', image_width, image_height, "
                "image_alt, seo_title, seo_description "
                "FROM project WHERE slug = 'webchat-ai'"
            )
        )

    report = await run_seed(test_database_url, _snapshot())
    assert report["project"].orphans == ["legacy-project"]
    assert await _count(engine, "project") == 6, "the orphan must be left in place"

    # And it stays an orphan on every subsequent run instead of vanishing.
    report = await run_seed(test_database_url, _snapshot())
    assert report["project"].orphans == ["legacy-project"]


async def test_seeded_dimensions_match_real_webp_headers(
    engine: AsyncEngine, test_database_url: str
) -> None:
    await run_seed(test_database_url, _snapshot())

    async with engine.connect() as connection:
        rows = (
            await connection.execute(
                text("SELECT image, image_width, image_height FROM project ORDER BY slug")
            )
        ).all()

    assert rows, "no projects seeded"
    for image, width, height in rows:
        webp_path = REPO_ROOT / "public" / image.lstrip("/")
        assert webp_path.exists(), f"missing image file {webp_path}"
        actual = _webp_size(webp_path)
        assert actual == (width, height), (
            f"{image}: DB says {(width, height)} but the WebP header says {actual}"
        )


async def test_api_payload_deep_equals_snapshot(
    client: AsyncClient, test_database_url: str
) -> None:
    """The Python twin of `scripts/compare-content.mjs` (TESTING.md §5.2)."""
    data = _snapshot()
    await run_seed(test_database_url, data)

    response = await client.get("/api/content")
    assert response.status_code == 200
    payload = response.json()
    payload.pop("meta", None)  # generated per request (API.md §5.1.4)

    snapshot = load_snapshot(DEFAULT_SNAPSHOT)
    snapshot.pop("_migration", None)  # extractor bookkeeping

    _assert_deep_equal(snapshot, payload)


async def test_preflight_refuses_an_unmigrated_database(
    unmigrated_database_url: str,
) -> None:
    with pytest.raises(SeedEnvironmentError, match="alembic"):
        await preflight(unmigrated_database_url)
