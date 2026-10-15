"""`GET /api/content` — the contract in `docs/API.md` §5.1.2, asserted.

The payload shape is a hard contract between the database and components that do
not exist yet (`Hero.jsx`, `ProjectCard.jsx`, `About.jsx`, and the build's
prerender and SEO generators). These tests are what stops the two representations
from drifting (`DATABASE.md` §11.4.4).

Every test runs against a real PostgreSQL instance and inserts rows with raw SQL,
so a passing test means the *database* holds what the API served, not that a mock
agreed with a fixture.
"""

from __future__ import annotations

import gzip
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

# ---------------------------------------------------------------------------
# Insert helpers
# ---------------------------------------------------------------------------

VALID_SEO: dict[str, Any] = {
    "siteName": "Ritu Raj",
    "title": "Ritu Raj | Full Stack Developer",
    "description": "Portfolio of Ritu Raj.",
    "keywords": ["Ritu Raj", "MERN"],
    "author": "Ritu Raj",
    "image": "https://riturajlabs.vercel.app/images/portfolio-og.jpg",
    "imageAlt": "Ritu Raj portfolio",
    "twitterCard": "summary_large_image",
    "twitterSite": "@riturajlabs",
    "locale": "en_IN",
    "type": "website",
    "robots": {"index": True, "follow": True},
    "person": {
        "name": "Ritu Raj",
        "alternateName": "riturajlabs",
        "jobTitle": "Full Stack Developer",
        "email": "riturajlabs@outlook.com",
        "address": {"locality": "Pune", "region": "Maharashtra", "country": "IN"},
        "nationality": "Indian",
        "credential": "B.Sc. Artificial Intelligence & Machine Learning",
        "knowsAbout": ["React", "Python"],
    },
}

VALID_ABOUT: dict[str, Any] = {
    "tag": "About Me",
    "title": "Building Software. Exploring Intelligence.",
    "description": "An AI and ML student.",
    "heading": "My Journey",
    "paragraphs": ["Started with web development."],
    "cards": [
        {
            "icon_key": "FaGraduationCap",
            "title": "Education",
            "description": "B.Sc. AI & ML student.",
        }
    ],
}

VALID_SOCIAL: dict[str, str] = {
    "github": "https://github.com/riturajlabs",
    "linkedin": "https://linkedin.com/in/riturajlabs",
    "email": "riturajlabs@outlook.com",
}

VALID_STATS: list[dict[str, str]] = [{"label": "Projects", "value": "4+"}]

VALID_PROJECT: dict[str, Any] = {
    "slug": "webchat-ai",
    "title": "WebChat AI",
    "short_description": "Real-time AI chat application.",
    "image": "/images/projects/webchat-ai.webp",
    "image_width": 1200,
    "image_height": 750,
    "image_alt": "WebChat AI landing page",
    "seo_title": "WebChat AI: RAG Support Chatbot",
    "seo_description": "A multi-tenant AI support chatbot.",
}


async def _insert_profile(
    engine: AsyncEngine,
    *,
    name: str = "Ritu Raj",
    seo: dict[str, Any] | None = None,
    about: dict[str, Any] | None = None,
    stats: list[dict[str, str]] | None = None,
    social: dict[str, str] | None = None,
) -> None:
    statement = text(
        "INSERT INTO site_profile "
        "(name, title, greeting, roles, available_for_internship, internship_text, "
        " description, location, resume, stats, social, about, seo) "
        "VALUES (:name, 'Full Stack Developer', 'Hello', ARRAY['Full Stack Developer'], "
        " true, 'Available for an internship', 'A developer.', 'Pune, India', '/resume.pdf', "
        " CAST(:stats AS jsonb), CAST(:social AS jsonb), CAST(:about AS jsonb), CAST(:seo AS jsonb))"
    )
    async with engine.begin() as connection:
        await connection.execute(
            statement,
            {
                "name": name,
                "stats": _json(stats if stats is not None else VALID_STATS),
                "social": _json(social if social is not None else VALID_SOCIAL),
                "about": _json(about if about is not None else VALID_ABOUT),
                "seo": _json(seo if seo is not None else VALID_SEO),
            },
        )


def _json(value: Any) -> str:
    import json

    return json.dumps(value)


