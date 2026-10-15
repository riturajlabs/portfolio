"""Foreign-key behaviour.

`DATABASE.md` §8 and §14.2: deleting a skill category takes its skills with it,
deleting an admin user takes its sessions with it, and deleting an admin user
leaves the audit trail intact with a NULL actor. These are database guarantees,
so the deletes are issued as plain SQL and the effects observed with plain
queries — an ORM cascade could mask a missing `ON DELETE` clause.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine


async def _insert_category(engine: AsyncEngine, name: str = "Frontend Development") -> str:
    async with engine.begin() as connection:
        category_id = (
            await connection.execute(
                text(
                    "INSERT INTO skill_category (name, icon_key) VALUES (:name, 'FaCode') "
                    "RETURNING id"
                ),
                {"name": name},
            )
        ).scalar_one()
    return str(category_id)


async def _insert_skill(engine: AsyncEngine, category_id: str, name: str) -> None:
    async with engine.begin() as connection:
        await connection.execute(
            text("INSERT INTO skill (category_id, name, icon_key) VALUES (:category_id, :name, 'FaIcon')"),
            {"category_id": category_id, "name": name},
        )


async def _count(engine: AsyncEngine, table: str) -> int:
    async with engine.connect() as connection:
        return (await connection.execute(text(f"SELECT count(*) FROM {table}"))).scalar()


async def _insert_admin(engine: AsyncEngine, email: str = "owner@example.com") -> str:
    async with engine.begin() as connection:
        return str(
            (
                await connection.execute(
                    text(
                        "INSERT INTO admin_user (email, password_hash) "
                        "VALUES (:email, 'argon2id$hash') RETURNING id"
                    ),
                    {"email": email},
                )
            ).scalar_one()
        )


async def _insert_session(engine: AsyncEngine, user_id: str, token_hash: str) -> None:
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "INSERT INTO admin_session (user_id, token_hash, expires_at) "
                "VALUES (:user_id, :token_hash, now() + interval '7 days')"
            ),
            {"user_id": user_id, "token_hash": token_hash},
        )


async def _insert_audit_log(
    engine: AsyncEngine, user_id: str, entity_id: str = "project-1"
) -> None:
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "INSERT INTO admin_audit_log (actor_user_id, action, entity, entity_id, after) "
                "VALUES (:user_id, 'update', 'project', :entity_id, '{\"title\": \"x\"}'::jsonb)"
            ),
            {"user_id": user_id, "entity_id": entity_id},
        )


async def test_deleting_a_skill_category_cascades_to_its_skills(engine: AsyncEngine) -> None:
    category_id = await _insert_category(engine)
    await _insert_skill(engine, category_id, "React")
    await _insert_skill(engine, category_id, "Tailwind CSS")
    await _insert_category(engine, "Backend Development")

    async with engine.begin() as connection:
        await connection.execute(
            text("DELETE FROM skill_category WHERE id = :id"), {"id": category_id}
        )

    assert await _count(engine, "skill") == 0
    assert await _count(engine, "skill_category") == 1


async def test_deleting_a_category_leaves_other_categories_skills_alone(
    engine: AsyncEngine,
) -> None:
    frontend = await _insert_category(engine, "Frontend Development")
    backend = await _insert_category(engine, "Backend Development")
    await _insert_skill(engine, frontend, "React")
    await _insert_skill(engine, backend, "FastAPI")

    async with engine.begin() as connection:
        await connection.execute(text("DELETE FROM skill_category WHERE id = :id"), {"id": frontend})

    async with engine.connect() as connection:
        remaining = (await connection.execute(text("SELECT name FROM skill"))).scalars().all()

    assert list(remaining) == ["FastAPI"]


async def test_deleting_an_admin_user_cascades_to_its_sessions(engine: AsyncEngine) -> None:
    user_id = await _insert_admin(engine)
    await _insert_session(engine, user_id, "sha256$one")
    await _insert_session(engine, user_id, "sha256$two")

    async with engine.begin() as connection:
        await connection.execute(text("DELETE FROM admin_user WHERE id = :id"), {"id": user_id})

    assert await _count(engine, "admin_session") == 0
    assert await _count(engine, "admin_user") == 0


async def test_deleting_an_admin_user_nulls_the_audit_actor(engine: AsyncEngine) -> None:
    """The audit trail outlives the account: `ON DELETE SET NULL`."""
    user_id = await _insert_admin(engine)
    await _insert_audit_log(engine, user_id)

    async with engine.begin() as connection:
        await connection.execute(text("DELETE FROM admin_user WHERE id = :id"), {"id": user_id})

    assert await _count(engine, "admin_audit_log") == 1
    async with engine.connect() as connection:
        row = (
            await connection.execute(
                text("SELECT actor_user_id, action, entity FROM admin_audit_log")
            )
        ).one()

    assert row.actor_user_id is None
    assert row.action == "update"
    assert row.entity == "project"


async def test_deleting_a_user_leaves_other_users_sessions_intact(engine: AsyncEngine) -> None:
    first = await _insert_admin(engine, "first@example.com")
    second = await _insert_admin(engine, "second@example.com")
    await _insert_session(engine, first, "sha256$first")
    await _insert_session(engine, second, "sha256$second")

    async with engine.begin() as connection:
        await connection.execute(text("DELETE FROM admin_user WHERE id = :id"), {"id": first})

    async with engine.connect() as connection:
        remaining = (await connection.execute(text("SELECT token_hash FROM admin_session"))).scalars().all()

    assert list(remaining) == ["sha256$second"]


async def test_deleting_a_session_is_allowed_but_the_user_is_not(engine: AsyncEngine) -> None:
    """Sessions are ephemeral and purgeable; users are not cascades of sessions."""
    user_id = await _insert_admin(engine)
    await _insert_session(engine, user_id, "sha256$one")

    async with engine.begin() as connection:
        await connection.execute(text("DELETE FROM admin_session"))

    assert await _count(engine, "admin_session") == 0
    assert await _count(engine, "admin_user") == 1


async def test_a_session_for_a_missing_user_is_rejected(engine: AsyncEngine) -> None:
    with pytest.raises(IntegrityError):
        async with engine.begin() as connection:
            await connection.execute(
                text(
                    "INSERT INTO admin_session (user_id, token_hash, expires_at) "
                    "VALUES (gen_random_uuid(), 'sha256$ghost', now() + interval '1 day')"
                )
            )


async def test_an_audit_log_without_an_actor_is_allowed(engine: AsyncEngine) -> None:
    """`actor_user_id` is nullable: a system action has no human actor."""
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "INSERT INTO admin_audit_log (action, entity, entity_id) "
                "VALUES ('create', 'certification', 'cert-1')"
            )
        )

    assert await _count(engine, "admin_audit_log") == 1


async def test_relationship_navigation_from_category_to_skills(engine: AsyncEngine) -> None:
    """The ORM mapping and the database rule must agree."""
    from app.models import Skill, SkillCategory

    category_id = await _insert_category(engine)
    await _insert_skill(engine, category_id, "React")

    async with engine.begin() as connection:
        rows = (
            await connection.execute(
                text(
                    "SELECT c.name, s.name FROM skill_category c "
                    "JOIN skill s ON s.category_id = c.id WHERE c.id = :id"
                ),
                {"id": category_id},
            )
        ).all()

    assert [tuple(row) for row in rows] == [("Frontend Development", "React")]
    assert SkillCategory.skills.property.mapper.class_ is Skill