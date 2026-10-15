"""Phase 6 content seed — `.cache/content-snapshot.json` → PostgreSQL.

`MIGRATION.md` §Phase 6 and `DATABASE.md` §14.1. Run via::

    npm run seed:load          # = cd backend && python -m db.seed

Design rules, all from the locked documents:

* **Validate everything before writing anything.** The snapshot is parsed,
  pydantic-validated against the *response* models (`app.schemas.content`, the
  `GET /api/content` contract with `extra="forbid"`), and semantically checked
  (slug/image/URL/icon rules from `app.schemas.admin_content`, the
  `0001_initial` CHECK lengths) before a connection is opened.
* **One transaction.** Everything after the connection runs inside a single
  `engine.begin()`. Any failure rolls the whole seed back — a half-seeded
  database is worse than an empty one, and the CLI exits non-zero.
* **Idempotent upserts on natural keys** (`slug`, `name`, `(category_id, name)`,
  `(title, issuer)`, the `singleton` profile). A field is written only when it
  actually differs, so a second run issues no `UPDATE` and `created_at` /
  `updated_at` stay byte-identical (`MIGRATION.md`: "running twice produces
  identical rows").
* **Only the five content tables.** `contact_message`, `admin_user`,
  `admin_session` and `admin_audit_log` are never touched — they are not even
  imported. Forbidden tables (`DATABASE.md` §15) are asserted absent.

Exit codes: 0 success, 1 validation/content failure, 2 environment/connection
failure.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import normalise_database_url
from app.db.migrations import expected_head
from app.services.seed import (
    Counts,
    SeedData,
    SeedError,
    seed_content,
    validate_snapshot,
)

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
DEFAULT_SNAPSHOT = REPO_ROOT / ".cache" / "content-snapshot.json"

load_dotenv(BACKEND_ROOT / ".env")

# `0001_initial` CHECKs that pydantic does not already enforce.
SEO_TITLE_MAX = 70
SEO_DESCRIPTION_MAX = 185
CATEGORY_MAX = 60
SKILL_NAME_MAX = 60

FORBIDDEN_TABLES = (
    "project_technology",
    "project_category",
    "social_link",
    "education",
    "about_card",
    "blog_post",
    "redirect",
    "media_asset",
)

OPERATIONAL_TABLES = ("contact_message", "admin_user", "admin_session", "admin_audit_log")

CONTENT_KEYS = ("profile", "about", "projects", "skills", "certifications", "seo")


class SeedEnvironmentError(Exception):
    """A connection/environment problem — exit code 2."""


def say(message: str) -> None:
    print(f"[seed] {message}", flush=True)


def fail(message: str) -> None:
    raise SeedError(message)


# --------------------------------------------------------------------------
# Environment checks
# --------------------------------------------------------------------------


async def preflight(database_url: str) -> None:
    """Fail before writing if the database is unusable or not migrated."""
    engine = create_async_engine(database_url, pool_pre_ping=True)
    try:
        async with engine.connect() as connection:
            result = await connection.execute(text("SELECT version_num FROM alembic_version"))
            row = result.first()
    except SQLAlchemyError as exc:
        raise SeedEnvironmentError(
            f"cannot reach the database: {exc.__class__.__name__}: {exc.orig}\n"
            "  Is PostgreSQL running? Is DATABASE_URL correct?"
        ) from exc
    finally:
        await engine.dispose()

    applied = row[0] if row else None
    head = expected_head()
    if applied != head:
        raise SeedEnvironmentError(
            f"database is at migration {applied!r} but head is {head!r} — "
            "run `python -m alembic upgrade head` first"
        )


async def assert_schema_safety(database_url: str) -> dict[str, int]:
    """Assert forbidden tables are absent and count operational tables."""
    engine = create_async_engine(database_url, pool_pre_ping=True)
    try:
        async with engine.connect() as connection:
            result = await connection.execute(
                text(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema = 'public'"
                )
            )
            present = {row[0] for row in result.all()}
            forbidden = sorted(present.intersection(FORBIDDEN_TABLES))
            if forbidden:
                raise SeedError(
                    f"forbidden tables exist: {forbidden} — the seed refuses to run "
                    "(DATABASE.md §15)"
                )
            counts: dict[str, int] = {}
            for table in OPERATIONAL_TABLES:
                if table in present:
                    result = await connection.execute(text(f"SELECT count(*) FROM {table}"))
                    counts[table] = int(result.first()[0])
                else:
                    counts[table] = 0
            return counts
    finally:
        await engine.dispose()


async def run_seed(database_url: str, data: SeedData) -> dict[str, Counts]:
    engine = create_async_engine(database_url, pool_pre_ping=True)
    try:
        async with engine.begin() as connection:
            session_factory = async_sessionmaker(bind=connection, expire_on_commit=False)
            async with session_factory() as session:
                report = await seed_content(session, data)
    finally:
        await engine.dispose()
    return report


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def load_snapshot(path: Path) -> Any:
    if not path.exists():
        raise SeedError(
            f"snapshot not found: {path}\n"
            "  Run `npm run seed:extract` first (MIGRATION.md §Phase 6)."
        )
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SeedError(f"snapshot is not valid JSON: {exc}") from exc


async def async_main(snapshot_path: Path) -> int:
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        raise SeedEnvironmentError(
            "DATABASE_URL is not set. Example:\n"
            "  DATABASE_URL=postgresql://postgres@127.0.0.1:5432/portfolio_dev "
            "python -m db.seed"
        )

    data = validate_snapshot(load_snapshot(snapshot_path))
    say(
        f"validated snapshot: {len(data.projects)} projects, "
        f"{len({s.category.name for s in data.skills})} categories, "
        f"{len(data.skills)} skills, {len(data.certifications)} certifications, "
        "1 profile"
    )
    if data.omitted:
        say(f"documented omissions carried in the snapshot: {len(data.omitted)}")

    url = normalise_database_url(database_url)
    await preflight(url)
    operational = await assert_schema_safety(url)
    say(
        "operational tables (never written): "
        + ", ".join(f"{name}={count}" for name, count in operational.items())
    )

    report = await run_seed(url, data)
    for name in ("site_profile", "project", "skill_category", "skill", "certification"):
        say(report[name].line(name))
    for name, counts in report.items():
        if counts.orphans:
            say(f"warning — {name} rows not present in the snapshot were left untouched: {counts.orphans}")
    say("commit complete — re-run is a no-op if nothing changed (idempotent)")
    return 0


def main() -> int:
    args = [arg for arg in sys.argv[1:] if not arg.startswith("-")]
    snapshot_path = Path(args[0]).resolve() if args else DEFAULT_SNAPSHOT
    try:
        return asyncio.run(async_main(snapshot_path))
    except SeedEnvironmentError as exc:
        print(f"[seed] ENVIRONMENT ERROR: {exc}", file=sys.stderr, flush=True)
        return 2
    except SeedError as exc:
        print(f"[seed] FAILED: {exc}", file=sys.stderr, flush=True)
        return 1
    except SQLAlchemyError as exc:
        print(
            f"[seed] FAILED (database): {exc.__class__.__name__}: {exc}",
            file=sys.stderr,
            flush=True,
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
