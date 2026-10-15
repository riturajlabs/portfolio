"""Every documented constraint, tested with a failing case.

`DATABASE.md` §16 requires each CHECK to be exercised with a value it must
reject. These tests issue raw SQL rather than going through a model or a
Pydantic schema, because the claim under test is that the *database* refuses the
write. A validation layer that happened to accept the value would leave this
suite green.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine

VALID_PROJECT: dict[str, object] = {
    "slug": "valid-project",
    "title": "Valid Project",
    "short_description": "Short description.",
    "image": "/images/projects/valid-project.webp",
    "image_width": 1200,
    "image_height": 800,
    "image_alt": "Screenshot of the project",
    "seo_title": "Valid Project",
    "seo_description": "A description.",
}

VALID_MESSAGE: dict[str, object] = {
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "subject": "Hello there",
    "message": "This is a message body long enough to pass the check.",
}

ADMIN_INSERT = "INSERT INTO admin_user (email, password_hash) VALUES (:email, 'argon2id$hash')"
SESSION_INSERT = (
    "INSERT INTO admin_session (user_id, token_hash, expires_at) "
    "SELECT id, :token_hash, now() + interval '7 days' FROM admin_user WHERE email = :email"
)


def _insert(table: str, values: dict[str, object]) -> tuple[str, dict[str, object]]:
    """Build an INSERT whose column list comes from the values actually supplied.

    Building the list from the merged values means an override such as `status`
    or `category` really reaches the database. A dropped column would let a
    constraint test pass for the wrong reason.
    """
    columns = ", ".join(values)
    placeholders = ", ".join(f":{key}" for key in values)
    return f"INSERT INTO {table} ({columns}) VALUES ({placeholders})", values


async def _expect_rejection(engine: AsyncEngine, statement: str, **params: object) -> None:
    """Run `statement` and require the database to refuse it."""
    with pytest.raises(IntegrityError):
        async with engine.begin() as connection:
            await connection.execute(text(statement), params)


async def _insert_project(engine: AsyncEngine, **overrides: object) -> None:
    statement, values = _insert("project", {**VALID_PROJECT, **overrides})
    async with engine.begin() as connection:
        await connection.execute(text(statement), values)


async def _expect_project_rejection(engine: AsyncEngine, **overrides: object) -> None:
    statement, values = _insert("project", {**VALID_PROJECT, **overrides})
    await _expect_rejection(engine, statement, **values)


async def _expect_message_rejection(engine: AsyncEngine, **overrides: object) -> None:
    statement, values = _insert("contact_message", {**VALID_MESSAGE, **overrides})
    await _expect_rejection(engine, statement, **values)


async def _insert_message(engine: AsyncEngine, **overrides: object) -> None:
    statement, values = _insert("contact_message", {**VALID_MESSAGE, **overrides})
    async with engine.begin() as connection:
        await connection.execute(text(statement), values)


async def _insert_category(engine: AsyncEngine, name: str) -> None:
    async with engine.begin() as connection:
        await connection.execute(
            text("INSERT INTO skill_category (name, icon_key) VALUES (:name, 'FaCode')"),
            {"name": name},
        )


async def _insert_admin(engine: AsyncEngine, email: str = "owner@example.com") -> None:
    async with engine.begin() as connection:
        await connection.execute(text(ADMIN_INSERT), {"email": email})


# --------------------------------------------------------------------------
# site_profile: `singleton boolean UNIQUE DEFAULT true`
# --------------------------------------------------------------------------


PROFILE_INSERT = "INSERT INTO site_profile (name, title, resume) VALUES (:name, :title, :resume)"
VALID_PROFILE = {"name": "Ritu Raj", "title": "Full Stack Developer", "resume": "/resume.pdf"}


async def test_a_valid_site_profile_is_accepted(engine: AsyncEngine) -> None:
    async with engine.begin() as connection:
        await connection.execute(text(PROFILE_INSERT), VALID_PROFILE)


async def test_a_second_site_profile_row_is_rejected(engine: AsyncEngine) -> None:
    """Only one profile row is possible, by constraint rather than by convention."""
    async with engine.begin() as connection:
        await connection.execute(text(PROFILE_INSERT), VALID_PROFILE)

    await _expect_rejection(engine, PROFILE_INSERT, **{**VALID_PROFILE, "name": "Someone Else"})


async def test_site_profile_defaults_match_the_documented_shape(engine: AsyncEngine) -> None:
    async with engine.connect() as connection:
        row = (
            await connection.execute(
                text(
                    "INSERT INTO site_profile (name, title, resume) "
                    "VALUES ('Ritu Raj', 'Full Stack Developer', '/resume.pdf') "
                    "RETURNING singleton, available_for_internship, roles, stats, social, about, seo"
                )
            )
        ).one()

    assert row.singleton is True
    assert row.available_for_internship is False
    assert list(row.roles) == []
    assert row.stats == []
    assert row.social == {}
    assert row.about == {}
    assert row.seo == {}


# --------------------------------------------------------------------------
# project
# --------------------------------------------------------------------------


async def test_a_valid_project_is_accepted(engine: AsyncEngine) -> None:
    await _insert_project(engine)


async def test_duplicate_project_slug_is_rejected(engine: AsyncEngine) -> None:
    await _insert_project(engine)

    await _expect_project_rejection(engine)


@pytest.mark.parametrize(
    "slug",
    ["../etc", "Upper", "with space", "-leading", "trailing-", "double--dash", "under_score", "ünïcode"],
)
async def test_invalid_project_slug_is_rejected(engine: AsyncEngine, slug: str) -> None:
    await _expect_project_rejection(engine, slug=slug)


@pytest.mark.parametrize("slug", ["a", "project-1", "a-b-c", "abc123", "9lives"])
async def test_valid_project_slug_is_accepted(engine: AsyncEngine, slug: str) -> None:
    await _insert_project(engine, slug=slug, image=f"/images/projects/{slug}.webp")


@pytest.mark.parametrize(
    "image",
    [
        "/images/projects/../../etc/passwd",
        "/images/projects/Valid-Project.webp",
        "/images/projects/project.png",
        "images/projects/project.webp",
        "/other/path.webp",
        "/images/projects/project.webp.bak",
        "/images/projects/.webp",
    ],
)
async def test_invalid_project_image_path_is_rejected(engine: AsyncEngine, image: str) -> None:
    """The image CHECK is a build contract; a stored path that breaks it breaks the build."""
    await _expect_project_rejection(engine, image=image)


@pytest.mark.parametrize(
    "image",
    [
        "https://br-example.storage.us-east-2.aws.neon.tech/media/project-images/a1b2.webp",
        "http://localhost:9000/media/project-images/a1b2.png",
        "https://cdn.example.com/p/abc.jpg",
    ],
)
async def test_object_storage_image_url_is_accepted(engine: AsyncEngine, image: str) -> None:
    """An admin-uploaded cover is stored as the bucket's anonymous public URL."""
    await _insert_project(engine, image=image)


