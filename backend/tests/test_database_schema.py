"""The database shape itself.

`DATABASE.md` §16 requires the table count, every column, type and nullability,
and the absence of every table from §15 to be asserted — in a test, not by eye.
`DATABASE.md` §0 fixes the answer at exactly nine application tables.
"""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.sql.elements import TextClause

from app.db.migrations import expected_head
from tests.conftest import EXPECTED_TABLES, FORBIDDEN_TABLES

# `udt_name` is used rather than `data_type` because it distinguishes the
# PostgreSQL-specific types the design depends on: _text (text[]), citext, jsonb.
EXPECTED_COLUMNS: dict[str, tuple[tuple[str, str, bool], ...]] = {
    "site_profile": (
        ("id", "uuid", False),
        ("singleton", "bool", False),
        ("name", "text", False),
        ("title", "text", False),
        ("greeting", "text", True),
        ("roles", "_text", False),
        ("available_for_internship", "bool", False),
        ("internship_text", "text", True),
        ("description", "text", True),
        ("location", "text", True),
        ("resume", "text", False),
        ("resume_key", "text", True),
        ("stats", "jsonb", False),
        ("social", "jsonb", False),
        ("about", "jsonb", False),
        ("seo", "jsonb", False),
        ("created_at", "timestamptz", False),
        ("updated_at", "timestamptz", False),
    ),
    "project": (
        ("id", "uuid", False),
        ("slug", "text", False),
        ("title", "text", False),
        ("short_description", "text", False),
        ("long_description", "text", True),
        ("image", "text", False),
        ("image_width", "int4", False),
        ("image_height", "int4", False),
        ("image_alt", "text", False),
        ("category", "text", True),
        ("tech_stack", "_text", False),
        ("status", "text", False),
        ("featured", "bool", False),
        ("indexable", "bool", False),
        ("display_order", "int4", False),
        ("live_url", "text", True),
        ("github_url", "text", True),
        ("seo_title", "text", False),
        ("seo_description", "text", False),
        ("created_at", "timestamptz", False),
        ("updated_at", "timestamptz", False),
    ),
    "skill_category": (
        ("id", "uuid", False),
        ("name", "text", False),
        ("icon_key", "text", False),
        ("display_order", "int4", False),
        ("is_visible", "bool", False),
        ("created_at", "timestamptz", False),
        ("updated_at", "timestamptz", False),
    ),
    "skill": (
        ("id", "uuid", False),
        ("category_id", "uuid", False),
        ("name", "text", False),
        ("icon_key", "text", False),
        ("display_order", "int4", False),
        ("is_visible", "bool", False),
        ("created_at", "timestamptz", False),
        ("updated_at", "timestamptz", False),
    ),
    "certification": (
        ("id", "uuid", False),
        ("title", "text", False),
        ("issuer", "text", False),
        ("icon", "text", True),
        ("issued_on", "text", True),
        ("credential_id", "text", True),
        ("credential_url", "text", True),
        ("display_order", "int4", False),
        ("created_at", "timestamptz", False),
        ("updated_at", "timestamptz", False),
    ),
    "contact_message": (
        ("id", "uuid", False),
        ("name", "text", False),
        ("email", "citext", False),
        ("subject", "text", False),
        ("message", "text", False),
        ("status", "text", False),
        ("delivery_status", "text", False),
        ("source_ip_hash", "text", True),
        ("user_agent", "text", True),
        ("created_at", "timestamptz", False),
    ),
    "admin_user": (
        ("id", "uuid", False),
        ("email", "citext", False),
        ("password_hash", "text", False),
        ("role", "text", False),
        ("is_active", "bool", False),
        ("failed_attempts", "int4", False),
        ("locked_until", "timestamptz", True),
        ("last_login_at", "timestamptz", True),
        ("created_at", "timestamptz", False),
        ("updated_at", "timestamptz", False),
    ),
    "admin_session": (
        ("id", "uuid", False),
        ("user_id", "uuid", False),
        ("token_hash", "text", False),
        ("issued_at", "timestamptz", False),
        ("last_used_at", "timestamptz", False),
        ("expires_at", "timestamptz", False),
        ("revoked_at", "timestamptz", True),
        ("ip_hash", "text", True),
        ("user_agent", "text", True),
    ),
    "admin_audit_log": (
        ("id", "uuid", False),
        ("actor_user_id", "uuid", True),
        ("action", "text", False),
        ("entity", "text", False),
        ("entity_id", "text", True),
        ("before", "jsonb", True),
        ("after", "jsonb", True),
        ("at", "timestamptz", False),
    ),
}

