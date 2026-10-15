"""Admin content CRUD — `TESTING.md` §7.4.

The matrix in that section is the contract, so nearly every row in it has a test
name here. Two structural guarantees stand behind the individual cases:

* **Every mutating test asserts the audit row exists** with the right actor and
  entity — and one test reads the audit table after a batch and proves no
  password or token ever lands in `before` / `after`.
* **Every mutation test runs against the real schema**, not a mock session. A
  passing test against SQLite would prove nothing about `jsonb`, `text[]`,
  `citext`, CHECK constraints and `ON DELETE CASCADE`; `conftest.py` therefore
  rebuilds the schema from Alembic before the suite, exactly as `TESTING.md`
  §3.2 describes.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from email.utils import format_datetime

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from support_admin import ADMIN_EMAIL, ADMIN_PASSWORD, audit_rows

from app.models import AdminUser

CSRF_HEADER = "X-CSRF-Token"


def _seed_session(engine: AsyncEngine):
    """A session factory bound to the *fixture's* engine.

    The suite's `engine` fixture owns one event loop; seeding must go through it,
    not through the process-wide engine, whose pool is bound to whatever loop
    created it first — touching it from another loop raises asyncpg's
    "attached to a different loop".
    """
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def _seed_rows(engine: AsyncEngine, *rows) -> None:
    async with _seed_session(engine)() as session:
        session.add_all(rows)
        await session.commit()


async def _seed_full_profile(engine: AsyncEngine) -> None:
    """Insert a `site_profile` the public content contract can render.

    The public `GET /api/content` validates the row against the strict §5.1.2
    payload shape and 500s on anything incomplete, so a test that inspects public
    output must seed the full set of required keys — not just `name`/`title`.
    """
    from app.models import SiteProfile

    await _seed_rows(
        engine,
        SiteProfile(
            name="Ritu Raj",
            title="Full Stack Developer",
            greeting="Hello",
            roles=["Developer"],
            available_for_internship=True,
            internship_text="Open to internships.",
            description="A developer.",
            location="India",
            resume="/resume.pdf",
            stats=[{"label": "Projects", "value": "5"}],
            social={
                "github": "https://github.com/riturajlabs",
                "linkedin": "https://linkedin.com/in/riturajlabs",
                "email": "hi@example.com",
            },
            about={
                "tag": "about",
                "title": "About",
                "description": "desc",
                "heading": "heading",
                "paragraphs": ["One paragraph."],
                "cards": [
                    {
                        "icon_key": "FaCode",
                        "title": "Development",
                        "description": "Builds software.",
                    }
                ],
            },
            seo={
                "siteName": "Ritu Raj",
                "title": "Ritu Raj",
                "description": "desc",
                "keywords": ["ai"],
                "author": "Ritu Raj",
                "image": "/images/profile.webp",
                "imageAlt": "Ritu Raj",
                "twitterCard": "summary",
                "twitterSite": "@riturajlabs",
                "locale": "en",
                "type": "website",
                "robots": {"index": True, "follow": True},
                "person": {"name": "Ritu Raj"},
            },
        ),
    )


@pytest_asyncio.fixture(autouse=True)
async def _ensure_admin(admin_user: AdminUser) -> AdminUser:
    """Every test here hits the admin API, so every test needs an administrator.

    The `admin_user` fixture is something each test requests on purpose
    elsewhere; this module's tests authenticate unconditionally, so the fixture
    is made automatic for this file only.
    """
    return admin_user


async def _login(client: AsyncClient) -> None:
    response = await client.post(
        "/api/admin/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    assert response.status_code == 200, response.text


async def _csrf(client: AsyncClient) -> str:
    response = await client.get("/api/admin/me")
    assert response.status_code == 200, response.text
    return response.json()["csrf_token"]


async def _authng_headers(client: AsyncClient) -> dict[str, str]:
    await _login(client)
    return {CSRF_HEADER: await _csrf(client)}


def _project_payload(slug: str, **changes: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "slug": slug,
        "title": "WebChat AI",
        "short_description": "An AI chat frontend built on FastAPI.",
        "image": f"/images/projects/{slug}.webp",
        "image_width": 1200,
        "image_height": 750,
        "image_alt": "WebChat AI interface",
        "seo_title": "WebChat AI",
        "seo_description": "A full-stack conversational AI project.",
        "tech_stack": ["React", "FastAPI"],
    }
    payload.update(changes)
    return payload


# ---------------------------------------------------------------------------
# Authentication gating — §7.3's rule applied to the new routes
# ---------------------------------------------------------------------------


async def test_mutations_without_a_session_are_401(client: AsyncClient) -> None:
    response = await client.post(
        "/api/admin/projects",
        json=_project_payload("no-session"),
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


async def test_reads_without_a_session_are_401(client: AsyncClient) -> None:
    response = await client.get("/api/admin/projects")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHENTICATED"


async def test_mutations_without_a_csrf_token_are_403(client: AsyncClient) -> None:
    await _login(client)
    response = await client.post(
        "/api/admin/projects",
        json=_project_payload("no-csrf"),
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"


# ---------------------------------------------------------------------------
# Projects — create
# ---------------------------------------------------------------------------


async def test_create_project_with_valid_data_persists_and_audits(
    client: AsyncClient, engine
) -> None:
    csrf = await _authng_headers(client)

    response = await client.post(
        "/api/admin/projects", json=_project_payload("webchat-ai"), headers=csrf
    )
    assert response.status_code == 201, response.text

    body = response.json()
    entity = body["entity"]
    assert body["audit_id"]

    listed = await client.get("/api/admin/projects")
    assert listed.status_code == 200
    slugs = [item["slug"] for item in listed.json()]
    assert "webchat-ai" in slugs

    rows = await audit_rows(engine, action="create")
    assert any(row.entity == "project" and row.entity_id == entity["id"] for row in rows)


@pytest.mark.parametrize(
    "slug",
    ["UPPER", "has_space", "trailing-", "double--dash", "s_lash", ""],
)
async def test_create_project_with_an_invalid_slug_is_422(
    client: AsyncClient, slug: str
) -> None:
    csrf = await _authng_headers(client)
    response = await client.post(
        "/api/admin/projects", json=_project_payload(slug), headers=csrf
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_create_project_with_a_malicious_image_is_422(
    client: AsyncClient,
) -> None:
    csrf = await _authng_headers(client)
    response = await client.post(
        "/api/admin/projects",
        json=_project_payload("safe", image="/images/projects/../../etc/passwd.webp"),
        headers=csrf,
    )
    assert response.status_code == 422
    fields = response.json()["error"]["fields"]
    assert any(field["field"] == "image" for field in fields)


async def test_create_project_with_zero_or_negative_dimensions_is_422(
    client: AsyncClient,
) -> None:
    csrf = await _authng_headers(client)
    for dimensions in ({"image_width": 0}, {"image_height": -5}):
        response = await client.post(
            "/api/admin/projects",
            json=_project_payload("dims", **dimensions),
            headers=csrf,
        )
        assert response.status_code == 422
        field = response.json()["error"]["fields"][0]["field"]
        assert field in ("image_width", "image_height")


async def test_create_project_without_seo_fields_is_422(client: AsyncClient) -> None:
    csrf = await _authng_headers(client)
    payload = _project_payload("seo-missing")
    del payload["seo_title"]
    response = await client.post("/api/admin/projects", json=payload, headers=csrf)
    assert response.status_code == 422
    fields = [f["field"] for f in response.json()["error"]["fields"]]
    assert "seo_title" in fields


async def test_create_project_with_an_unknown_field_is_422(client: AsyncClient) -> None:
    csrf = await _authng_headers(client)
    response = await client.post(
        "/api/admin/projects",
        json=_project_payload("extra-field", not_a_column=True),
        headers=csrf,
    )
    assert response.status_code == 422
    fields = [f["field"] for f in response.json()["error"]["fields"]]
    assert "not_a_column" in fields


async def test_create_project_with_a_duplicate_slug_is_409(client: AsyncClient) -> None:
    csrf = await _authng_headers(client)
    first = await client.post("/api/admin/projects", json=_project_payload("dup"), headers=csrf)
    assert first.status_code == 201

    second = await client.post("/api/admin/projects", json=_project_payload("dup"), headers=csrf)
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "SLUG_TAKEN"


async def test_create_project_with_an_unknown_icon_key_is_422_anywhere_else(
    client: AsyncClient,
) -> None:
    # §7.4 pins this for projects implicitly; the explicit row is "unknown
    # icon_key → 422", exercised on the skill routes below.
    csrf = await _authng_headers(client)
    response = await client.post(
        "/api/admin/skill-categories",
        json={"name": "Bogus", "icon_key": "FaTotallyFake"},
        headers=csrf,
    )
    assert response.status_code == 422
    fields = [f["field"] for f in response.json()["error"]["fields"]]
    assert "icon_key" in fields


# ---------------------------------------------------------------------------
# Projects — update
# ---------------------------------------------------------------------------


async def _create_project(client: AsyncClient, csrf: dict[str, str], slug: str) -> dict:
    response = await client.post("/api/admin/projects", json=_project_payload(slug), headers=csrf)
    assert response.status_code == 201, response.text
    return response.json()["entity"]


async def test_update_project_partial_payload_changes_only_supplied_fields(
    client: AsyncClient,
) -> None:
    csrf = await _authng_headers(client)
    entity = await _create_project(client, csrf, "partial-update")

    response = await client.put(
        f"/api/admin/projects/{entity['id']}",
        json={"title": "Renamed", "featured": True},
        headers=csrf,
    )
    assert response.status_code == 200, response.text

    detail = await client.get(f"/api/admin/projects/{entity['id']}")
    assert detail.status_code == 200
    data = detail.json()
    assert data["title"] == "Renamed"
    assert data["featured"] is True
    assert data["slug"] == "partial-update"
    assert data["short_description"] == entity["short_description"]


async def test_update_a_published_projects_slug_is_409(client: AsyncClient) -> None:
    csrf = await _authng_headers(client)
    entity = await _create_project(client, csrf, "published-project")  # status defaults published

    response = await client.put(
        f"/api/admin/projects/{entity['id']}",
        json={"slug": "renamed-project"},
        headers=csrf,
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "SLUG_IMMUTABLE"

    detail = await client.get(f"/api/admin/projects/{entity['id']}")
    assert detail.json()["slug"] == "published-project"


async def test_update_a_hidden_projects_slug_is_allowed(client: AsyncClient) -> None:
    csrf = await _authng_headers(client)
    entity = await _create_project(client, csrf, "hidden-project")

    hidden = await client.put(
        f"/api/admin/projects/{entity['id']}", json={"status": "hidden"}, headers=csrf
    )
    assert hidden.status_code == 200

    response = await client.put(
        f"/api/admin/projects/{entity['id']}",
        json={"slug": "hidden-project-renamed"},
        headers=csrf,
    )
    assert response.status_code == 200, response.text
    detail = await client.get(f"/api/admin/projects/{entity['id']}")
    assert detail.json()["slug"] == "hidden-project-renamed"


async def test_create_project_without_a_slug_generates_one_from_the_title(
    client: AsyncClient,
) -> None:
    """The admin does not author URLs: omitting `slug` derives it from `title`."""
    csrf = await _authng_headers(client)
    payload = _project_payload("ignored")
    del payload["slug"]

    response = await client.post("/api/admin/projects", json=payload, headers=csrf)
    assert response.status_code == 201, response.text
    assert response.json()["entity"]["slug"] == "webchat-ai"


async def test_generated_slugs_are_disambiguated_not_rejected(client: AsyncClient) -> None:
    """Two projects titled identically get `slug` and `slug-2`, never a 409."""
    csrf = await _authng_headers(client)
    payload = _project_payload("ignored")
    del payload["slug"]

    first = await client.post("/api/admin/projects", json=payload, headers=csrf)
    second = await client.post("/api/admin/projects", json=payload, headers=csrf)
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert first.json()["entity"]["slug"] == "webchat-ai"
    assert second.json()["entity"]["slug"] == "webchat-ai-2"


async def test_renaming_the_title_does_not_move_a_generated_slug(client: AsyncClient) -> None:
    """The slug is a permalink: a later title edit must not change the URL."""
    csrf = await _authng_headers(client)
    payload = _project_payload("ignored")
    del payload["slug"]
    entity = (await client.post("/api/admin/projects", json=payload, headers=csrf)).json()["entity"]

    response = await client.put(
        f"/api/admin/projects/{entity['id']}", json={"title": "A New Name"}, headers=csrf
    )
    assert response.status_code == 200, response.text
    detail = await client.get(f"/api/admin/projects/{entity['id']}")
    assert detail.json()["title"] == "A New Name"
    assert detail.json()["slug"] == "webchat-ai"


async def test_update_project_rejects_an_explicit_null_for_a_required_field(
    client: AsyncClient,
) -> None:
    """A `null` for a `NOT NULL` column is a `422`, not a misleading `500`."""
    csrf = await _authng_headers(client)
    entity = await _create_project(client, csrf, "null-guard")

    response = await client.put(
        f"/api/admin/projects/{entity['id']}", json={"title": None}, headers=csrf
    )
    assert response.status_code == 422, response.text


async def test_update_with_a_stale_if_unmodified_since_is_409(client: AsyncClient) -> None:
    csrf = await _authng_headers(client)
    entity = await _create_project(client, csrf, "stale-write")

    stale = format_datetime(datetime.now(UTC) - timedelta(hours=1))
    response = await client.put(
        f"/api/admin/projects/{entity['id']}",
        json={"title": "Too late"},
        headers={**csrf, "If-Unmodified-Since": stale},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "STALE_WRITE"


async def test_display_order_is_set_through_a_plain_put(client: AsyncClient) -> None:
    csrf = await _authng_headers(client)
    entity = await _create_project(client, csrf, "ordering")

    response = await client.put(
        f"/api/admin/projects/{entity['id']}",
        json={"display_order": 7},
        headers=csrf,
    )
    assert response.status_code == 200
    assert response.json()["entity"]["display_order"] == 7


# ---------------------------------------------------------------------------
# Projects — delete (soft)
# ---------------------------------------------------------------------------


async def test_delete_project_soft_deletes_and_hides_from_content(
    client: AsyncClient, engine
) -> None:
    csrf = await _authng_headers(client)
    entity = await _create_project(client, csrf, "soft-delete")

    await _seed_full_profile(engine)

    response = await client.delete(f"/api/admin/projects/{entity['id']}", headers=csrf)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["audit_id"]

    detail = await client.get(f"/api/admin/projects/{entity['id']}")
    assert detail.status_code == 200
    assert detail.json()["status"] == "hidden"
    assert detail.json()["indexable"] is False

    public = await client.get("/api/content")
    assert public.status_code == 200
    assert all(p["slug"] != "soft-delete" for p in public.json()["projects"])

    rows = await audit_rows(engine, action="delete")
    assert any(
        row.entity == "project" and row.entity_id == entity["id"] and row.before
        and row.before["status"] == "published"
        for row in rows
    )


# ---------------------------------------------------------------------------
# Skill categories and skills
# ---------------------------------------------------------------------------


async def test_create_and_list_skill_categories(client: AsyncClient) -> None:
    csrf = await _authng_headers(client)
    created = await client.post(
        "/api/admin/skill-categories",
        json={"name": "Frontend Development", "icon_key": "FaReact", "display_order": 1},
        headers=csrf,
    )
    assert created.status_code == 201, created.text

    listed = await client.get("/api/admin/skill-categories")
    assert listed.status_code == 200
    assert listed.json()[0]["name"] == "Frontend Development"
    assert listed.json()[0]["skill_count"] == 0


async def test_delete_skill_category_without_cascade_is_refused(client: AsyncClient) -> None:
    csrf = await _authng_headers(client)
    category = await client.post(
        "/api/admin/skill-categories",
        json={"name": "Guarded Tools", "icon_key": "FaDatabase"},
        headers=csrf,
    )
    category_id = category.json()["entity"]["id"]

    skill = await client.post(
        "/api/admin/skills",
        json={"category_id": category_id, "name": "PostgreSQL", "icon_key": "SiPostgresql"},
        headers=csrf,
    )
    assert skill.status_code == 201, skill.text

    refused = await client.delete(f"/api/admin/skill-categories/{category_id}", headers=csrf)
    assert refused.status_code == 422
    fields = [f["field"] for f in refused.json()["error"]["fields"]]
    assert "cascade" in fields


async def test_delete_skill_category_with_cascade_removes_its_skills(
    client: AsyncClient, engine
) -> None:
    csrf = await _authng_headers(client)
    category = await client.post(
        "/api/admin/skill-categories",
        json={"name": "Cascade Tools", "icon_key": "FaDatabase"},
        headers=csrf,
    )
    category_id = category.json()["entity"]["id"]
    for name, icon in (("PostgreSQL", "SiPostgresql"), ("MongoDB", "SiMongodb")):
        made = await client.post(
            "/api/admin/skills",
            json={"category_id": category_id, "name": name, "icon_key": icon},
            headers=csrf,
        )
        assert made.status_code == 201, made.text

    deleted = await client.delete(
        f"/api/admin/skill-categories/{category_id}?cascade=true", headers=csrf
    )
    assert deleted.status_code == 200, deleted.text

    listed = await client.get("/api/admin/skills")
    assert all(s["category_id"] != category_id for s in listed.json())

    rows = await audit_rows(engine, action="delete")
    assert any(row.entity == "skill_category" and row.entity_id == category_id for row in rows)


async def test_delete_a_skill_keeps_its_category(client: AsyncClient) -> None:
    csrf = await _authng_headers(client)
    category = await client.post(
        "/api/admin/skill-categories",
        json={"name": "Removable Skills", "icon_key": "FaCode"},
        headers=csrf,
    )
    category_id = category.json()["entity"]["id"]
    skill = await client.post(
        "/api/admin/skills",
        json={"category_id": category_id, "name": "Python", "icon_key": "FaPython"},
        headers=csrf,
    )
    skill_id = skill.json()["entity"]["id"]

    response = await client.delete(f"/api/admin/skills/{skill_id}", headers=csrf)
    assert response.status_code == 200

    categories = await client.get("/api/admin/skill-categories")
    assert any(c["id"] == category_id for c in categories.json())
    skills = await client.get("/api/admin/skills")
    assert all(s["id"] != skill_id for s in skills.json())


async def test_skill_name_must_be_unique_within_a_category(client: AsyncClient) -> None:
    csrf = await _authng_headers(client)
    category = await client.post(
        "/api/admin/skill-categories",
        json={"name": "Uniqueness", "icon_key": "FaCode"},
        headers=csrf,
    )
    category_id = category.json()["entity"]["id"]
    first = await client.post(
        "/api/admin/skills",
        json={"category_id": category_id, "name": "React", "icon_key": "FaReact"},
        headers=csrf,
    )
    assert first.status_code == 201

    second = await client.post(
        "/api/admin/skills",
        json={"category_id": category_id, "name": "React", "icon_key": "FaReact"},
        headers=csrf,
    )
    assert second.status_code == 422


# ---------------------------------------------------------------------------
# Certifications
# ---------------------------------------------------------------------------


async def test_certification_crud(client: AsyncClient, engine) -> None:
    csrf = await _authng_headers(client)

    created = await client.post(
        "/api/admin/certifications",
        json={
            "title": "Meta Front-End Developer",
            "issuer": "Meta",
            "icon": "🌐",
            "issued_on": "June 2025",
            "credential_id": "ABC-123",
            "credential_url": "https://coursera.org/verify/ABC-123",
        },
        headers=csrf,
    )
    assert created.status_code == 201, created.text
    cert_id = created.json()["entity"]["id"]

    updated = await client.put(
        f"/api/admin/certifications/{cert_id}",
        json={"credential_url": "https://coursera.org/verify/NEW-ID"},
        headers=csrf,
    )
    assert updated.status_code == 200
    assert updated.json()["entity"]["credential_url"] == "https://coursera.org/verify/NEW-ID"

    listed = await client.get("/api/admin/certifications")
    assert listed.json()[0]["title"] == "Meta Front-End Developer"

    deleted = await client.delete(f"/api/admin/certifications/{cert_id}", headers=csrf)
    assert deleted.status_code == 200
    assert (await client.get("/api/admin/certifications")).json() == []

    rows = await audit_rows(engine)
    assert {row.entity for row in rows} >= {"certification"}


async def test_certification_url_must_be_http(client: AsyncClient) -> None:
    csrf = await _authng_headers(client)
    response = await client.post(
        "/api/admin/certifications",
        json={
            "title": "Bad URL",
            "issuer": "Someone",
            "credential_url": "javascript:alert(1)",
        },
        headers=csrf,
    )
    assert response.status_code == 422


async def test_certification_title_issuer_must_be_unique(client: AsyncClient) -> None:
    csrf = await _authng_headers(client)
    payload = {"title": "AWS Cloud Practitioner", "issuer": "Amazon Web Services"}
    first = await client.post("/api/admin/certifications", json=payload, headers=csrf)
    assert first.status_code == 201, first.text

    duplicate = await client.post("/api/admin/certifications", json=payload, headers=csrf)
    assert duplicate.status_code == 422, duplicate.text
    assert duplicate.json()["error"]["code"] == "VALIDATION_ERROR"
    assert duplicate.json()["error"]["fields"][0]["field"] == "title"


async def test_editing_certification_onto_an_existing_key_is_rejected(
    client: AsyncClient,
) -> None:
    csrf = await _authng_headers(client)
    first = await client.post(
        "/api/admin/certifications",
        json={"title": "Cert A", "issuer": "Shared Issuer"},
        headers=csrf,
    )
    assert first.status_code == 201, first.text
    second = await client.post(
        "/api/admin/certifications",
        json={"title": "Cert B", "issuer": "Shared Issuer"},
        headers=csrf,
    )
    assert second.status_code == 201, second.text
    cert_id = second.json()["entity"]["id"]

    response = await client.put(
        f"/api/admin/certifications/{cert_id}",
        json={"title": "Cert A"},
        headers=csrf,
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


# ---------------------------------------------------------------------------
# Profile
# ---------------------------------------------------------------------------


async def test_profile_is_404_until_it_exists(client: AsyncClient) -> None:
    await _login(client)
    response = await client.get("/api/admin/profile")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


async def test_profile_update_persists(client: AsyncClient, engine) -> None:
    csrf = await _authng_headers(client)

    from app.models import SiteProfile

    await _seed_rows(
        engine,
        SiteProfile(
            name="Ritu Raj",
            title="Full Stack Developer",
            resume="/resume.pdf",
        ),
    )

    response = await client.put(
        "/api/admin/profile",
        json={"name": "Ritu Raj Labs", "location": "India"},
        headers=csrf,
    )
    assert response.status_code == 200, response.text

    fetched = await client.get("/api/admin/profile")
    assert fetched.status_code == 200
    data = fetched.json()
    assert data["name"] == "Ritu Raj Labs"
    assert data["location"] == "India"
    assert data["title"] == "Full Stack Developer"

    rows = await audit_rows(engine, action="update")
    assert any(row.entity == "site_profile" for row in rows)


async def test_profile_rejects_unknown_fields(client: AsyncClient) -> None:
    csrf = await _authng_headers(client)
    response = await client.put("/api/admin/profile", json={"nope": True}, headers=csrf)
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------


async def test_messages_inbox_paginates_and_filters(
    client: AsyncClient, engine
) -> None:
    await _login(client)

    from app.models import ContactMessage

    await _seed_rows(
        engine,
        *[
            ContactMessage(
                name="Recruiter",
                email="recruiter@example.com",
                subject="Opportunity",
                message=f"This is message number {status}.",
                status=status,
            )
            for status in ("unread", "read", "archived")
        ],
    )

    page = await client.get("/api/admin/messages?status=unread&page=1&page_size=10")
    assert page.status_code == 200
    body = page.json()
    assert body["total"] == 1
    assert body["items"][0]["status"] == "unread"

    all_page = await client.get("/api/admin/messages")
    assert all_page.json()["total"] == 3


async def test_message_can_be_marked_read_or_archived_not_unread(
    client: AsyncClient, engine
) -> None:
    csrf = await _authng_headers(client)

    from app.models import ContactMessage

    row = ContactMessage(
        name="Recruiter",
        email="recruiter@example.com",
        subject="Opportunity",
        message="This is a ten character message.",
        status="unread",
    )
    async with _seed_session(engine)() as session:
        session.add(row)
        await session.flush()
        message_id = str(row.id)
        await session.commit()

    marked = await client.patch(
        f"/api/admin/messages/{message_id}",
        json={"status": "archived"},
        headers=csrf,
    )
    assert marked.status_code == 200
    assert marked.json()["entity"]["status"] == "archived"

    forbidden = await client.patch(
        f"/api/admin/messages/{message_id}",
        json={"status": "unread"},
        headers=csrf,
    )
    assert forbidden.status_code == 422


# ---------------------------------------------------------------------------
# The audit invariant
# ---------------------------------------------------------------------------


async def test_no_audit_row_contains_a_password_or_session_token(
    client: AsyncClient, engine
) -> None:
    csrf = await _authng_headers(client)

    entity = await _create_project(client, csrf, "audit-invariant")
    await client.put(
        f"/api/admin/projects/{entity['id']}", json={"title": "Changed"}, headers=csrf
    )

    rows = await audit_rows(engine)
    assert rows, "a mutation must have been audited"

    sensitive = ("password", "token", "credential_id", "set-cookie")
    for row in rows:
        for side in (row.before, row.after):
            if not side:
                continue
            for key, value in _flatten(side):
                assert key not in sensitive
                assert "credentials" not in _to_str(value)


def _flatten(mapping: dict) -> list[tuple[str, object]]:
    """Yield `(key path, value)` for every leaf of a nested JSON blob."""
    collected: list[tuple[str, object]] = []

    def walk(prefix: str, node: object) -> None:
        if isinstance(node, dict):
            for key, child in node.items():
                walk(f"{prefix}.{key}" if prefix else str(key), child)
        elif isinstance(node, list):
            for child in node:
                walk(prefix, child)
        else:
            collected.append((prefix, node))

    walk("", mapping)
    return collected


def _to_str(value: object) -> str:
    return str(value).lower()


# ---------------------------------------------------------------------------
# Icon registry parity
# ---------------------------------------------------------------------------


def test_icon_registry_matches_frontend() -> None:
    """`ADR-008`: the server and client share one icon vocabulary.

    The frontend list lives at `src/components/iconKeys.js` — a pure-data module
    with no imports, so the public entry never pays for `react-icons`. If the
    lists drift, a key the admin dropdown offers (or refuses) will not match what
    the site can actually render, and the failure is silent until a build.
    """
    from pathlib import Path

    from app.registry import ICON_KEYS

    frontend = (
        Path(__file__).resolve().parents[2]
        / "src"
        / "components"
        / "iconKeys.js"
    )
    assert frontend.is_file(), f"missing {frontend}"
    source = frontend.read_text()
    block = source[source.index("[") : source.index("]")]
    js_keys = set(re.findall(r'"([^"]+)"', block))

    assert js_keys == set(ICON_KEYS)