async def _insert_project(engine: AsyncEngine, **overrides: Any) -> None:
    values = {**VALID_PROJECT, **overrides}
    columns = ", ".join(values)
    placeholders = ", ".join(f":{key}" for key in values)
    async with engine.begin() as connection:
        await connection.execute(
            text(f"INSERT INTO project ({columns}) VALUES ({placeholders})"), values
        )


async def _insert_category(
    engine: AsyncEngine,
    name: str,
    *,
    display_order: int = 0,
    is_visible: bool = True,
) -> None:
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "INSERT INTO skill_category (name, icon_key, display_order, is_visible) "
                "VALUES (:name, 'FaCode', :display_order, :is_visible)"
            ),
            {"name": name, "display_order": display_order, "is_visible": is_visible},
        )


async def _insert_skill(
    engine: AsyncEngine,
    category: str,
    name: str,
    *,
    display_order: int = 0,
    is_visible: bool = True,
) -> None:
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "INSERT INTO skill (category_id, name, icon_key, display_order, is_visible) "
                "SELECT id, :name, 'FaReact', :display_order, :is_visible "
                "FROM skill_category WHERE name = :category"
            ),
            {
                "name": name,
                "category": category,
                "display_order": display_order,
                "is_visible": is_visible,
            },
        )


async def _insert_certification(
    engine: AsyncEngine,
    title: str,
    *,
    issuer: str = "Issuer",
    display_order: int = 0,
) -> None:
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "INSERT INTO certification (title, issuer, icon, issued_on, "
                " credential_id, credential_url, display_order) "
                "VALUES (:title, :issuer, '🌐', 'June 2025', 'ID-1', "
                " 'https://example.com/cert', :display_order)"
            ),
            {"title": title, "issuer": issuer, "display_order": display_order},
        )


async def _seed_complete(engine: AsyncEngine) -> None:
    await _insert_profile(engine)
    await _insert_project(engine)
    await _insert_category(engine, "Frontend Development", display_order=0)
    await _insert_skill(engine, "Frontend Development", "React", display_order=0)
    await _insert_certification(engine, "Delta", display_order=0)


# ---------------------------------------------------------------------------
# Empty database
# ---------------------------------------------------------------------------


