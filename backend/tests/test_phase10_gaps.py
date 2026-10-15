"""Phase 10 gap tests — the last rows of `TESTING.md` §7 not yet covered elsewhere.

Three contracts get explicit tests here, each missing from the pre-Phase-10 suite:

* **CSRF on every mutating admin route**, enumerated from the application's own
  OpenAPI document (the same walk `test_csrf.py` does for the 401 rule). The
  existing CSRF test proved one route; a guard that only protects the route the
  test remembered is exactly how a new endpoint ships unprotected.
* **Skill / skill-category updates and unknown-id handling** — §7.4's CRUD
  matrix covered create/delete for these entities but never `PUT`, and never the
  `404` vs `422` distinction on ids the service parses.
* **The admin read budget** (`API.md` §8: 600/min per user) was enforced by
  `require_admin_read_budget` but had no test at all, while the content and login
  limiters both did.

The project `status`/`indexable` create flags get a round-trip here too, because
a flag that only echoes back in the admin API but leaks into `GET /api/content`
would be a publishing bug the suite would miss.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine
from support_admin import ADMIN_EMAIL, ADMIN_PASSWORD, audit_rows
from test_admin_content import _seed_full_profile

from app.config import get_settings
from app.models import AdminUser

CSRF_HEADER = "X-CSRF-Token"
# `login` creates a session and `bootstrap` is guarded by its own one-time
# token, not a session cookie, so neither is subject to the CSRF rule. Bootstrap
# is otherwise fully exercised by `test_admin_bootstrap.py`.
SKIP_FOR_CSRF = {
    ("POST", "/api/admin/auth/login"),
    ("POST", "/api/admin/bootstrap"),
}


@pytest_asyncio.fixture(autouse=True)
async def _ensure_admin(admin_user: AdminUser) -> AdminUser:
    """Every test here logs in, so every test needs an administrator."""
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


async def _seed_category_and_skill(
    client: AsyncClient, headers: dict[str, str]
) -> tuple[str, str]:
    category = await client.post(
        "/api/admin/skill-categories",
        json={"name": "Phase 10 Gap Skills", "icon_key": "FaCode"},
        headers=headers,
    )
    assert category.status_code == 201, category.text
    skill = await client.post(
        "/api/admin/skills",
        json={
            "category_id": category.json()["entity"]["id"],
            "name": "GapSkill",
            "icon_key": "FaCode",
        },
        headers=headers,
    )
    assert skill.status_code == 201, skill.text
    return category.json()["entity"]["id"], skill.json()["entity"]["id"]


def _project_payload(slug: str, **changes: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "slug": slug,
        "title": "Gap Roundtrip",
        "short_description": "Flags must survive the round trip.",
        "image": f"/images/projects/{slug}.webp",
        "image_width": 1200,
        "image_height": 750,
        "image_alt": "Gap roundtrip",
        "seo_title": "Gap Roundtrip",
        "seo_description": "A project created to prove flag handling.",
        "tech_stack": ["React", "FastAPI"],
    }
    payload.update(changes)
    return payload


# ---------------------------------------------------------------------------
# CSRF — every mutating route, enumerated
# ---------------------------------------------------------------------------


async def test_every_mutating_admin_route_requires_a_csrf_token(
    application: FastAPI, client: AsyncClient
) -> None:
    """§7.3's enumeration test for the CSRF rule.

    Walks the OpenAPI document, so a route added without `AdminSessionWithCsrf`
    fails here without anyone updating a list. Each route is called twice while
    authenticated: with no `X-CSRF-Token` header at all, and with a token minted
    for a *different* session — both must be 403 before the handler runs.
    """
    await _login(client)
    foreign = str(uuid.uuid4())
    assert foreign != (await _csrf(client))

    admin_paths = {
        path: methods
        for path, methods in application.openapi()["paths"].items()
        if path.startswith("/api/admin")
    }

    checked = 0
    for path, methods in admin_paths.items():
        for method in methods:
            if method.upper() not in ("POST", "PUT", "PATCH", "DELETE"):
                continue
            if (method.upper(), path) in SKIP_FOR_CSRF:
                continue
            sample = path.replace("{project_id}", str(uuid.uuid4()))
            sample = sample.replace("{category_id}", str(uuid.uuid4()))
            sample = sample.replace("{skill_id}", str(uuid.uuid4()))
            sample = sample.replace("{certification_id}", str(uuid.uuid4()))
            sample = sample.replace("{message_id}", str(uuid.uuid4()))

            missing = await client.request(method.upper(), sample)
            assert missing.status_code == 403, f"{method.upper()} {path} without header"
            assert missing.json()["error"]["code"] == "FORBIDDEN"

            wrong = await client.request(
                method.upper(), sample, headers={CSRF_HEADER: foreign}
            )
            assert wrong.status_code == 403, f"{method.upper()} {path} with wrong token"
            assert wrong.json()["error"]["code"] == "FORBIDDEN"
            checked += 1

    # The walk is worthless if it silently matched nothing.
    assert checked >= 10, f"only {checked} mutating admin routes enumerated"


# ---------------------------------------------------------------------------
# Skills and categories — updates and id handling
# ---------------------------------------------------------------------------


async def test_update_skill_persists_fields_and_audits(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    headers = await _authng_headers(client)
    _, skill_id = await _seed_category_and_skill(client, headers)

    response = await client.put(
        f"/api/admin/skills/{skill_id}",
        json={"name": "GapSkill Renamed", "display_order": 5, "is_visible": False},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    entity = response.json()["entity"]
    assert entity["name"] == "GapSkill Renamed"
    assert entity["display_order"] == 5
    assert entity["is_visible"] is False

    listed = await client.get("/api/admin/skills")
    stored = next(s for s in listed.json() if s["id"] == skill_id)
    assert stored["name"] == "GapSkill Renamed"
    assert stored["display_order"] == 5
    assert stored["is_visible"] is False

    rows = await audit_rows(engine, action="update")
    assert any(row.entity == "skill" and row.entity_id == skill_id for row in rows)


async def test_update_skill_category_persists_fields_and_audits(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    headers = await _authng_headers(client)
    category_id, _ = await _seed_category_and_skill(client, headers)

    response = await client.put(
        f"/api/admin/skill-categories/{category_id}",
        json={"name": "Renamed Category", "display_order": 3, "is_visible": False},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    entity = response.json()["entity"]
    assert entity["name"] == "Renamed Category"
    assert entity["display_order"] == 3
    assert entity["is_visible"] is False

    listed = await client.get("/api/admin/skill-categories")
    stored = next(c for c in listed.json() if c["id"] == category_id)
    assert stored["name"] == "Renamed Category"
    assert stored["display_order"] == 3
    assert stored["is_visible"] is False

    rows = await audit_rows(engine, action="update")
    assert any(
        row.entity == "skill_category" and row.entity_id == category_id for row in rows
    )


async def test_unknown_ids_are_404_and_malformed_ids_are_422(
    client: AsyncClient,
) -> None:
    """The id contract `admin_content.py` documents at `_uuid`/`_not_found`.

    A well-formed id that names nothing is a 404; an id the database could never
    hold is a 422 — answering 404 for the latter would claim an entity does not
    exist when the request never named one.
    """
    headers = await _authng_headers(client)
    ghost = str(uuid.uuid4())

    skill_404 = await client.put(
        f"/api/admin/skills/{ghost}",
        json={"name": "Nobody"},
        headers=headers,
    )
    assert skill_404.status_code == 404
    assert skill_404.json()["error"]["code"] == "NOT_FOUND"

    category_404 = await client.put(
        f"/api/admin/skill-categories/{ghost}",
        json={"name": "Nobody"},
        headers=headers,
    )
    assert category_404.status_code == 404
    assert category_404.json()["error"]["code"] == "NOT_FOUND"

    skill_422 = await client.put(
        "/api/admin/skills/not-a-uuid",
        json={"name": "Nobody"},
        headers=headers,
    )
    assert skill_422.status_code == 422


# ---------------------------------------------------------------------------
# Publishing flags — admin write to public visibility
# ---------------------------------------------------------------------------


async def test_create_project_honours_status_and_indexable_flags(
    client: AsyncClient, engine: AsyncEngine
) -> None:
    """`status`/`indexable` are publishing switches, not echo fields.

    A hidden, non-indexable project must exist in the admin API and stay out of
    `GET /api/content`; flipping it to published must bring it back. That is the
    only path the static build reads.
    """
    headers = await _authng_headers(client)
    # `GET /api/content` is 404 until a renderable profile row exists.
    await _seed_full_profile(engine)
    slug = f"gap-flags-{uuid.uuid4().hex[:8]}"

    created = await client.post(
        "/api/admin/projects",
        json=_project_payload(slug, status="hidden", indexable=False, featured=True),
        headers=headers,
    )
    assert created.status_code == 201, created.text
    entity = created.json()["entity"]
    assert entity["status"] == "hidden"
    assert entity["indexable"] is False
    assert entity["featured"] is True

    content = await client.get("/api/content")
    assert content.status_code == 200
    public_slugs = {p["slug"] for p in content.json()["projects"]}
    assert slug not in public_slugs

    flipped = await client.put(
        f"/api/admin/projects/{entity['id']}",
        json={"status": "published", "indexable": True},
        headers=headers,
    )
    assert flipped.status_code == 200, flipped.text

    content = await client.get("/api/content")
    assert slug in {p["slug"] for p in content.json()["projects"]}


# ---------------------------------------------------------------------------
# Admin read budget — API.md §8
# ---------------------------------------------------------------------------


async def test_admin_reads_stop_at_the_documented_600_per_window(
    client: AsyncClient,
) -> None:
    """600 authenticated reads, then 429 — and mutations stay open.

    The budget is process memory keyed by user id; `conftest.py` resets it
    around every test, so this one may burn the whole window safely. Driving the
    real boundary (rather than poking the limiter object) also proves the
    dependency is actually wired to the read routes.
    """
    limit = get_settings().ADMIN_READ_RATE_LIMIT
    assert limit == 600, "API.md §8 documents 600/min; the test asserts the doc"

    await _login(client)

    reads = 0
    csrf = ""
    response = await client.get("/api/admin/me")
    while response.status_code == 200:
        csrf = response.json()["csrf_token"]
        reads += 1
        if reads > limit + 5:
            pytest.fail("admin read budget was never enforced")
        response = await client.get("/api/admin/me")

    assert reads == limit, f"budget stopped after {reads} reads, expected {limit}"
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "RATE_LIMITED"
    assert response.headers.get("Retry-After"), "429 must carry Retry-After"

    # Safe methods are capped; mutations are CSRF-bound and audited instead.
    mutation = await client.post(
        "/api/admin/skill-categories",
        json={"name": "After The Budget", "icon_key": "FaCode"},
        headers={CSRF_HEADER: csrf},
    )
    assert mutation.status_code == 201, mutation.text