# `DATABASE.md` §12. `project.slug` and `admin_session.token_hash` are the
# documented UNIQUE indexes, so no duplicate index is created for them.
EXPECTED_INDEXES: dict[str, tuple[str, ...]] = {
    "ix_project_status_display_order": ("status", "display_order"),
    "ix_project_status_indexable": ("status", "indexable"),
    "ix_project_status_featured": ("status", "featured"),
    "ix_skill_category_is_visible_display_order": ("is_visible", "display_order"),
    "ix_skill_category_visible_order": ("category_id", "is_visible", "display_order"),
    "ix_certification_display_order": ("display_order",),
    "ix_contact_message_status_created_at": ("status", "created_at DESC"),
    "ix_admin_session_expires_at": ("expires_at",),
    "ix_admin_audit_log_entity_entity_id_at": ("entity", "entity_id", "at DESC"),
}

EXPECTED_UNIQUE_INDEXES: dict[str, tuple[str, ...]] = {
    "uq_project_slug": ("slug",),
    "uq_skill_category_name": ("name",),
    "uq_skill_category_id_name": ("category_id", "name"),
    "uq_certification_title_issuer": ("title", "issuer"),
    "uq_site_profile_singleton": ("singleton",),
    "uq_admin_user_email": ("email",),
    "uq_admin_session_token_hash": ("token_hash",),
}

EXPECTED_FOREIGN_KEYS: dict[str, tuple[str, str, str]] = {
    # constraint name -> (child column, parent table, pg_constraint.confdeltype)
    "fk_skill_category_id_skill_category": ("category_id", "skill_category", "c"),  # CASCADE
    "fk_admin_session_user_id_admin_user": ("user_id", "admin_user", "c"),  # CASCADE
    "fk_admin_audit_log_actor_user_id_admin_user": ("actor_user_id", "admin_user", "n"),  # SET NULL
}


async def _fetch(
    engine: AsyncEngine,
    statement: TextClause,
    params: dict[str, object] | None = None,
) -> list[Row[Any]]:
    """Run a read and close the connection before returning.

    An unclosed connection outlives the test that opened it and is then torn
    down by the garbage collector, which leaks between tests.
    """
    async with engine.connect() as connection:
        result = await connection.execute(statement, params or {})
        return list(result)


async def _application_tables(engine: AsyncEngine) -> set[str]:
    """Base tables in `public`, excluding PostgreSQL system and Alembic tables."""
    rows = await _fetch(engine, 
        text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' "
            "AND table_name <> 'alembic_version'"
        )
    )
    return {row[0] for row in rows}


async def test_exactly_nine_application_tables(engine: AsyncEngine) -> None:
    """The scope guard. An extra table means scope creep; a missing one, a mistake."""
    present = await _application_tables(engine)

    assert len(present) == 9, f"expected 9 application tables, found {sorted(present)}"
    assert present == set(EXPECTED_TABLES)


async def test_no_deferred_table_exists(engine: AsyncEngine) -> None:
    """`DATABASE.md` §15: blog, education, social_link, redirect, media_asset …"""
    present = await _application_tables(engine)

    assert present.isdisjoint(FORBIDDEN_TABLES)


async def test_alembic_revision_is_applied(engine: AsyncEngine) -> None:
    rows = await _fetch(engine, text("SELECT version_num FROM alembic_version"))

    assert [row[0] for row in rows] == [expected_head()]