async def test_empty_database_returns_404_not_a_fabricated_profile(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """Phase 3 ships no seed, so an empty database is the normal state to test.

    The profile is a required singleton. Inventing a placeholder would let the site
    build with invented content — the precise failure this migration removes — so
    the endpoint reports absence honestly.
    """
    assert (await _count(engine, "site_profile")) == 0

    response = await client.get("/api/content")

    assert response.status_code == 404
    assert response.json() == {"detail": "Site profile not found."}


async def test_empty_database_does_not_leak_internals(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    response = await client.get("/api/content")

    body = response.text
    for leak in ("portfolio_test", "asyncpg", "SELECT", "Traceback", "/home/", "password"):
        assert leak not in body, f"{leak!r} leaked into the response"


async def _count(engine: AsyncEngine, table: str) -> int:
    async with engine.connect() as connection:
        result = await connection.execute(text(f"SELECT count(*) FROM {table}"))
        return result.scalar()


async def test_profile_present_but_no_collections_returns_empty_lists(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """An empty collection is valid content, not an error.

    Only the singleton profile is required. A site with no certifications yet must
    still serve a payload rather than 404.
    """
    await _insert_profile(engine)

    response = await client.get("/api/content")

    assert response.status_code == 200
    body = response.json()
    assert body["projects"] == []
    assert body["skills"] == []
    assert body["certifications"] == []
    assert body["profile"]["name"] == "Ritu Raj"
    assert body["about"]["tag"] == "About Me"


# ---------------------------------------------------------------------------
# Success and exact key sets
# ---------------------------------------------------------------------------


async def test_complete_content_returns_200(client: AsyncClient, engine: AsyncEngine) -> None:
    await _seed_complete(engine)

    response = await client.get("/api/content")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"profile", "about", "projects", "skills", "certifications", "seo", "meta"}


async def test_top_level_keys_match_the_documented_contract(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """`API.md` §5.1.2 — a second undocumented shape is not permitted."""
    await _seed_complete(engine)

    body = (await client.get("/api/content")).json()

    assert set(body) == {
        "profile",
        "about",
        "projects",
        "skills",
        "certifications",
        "seo",
        "meta",
    }
    assert set(body["meta"]) == {"generated_at", "version"}


async def test_profile_keys_match_the_js_module(client: AsyncClient, engine: AsyncEngine) -> None:
    """`DATABASE.md` §11.2: camelCase keys so `Hero.jsx` needs no mapper.

    `profileImage`, `seo` and `techStack` are absent by documented decision
    (`API.md` §5.1.3) — a Vite asset import, and two dead keys.
    """
    await _seed_complete(engine)

    profile = (await client.get("/api/content")).json()["profile"]

    assert set(profile) == {
        "name",
        "title",
        "greeting",
        "roles",
        "availableForInternship",
        "internshipText",
        "description",
        "location",
        "resume",
        "stats",
        "social",
    }
    assert "profileImage" not in profile
    assert "seo" not in profile
    assert "techStack" not in profile
    assert "singleton" not in profile


async def test_social_and_stats_keep_their_jsonb_shape(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """jsonb keys already match the payload byte-for-byte (`DATABASE.md` §11.1)."""
    await _seed_complete(engine)

    profile = (await client.get("/api/content")).json()["profile"]

    assert profile["social"] == VALID_SOCIAL
    assert profile["stats"] == VALID_STATS


async def test_about_is_passed_through_without_flattening(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """`about` is one jsonb column and stays one object (`DATABASE.md` §5.1.4)."""
    await _seed_complete(engine)

    about = (await client.get("/api/content")).json()["about"]

    assert about == VALID_ABOUT
    # `icon_key` is the documented rename of the old React component reference.
    assert about["cards"][0]["icon_key"] == "FaGraduationCap"


async def test_about_card_icon_is_a_key_not_a_component_reference(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    await _insert_profile(engine)

    about = (await client.get("/api/content")).json()["about"]

    assert "icon" not in about["cards"][0]


async def test_project_keys_match_the_documented_contract(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """`image_width`/`image_height` are the only snake_case keys, deliberately."""
    await _seed_complete(engine)

    project = (await client.get("/api/content")).json()["projects"][0]

    assert set(project) == {
        "slug",
        "title",
        "description",
        "longDescription",
        "image",
        "image_width",
        "image_height",
        "imageAlt",
        "category",
        "techStack",
        "highlights",
        "featured",
        "indexable",
        "status",
        "display_order",
        "live",
        "github",
        "seoTitle",
        "seoDescription",
    }
    # The three renamed keys keep their JS spelling rather than their DB spelling.
    assert project["description"] == "Real-time AI chat application."
    assert project["seoTitle"] == "WebChat AI: RAG Support Chatbot"


async def test_skill_keys_nest_their_category(client: AsyncClient, engine: AsyncEngine) -> None:
    await _seed_complete(engine)

    skill = (await client.get("/api/content")).json()["skills"][0]

    assert set(skill) == {"name", "icon_key", "display_order", "category"}
    assert set(skill["category"]) == {"name", "icon_key", "display_order"}


async def test_certification_keys_match_the_documented_contract(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    await _seed_complete(engine)

    certification = (await client.get("/api/content")).json()["certifications"][0]

    assert set(certification) == {
        "title",
        "issuer",
        "icon",
        "issued_on",
        "credential_id",
        "credential_url",
        "display_order",
    }


async def test_seo_keys_exclude_deployment_owned_values(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """`url` and `verification` belong to the domain, not the person.

    They stay in `src/config/seo.js` so a content edit cannot repoint every
    canonical tag at the wrong host (`DATABASE.md` §5.1.3).
    """
    await _seed_complete(engine)

    seo = (await client.get("/api/content")).json()["seo"]

    assert "url" not in seo
    assert "verification" not in seo
    assert "sameAs" in seo


async def test_same_as_is_derived_from_social_not_stored(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """One fact, one source (`DATABASE.md` §5.1.3)."""
    await _insert_profile(engine)

    body = (await client.get("/api/content")).json()

    assert body["seo"]["sameAs"] == [
        VALID_SOCIAL["github"],
        VALID_SOCIAL["linkedin"],
    ]


async def test_optional_project_fields_are_null_not_absent(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """A null column is `null` in the payload; the key never disappears.

    The build asserts these keys exist, so dropping one would fail at build time
    rather than degrade quietly.
    """
    await _insert_profile(engine)
    await _insert_project(engine)

    project = (await client.get("/api/content")).json()["projects"][0]

    assert project["live"] is None
    assert project["github"] is None
    assert project["category"] is None
    assert project["longDescription"] is None
    assert "live" in project and "github" in project


async def test_tech_stack_array_is_returned_as_a_list(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    await _insert_profile(engine)
    await _insert_project(engine, tech_stack=["React", "Node.js"])

    project = (await client.get("/api/content")).json()["projects"][0]

    assert project["techStack"] == ["React", "Node.js"]


async def test_highlights_are_recovered_from_the_long_description(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """`highlights` has no column; it is derived (`DATABASE.md` §11.3)."""
    await _insert_profile(engine)
    await _insert_project(
        engine,
        long_description="A RAG chatbot.\n- Streaming via SSE\n- Multi-tenant\n",
    )

    project = (await client.get("/api/content")).json()["projects"][0]

    assert project["highlights"] == ["A RAG chatbot.", "Streaming via SSE", "Multi-tenant"]


async def test_unexpected_jsonb_key_is_rejected_rather_than_exposed(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """`extra="forbid"` turns a stray jsonb key into a failure, not a new field.

    Without this, a typo in the seed or a future column would silently widen the
    public contract.
    """
    await _insert_profile(engine, seo={**VALID_SEO, "unexpectedKey": "leak"})

    response = await client.get("/api/content")

    assert response.status_code == 500
    assert "unexpectedKey" not in response.text
    assert "leak" not in response.text


# ---------------------------------------------------------------------------
# Filtering
# ---------------------------------------------------------------------------


async def test_published_project_is_returned(client: AsyncClient, engine: AsyncEngine) -> None:
    await _insert_profile(engine)
    await _insert_project(engine, slug="visible-project", status="published")

    projects = (await client.get("/api/content")).json()["projects"]

    assert [project["slug"] for project in projects] == ["visible-project"]


async def test_hidden_project_is_never_returned(client: AsyncClient, engine: AsyncEngine) -> None:
    await _insert_profile(engine)
    await _insert_project(engine, slug="secret-project", status="hidden")
    await _insert_project(engine, slug="public-project", status="published")

    projects = (await client.get("/api/content")).json()["projects"]

    assert [project["slug"] for project in projects] == ["public-project"]
    assert "secret-project" not in str(projects)


async def test_indexable_does_not_filter_the_project_list(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """`indexable` and `status` are different flags.

    A published project can be excluded from the sitemap and `llms.txt` while still
    appearing on the homepage. The build splits on the flag, so the API must return
    both kinds (`API.md` §5.1.1).
    """
    await _insert_profile(engine)
    await _insert_project(engine, slug="indexed-project", status="published", indexable=True)
    await _insert_project(engine, slug="noindex-project", status="published", indexable=False)

    projects = (await client.get("/api/content")).json()["projects"]

    assert {project["slug"] for project in projects} == {"indexed-project", "noindex-project"}
    indexed = {project["slug"]: project["indexable"] for project in projects}
    assert indexed["indexed-project"] is True
    assert indexed["noindex-project"] is False


# ---------------------------------------------------------------------------
# Ordering
# ---------------------------------------------------------------------------


async def test_projects_are_ordered_by_display_order(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    await _insert_profile(engine)
    await _insert_project(engine, slug="third-project", display_order=2)
    await _insert_project(engine, slug="first-project", display_order=0)
    await _insert_project(engine, slug="second-project", display_order=1)

    projects = (await client.get("/api/content")).json()["projects"]

    assert [project["slug"] for project in projects] == [
        "first-project",
        "second-project",
        "third-project",
    ]


async def test_projects_sharing_a_display_order_are_ordered_deterministically(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """Equal `display_order` must not produce an arbitrary order.

    Without a tie-breaker PostgreSQL may return rows in any order, which would make
    the ETag flap between identical requests.
    """
    await _insert_profile(engine)
    for slug in ("gamma", "alpha", "beta"):
        await _insert_project(engine, slug=slug, display_order=0)

    first = (await client.get("/api/content")).json()["projects"]
    second = (await client.get("/api/content")).json()["projects"]

    assert [project["slug"] for project in first] == ["alpha", "beta", "gamma"]
    assert first == second


async def test_skills_follow_category_then_skill_display_order(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    await _insert_profile(engine)
    await _insert_category(engine, "Backend", display_order=1)
    await _insert_category(engine, "Frontend", display_order=0)
    await _insert_skill(engine, "Backend", "Python", display_order=0)
    await _insert_skill(engine, "Frontend", "React", display_order=1)
    await _insert_skill(engine, "Frontend", "Bootstrap", display_order=0)

    skills = (await client.get("/api/content")).json()["skills"]

    assert [skill["name"] for skill in skills] == ["Bootstrap", "React", "Python"]
    assert [skill["category"]["name"] for skill in skills] == [
        "Frontend",
        "Frontend",
        "Backend",
    ]


async def test_hidden_skill_is_not_returned(client: AsyncClient, engine: AsyncEngine) -> None:
    await _insert_profile(engine)
    await _insert_category(engine, "Frontend")
    await _insert_skill(engine, "Frontend", "React", is_visible=True)
    await _insert_skill(engine, "Frontend", "Deprecated", is_visible=False)

    skills = (await client.get("/api/content")).json()["skills"]

    assert [skill["name"] for skill in skills] == ["React"]


async def test_hidden_category_hides_its_skills(client: AsyncClient, engine: AsyncEngine) -> None:
    """A visible skill inside an invisible category has nowhere to be shown."""
    await _insert_profile(engine)
    await _insert_category(engine, "Frontend", display_order=0)
    await _insert_category(engine, "Retired", display_order=1, is_visible=False)
    await _insert_skill(engine, "Frontend", "React")
    await _insert_skill(engine, "Retired", "Angular")

    skills = (await client.get("/api/content")).json()["skills"]

    assert [skill["name"] for skill in skills] == ["React"]


async def test_certifications_are_ordered_by_display_order(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    await _insert_profile(engine)
    await _insert_certification(engine, "Third", display_order=2)
    await _insert_certification(engine, "First", display_order=0)
    await _insert_certification(engine, "Second", display_order=1)

    certifications = (await client.get("/api/content")).json()["certifications"]

    assert [item["title"] for item in certifications] == ["First", "Second", "Third"]


async def test_certifications_sharing_a_display_order_are_stable(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    await _insert_profile(engine)
    for title in ("Zeta", "Alpha"):
        await _insert_certification(engine, title, display_order=0)

    certifications = (await client.get("/api/content")).json()["certifications"]

    assert [item["title"] for item in certifications] == ["Alpha", "Zeta"]


# ---------------------------------------------------------------------------
# Administrative data must never appear
# ---------------------------------------------------------------------------


async def test_response_exposes_no_administrative_data(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """No admin table, credential or internal timestamp may appear in the payload.

    Rows are inserted into all three admin tables and a contact message so the
    assertion is made against data that genuinely exists, not against empty tables.
    """
    await _insert_profile(engine)
    await _insert_project(engine)
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "INSERT INTO admin_user (email, password_hash) "
                "VALUES ('owner@example.com', 'argon2id$really-a-hash')"
            )
        )
        await connection.execute(
            text(
                "INSERT INTO admin_session (user_id, token_hash, expires_at) "
                "SELECT id, 'sha256$really-a-token', now() + interval '1 day' FROM admin_user"
            )
        )
        await connection.execute(
            text(
                "INSERT INTO admin_audit_log (action, entity, entity_id) "
                "VALUES ('update', 'project', 'webchat-ai')"
            )
        )
        await connection.execute(
            text(
                "INSERT INTO contact_message (name, email, subject, message) "
                "VALUES ('Someone', 'someone@example.com', 'Hello there', 'A message body.')"
            )
        )

    response = await client.get("/api/content")
    body = response.text

    assert response.status_code == 200
    for leak in (
        "argon2id",
        "sha256$",
        "really-a-hash",
        "really-a-token",
        "password_hash",
        "token_hash",
        "admin_user",
        "admin_session",
        "admin_audit_log",
        "contact_message",
        "someone@example.com",
    ):
        assert leak not in body, f"{leak!r} leaked into the public payload"


async def test_response_exposes_no_row_ids_or_timestamps(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """`API.md` §5.1.3: no `id`, no `created_at`/`updated_at` on public entities."""
    await _seed_complete(engine)

    body = (await client.get("/api/content")).json()

    project = body["projects"][0]
    assert "id" not in project
    assert "created_at" not in project
    assert "updated_at" not in project
    assert "singleton" not in body["profile"]


# ---------------------------------------------------------------------------
# Read-only guarantee
# ---------------------------------------------------------------------------


async def test_serving_content_does_not_mutate_anything(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """A `GET` must leave every row exactly as it was."""
    await _seed_complete(engine)
    before = {
        table: await _count(engine, table)
        for table in ("site_profile", "project", "skill_category", "skill", "certification")
    }

    for _ in range(3):
        assert (await client.get("/api/content")).status_code == 200

    after = {
        table: await _count(engine, table)
        for table in ("site_profile", "project", "skill_category", "skill", "certification")
    }
    assert before == after


async def test_the_connection_refuses_writes_while_serving_content(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """Read-only is enforced by PostgreSQL, not merely by convention.

    The content statements set `postgresql_readonly`, so a write issued on that
    connection is rejected by the server. This is what stops a future edit from
    turning a `GET` into a mutation.
    """
    await _insert_profile(engine)
    assert (await client.get("/api/content")).status_code == 200

    async with engine.connect() as connection:
        await connection.execute(text("SET TRANSACTION READ ONLY"))
        with pytest.raises(Exception, match="read-only|read only"):
            await connection.execute(text("DELETE FROM site_profile"))


# ---------------------------------------------------------------------------
# Determinism and caching
# ---------------------------------------------------------------------------


async def test_identical_state_produces_identical_bytes(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """Same database state must mean the same response, byte for byte."""
    await _seed_complete(engine)

    first = await client.get("/api/content")
    second = await client.get("/api/content")

    assert first.content == second.content
    assert first.headers["etag"] == second.headers["etag"]


async def test_cache_headers_match_the_documented_contract(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    await _seed_complete(engine)

    response = await client.get("/api/content")

    assert response.headers["cache-control"] == "public, max-age=300, stale-while-revalidate=600"
    assert response.headers["etag"].startswith('"')


async def test_matching_if_none_match_returns_304_without_a_body(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """`API.md` §5.1.5 — a client holding the body must not re-download it."""
    await _seed_complete(engine)
    first = await client.get("/api/content")

    second = await client.get("/api/content", headers={"If-None-Match": first.headers["etag"]})

    assert second.status_code == 304
    assert second.content == b""


async def test_stale_if_none_match_returns_the_body(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    await _seed_complete(engine)

    response = await client.get(
        "/api/content", headers={"If-None-Match": '"an-older-representation"'}
    )

    assert response.status_code == 200
    assert response.json()["profile"]["name"] == "Ritu Raj"


async def test_wildcard_if_none_match_returns_304(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    await _seed_complete(engine)

    response = await client.get("/api/content", headers={"If-None-Match": "*"})

    assert response.status_code == 304


async def test_etag_changes_when_content_changes(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """A content edit must invalidate every client on the next request.

    There is no cache-purge step, so this is the only invalidation mechanism
    (`API.md` §5.1.5).
    """
    await _insert_profile(engine)
    await _insert_project(engine)
    before = await client.get("/api/content")

    async with engine.begin() as connection:
        await connection.execute(text("UPDATE project SET title = 'Renamed'"))
    after = await client.get("/api/content")

    assert before.headers["etag"] != after.headers["etag"]


async def test_generated_at_tracks_the_newest_row_not_just_the_profile(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """`meta.generated_at` must reflect the newest content, not the profile's clock.

    Reading only `site_profile.updated_at` would report a stale timestamp after any
    project, skill or certification edit. A reader — and any check that decides
    whether a cached payload is still current — would then be told the content is
    older than it is.
    """
    await _insert_profile(engine)
    await _insert_project(engine)

    before = (await client.get("/api/content")).json()["meta"]["generated_at"]

    async with engine.begin() as connection:
        await connection.execute(
            text(
                "UPDATE project SET updated_at = now() + interval '1 hour' "
                "WHERE slug = 'webchat-ai'"
            )
        )

    after = (await client.get("/api/content")).json()["meta"]["generated_at"]

    assert after > before


async def test_generated_at_is_the_newest_row_across_every_entity(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """Whichever entity changed most recently sets the value.

    Each table is pushed one hour further into the future in turn, so this fails if
    any single entity is left out of the maximum — including `skill_category`,
    whose name and icon are part of the payload.
    """
    await _seed_complete(engine)

    expected = datetime.now(UTC)
    for table, hours in (("project", 1), ("skill", 2), ("certification", 3)):
        expected = datetime.now(UTC) + timedelta(hours=hours)
        async with engine.begin() as connection:
            await connection.execute(
                text(f"UPDATE {table} SET updated_at = :stamp"),  # noqa: S608
                {"stamp": expected},
            )

        reported = _parse_generated_at((await client.get("/api/content")).json())

        assert abs((reported - expected).total_seconds()) < 1


async def test_generated_at_ignores_hidden_and_unpublished_rows(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """The timestamp covers the payload, not the database.

    An unpublished project or a hidden skill never appears in the response, so its
    `updated_at` must not move `generated_at`. Including them would make the value
    depend on data the caller cannot see.
    """
    await _insert_profile(engine)
    await _insert_project(engine)

    published = _parse_generated_at((await client.get("/api/content")).json())

    await _insert_project(
        engine, slug="hidden-project", title="Draft Project", status="hidden"
    )
    async with engine.begin() as connection:
        await connection.execute(
            text(
                "UPDATE project SET updated_at = now() + interval '5 hours' "
                "WHERE slug = 'hidden-project'"
            )
        )

    assert _parse_generated_at((await client.get("/api/content")).json()) == published


def _parse_generated_at(body: dict[str, Any]) -> datetime:
    return datetime.fromisoformat(body["meta"]["generated_at"].replace("Z", "+00:00"))


# ---------------------------------------------------------------------------
# Payload budget
# ---------------------------------------------------------------------------

# `MIGRATION.md` Phase 3: the payload must stay ≤ 60 KB gzipped for the current
# 5-project dataset. The budget exists so the endpoint cannot quietly become a
# bandwidth problem as content grows.
GZIP_BUDGET_BYTES = 60 * 1024

_REALISTIC_LONG_DESCRIPTION = "\n".join(
    f"Bullet point {index}: a sentence of roughly the length the real project "
    "descriptions use, so the size test measures representative payload weight "
    "rather than an artificially empty one."
    for index in range(1, 9)
)


async def test_payload_fits_the_gzipped_budget_at_current_scale(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """Five projects, full-length descriptions, as the real dataset has today."""
    await _insert_profile(engine)
    for index in range(1, 6):
        await _insert_project(
            engine,
            slug=f"project-{index}",
            title=f"Project {index}",
            long_description=_REALISTIC_LONG_DESCRIPTION,
        )

    response = await client.get("/api/content")

    assert response.status_code == 200
    raw = response.content
    compressed = gzip.compress(raw, compresslevel=9)
    assert len(compressed) < GZIP_BUDGET_BYTES, (
        f"{len(compressed)} B gzipped exceeds the {GZIP_BUDGET_BYTES} B budget"
    )


async def test_hidden_projects_do_not_inflate_the_payload(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """Unpublished rows must cost the response nothing at all.

    A filter applied after assembly would leave the work done and the bytes out;
    filtering in SQL means a hidden project is never read in the first place.
    """
    await _insert_profile(engine)
    await _insert_project(engine, slug="visible", title="Visible")
    await _insert_project(
        engine, slug="invisible", title="Invisible", status="hidden", long_description="x" * 5_000
    )

    body = (await client.get("/api/content")).json()

    assert [project["slug"] for project in body["projects"]] == ["visible"]


# ---------------------------------------------------------------------------
# Database failure
# ---------------------------------------------------------------------------


async def test_database_failure_returns_503_without_internals(
    isolated_client: tuple[AsyncClient, AsyncEngine], engine: AsyncEngine
) -> None:
    """An unreachable database must not become a stack trace.

    The response body is a single generic sentence; the driver, host and exception
    text stay in the log.
    """
    client, dead_engine = isolated_client
    await _seed_complete(engine)

    response = await client.get("/api/content")

    assert response.status_code == 503
    assert response.json() == {"detail": "Content is temporarily unavailable."}
    for leak in ("asyncpg", "Connection", "127.0.0.1", "Traceback", "SELECT", "portfolio"):
        assert leak not in response.text


async def test_health_still_answers_while_the_database_is_down(
    isolated_client: tuple[AsyncClient, AsyncEngine],
) -> None:
    """Liveness must not depend on the database, or a restart loop follows."""
    client, _dead_engine = isolated_client

    assert (await client.get("/health")).status_code == 200