@pytest.mark.parametrize(
    "image",
    [
        # A scheme that would execute if emitted as an image source.
        "javascript:alert(1)",
        "data:image/png;base64,AAAA",
        "ftp://example.com/a.webp",
        # Whitespace, a double quote or an angle bracket would break the emitted
        # attribute (or smuggle a second one) — the CHECK refuses all three.
        "https://example.com/a b.webp",
        'https://example.com/a"b.webp',
        "https://example.com/a<b.webp",
        "https://example.com/a>b.webp",
        # Not absolute.
        "//example.com/a.webp",
        "example.com/a.webp",
    ],
)
async def test_image_value_that_is_not_a_path_or_http_url_is_rejected(
    engine: AsyncEngine, image: str
) -> None:
    await _expect_project_rejection(engine, image=image)


@pytest.mark.parametrize("width", [0, -5, -1])
async def test_non_positive_image_width_is_rejected(engine: AsyncEngine, width: int) -> None:
    await _expect_project_rejection(engine, image_width=width)


@pytest.mark.parametrize("height", [0, -5, -1])
async def test_non_positive_image_height_is_rejected(engine: AsyncEngine, height: int) -> None:
    await _expect_project_rejection(engine, image_height=height)


@pytest.mark.parametrize("status", ["draft", "archived", "Published", "", "deleted"])
async def test_invalid_project_status_is_rejected(engine: AsyncEngine, status: str) -> None:
    await _expect_project_rejection(engine, status=status)