@pytest.mark.parametrize("table", EXPECTED_TABLES)
async def test_columns_match_the_specification(engine: AsyncEngine, table: str) -> None:
    rows = await _fetch(engine, 
        text(
            "SELECT column_name, udt_name, is_nullable FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = :table "
            "ORDER BY column_name"
        ),
        {"table": table},
    )
    actual = tuple(sorted((name, udt, nullable == "YES") for name, udt, nullable in rows))
    expected = tuple(sorted(EXPECTED_COLUMNS[table]))

    assert actual == expected


async def test_primary_keys_are_generated_uuids(engine: AsyncEngine) -> None:
    rows = await _fetch(engine, 
        text(
            "SELECT c.relname AS table_name, a.attname AS column_name, "
            "       pg_get_expr(d.adbin, d.adrelid) AS column_default "
            "FROM pg_index i "
            "JOIN pg_class c ON c.oid = i.indrelid "
            "JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey) "
            "JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum "
            "WHERE i.indisprimary AND c.relname = ANY(:tables) "
            "ORDER BY c.relname"
        ),
        {"tables": list(EXPECTED_TABLES)},
    )
    assert len(rows) == 9
    for table_name, column_name, column_default in rows:
        assert column_name == "id", f"{table_name} primary key is {column_name}"
        assert "gen_random_uuid()" in column_default, (
            f"{table_name}.id must be generated by PostgreSQL, got {column_default!r}"
        )


async def test_expected_indexes_exist_with_the_documented_columns(engine: AsyncEngine) -> None:
    rows = await _fetch(engine, 
        text(
            "SELECT indexname, indexdef FROM pg_indexes "
            "WHERE schemaname = 'public' AND indexname <> 'alembic_version_pkey'"
        )
    )
    definitions = {name: definition for name, definition in rows}

    for index_name, columns in EXPECTED_INDEXES.items():
        assert index_name in definitions, f"missing index {index_name}"
        for column in columns:
            assert column in definitions[index_name], (
                f"{index_name} should cover {column}, got {definitions[index_name]}"
            )


async def test_unique_indexes_exist_for_the_documented_uniques(engine: AsyncEngine) -> None:
    rows = await _fetch(engine, 
        text(
            "SELECT indexname, indexdef FROM pg_indexes "
            "WHERE schemaname = 'public' AND indexdef LIKE 'CREATE UNIQUE INDEX%'"
        )
    )
    definitions = {name: definition for name, definition in rows}

    for index_name, columns in EXPECTED_UNIQUE_INDEXES.items():
        assert index_name in definitions, f"missing unique index {index_name}"
        for column in columns:
            assert column in definitions[index_name]


async def test_unique_constraint_lookup_indexes_cover_the_documented_lookups(
    engine: AsyncEngine,
) -> None:
    """`project.slug` and `admin_session.token_hash` are looked up on every request.

    Both are UNIQUE, and a UNIQUE constraint is backed by a unique index, so
    `DATABASE.md` §12 is satisfied without a second, redundant index.
    """
    rows = await _fetch(engine, 
        text(
            "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' "
            "AND indexdef LIKE 'CREATE UNIQUE INDEX%' AND indexdef LIKE '%(slug)%'"
        )
    )
    assert "uq_project_slug" in [row[0] for row in rows]

    rows = await _fetch(engine, 
        text(
            "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' "
            "AND indexdef LIKE 'CREATE UNIQUE INDEX%' AND indexdef LIKE '%(token_hash)%'"
        )
    )
    assert "uq_admin_session_token_hash" in [row[0] for row in rows]


