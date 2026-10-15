"""Admin content CRUD — writes, audit rows, and the conflict rules.

One rule drives the shape of everything here: **every mutation writes exactly one
`admin_audit_log` row in the same transaction as the change** (`API.md` §6.4).
Audit rows are never deleted and are the only record of who changed what now that
content lives in a database instead of in git, so a change that commits without
its audit row is a silent loss of history. Each helper therefore does:

    mutate → flush → audit → commit

and nothing commits before the audit insert has succeeded.

**No entity in this module carries a password or a session token**, so the JSON
written to `before` / `after` is the serialized row itself. The invariant is
asserted in `tests/test_admin_content.py` rather than trusted.

Deletion rules come from `API.md` §6.4: `project` is soft (row survives, removed
from the site), everything else here is hard, and `contact_message` is never
deleted at all.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import (
    NOT_FOUND,
    VALIDATION_ERROR,
    APIError,
    ErrorField,
)
from app.models import (
    AdminAuditLog,
    Certification,
    ContactMessage,
    Project,
    SiteProfile,
    Skill,
    SkillCategory,
)
from app.schemas.admin_content import (
    CertificationCreateIn,
    CertificationUpdateIn,
    MessageUpdateIn,
    ProfileUpdateIn,
    ProjectCreateIn,
    ProjectUpdateIn,
    SkillCategoryCreateIn,
    SkillCategoryUpdateIn,
    SkillCreateIn,
    SkillUpdateIn,
)
from app.services.slugs import slugify, suffixed_slug

ACTION_CREATE = "create"
ACTION_UPDATE = "update"
ACTION_DELETE = "delete"
ACTION_PUBLISH = "publish"

ENTITY_PROJECT = "project"
ENTITY_SKILL_CATEGORY = "skill_category"
ENTITY_SKILL = "skill"
ENTITY_CERTIFICATION = "certification"
ENTITY_SITE_PROFILE = "site_profile"
ENTITY_CONTACT_MESSAGE = "contact_message"
ENTITY_DEPLOYMENT = "deployment"
ENTITY_UPLOAD = "upload"

ENTITY_NAMES = (
    ENTITY_PROJECT,
    ENTITY_SKILL_CATEGORY,
    ENTITY_SKILL,
    ENTITY_CERTIFICATION,
    ENTITY_SITE_PROFILE,
    ENTITY_CONTACT_MESSAGE,
    ENTITY_DEPLOYMENT,
    ENTITY_UPLOAD,
)

# The stable id used for the single deployment-publish audit subject. There is
# exactly one deploy hook, so the id is a constant rather than a row id.
DEPLOYMENT_ENTITY_ID = "vercel-deploy-hook"

# Phase 11 — the public route the profile stores once a resume has been uploaded.
# It is a root-relative path (not a bucket URL) so the public components and the
# static build treat it like the in-repo `/Ritu_Raj_..._Resume.pdf` they already
# handle, and the private object is only ever reached through the API.
RESUME_PUBLIC_PATH = "/api/resume"

# Fallback slug base when a title reduces to no slug-safe characters (for
# example a title of "!!!"). Chosen to be a valid slug so the insert cannot fail
# the `slug_format` CHECK.
_FALLBACK_SLUG_BASE = "project"

# `API.md` §6.5's 409 codes. `SLUG_TAKEN` is the fourth and is documented in
# §7.2 as of Phase 5: `TESTING.md` §7.4 fixes "duplicate slug" as `409`, and the
# code list had no entry for it.
SLUG_IMMUTABLE = "SLUG_IMMUTABLE"
SLUG_TAKEN = "SLUG_TAKEN"
STALE_WRITE = "STALE_WRITE"

SLUG_IMMUTABLE_MESSAGE = "Slug cannot change once a project is published."
SLUG_TAKEN_MESSAGE = "That slug is already in use."
STALE_WRITE_MESSAGE = "This project was changed elsewhere. Reload and retry."
CATEGORY_NOT_EMPTY_MESSAGE = (
    "This category still has skills. Repeat with ?cascade=true to delete them too."
)
CERTIFICATION_DUPLICATE_MESSAGE = "That certification already exists."


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _jsonable(value: Any) -> Any:
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value


def _dump(model: Any) -> dict[str, Any]:
    """Serialize a row for `before` / `after`.

    Only named columns are read, so a future column with a secret in it cannot
    reach the audit table through a later edit to this helper.
    """
    return {column.name: _jsonable(getattr(model, column.name)) for column in model.__table__.columns}


@dataclass(frozen=True, slots=True)
class Mutation:
    """A committed change and the audit row that certifies it."""

    entity: dict[str, Any]
    audit_id: str


async def _audit(
    db: AsyncSession,
    *,
    actor_user_id: uuid.UUID,
    action: str,
    entity: str,
    entity_id: str,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
) -> str:
    row = AdminAuditLog(
        actor_user_id=actor_user_id,
        action=action,
        entity=entity,
        entity_id=entity_id,
        before=before,
        after=after,
    )
    db.add(row)
    await db.flush()
    return str(row.id)


def _not_found(entity: str) -> APIError:
    return APIError(
        status_code=404,
        code=NOT_FOUND,
        message="Not found.",
        event="admin_entity_not_found",
        log_fields={"entity": entity},
    )


def _conflict(code: str, message: str, **fields: object) -> APIError:
    return APIError(
        status_code=409,
        code=code,
        message=message,
        event="admin_conflict",
        log_fields={"conflict": code, **fields},
    )


def _invalid(field: str, message: str) -> APIError:
    return APIError(
        status_code=422,
        code=VALIDATION_ERROR,
        message="Request validation failed.",
        event="admin_validation_failed",
        fields=[ErrorField(field=field, message=message)],
    )


def _is_violation(exc: IntegrityError, constraint_hint: str) -> bool:
    return constraint_hint in str(exc.orig)


async def record_upload(
    db: AsyncSession,
    *,
    actor_user_id: uuid.UUID,
    key: str,
    url: str,
    width: int,
    height: int,
    content_type: str,
    size: int,
) -> Mutation:
    """Audit an object-storage upload and commit it.

    An upload is not a change to a content row — the image only becomes content
    when the project is saved, which audits again — but it does write to storage
    and it is the action that decides *which bytes* a future build will fetch, so
    it is recorded here rather than left invisible. `entity_id` is the object key,
    which is unique and is what support would need to find the object.

    `before` is `None` (the key is fresh) and `after` holds only non-secret facts:
    the key, the public URL, the measured dimensions, the content type and the
    byte count. No credentials are ever part of this record.
    """
    after: dict[str, Any] = {
        "key": key,
        "url": url,
        "width": width,
        "height": height,
        "content_type": content_type,
        "bytes": size,
    }
    audit_id = await _audit(
        db,
        actor_user_id=actor_user_id,
        action=ACTION_CREATE,
        entity=ENTITY_UPLOAD,
        entity_id=key,
        before=None,
        after=after,
    )
    await db.commit()
    return Mutation(entity=after, audit_id=audit_id)


# --------------------------------------------------------------------------
# Projects
# --------------------------------------------------------------------------


async def _load_project(db: AsyncSession, project_id: str) -> Project:
    row = await db.get(Project, _uuid(project_id, ENTITY_PROJECT))
    if row is None:
        raise _not_found(ENTITY_PROJECT)
    return row


def _uuid(raw: str, entity: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except (ValueError, AttributeError, TypeError):
        # A malformed id is a request-shape problem, so it is 422 and not 404:
        # a `404` would tell the client the entity does not exist when the client
        # never named one.
        raise _invalid("id", "Must be a valid id.") from None


async def list_projects(db: AsyncSession) -> list[Project]:
    rows = await db.scalars(
        select(Project).order_by(Project.display_order, Project.created_at)
    )
    return list(rows)


async def get_project(db: AsyncSession, project_id: str) -> Project:
    return await _load_project(db, project_id)


async def _unique_project_slug(db: AsyncSession, base: str) -> str:
    """Return `base`, or `base-2`, `base-3`, ... until it is unused.

    Only reached for *generated* slugs. An explicitly supplied slug that collides
    is still a `409` — silently changing a slug the caller chose would hide a
    real conflict, whereas a generated one has no author to surprise.
    """
    candidate = base
    suffix = 2
    while await db.scalar(select(Project.id).where(Project.slug == candidate)) is not None:
        candidate = suffixed_slug(base, suffix)
        suffix += 1
    return candidate


async def create_project(
    db: AsyncSession, payload: ProjectCreateIn, actor_user_id: uuid.UUID
) -> Mutation:
    data = payload.model_dump()

    if payload.slug:
        duplicate = await db.scalar(select(Project.id).where(Project.slug == payload.slug))
        if duplicate is not None:
            raise _conflict(SLUG_TAKEN, SLUG_TAKEN_MESSAGE, field="slug")
    else:
        # The admin does not author URLs: derive a stable, unique slug from the
        # title. `slugify` can return "" for a punctuation-only title, so fall
        # back to a fixed base before the uniqueness pass.
        data["slug"] = await _unique_project_slug(db, slugify(payload.title) or _FALLBACK_SLUG_BASE)

    row = Project(**data)
    db.add(row)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        if _is_violation(exc, "slug"):
            raise _conflict(SLUG_TAKEN, SLUG_TAKEN_MESSAGE, field="slug") from None
        raise _invalid("slug", "That slug is already in use.") from None

    audit_id = await _audit(
        db,
        actor_user_id=actor_user_id,
        action=ACTION_CREATE,
        entity=ENTITY_PROJECT,
        entity_id=str(row.id),
        before=None,
        after=_dump(row),
    )
    await db.commit()
    return Mutation(entity=_dump(row), audit_id=audit_id)


async def update_project(
    db: AsyncSession,
    project_id: str,
    payload: ProjectUpdateIn,
    actor_user_id: uuid.UUID,
    if_unmodified_since: datetime | None = None,
) -> Mutation:
    row = await _load_project(db, project_id)
    changes = payload.model_dump(exclude_unset=True)

    if if_unmodified_since is not None:
        stored = row.updated_at
        if stored.tzinfo is None:
            stored = stored.replace(tzinfo=UTC)
        # HTTP dates carry one-second resolution, so the comparison is made at
        # that resolution too. Without it, a row stamped `10:00:00.500` would look
        # newer than a header the client derived from that very same value.
        if stored.replace(microsecond=0) > if_unmodified_since:
            raise _conflict(STALE_WRITE, STALE_WRITE_MESSAGE)

    if "slug" in changes and changes["slug"] != row.slug and row.status == "published":
        raise _conflict(SLUG_IMMUTABLE, SLUG_IMMUTABLE_MESSAGE)

    if "slug" in changes and changes["slug"] != row.slug:
        taken = await db.scalar(
            select(Project.id).where(Project.slug == changes["slug"], Project.id != row.id)
        )
        if taken is not None:
            raise _conflict(SLUG_TAKEN, SLUG_TAKEN_MESSAGE, field="slug")

    before = _dump(row)
    for key, value in changes.items():
        setattr(row, key, value)
    row.updated_at = _utcnow()

    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        if _is_violation(exc, "slug"):
            raise _conflict(SLUG_TAKEN, SLUG_TAKEN_MESSAGE, field="slug") from None
        raise _invalid("slug", "That slug is already in use.") from None

    audit_id = await _audit(
        db,
        actor_user_id=actor_user_id,
        action=ACTION_UPDATE,
        entity=ENTITY_PROJECT,
        entity_id=str(row.id),
        before=before,
        after=_dump(row),
    )
    await db.commit()
    return Mutation(entity=_dump(row), audit_id=audit_id)


async def delete_project(
    db: AsyncSession, project_id: str, actor_user_id: uuid.UUID
) -> Mutation:
    """Soft delete: the row survives, the site stops showing it.

    `indexable` goes false in the same write so the next build drops the URL from
    `sitemap.xml` and the JSON-LD. Setting only `status` would leave a canonical
    URL in the sitemap pointing at a page the generator no longer emits.
    """
    row = await _load_project(db, project_id)
    before = _dump(row)
    row.status = "hidden"
    row.indexable = False
    row.updated_at = _utcnow()
    await db.flush()

    audit_id = await _audit(
        db,
        actor_user_id=actor_user_id,
        action=ACTION_DELETE,
        entity=ENTITY_PROJECT,
        entity_id=str(row.id),
        before=before,
        after=_dump(row),
    )
    await db.commit()
    return Mutation(entity=_dump(row), audit_id=audit_id)


# --------------------------------------------------------------------------
# Skill categories
# --------------------------------------------------------------------------


async def list_skill_categories(
    db: AsyncSession,
) -> list[tuple[SkillCategory, int]]:
    """Categories with their skill count.

    The count is a `LEFT JOIN` aggregate rather than a second query per row: the
    list screen renders it for every category, so N+1 would cost N round trips on
    a page that has no reason to be slow.
    """
    result = await db.execute(
        select(SkillCategory, func.count(Skill.id))
        .outerjoin(Skill, Skill.category_id == SkillCategory.id)
        .group_by(SkillCategory.id)
        .order_by(SkillCategory.display_order, SkillCategory.name)
    )
    return [(row, int(count)) for row, count in result.all()]


async def create_skill_category(
    db: AsyncSession, payload: SkillCategoryCreateIn, actor_user_id: uuid.UUID
) -> Mutation:
    duplicate = await db.scalar(select(SkillCategory.id).where(SkillCategory.name == payload.name))
    if duplicate is not None:
        raise _invalid("name", "That category name is already in use.")

    row = SkillCategory(**payload.model_dump())
    db.add(row)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise _invalid("name", "That category name is already in use.") from None

    audit_id = await _audit(
        db,
        actor_user_id=actor_user_id,
        action=ACTION_CREATE,
        entity=ENTITY_SKILL_CATEGORY,
        entity_id=str(row.id),
        before=None,
        after=_dump(row),
    )
    await db.commit()
    return Mutation(entity=_dump(row), audit_id=audit_id)


async def update_skill_category(
    db: AsyncSession,
    category_id: str,
    payload: SkillCategoryUpdateIn,
    actor_user_id: uuid.UUID,
) -> Mutation:
    row = await db.get(SkillCategory, _uuid(category_id, ENTITY_SKILL_CATEGORY))
    if row is None:
        raise _not_found(ENTITY_SKILL_CATEGORY)

    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes and changes["name"] != row.name:
        taken = await db.scalar(
            select(SkillCategory.id).where(
                SkillCategory.name == changes["name"], SkillCategory.id != row.id
            )
        )
        if taken is not None:
            raise _invalid("name", "That category name is already in use.")

    before = _dump(row)
    for key, value in changes.items():
        setattr(row, key, value)
    row.updated_at = _utcnow()
    await db.flush()

    audit_id = await _audit(
        db,
        actor_user_id=actor_user_id,
        action=ACTION_UPDATE,
        entity=ENTITY_SKILL_CATEGORY,
        entity_id=str(row.id),
        before=before,
        after=_dump(row),
    )
    await db.commit()
    return Mutation(entity=_dump(row), audit_id=audit_id)


async def delete_skill_category(
    db: AsyncSession, category_id: str, actor_user_id: uuid.UUID, cascade: bool
) -> Mutation:
    row = await db.get(SkillCategory, _uuid(category_id, ENTITY_SKILL_CATEGORY))
    if row is None:
        raise _not_found(ENTITY_SKILL_CATEGORY)

    child_count = int(
        await db.scalar(select(func.count(Skill.id)).where(Skill.category_id == row.id)) or 0
    )
    if child_count and not cascade:
        # 422 rather than 409: §7.2's code list has no conflict code for this
        # condition, and the request genuinely is not acceptable as written —
        # it is asking for a destructive cascade without authorising one.
        raise _invalid("cascade", CATEGORY_NOT_EMPTY_MESSAGE)

    before = _dump(row)
    entity_id = str(row.id)
    if child_count:
        await db.execute(delete(Skill).where(Skill.category_id == row.id))
    await db.delete(row)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise _invalid("cascade", CATEGORY_NOT_EMPTY_MESSAGE) from exc

    audit_id = await _audit(
        db,
        actor_user_id=actor_user_id,
        action=ACTION_DELETE,
        entity=ENTITY_SKILL_CATEGORY,
        entity_id=entity_id,
        before=before,
        after=None,
    )
    await db.commit()
    return Mutation(entity=before, audit_id=audit_id)


# --------------------------------------------------------------------------
# Skills
# --------------------------------------------------------------------------


async def list_skills(db: AsyncSession) -> list[Skill]:
    rows = await db.scalars(
        select(Skill)
        .join(SkillCategory, Skill.category_id == SkillCategory.id)
        .order_by(
            SkillCategory.display_order, Skill.display_order, Skill.name
        )
    )
    return list(rows)


async def _require_category(db: AsyncSession, category_id: str) -> uuid.UUID:
    """Return the validated category id, or 404 if no such category exists."""
    parsed = _uuid(category_id, ENTITY_SKILL_CATEGORY)
    if await db.get(SkillCategory, parsed) is None:
        raise _not_found(ENTITY_SKILL_CATEGORY)
    return parsed


async def create_skill(
    db: AsyncSession, payload: SkillCreateIn, actor_user_id: uuid.UUID
) -> Mutation:
    category_uuid = await _require_category(db, payload.category_id)

    duplicate = await db.scalar(
        select(Skill.id).where(
            Skill.category_id == category_uuid, Skill.name == payload.name
        )
    )
    if duplicate is not None:
        raise _invalid("name", "That skill already exists in this category.")

    row = Skill(category_id=category_uuid, **payload.model_dump(exclude={"category_id"}))
    db.add(row)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise _invalid("name", "That skill already exists in this category.") from None

    audit_id = await _audit(
        db,
        actor_user_id=actor_user_id,
        action=ACTION_CREATE,
        entity=ENTITY_SKILL,
        entity_id=str(row.id),
        before=None,
        after=_dump(row),
    )
    await db.commit()
    return Mutation(entity=_dump(row), audit_id=audit_id)


async def update_skill(
    db: AsyncSession, skill_id: str, payload: SkillUpdateIn, actor_user_id: uuid.UUID
) -> Mutation:
    row = await db.get(Skill, _uuid(skill_id, ENTITY_SKILL))
    if row is None:
        raise _not_found(ENTITY_SKILL)

    changes = payload.model_dump(exclude_unset=True)
    if "category_id" in changes:
        changes["category_id"] = await _require_category(db, str(changes["category_id"]))

    if "name" in changes or "category_id" in changes:
        target_category = changes.get("category_id", row.category_id)
        target_name = changes.get("name", row.name)
        taken = await db.scalar(
            select(Skill.id).where(
                Skill.category_id == target_category,
                Skill.name == target_name,
                Skill.id != row.id,
            )
        )
        if taken is not None:
            raise _invalid("name", "That skill already exists in this category.")

    before = _dump(row)
    for key, value in changes.items():
        setattr(row, key, value)
    row.updated_at = _utcnow()
    await db.flush()

    audit_id = await _audit(
        db,
        actor_user_id=actor_user_id,
        action=ACTION_UPDATE,
        entity=ENTITY_SKILL,
        entity_id=str(row.id),
        before=before,
        after=_dump(row),
    )
    await db.commit()
    return Mutation(entity=_dump(row), audit_id=audit_id)


async def delete_skill(
    db: AsyncSession, skill_id: str, actor_user_id: uuid.UUID
) -> Mutation:
    row = await db.get(Skill, _uuid(skill_id, ENTITY_SKILL))
    if row is None:
        raise _not_found(ENTITY_SKILL)

    before = _dump(row)
    entity_id = str(row.id)
    await db.delete(row)
    await db.flush()

    audit_id = await _audit(
        db,
        actor_user_id=actor_user_id,
        action=ACTION_DELETE,
        entity=ENTITY_SKILL,
        entity_id=entity_id,
        before=before,
        after=None,
    )
    await db.commit()
    return Mutation(entity=before, audit_id=audit_id)


# --------------------------------------------------------------------------
# Certifications
# --------------------------------------------------------------------------


async def list_certifications(db: AsyncSession) -> list[Certification]:
    rows = await db.scalars(
        select(Certification).order_by(Certification.display_order, Certification.title)
    )
    return list(rows)


async def create_certification(
    db: AsyncSession, payload: CertificationCreateIn, actor_user_id: uuid.UUID
) -> Mutation:
    duplicate = await db.scalar(
        select(Certification.id).where(
            Certification.title == payload.title, Certification.issuer == payload.issuer
        )
    )
    if duplicate is not None:
        raise _invalid("title", CERTIFICATION_DUPLICATE_MESSAGE)

    row = Certification(**payload.model_dump())
    db.add(row)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise _invalid("title", CERTIFICATION_DUPLICATE_MESSAGE) from None

    audit_id = await _audit(
        db,
        actor_user_id=actor_user_id,
        action=ACTION_CREATE,
        entity=ENTITY_CERTIFICATION,
        entity_id=str(row.id),
        before=None,
        after=_dump(row),
    )
    await db.commit()
    return Mutation(entity=_dump(row), audit_id=audit_id)


async def update_certification(
    db: AsyncSession,
    certification_id: str,
    payload: CertificationUpdateIn,
    actor_user_id: uuid.UUID,
) -> Mutation:
    row = await db.get(Certification, _uuid(certification_id, ENTITY_CERTIFICATION))
    if row is None:
        raise _not_found(ENTITY_CERTIFICATION)

    changes = payload.model_dump(exclude_unset=True)
    if "title" in changes or "issuer" in changes:
        target_title = changes.get("title", row.title)
        target_issuer = changes.get("issuer", row.issuer)
        taken = await db.scalar(
            select(Certification.id).where(
                Certification.title == target_title,
                Certification.issuer == target_issuer,
                Certification.id != row.id,
            )
        )
        if taken is not None:
            raise _invalid("title", CERTIFICATION_DUPLICATE_MESSAGE)

    before = _dump(row)
    for key, value in changes.items():
        setattr(row, key, value)
    row.updated_at = _utcnow()
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise _invalid("title", CERTIFICATION_DUPLICATE_MESSAGE) from None

    audit_id = await _audit(
        db,
        actor_user_id=actor_user_id,
        action=ACTION_UPDATE,
        entity=ENTITY_CERTIFICATION,
        entity_id=str(row.id),
        before=before,
        after=_dump(row),
    )
    await db.commit()
    return Mutation(entity=_dump(row), audit_id=audit_id)


async def delete_certification(
    db: AsyncSession, certification_id: str, actor_user_id: uuid.UUID
) -> Mutation:
    row = await db.get(Certification, _uuid(certification_id, ENTITY_CERTIFICATION))
    if row is None:
        raise _not_found(ENTITY_CERTIFICATION)

    before = _dump(row)
    entity_id = str(row.id)
    await db.delete(row)
    await db.flush()

    audit_id = await _audit(
        db,
        actor_user_id=actor_user_id,
        action=ACTION_DELETE,
        entity=ENTITY_CERTIFICATION,
        entity_id=entity_id,
        before=before,
        after=None,
    )
    await db.commit()
    return Mutation(entity=before, audit_id=audit_id)


# --------------------------------------------------------------------------
# Site profile
# --------------------------------------------------------------------------


async def get_profile(db: AsyncSession) -> SiteProfile:
    row = await db.scalar(select(SiteProfile))
    if row is None:
        raise _not_found(ENTITY_SITE_PROFILE)
    return row


async def update_profile(
    db: AsyncSession, payload: ProfileUpdateIn, actor_user_id: uuid.UUID
) -> Mutation:
    row = await get_profile(db)
    changes = payload.model_dump(exclude_unset=True)

    before = _dump(row)
    for key, value in changes.items():
        setattr(row, key, value)
    if "resume" in changes and row.resume != RESUME_PUBLIC_PATH:
        # The owner replaced the uploaded object with a hand-written path (or
        # cleared the field back to the in-repo PDF). `resume_key` no longer
        # describes `resume`, so the pointer is dropped: `GET /api/resume` then
        # 404s instead of serving an object the profile does not reference. The
        # object itself is left in place — a save is no place for a storage
        # round-trip, and an unreferenced object is waste, not a leak.
        row.resume_key = None
    row.updated_at = _utcnow()
    await db.flush()

    audit_id = await _audit(
        db,
        actor_user_id=actor_user_id,
        action=ACTION_UPDATE,
        entity=ENTITY_SITE_PROFILE,
        entity_id=str(row.id),
        before=before,
        after=_dump(row),
    )
    await db.commit()
    return Mutation(entity=_dump(row), audit_id=audit_id)


async def set_resume(
    db: AsyncSession,
    *,
    actor_user_id: uuid.UUID,
    key: str,
) -> tuple[Mutation, str | None]:
    """Point the profile at `key` and audit the change, in one transaction.

    Returns the committed mutation and the *previous* object key (or `None`) so
    the route can delete the object this upload supersedes — but only after this
    transaction has committed. That ordering is the whole safety property: a
    failure anywhere before the commit leaves both the database and `GET /api/resume`
    still pointing at the old object, so the previous resume stays live.

    The audit row is on `site_profile` (the row that changed), with `before` and
    `after` taken from the row itself, so the history reads as "the profile's resume
    changed", exactly like a `PUT /api/admin/profile`. The new object key is in
    `after.resume_key` and is the only non-secret diagnostic added.
    """
    row = await get_profile(db)
    before = _dump(row)
    previous_key = row.resume_key
    row.resume = RESUME_PUBLIC_PATH
    row.resume_key = key
    row.updated_at = _utcnow()
    await db.flush()

    audit_id = await _audit(
        db,
        actor_user_id=actor_user_id,
        action=ACTION_UPDATE,
        entity=ENTITY_SITE_PROFILE,
        entity_id=str(row.id),
        before=before,
        after=_dump(row),
    )
    await db.commit()
    return Mutation(entity=_dump(row), audit_id=audit_id), previous_key


# --------------------------------------------------------------------------
# Messages — read-only apart from read/archived
# --------------------------------------------------------------------------


async def list_messages(
    db: AsyncSession,
    *,
    status: str | None,
    page: int,
    page_size: int,
) -> tuple[list[ContactMessage], int]:
    query = select(ContactMessage)
    count_query = select(func.count()).select_from(ContactMessage)
    if status is not None:
        query = query.where(ContactMessage.status == status)
        count_query = count_query.where(ContactMessage.status == status)

    total = int(await db.scalar(count_query) or 0)
    rows = await db.scalars(
        query.order_by(ContactMessage.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return list(rows), total


async def update_message(
    db: AsyncSession, message_id: str, payload: MessageUpdateIn, actor_user_id: uuid.UUID
) -> Mutation:
    row = await db.get(ContactMessage, _uuid(message_id, ENTITY_CONTACT_MESSAGE))
    if row is None:
        raise _not_found(ENTITY_CONTACT_MESSAGE)

    before = _dump(row)
    row.status = payload.status
    await db.flush()

    audit_id = await _audit(
        db,
        actor_user_id=actor_user_id,
        action=ACTION_UPDATE,
        entity=ENTITY_CONTACT_MESSAGE,
        entity_id=str(row.id),
        before=before,
        after=_dump(row),
    )
    await db.commit()
    return Mutation(entity=_dump(row), audit_id=audit_id)


# --------------------------------------------------------------------------
# Publish
# --------------------------------------------------------------------------


async def record_publish(
    db: AsyncSession,
    actor_user_id: uuid.UUID,
    *,
    status: str,
    ok: bool,
    rebuild_status: str,
    rebuild_ok: bool,
    reingest_status: str,
    reingest_ok: bool,
) -> Mutation:
    """Record a publish attempt in the audit log.

    A publish has no content row of its own, so the audit row *is* the record:
    who asked for it, when, and how each downstream step (rebuild and AI
    re-ingestion) turned out. The row is written whether the steps succeeded or
    not — a failed or unconfigured attempt is exactly the history an owner
    diagnosing "why didn't the site update?" needs.

    `after` carries only the outcome flags, never the deploy-hook URL or the AI
    admin token, both of which are capability tokens and must not reach the audit
    table.
    """
    outcome = {
        "status": status,
        "ok": ok,
        "rebuild": {"status": rebuild_status, "ok": rebuild_ok},
        "reingest": {"status": reingest_status, "ok": reingest_ok},
    }
    audit_id = await _audit(
        db,
        actor_user_id=actor_user_id,
        action=ACTION_PUBLISH,
        entity=ENTITY_DEPLOYMENT,
        entity_id=DEPLOYMENT_ENTITY_ID,
        before=None,
        after=outcome,
    )
    await db.commit()
    return Mutation(entity=outcome, audit_id=audit_id)