@pytest.mark.parametrize("status", ["published", "hidden"])
async def test_valid_project_status_is_accepted(engine: AsyncEngine, status: str) -> None:
    await _insert_project(engine, status=status)


@pytest.mark.parametrize(
    ("column", "value"),
    [
        ("seo_title", "x" * 71),
        ("seo_description", "x" * 186),
        ("slug", "a" * 81),
        ("category", "c" * 61),
    ],
)
async def test_project_length_caps_are_enforced(
    engine: AsyncEngine, column: str, value: str
) -> None:
    await _expect_project_rejection(engine, **{column: value})


@pytest.mark.parametrize("missing", ["seo_title", "seo_description"])
async def test_seo_fields_are_required(engine: AsyncEngine, missing: str) -> None:
    """`discover.mjs` asserts both exist, so the database must not allow NULL."""
    await _expect_project_rejection(engine, **{missing: None})


async def test_project_defaults_match_the_documented_flags(engine: AsyncEngine) -> None:
    """A project is published, indexable, not featured, and ordered last by default."""
    await _insert_project(engine)

    async with engine.connect() as connection:
        row = (
            await connection.execute(
                text("SELECT status, featured, indexable, display_order, tech_stack FROM project")
            )
        ).one()

    assert row.status == "published"
    assert row.featured is False
    assert row.indexable is True
    assert row.display_order == 0
    assert list(row.tech_stack) == []


# --------------------------------------------------------------------------
# skill_category / skill
# --------------------------------------------------------------------------


async def test_a_skill_requires_its_category(engine: AsyncEngine) -> None:
    await _insert_category(engine, "Frontend Development")
    statement = (
        "INSERT INTO skill (category_id, name, icon_key) "
        "SELECT id, 'React', 'FaReact' FROM skill_category WHERE name = 'Frontend Development'"
    )
    async with engine.begin() as connection:
        await connection.execute(text(statement))

    assert True


async def test_duplicate_skill_in_category_is_rejected(engine: AsyncEngine) -> None:
    await _insert_category(engine, "Frontend Development")
    statement = (
        "INSERT INTO skill (category_id, name, icon_key) "
        "SELECT id, 'React', 'FaReact' FROM skill_category WHERE name = 'Frontend Development'"
    )
    async with engine.begin() as connection:
        await connection.execute(text(statement))

    await _expect_rejection(engine, statement)


async def test_the_same_skill_name_in_another_category_is_allowed(engine: AsyncEngine) -> None:
    """`UNIQUE (category_id, name)` is scoped to the category, not global."""
    await _insert_category(engine, "Frontend Development")
    await _insert_category(engine, "Backend Development")
    statement = (
        "INSERT INTO skill (category_id, name, icon_key) "
        "SELECT id, 'React', 'FaReact' FROM skill_category"
    )

    async with engine.begin() as connection:
        await connection.execute(text(statement))
        count = (await connection.execute(text("SELECT count(*) FROM skill"))).scalar()

    assert count == 2


async def test_orphan_skill_is_rejected(engine: AsyncEngine) -> None:
    """`DATABASE.md` §13: no skill without a category."""
    await _expect_rejection(
        engine,
        "INSERT INTO skill (category_id, name, icon_key) "
        "VALUES (gen_random_uuid(), 'Orphan', 'FaOrphan')",
    )


async def test_null_skill_category_is_rejected(engine: AsyncEngine) -> None:
    await _expect_rejection(
        engine,
        "INSERT INTO skill (category_id, name, icon_key) VALUES (NULL, 'Null', 'FaNull')",
    )


async def test_duplicate_skill_category_name_is_rejected(engine: AsyncEngine) -> None:
    await _insert_category(engine, "Frontend Development")

    await _expect_rejection(
        engine,
        "INSERT INTO skill_category (name, icon_key) VALUES ('Frontend Development', 'FaCode')",
    )