async def test_foreign_keys_and_their_delete_rules(engine: AsyncEngine) -> None:
    """The three documented foreign keys, with their exact `ON DELETE` rules.

    `pg_constraint.confdeltype` is the source of truth: `c` = CASCADE,
    `n` = SET NULL, `a` = NO ACTION, `r` = RESTRICT, `d` = SET DEFAULT.
    """
    rows = await _fetch(engine, 
        text(
            "SELECT con.conname AS constraint_name, "
            "       child.attname AS child_column, "
            "       parent.relname AS parent_table, "
            "       parent_col.attname AS parent_column, "
            "       con.confdeltype::text AS delete_rule "
            "FROM pg_constraint con "
            "JOIN pg_class child_table ON child_table.oid = con.conrelid "
            "JOIN pg_namespace n ON n.oid = child_table.relnamespace "
            "JOIN pg_class parent ON parent.oid = con.confrelid "
            "JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true "
            "JOIN pg_attribute child ON child.attrelid = con.conrelid AND child.attnum = k.attnum "
            "JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS pk(attnum, ord) "
            "  ON pk.ord = k.ord "
            "JOIN pg_attribute parent_col "
            "  ON parent_col.attrelid = con.confrelid AND parent_col.attnum = pk.attnum "
            "WHERE con.contype = 'f' AND n.nspname = 'public' "
            "ORDER BY con.conname"
        )
    )
    found = {
        name: (child_column, parent_table, _parent_column, delete_rule)
        for name, child_column, parent_table, _parent_column, delete_rule in rows
    }

    assert set(found) == set(EXPECTED_FOREIGN_KEYS), (
        f"expected exactly the 3 documented foreign keys, found {sorted(found)}"
    )
    for name, (child_column, parent_table, delete_rule) in EXPECTED_FOREIGN_KEYS.items():
        actual_child, actual_parent, _actual_parent_column, actual_rule = found[name]
        assert actual_child == child_column
        assert actual_parent == parent_table
        assert actual_rule == delete_rule


async def test_citext_extension_is_installed(engine: AsyncEngine) -> None:
    """`citext` is not a core PostgreSQL type; the migration must create it."""
    rows = await _fetch(engine, 
        text("SELECT extname FROM pg_extension WHERE extname = 'citext'")
    )

    assert [row[0] for row in rows] == ["citext"]


async def test_no_content_has_been_seeded(pristine_database_url: str) -> None:
    """Phase 2 ships an empty schema. Content seeding is Phase 6.

    Read from a database that was migrated moments ago and that no test has
    written to, so the assertion cannot be satisfied or broken by test ordering.
    """
    pristine = create_async_engine(pristine_database_url)
    try:
        async with pristine.connect() as connection:
            for table in EXPECTED_TABLES:
                count = (
                    await connection.execute(text(f"SELECT count(*) FROM {table}"))
                ).scalar()
                assert count == 0, f"{table} already holds {count} rows; Phase 2 seeds nothing"
    finally:
        await pristine.dispose()


async def test_timestamps_are_timezone_aware(engine: AsyncEngine) -> None:
    """`DATABASE.md` §5: `timestamptz` for all timestamps."""
    rows = await _fetch(engine, 
        text(
            "SELECT table_name, column_name FROM information_schema.columns "
            "WHERE table_schema = 'public' AND udt_name = 'timestamptz' "
            "ORDER BY table_name, column_name"
        )
    )
    present = {(table, column) for table, column in rows}

    expected_pairs = {
        ("site_profile", "created_at"),
        ("site_profile", "updated_at"),
        ("project", "created_at"),
        ("project", "updated_at"),
        ("skill_category", "created_at"),
        ("skill_category", "updated_at"),
        ("skill", "created_at"),
        ("skill", "updated_at"),
        ("certification", "created_at"),
        ("certification", "updated_at"),
        ("contact_message", "created_at"),
        ("admin_user", "locked_until"),
        ("admin_user", "last_login_at"),
        ("admin_user", "created_at"),
        ("admin_user", "updated_at"),
        ("admin_session", "issued_at"),
        ("admin_session", "last_used_at"),
        ("admin_session", "expires_at"),
        ("admin_session", "revoked_at"),
        ("admin_audit_log", "at"),
    }

    assert present == expected_pairs


async def test_no_foreign_key_outside_the_documented_three(engine: AsyncEngine) -> None:
    """`DATABASE.md` §5: 3 foreign keys, all `admin_*` or `skill`."""
    rows = await _fetch(engine, 
        text(
            "SELECT COUNT(*) FROM information_schema.table_constraints "
            "WHERE constraint_type = 'FOREIGN KEY' AND table_schema = 'public'"
        )
    )

    assert rows[0][0] == 3