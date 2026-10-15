"""Content assembly for `GET /api/content`.

This is the only transformation layer between PostgreSQL and the public payload.
`DATABASE.md` §11.1 fixes that responsibility here: the frontend contains no
mapper, so component props keep working unchanged.

Shape of the work:

* **Four queries, always** — one per public entity: profile, projects, skills
  (joined to their categories), certifications. Not one per row; the ORM's lazy
  loading is never triggered because the selects name their columns explicitly
  rather than returning whole rows. Skills and their categories share a query, so
  there is no fifth round trip for categories.
* **Read-only at the database, not just in intention** — every statement carries
  `postgresql_readonly=True`, so PostgreSQL rejects a write on this connection.
  A future edit that adds an `INSERT` here fails at runtime instead of quietly
  mutating content behind a `GET`.
* **Columns are named, never `select(Model)`** — an administrative column added
  in a later migration cannot leak into the public payload by being selected, and
  `extra="forbid"` would turn that into a 500 rather than a silent exposure.
* **Ordering is total** — every `ORDER BY` ends in a unique column, so two rows
  sharing a `display_order` still come back in the same sequence on every call and
  on every server. Relying on PostgreSQL's unspecified order would make the ETag
  flap.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.logging import log_event
from app.models.certification import Certification
from app.models.project import Project
from app.models.site_profile import SiteProfile
from app.models.skill import Skill
from app.models.skill_category import SkillCategory
from app.schemas.content import Content

logger = logging.getLogger("app.content")

# PostgreSQL refuses any write on a connection in a read-only transaction, so
# this is a guarantee rather than a convention.
_READ_ONLY = {"postgresql_readonly": True}

# `ProjectCard.jsx` and `ProjectPage.jsx` render `project.highlights` as a bullet
# list. There is no `highlights` column (`DATABASE.md` §11.3), so the list is
# recovered from the long description, which is where those bullets live. These
# are the markers a description may use to introduce a bullet.
_BULLET_MARKERS = ("- ", "* ", "• ", "– ", "— ")


class ContentNotFoundError(Exception):
    """The singleton `site_profile` row is absent.

    Raised instead of returning a placeholder. A fabricated profile would let the
    site build with invented content, which is the exact failure the migration is
    meant to remove.
    """


def _read_only(statement: Select[Any]) -> Select[Any]:
    return statement.execution_options(**_READ_ONLY)


async def _fetch_one(session: AsyncSession, statement: Select[Any]) -> Any | None:
    result = await session.execute(_read_only(statement))
    return result.first()


async def _fetch_all(session: AsyncSession, statement: Select[Any]) -> list[Any]:
    result = await session.execute(_read_only(statement))
    return list(result.all())


def _highlights(long_description: str | None) -> list[str]:
    """Recover the bullet list from a long description.

    One string per line, with any leading bullet marker removed. An absent or
    single-paragraph description yields an empty list, which is a valid payload —
    `highlights` is never a reason to fail a response.
    """
    if not long_description:
        return []
    bullets: list[str] = []
    for line in long_description.splitlines():
        cleaned = line.strip()
        if not cleaned:
            continue
        for marker in _BULLET_MARKERS:
            if cleaned.startswith(marker):
                cleaned = cleaned[len(marker) :].strip()
                break
        if cleaned:
            bullets.append(cleaned)
    return bullets


def _same_as(social: dict[str, Any]) -> list[str]:
    """Derive `seo.sameAs` from `profile.social`.

    Stored once, derived once. A second stored copy of the same two URLs could
    drift from `social`, and the drift would surface as a wrong `sameAs` in the
    JSON-LD (`DATABASE.md` §5.1.3).
    """
    return [social[key] for key in ("github", "linkedin") if social.get(key)]


async def load_content(session: AsyncSession) -> Content:
    """Build the complete public payload from the database.

    Raises `ContentNotFoundError` when the singleton profile row is missing. Every
    other collection is legitimately empty in a fresh database and serialises as an
    empty list.
    """
    profile_row = await _fetch_one(
        session,
        select(
            SiteProfile.name,
            SiteProfile.title,
            SiteProfile.greeting,
            SiteProfile.roles,
            SiteProfile.available_for_internship,
            SiteProfile.internship_text,
            SiteProfile.description,
            SiteProfile.location,
            SiteProfile.resume,
            SiteProfile.stats,
            SiteProfile.social,
            SiteProfile.about,
            SiteProfile.seo,
            SiteProfile.updated_at,
        ),
    )
    if profile_row is None:
        raise ContentNotFoundError("site_profile has no row")

    project_rows = await _fetch_all(
        session,
        _published_projects(),
    )
    skill_rows = await _fetch_all(session, _visible_skills())
    certification_rows = await _fetch_all(session, _ordered_certifications())

    social = dict(profile_row.social or {})
    about = dict(profile_row.about or {})
    seo = dict(profile_row.seo or {})

    projects = [
        {
            "slug": row.slug,
            "title": row.title,
            # `short_description` keeps the key `description`: the frontend and the
            # build both already read `projects[].description` (`DATABASE.md` §11.2).
            "description": row.short_description,
            "longDescription": row.long_description,
            "image": row.image,
            "image_width": row.image_width,
            "image_height": row.image_height,
            "imageAlt": row.image_alt,
            "category": row.category,
            "techStack": list(row.tech_stack or []),
            "highlights": _highlights(row.long_description),
            "featured": row.featured,
            "indexable": row.indexable,
            "status": row.status,
            "display_order": row.display_order,
            "live": row.live_url,
            "github": row.github_url,
            "seoTitle": row.seo_title,
            "seoDescription": row.seo_description,
        }
        for row in project_rows
    ]

    # `skills` is a flat list with the category nested on each skill, matching
    # `skills.js`. The frontend groups by `category.name`, so the category travels
    # with the skill rather than in a separate collection.
    skills = [
        {
            "name": row.name,
            "icon_key": row.icon_key,
            "display_order": row.display_order,
            "category": {
                "name": row.category_name,
                "icon_key": row.category_icon_key,
                "display_order": row.category_display_order,
            },
        }
        for row in skill_rows
    ]

    certifications = [
        {
            "title": row.title,
            "issuer": row.issuer,
            "icon": row.icon,
            "issued_on": row.issued_on,
            "credential_id": row.credential_id,
            "credential_url": row.credential_url,
            "display_order": row.display_order,
        }
        for row in certification_rows
    ]

    payload = {
        "profile": {
            "name": profile_row.name,
            "title": profile_row.title,
            "greeting": profile_row.greeting,
            "roles": list(profile_row.roles or []),
            "availableForInternship": profile_row.available_for_internship,
            "internshipText": profile_row.internship_text,
            "description": profile_row.description,
            "location": profile_row.location,
            "resume": profile_row.resume,
            "stats": list(profile_row.stats or []),
            "social": social,
        },
        "about": about,
        "projects": projects,
        "skills": skills,
        "certifications": certifications,
        "seo": {**seo, "sameAs": _same_as(social)},
        "meta": {
            # The newest row behind this payload. Empty collections contribute
            # nothing, so an empty database still reports the profile's own
            # timestamp rather than an arbitrary epoch.
            "generated_at": _generated_at(
                profile_row.updated_at,
                *(row.updated_at for row in project_rows),
                *(row.skill_updated_at for row in skill_rows),
                *(row.category_updated_at for row in skill_rows),
                *(row.updated_at for row in certification_rows),
            ),
            "version": 1,
        },
    }

    log_event(
        logger,
        logging.DEBUG,
        "content_loaded",
        projects=len(projects),
        skills=len(skills),
        certifications=len(certifications),
    )
    return Content.model_validate(payload)


def _generated_at(*timestamps: datetime) -> datetime:
    """The payload's `meta.generated_at`: the newest row this payload was built from.

    Every entity in the response carries an `updated_at`, so the newest of them is
    the last moment anything in this payload could have changed. Reading only the
    profile's timestamp would leave the value stale after any project, skill or
    certification edit, and a stale value is worse than no value: it tells a reader
    — and the cache-revalidation check in `docs/API.md` §8 — that content is older
    than it is.

    The request time is deliberately not used. It would change the response bytes on
    every call and defeat the `ETag`.
    """
    return max(timestamps)


def _published_projects() -> Select[Any]:
    """Published projects, in display order.

    `status` is the visibility gate and the only one. `indexable` is *not* a
    filter here: it excludes a project from `sitemap.xml` and `llms.txt` while
    keeping it on the homepage, so the build needs to see both kinds and split on
    the flag (`API.md` §5.1.1). Filtering on it would make those outputs impossible
    and would confuse the two meanings.

    `slug` breaks ties. It is UNIQUE, so the ordering is total and repeatable.
    """
    return (
        select(
            Project.slug,
            Project.title,
            Project.short_description,
            Project.long_description,
            Project.image,
            Project.image_width,
            Project.image_height,
            Project.image_alt,
            Project.category,
            Project.tech_stack,
            Project.status,
            Project.featured,
            Project.indexable,
            Project.display_order,
            Project.live_url,
            Project.github_url,
            Project.seo_title,
            Project.seo_description,
            # Selected for `meta.generated_at` only. `API.md` §5.1.3 keeps
            # `updated_at` out of the public payload, so it is read here and
            # deliberately not copied into the project dict.
            Project.updated_at,
        )
        .where(Project.status == "published")
        .order_by(Project.display_order, Project.slug)
    )


def _visible_skills() -> Select[Any]:
    """Visible skills, ordered by category then by position within the category.

    The category is joined rather than fetched separately so a skill never costs
    an extra query. A hidden *category* hides its skills as well: the category is
    what a visitor sees, so a visible skill inside an invisible category would
    have nowhere to be displayed.

    The tie-breaker chain ends at `id`, which is unique, so the sequence is total.
    """
    return (
        select(
            Skill.name,
            Skill.icon_key,
            Skill.display_order,
            SkillCategory.name.label("category_name"),
            SkillCategory.icon_key.label("category_icon_key"),
            SkillCategory.display_order.label("category_display_order"),
            # Both timestamps feed `meta.generated_at`; neither is public.
            Skill.updated_at.label("skill_updated_at"),
            SkillCategory.updated_at.label("category_updated_at"),
        )
        .join(SkillCategory, Skill.category_id == SkillCategory.id)
        .where(Skill.is_visible.is_(True), SkillCategory.is_visible.is_(True))
        .order_by(
            SkillCategory.display_order,
            SkillCategory.id,
            Skill.display_order,
            Skill.name,
            Skill.id,
        )
    )


def _ordered_certifications() -> Select[Any]:
    """Every certification, in display order.

    `certification` has no visibility column: all three are public facts, and the
    homepage shows all of them. `title` and `id` break ties so the order is total.
    """
    return (
        select(
            Certification.title,
            Certification.issuer,
            Certification.icon,
            Certification.issued_on,
            Certification.credential_id,
            Certification.credential_url,
            # For `meta.generated_at`; not a public field.
            Certification.updated_at,
            Certification.display_order,
        )
        .order_by(Certification.display_order, Certification.title, Certification.id)
    )


__all__ = ["ContentNotFoundError", "load_content"]