async def test_skill_defaults_are_visible_and_ordered(engine: AsyncEngine) -> None:
    async with engine.connect() as connection:
        row = (
            await connection.execute(
                text(
                    "INSERT INTO skill_category (name, icon_key) VALUES ('AI', 'FaBrain') "
                    "RETURNING display_order, is_visible"
                )
            )
        ).one()

    assert row.display_order == 0
    assert row.is_visible is True


# --------------------------------------------------------------------------
# contact_message
# --------------------------------------------------------------------------


async def test_a_valid_contact_message_is_accepted(engine: AsyncEngine) -> None:
    await _insert_message(engine)


@pytest.mark.parametrize("name", ["a", "x" * 101, ""])
async def test_contact_name_length_is_enforced(engine: AsyncEngine, name: str) -> None:
    await _expect_message_rejection(engine, name=name)


@pytest.mark.parametrize("subject", ["ab", "x" * 151, ""])
async def test_contact_subject_length_is_enforced(engine: AsyncEngine, subject: str) -> None:
    await _expect_message_rejection(engine, subject=subject)


@pytest.mark.parametrize("message", ["x" * 9, "x" * 2001, ""])
async def test_contact_message_length_is_enforced(engine: AsyncEngine, message: str) -> None:
    await _expect_message_rejection(engine, message=message)


async def test_contact_email_length_is_enforced(engine: AsyncEngine) -> None:
    await _expect_message_rejection(engine, email="x" * 250 + "@example.com")


@pytest.mark.parametrize("status", ["new", "deleted", "READ", "", "unread "])
async def test_invalid_contact_status_is_rejected(engine: AsyncEngine, status: str) -> None:
    await _expect_message_rejection(engine, status=status)


@pytest.mark.parametrize("status", ["unread", "read", "archived"])
async def test_valid_contact_status_is_accepted(engine: AsyncEngine, status: str) -> None:
    await _insert_message(engine, status=status)


@pytest.mark.parametrize("delivery_status", ["queued", "delivered", "SENT", "", "failed "])
async def test_invalid_delivery_status_is_rejected(engine: AsyncEngine, delivery_status: str) -> None:
    await _expect_message_rejection(engine, delivery_status=delivery_status)


@pytest.mark.parametrize("delivery_status", ["pending", "sent", "failed"])
async def test_valid_delivery_status_is_accepted(engine: AsyncEngine, delivery_status: str) -> None:
    await _insert_message(engine, delivery_status=delivery_status)


async def test_contact_message_defaults_are_unread_and_pending(engine: AsyncEngine) -> None:
    """`delivery_status` is written before the Resend call, so 'pending' is the norm."""
    async with engine.connect() as connection:
        row = (
            await connection.execute(
                text(
                    "INSERT INTO contact_message (name, email, subject, message) "
                    "VALUES ('Ada', 'ada@example.com', 'Subject line', 'Body text long enough.') "
                    "RETURNING status, delivery_status, source_ip_hash, user_agent"
                )
            )
        ).one()

    assert row.status == "unread"
    assert row.delivery_status == "pending"
    assert row.source_ip_hash is None
    assert row.user_agent is None


async def test_contact_email_comparison_ignores_case(engine: AsyncEngine) -> None:
    """`citext` stores the spelling it is given but compares ignoring case.

    The evidence is the equality operator, not the stored spelling.
    """
    async with engine.connect() as connection:
        equal = (
            await connection.execute(text("SELECT 'ada@example.com'::citext = 'ADA@EXAMPLE.COM'::citext"))
        ).scalar_one()

    assert equal is True


# --------------------------------------------------------------------------
# admin_user / admin_session / admin_audit_log
# --------------------------------------------------------------------------


@pytest.mark.parametrize("role", ["USER", "EDITOR", "admin", ""])
async def test_invalid_admin_role_is_rejected(engine: AsyncEngine, role: str) -> None:
    """`CHECK (role = 'ADMIN')` exists so a partial RBAC schema cannot appear."""
    await _expect_rejection(
        engine,
        "INSERT INTO admin_user (email, password_hash, role) "
        "VALUES (:email, 'argon2id$hash', :role)",
        email=f"{role or 'blank'}@example.com",
        role=role,
    )


