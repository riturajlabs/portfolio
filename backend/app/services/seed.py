"""Content seed validation and database population service.

Extracted from db/seed.py so the validation and database upsert functions can be
safely reused by the one-time admin bootstrap endpoint and database seed CLI.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Certification, Project, SiteProfile, Skill, SkillCategory
from app.registry import ICON_KEYS
from app.schemas.admin_content import (
    IMAGE_PATTERN,
    SLUG_MAX_LENGTH,
    SLUG_PATTERN,
    validate_http_url,
)
from app.schemas.content import (
    About,
    Profile,
    Seo,
)
from app.schemas.content import (
    Certification as CertificationOut,
)
from app.schemas.content import (
    Project as ProjectOut,
)
from app.schemas.content import (
    Skill as SkillOut,
)

SEO_TITLE_MAX = 70
SEO_DESCRIPTION_MAX = 185
CATEGORY_MAX = 60
SKILL_NAME_MAX = 60

CONTENT_KEYS = ("profile", "about", "projects", "skills", "certifications", "seo")


class SeedError(Exception):
    """A validation or content problem — exit code 1."""


@dataclass
class SeedData:
    profile: Profile
    about: About
    projects: list[ProjectOut]
    skills: list[SkillOut]
    certifications: list[CertificationOut]
    seo: Seo
    omitted: list[str] = field(default_factory=list)


@dataclass
class Counts:
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0
    orphans: list[str] = field(default_factory=list)

    def line(self, name: str) -> str:
        orphan = f", orphans left untouched: {len(self.orphans)}" if self.orphans else ""
        return (
            f"{name}: inserted {self.inserted}, updated {self.updated}, "
            f"unchanged {self.unchanged}{orphan}"
        )


def _require_mapping(value: Any, where: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SeedError(f"{where}: expected an object, got {type(value).__name__}")
    return value


def _require_list(value: Any, where: str) -> list[Any]:
    if not isinstance(value, list):
        raise SeedError(f"{where}: expected an array, got {type(value).__name__}")
    return value


def _check_length(value: str, limit: int, where: str) -> None:
    if len(value) > limit:
        raise SeedError(f"{where}: longer than {limit} characters ({len(value)})")


def validate_snapshot(snapshot: Any) -> SeedData:
    root = _require_mapping(snapshot, "snapshot")
    missing = [key for key in CONTENT_KEYS if key not in root]
    if missing:
        raise SeedError(f"snapshot is missing {missing}")
    unexpected = [key for key in root if key not in (*CONTENT_KEYS, "_migration")]
    if unexpected:
        raise SeedError(
            f"snapshot has unexpected top-level keys {unexpected} — content with no "
            "entity must not be seeded (see docs/CONTENT_MAPPING.md)"
        )

    try:
        profile = Profile.model_validate(root["profile"])
        about = About.model_validate(root["about"])
        projects = [ProjectOut.model_validate(item) for item in _require_list(root["projects"], "projects")]
        skills = [SkillOut.model_validate(item) for item in _require_list(root["skills"], "skills")]
        certifications = [
            CertificationOut.model_validate(item)
            for item in _require_list(root["certifications"], "certifications")
        ]
        seo = Seo.model_validate(root["seo"])
    except Exception as exc:
        raise SeedError(f"pydantic validation failed: {exc}") from exc

    if profile.resume != "/Ritu_Raj_Full_Stack_Developer_Resume.pdf":
        raise SeedError(
            "profile.resume must be the tracked /Ritu_..._Resume.pdf path, "
            f"got {profile.resume!r}"
        )

    seen_slugs: set[str] = set()
    for project in projects:
        where = f"project {project.slug!r}"
        if len(project.slug) > SLUG_MAX_LENGTH or not SLUG_PATTERN.match(project.slug):
            raise SeedError(f"{where}: slug fails the DB CHECK {SLUG_PATTERN.pattern}")
        if project.slug in seen_slugs:
            raise SeedError(f"{where}: duplicate slug")
        seen_slugs.add(project.slug)
        if not IMAGE_PATTERN.match(project.image):
            raise SeedError(f"{where}: image fails the DB CHECK {IMAGE_PATTERN.pattern}")
        if project.image != f"/images/projects/{project.slug}.webp":
            raise SeedError(f"{where}: image does not match the slug-derived path")
        if project.image_width <= 0 or project.image_height <= 0:
            raise SeedError(f"{where}: image dimensions must be positive")
        if project.status not in ("published", "hidden"):
            raise SeedError(f"{where}: status must be published|hidden")
        if project.category is not None:
            _check_length(project.category, CATEGORY_MAX, f"{where}.category")
        _check_length(project.seoTitle, SEO_TITLE_MAX, f"{where}.seoTitle")
        _check_length(project.seoDescription, SEO_DESCRIPTION_MAX, f"{where}.seoDescription")
        if not project.seoTitle.strip() or not project.seoDescription.strip():
            raise SeedError(f"{where}: seoTitle/seoDescription must be non-empty")
        for label, url in (("live", project.live), ("github", project.github)):
            try:
                validate_http_url(url)
            except ValueError as exc:
                raise SeedError(f"{where}.{label}: {exc}") from exc

    category_meta: dict[str, tuple[str, int]] = {}
    seen_skills: set[tuple[str, str]] = set()
    for skill in skills:
        where = f"skill {skill.category.name!r}/{skill.name!r}"
        meta = (skill.category.icon_key, skill.category.display_order)
        if skill.category.name in category_meta and category_meta[skill.category.name] != meta:
            raise SeedError(f"{where}: category metadata is inconsistent across its skills")
        category_meta[skill.category.name] = meta
        if skill.name in seen_skills:
            raise SeedError(f"{where}: duplicate within category")
        seen_skills.add((skill.category.name, skill.name))
        _check_length(skill.name, SKILL_NAME_MAX, f"{where}.name")
        _check_length(skill.category.name, SKILL_NAME_MAX, f"{where}.category.name")
        for label, key in ((where, skill.icon_key), (f"{where}.category", skill.category.icon_key)):
            if key not in ICON_KEYS:
                raise SeedError(f"{label}: icon_key {key!r} is not in app.registry.ICON_KEYS")

    seen_certificates: set[tuple[str, str]] = set()
    for certificate in certifications:
        where = f"certification {certificate.title!r}"
        key = (certificate.title, certificate.issuer)
        if key in seen_certificates:
            raise SeedError(f"{where}: duplicate (title, issuer)")
        seen_certificates.add(key)
        try:
            validate_http_url(certificate.credential_url)
        except ValueError as exc:
            raise SeedError(f"{where}.credential_url: {exc}") from exc

    omitted: list[str] = []
    migration = root.get("_migration")
    if isinstance(migration, dict) and isinstance(migration.get("omitted"), list):
        omitted = [str(item) for item in migration["omitted"]]

    return SeedData(
        profile=profile,
        about=about,
        projects=projects,
        skills=skills,
        certifications=certifications,
        seo=seo,
        omitted=omitted,
    )


def _apply(row: Any, changes: dict[str, Any]) -> bool:
    """Write only the fields that actually differ. True if anything changed."""
    changed = False
    for column, value in changes.items():
        if getattr(row, column) != value:
            setattr(row, column, value)
            changed = True
    if changed:
        row.updated_at = datetime.now(UTC)
    return changed


async def seed_content(session: AsyncSession, data: SeedData) -> dict[str, Counts]:
    report: dict[str, Counts] = {
        name: Counts() for name in ("site_profile", "project", "skill_category", "skill", "certification")
    }

    # site_profile (singleton)
    profile_row = await session.scalar(select(SiteProfile))
    profile_changes = {
        "name": data.profile.name,
        "title": data.profile.title,
        "greeting": data.profile.greeting,
        "roles": list(data.profile.roles),
        "available_for_internship": data.profile.availableForInternship,
        "internship_text": data.profile.internshipText,
        "description": data.profile.description,
        "location": data.profile.location,
        "resume": data.profile.resume,
        "stats": [dict(stat) for stat in data.profile.stats],
        "social": dict(data.profile.social.model_dump()),
        "about": data.about.model_dump(),
        "seo": data.seo.model_dump(),
    }
    if profile_row is None:
        session.add(SiteProfile(singleton=True, **profile_changes))
        report["site_profile"].inserted += 1
    else:
        if _apply(profile_row, profile_changes):
            report["site_profile"].updated += 1
        else:
            report["site_profile"].unchanged += 1
    await session.flush()

    # project (upsert on slug)
    snapshot_slugs: set[str] = set()
    for project in data.projects:
        snapshot_slugs.add(project.slug)
        changes = {
            "title": project.title,
            "short_description": project.description,
            "long_description": project.longDescription,
            "image": project.image,
            "image_width": project.image_width,
            "image_height": project.image_height,
            "image_alt": project.imageAlt,
            "category": project.category,
            "tech_stack": list(project.techStack),
            "status": project.status,
            "featured": project.featured,
            "indexable": project.indexable,
            "display_order": project.display_order,
            "live_url": project.live,
            "github_url": project.github,
            "seo_title": project.seoTitle,
            "seo_description": project.seoDescription,
        }
        row = await session.scalar(select(Project).where(Project.slug == project.slug))
        if row is None:
            session.add(Project(slug=project.slug, **changes))
            report["project"].inserted += 1
        elif _apply(row, changes):
            report["project"].updated += 1
        else:
            report["project"].unchanged += 1
    await session.flush()

    orphans = await session.scalars(select(Project.slug).where(Project.slug.notin_(snapshot_slugs)))
    report["project"].orphans = sorted(orphans.all())

    # skill_category (upsert on name, first-seen order)
    snapshot_category_names: set[str] = set()
    categories: dict[str, SkillCategory] = {}
    ordered_names = list(dict.fromkeys(s.category.name for s in data.skills))
    for name in ordered_names:
        snapshot_category_names.add(name)
        icon_key = next(s.category.icon_key for s in data.skills if s.category.name == name)
        display_order = next(s.category.display_order for s in data.skills if s.category.name == name)
        changes = {"icon_key": icon_key, "display_order": display_order, "is_visible": True}
        row = await session.scalar(select(SkillCategory).where(SkillCategory.name == name))
        if row is None:
            row = SkillCategory(name=name, **changes)
            session.add(row)
            report["skill_category"].inserted += 1
        elif _apply(row, changes):
            report["skill_category"].updated += 1
        else:
            report["skill_category"].unchanged += 1
        await session.flush()
        categories[name] = row
    await session.flush()

    orphans = await session.scalars(
        select(SkillCategory.name).where(SkillCategory.name.notin_(snapshot_category_names))
    )
    report["skill_category"].orphans = sorted(orphans.all())

    # skill (upsert on (category_id, name))
    snapshot_skill_keys: set[tuple[str, str]] = set()
    for skill in data.skills:
        snapshot_skill_keys.add((skill.category.name, skill.name))
        category = categories[skill.category.name]
        changes = {
            "icon_key": skill.icon_key,
            "display_order": skill.display_order,
            "is_visible": True,
        }
        row = await session.scalar(
            select(Skill).where(Skill.category_id == category.id, Skill.name == skill.name)
        )
        if row is None:
            session.add(Skill(category_id=category.id, name=skill.name, **changes))
            report["skill"].inserted += 1
        elif _apply(row, changes):
            report["skill"].updated += 1
        else:
            report["skill"].unchanged += 1
    await session.flush()

    orphan_rows = await session.execute(
        select(Skill.name, SkillCategory.name).join(SkillCategory, Skill.category_id == SkillCategory.id)
    )
    report["skill"].orphans = sorted(
        f"{category}/{name}"
        for name, category in orphan_rows.all()
        if (category, name) not in snapshot_skill_keys
    )

    # certification (upsert on (title, issuer))
    snapshot_certificate_keys: set[tuple[str, str]] = set()
    for certificate in data.certifications:
        snapshot_certificate_keys.add((certificate.title, certificate.issuer))
        changes = {
            "icon": certificate.icon,
            "issued_on": certificate.issued_on,
            "credential_id": certificate.credential_id,
            "credential_url": certificate.credential_url,
            "display_order": certificate.display_order,
        }
        row = await session.scalar(
            select(Certification).where(
                Certification.title == certificate.title,
                Certification.issuer == certificate.issuer,
            )
        )
        if row is None:
            session.add(Certification(title=certificate.title, issuer=certificate.issuer, **changes))
            report["certification"].inserted += 1
        elif _apply(row, changes):
            report["certification"].updated += 1
        else:
            report["certification"].unchanged += 1
    await session.flush()

    orphan_rows = await session.execute(select(Certification.title, Certification.issuer))
    report["certification"].orphans = sorted(
        f"{title} ({issuer})"
        for title, issuer in orphan_rows.all()
        if (title, issuer) not in snapshot_certificate_keys
    )

    return report