async def test_admin_defaults_match_the_documented_shape(engine: AsyncEngine) -> None:
    async with engine.connect() as connection:
        row = (
            await connection.execute(
                text(
                    "INSERT INTO admin_user (email, password_hash) "
                    "VALUES ('owner@example.com', 'argon2id$hash') "
                    "RETURNING role, is_active, failed_attempts, locked_until, last_login_at"
                )
            )
        ).one()

    assert row.role == "ADMIN"
    assert row.is_active is True
    assert row.failed_attempts == 0
    assert row.locked_until is None
    assert row.last_login_at is None


async def test_duplicate_admin_email_is_rejected(engine: AsyncEngine) -> None:
    await _insert_admin(engine)

    await _expect_rejection(engine, ADMIN_INSERT, email="owner@example.com")


async def test_admin_email_uniqueness_ignores_case(engine: AsyncEngine) -> None:
    """`citext` means one owner, not one owner per email spelling."""
    await _insert_admin(engine, "owner@example.com")

    await _expect_rejection(engine, ADMIN_INSERT, email="Owner@Example.com")


async def test_duplicate_session_token_hash_is_rejected(engine: AsyncEngine) -> None:
    await _insert_admin(engine)
    async with engine.begin() as connection:
        await connection.execute(
            text(SESSION_INSERT), {"token_hash": "sha256$deadbeef", "email": "owner@example.com"}
        )

    await _expect_rejection(
        engine, SESSION_INSERT, token_hash="sha256$deadbeef", email="owner@example.com"
    )


async def test_session_without_an_expiry_is_rejected(engine: AsyncEngine) -> None:
    """`expires_at NOT NULL` — a session that never expires is forbidden."""
    await _insert_admin(engine)

    await _expect_rejection(
        engine,
        "INSERT INTO admin_session (user_id, token_hash, expires_at) "
        "SELECT id, 'sha256$nope', NULL FROM admin_user WHERE email = 'owner@example.com'",
    )


async def test_session_defaults_are_issued_now(engine: AsyncEngine) -> None:
    await _insert_admin(engine)
    async with engine.connect() as connection:
        row = (
            await connection.execute(
                text(
                    "INSERT INTO admin_session (user_id, token_hash, expires_at) "
                    "SELECT id, 'sha256$one', now() + interval '7 days' FROM admin_user "
                    "WHERE email = 'owner@example.com' RETURNING issued_at, last_used_at, revoked_at"
                )
            )
        ).one()

    assert row.issued_at is not None
    assert row.last_used_at is not None
    assert row.revoked_at is None


async def test_audit_log_records_action_and_entity(engine: AsyncEngine) -> None:
    """The audit trail is the only record of a DB edit once content leaves git."""
    async with engine.connect() as connection:
        row = (
            await connection.execute(
                text(
                    "INSERT INTO admin_audit_log (action, entity, entity_id, after) "
                    "VALUES ('update', 'project', 'slug-1', '{\"title\": \"x\"}'::jsonb) "
                    "RETURNING actor_user_id, before, at"
                )
            )
        ).one()

    assert row.actor_user_id is None
    assert row.before is None
    assert row.at is not None


# --------------------------------------------------------------------------
# certification
# --------------------------------------------------------------------------


async def test_issued_on_is_free_text_not_a_date(engine: AsyncEngine) -> None:
    """`DATABASE.md` §5.5: the stored values are `"June 2025"`-style strings."""
    async with engine.connect() as connection:
        row = (
            await connection.execute(
                text(
                    "INSERT INTO certification (title, issuer, issued_on) "
                    "VALUES ('Meta Backend', 'Meta', 'June 2025') RETURNING issued_on, display_order"
                )
            )
        ).one()

    assert row.issued_on == "June 2025"
    assert row.display_order == 0


async def test_certification_requires_a_title_and_issuer(engine: AsyncEngine) -> None:
    await _expect_rejection(
        engine, "INSERT INTO certification (title) VALUES ('No issuer')"
    )
    await _expect_rejection(
        engine, "INSERT INTO certification (issuer) VALUES ('No title')"
    )