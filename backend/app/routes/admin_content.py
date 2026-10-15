"""Admin content endpoints — the 21 content routes from `API.md` §6.3, plus the
`POST /api/admin/publish` rebuild trigger (`ADR-017`).

Three things every route deliberately shares:

* **`AdminSession` / `AdminSessionWithCsrf`** (`app.dependencies.admin_auth`): the
  session dependency is what makes a route an admin route, and the CSRF variant is
  what keeps a mutation a mutation. `TESTING.md` §7.3's "a single unprotected
  route is a breach" is enforced here by import, not by remembering.
* **The `Mutated` wrapper on every mutation.** §6.4 requires the persisted entity
  back *and* the audit id; the client never has to reconcile, and the audit row
  is a first-class response, not an implementation detail.
* **`422 VALIDATION_ERROR` with field-level errors.** `extra="forbid"` bodies and
  the shared validators make the browser's mistakes precise instead of terse.

Reads take `AdminSession`; writes take `AdminSessionWithCsrf`. The
`GET /api/admin/*` read budget (`API.md` §8: 600/min per user) is applied at the
router level so it bounds *every* read here and on the auth router without a
remembered per-route decision.
"""

from __future__ import annotations

from email.utils import parsedate_to_datetime
from typing import Annotated, Literal

from fastapi import APIRouter, File, Query, Request, UploadFile, status

from app.config import get_settings
from app.dependencies.admin_auth import (
    AdminSessionReadBudget,
    AdminSessionWithCsrf,
    DatabaseSession,
)
from app.errors import INTERNAL, VALIDATION_ERROR, APIError, ErrorField
from app.schemas.admin_content import (
    CertificationCreateIn,
    CertificationOut,
    CertificationUpdateIn,
    MessageOut,
    MessagePage,
    MessageUpdateIn,
    Mutated,
    ProfileOut,
    ProfileUpdateIn,
    ProjectCreateIn,
    ProjectListItem,
    ProjectOut,
    ProjectUpdateIn,
    PublishStatus,
    PublishStep,
    ResumeUploadOut,
    SeoAdmin,
    SkillCategoryCreateIn,
    SkillCategoryOut,
    SkillCategoryUpdateIn,
    SkillCreateIn,
    SkillOut,
    SkillUpdateIn,
    UploadOut,
)
from app.schemas.content import About, Social
from app.services import admin_content as service
from app.services import publish as publish_service
from app.services import storage

router = APIRouter(prefix="/api/admin", tags=["admin-content"])

# The keys `SeoAdmin` admits. The stored `seo` jsonb is trusted by the public
# repository layer, but this route is not going to 500 on a stored key it has no
# business rendering — an unknown key is dropped here and flagged in the audit
# trail instead.
SEO_FIELDS = frozenset(
    {
        "siteName",
        "title",
        "description",
        "keywords",
        "author",
        "image",
        "imageAlt",
        "twitterCard",
        "twitterSite",
        "locale",
        "type",
        "robots",
        "person",
    }
)

# Defaults for the read models, so `GET /api/admin/profile` never 500s on a
# partially-filled `site_profile` row. The public content endpoint rightly treats
# an incomplete profile as "content unavailable"; the admin GET is not the public
# contract, so it reports the stored reality instead of crashing — and the owner
# then fills the gaps in the editor.
_SOCIAL_TEMPLATE = {"github": "", "linkedin": "", "email": ""}
_ABOUT_TEMPLATE = {
    "tag": "",
    "title": "",
    "description": "",
    "heading": "",
    "paragraphs": [],
    "cards": [],
}
_SEO_TEMPLATE: dict = {
    "siteName": "",
    "title": "",
    "description": "",
    "keywords": [],
    "author": "",
    "image": "",
    "imageAlt": "",
    "twitterCard": "",
    "twitterSite": None,
    "locale": "",
    "type": "",
    "robots": {"index": True, "follow": True},
    "person": {
        "name": "",
        "alternateName": None,
        "jobTitle": None,
        "email": None,
        "address": None,
        "nationality": None,
        "credential": None,
        "knowsAbout": [],
    },
}


def _mutated(mutation: service.Mutation) -> Mutated:
    return Mutated(entity=mutation.entity, audit_id=mutation.audit_id)


def _invalid_upload(message: str) -> APIError:
    """A `422` naming the `file` part, in the §7.2 envelope the admin UI reads."""
    return APIError(
        status_code=422,
        code=VALIDATION_ERROR,
        message="Request validation failed.",
        event="admin_upload_invalid",
        fields=[ErrorField(field="file", message=message)],
    )


# Declared media types a PDF upload may carry. `application/pdf` is the correct
# one; the others are what some browsers, and multipart clients that do not sniff,
# send instead. The declared type is only a first gate — the real test is the
# `%PDF-` signature the server reads from the bytes, so admitting the generic
# types here cannot let a non-PDF through.
_PDF_CONTENT_TYPES = frozenset(
    {"application/pdf", "application/x-pdf", "application/octet-stream"}
)


def _project_list_item(row: service.Project) -> ProjectListItem:
    return ProjectListItem(
        id=str(row.id),
        slug=row.slug,
        title=row.title,
        status=row.status,
        indexable=row.indexable,
        featured=row.featured,
        display_order=row.display_order,
        updated_at=row.updated_at,
    )


def _project_out(row: service.Project) -> ProjectOut:
    return ProjectOut(
        id=str(row.id),
        slug=row.slug,
        title=row.title,
        status=row.status,
        indexable=row.indexable,
        featured=row.featured,
        display_order=row.display_order,
        updated_at=row.updated_at,
        short_description=row.short_description,
        long_description=row.long_description,
        image=row.image,
        image_width=row.image_width,
        image_height=row.image_height,
        image_alt=row.image_alt,
        category=row.category,
        tech_stack=list(row.tech_stack or []),
        live_url=row.live_url,
        github_url=row.github_url,
        seo_title=row.seo_title,
        seo_description=row.seo_description,
        created_at=row.created_at,
    )


def _category_out(row: service.SkillCategory, skill_count: int = 0) -> SkillCategoryOut:
    return SkillCategoryOut(
        id=str(row.id),
        name=row.name,
        icon_key=row.icon_key,
        display_order=row.display_order,
        is_visible=row.is_visible,
        created_at=row.created_at,
        updated_at=row.updated_at,
        skill_count=skill_count,
    )


def _skill_out(row: service.Skill) -> SkillOut:
    return SkillOut(
        id=str(row.id),
        category_id=str(row.category_id),
        name=row.name,
        icon_key=row.icon_key,
        display_order=row.display_order,
        is_visible=row.is_visible,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _certification_out(row: service.Certification) -> CertificationOut:
    return CertificationOut(
        id=str(row.id),
        title=row.title,
        issuer=row.issuer,
        icon=row.icon,
        issued_on=row.issued_on,
        credential_id=row.credential_id,
        credential_url=row.credential_url,
        display_order=row.display_order,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def _profile_out(row: service.SiteProfile) -> ProfileOut:
    social_values = {**_SOCIAL_TEMPLATE, **(row.social or {})}
    about_values = {**_ABOUT_TEMPLATE, **(row.about or {})}
    seo_values = {key: row.seo[key] for key in SEO_FIELDS if row.seo and key in row.seo}
    seo_values = {**_SEO_TEMPLATE, **seo_values}
    seo_values["person"] = {
        **_SEO_TEMPLATE["person"],
        **(seo_values.get("person") or {}),
    }
    seo_values["robots"] = {
        **_SEO_TEMPLATE["robots"],
        **(seo_values.get("robots") or {}),
    }
    return ProfileOut(
        id=str(row.id),
        name=row.name,
        title=row.title,
        greeting=row.greeting,
        roles=list(row.roles or []),
        available_for_internship=row.available_for_internship,
        internship_text=row.internship_text,
        description=row.description,
        location=row.location,
        resume=row.resume,
        resume_key=row.resume_key,
        stats=list(row.stats or []),
        social=Social(**social_values),
        about=About(**about_values),
        seo=SeoAdmin(**seo_values),
        updated_at=row.updated_at,
    )


# --------------------------------------------------------------------------
# Projects
# --------------------------------------------------------------------------


@router.get("/projects", response_model=list[ProjectListItem])
async def list_projects(
    authenticated: AdminSessionReadBudget,
    db: DatabaseSession,
) -> list[ProjectListItem]:
    rows = await service.list_projects(db)
    return [_project_list_item(row) for row in rows]


@router.post(
    "/projects",
    response_model=Mutated,
    status_code=status.HTTP_201_CREATED,
)
async def create_project(
    payload: ProjectCreateIn,
    authenticated: AdminSessionWithCsrf,
    db: DatabaseSession,
) -> Mutated:
    mutation = await service.create_project(db, payload, actor_user_id=authenticated.user.id)
    return _mutated(mutation)


@router.get("/projects/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: str,
    authenticated: AdminSessionReadBudget,
    db: DatabaseSession,
) -> ProjectOut:
    row = await service.get_project(db, project_id)
    return _project_out(row)


@router.put("/projects/{project_id}", response_model=Mutated)
async def update_project(
    payload: ProjectUpdateIn,
    project_id: str,
    request: Request,
    authenticated: AdminSessionWithCsrf,
    db: DatabaseSession,
) -> Mutated:
    header = request.headers.get("If-Unmodified-Since")
    if_unmodified_since = parsedate_to_datetime(header) if header else None
    mutation = await service.update_project(
        db,
        project_id,
        payload,
        actor_user_id=authenticated.user.id,
        if_unmodified_since=if_unmodified_since,
    )
    return _mutated(mutation)


@router.delete("/projects/{project_id}", response_model=Mutated)
async def delete_project(
    project_id: str,
    authenticated: AdminSessionWithCsrf,
    db: DatabaseSession,
) -> Mutated:
    mutation = await service.delete_project(db, project_id, actor_user_id=authenticated.user.id)
    return _mutated(mutation)


# --------------------------------------------------------------------------
# Uploads
# --------------------------------------------------------------------------


@router.post(
    "/uploads",
    response_model=UploadOut,
    status_code=status.HTTP_201_CREATED,
)
async def upload_project_image(
    authenticated: AdminSessionWithCsrf,
    db: DatabaseSession,
    file: Annotated[UploadFile, File()],
) -> UploadOut:
    """Store one project cover image and return the project fields it fills.

    Deliberately not project-scoped: the editor uploads the image *before* the
    project row exists (the create form has no id yet) and before either form has
    been saved, so the object is stored first and the URL/dimensions are then
    written to the row by the ordinary `POST`/`PUT`. That keeps exactly one write
    path to `project` — and one audit row per change to it — instead of a second,
    image-only mutation that could disagree with the form.

    The server measures the image (`app.services.storage`) rather than trusting
    the browser, because the build cross-checks these dimensions against the real
    file and a guess would fail the production build. The upload itself is
    audited (`entity='upload'`); the follow-up project save audits again, as every
    content mutation does.
    """
    settings = get_settings()
    if not settings.object_storage_configured:
        # Not configured is an operator gap, not the caller's mistake: report it
        # plainly (503) so the admin says "storage is off", exactly as
        # `/api/admin/publish` reports an unconfigured deploy hook.
        raise APIError(
            503,
            INTERNAL,
            "Image storage is not configured. Set AWS_ACCESS_KEY_ID, "
            "AWS_SECRET_ACCESS_KEY and AWS_ENDPOINT_URL_S3 on the backend.",
            event="admin_upload_unconfigured",
        )

    # Read one byte past the cap so an over-size body is detected without ever
    # holding an unbounded upload in memory.
    data = await file.read(settings.S3_IMAGE_MAX_BYTES + 1)
    if not data:
        raise _invalid_upload("The uploaded file is empty.")
    if len(data) > settings.S3_IMAGE_MAX_BYTES:
        raise _invalid_upload(
            f"Image must be at most {settings.S3_IMAGE_MAX_BYTES} bytes."
        )

    try:
        stored = await storage.store_project_image(data)
    except storage.UnsupportedImage as exc:
        raise _invalid_upload(str(exc)) from exc

    mutation = await service.record_upload(
        db,
        actor_user_id=authenticated.user.id,
        key=stored.key,
        url=stored.url,
        width=stored.width,
        height=stored.height,
        content_type=stored.content_type,
        size=stored.size,
    )
    return UploadOut(
        image=stored.url,
        image_width=stored.width,
        image_height=stored.height,
        key=stored.key,
        audit_id=mutation.audit_id,
    )


# --------------------------------------------------------------------------
# Skill categories
# --------------------------------------------------------------------------


@router.get("/skill-categories", response_model=list[SkillCategoryOut])
async def list_skill_categories(
    authenticated: AdminSessionReadBudget,
    db: DatabaseSession,
) -> list[SkillCategoryOut]:
    rows = await service.list_skill_categories(db)
    return [_category_out(row, count) for row, count in rows]


@router.post(
    "/skill-categories",
    response_model=Mutated,
    status_code=status.HTTP_201_CREATED,
)
async def create_skill_category(
    payload: SkillCategoryCreateIn,
    authenticated: AdminSessionWithCsrf,
    db: DatabaseSession,
) -> Mutated:
    mutation = await service.create_skill_category(
        db, payload, actor_user_id=authenticated.user.id
    )
    return _mutated(mutation)


@router.put("/skill-categories/{category_id}", response_model=Mutated)
async def update_skill_category(
    payload: SkillCategoryUpdateIn,
    category_id: str,
    authenticated: AdminSessionWithCsrf,
    db: DatabaseSession,
) -> Mutated:
    mutation = await service.update_skill_category(
        db, category_id, payload, actor_user_id=authenticated.user.id
    )
    return _mutated(mutation)


@router.delete("/skill-categories/{category_id}", response_model=Mutated)
async def delete_skill_category(
    category_id: str,
    authenticated: AdminSessionWithCsrf,
    db: DatabaseSession,
    cascade: bool = Query(default=False),
) -> Mutated:
    mutation = await service.delete_skill_category(
        db, category_id, actor_user_id=authenticated.user.id, cascade=cascade
    )
    return _mutated(mutation)


# --------------------------------------------------------------------------
# Skills
# --------------------------------------------------------------------------


@router.get("/skills", response_model=list[SkillOut])
async def list_skills(
    authenticated: AdminSessionReadBudget,
    db: DatabaseSession,
) -> list[SkillOut]:
    rows = await service.list_skills(db)
    return [_skill_out(row) for row in rows]


@router.post("/skills", response_model=Mutated, status_code=status.HTTP_201_CREATED)
async def create_skill(
    payload: SkillCreateIn,
    authenticated: AdminSessionWithCsrf,
    db: DatabaseSession,
) -> Mutated:
    mutation = await service.create_skill(db, payload, actor_user_id=authenticated.user.id)
    return _mutated(mutation)


@router.put("/skills/{skill_id}", response_model=Mutated)
async def update_skill(
    payload: SkillUpdateIn,
    skill_id: str,
    authenticated: AdminSessionWithCsrf,
    db: DatabaseSession,
) -> Mutated:
    mutation = await service.update_skill(db, skill_id, payload, actor_user_id=authenticated.user.id)
    return _mutated(mutation)


@router.delete("/skills/{skill_id}", response_model=Mutated)
async def delete_skill(
    skill_id: str,
    authenticated: AdminSessionWithCsrf,
    db: DatabaseSession,
) -> Mutated:
    mutation = await service.delete_skill(db, skill_id, actor_user_id=authenticated.user.id)
    return _mutated(mutation)


# --------------------------------------------------------------------------
# Certifications
# --------------------------------------------------------------------------


@router.get("/certifications", response_model=list[CertificationOut])
async def list_certifications(
    authenticated: AdminSessionReadBudget,
    db: DatabaseSession,
) -> list[CertificationOut]:
    rows = await service.list_certifications(db)
    return [_certification_out(row) for row in rows]


@router.post(
    "/certifications",
    response_model=Mutated,
    status_code=status.HTTP_201_CREATED,
)
async def create_certification(
    payload: CertificationCreateIn,
    authenticated: AdminSessionWithCsrf,
    db: DatabaseSession,
) -> Mutated:
    mutation = await service.create_certification(
        db, payload, actor_user_id=authenticated.user.id
    )
    return _mutated(mutation)


@router.put("/certifications/{certification_id}", response_model=Mutated)
async def update_certification(
    payload: CertificationUpdateIn,
    certification_id: str,
    authenticated: AdminSessionWithCsrf,
    db: DatabaseSession,
) -> Mutated:
    mutation = await service.update_certification(
        db, certification_id, payload, actor_user_id=authenticated.user.id
    )
    return _mutated(mutation)


@router.delete("/certifications/{certification_id}", response_model=Mutated)
async def delete_certification(
    certification_id: str,
    authenticated: AdminSessionWithCsrf,
    db: DatabaseSession,
) -> Mutated:
    mutation = await service.delete_certification(
        db, certification_id, actor_user_id=authenticated.user.id
    )
    return _mutated(mutation)


# --------------------------------------------------------------------------
# Profile
# --------------------------------------------------------------------------


@router.get("/profile", response_model=ProfileOut)
async def get_profile(
    authenticated: AdminSessionReadBudget,
    db: DatabaseSession,
) -> ProfileOut:
    row = await service.get_profile(db)
    return await _profile_out(row)


@router.put("/profile", response_model=Mutated)
async def update_profile(
    payload: ProfileUpdateIn,
    authenticated: AdminSessionWithCsrf,
    db: DatabaseSession,
) -> Mutated:
    mutation = await service.update_profile(db, payload, actor_user_id=authenticated.user.id)
    return _mutated(mutation)


@router.post(
    "/profile/resume",
    response_model=ResumeUploadOut,
    status_code=status.HTTP_201_CREATED,
)
async def upload_resume(
    authenticated: AdminSessionWithCsrf,
    db: DatabaseSession,
    file: Annotated[UploadFile, File()],
) -> ResumeUploadOut:
    """Store one resume PDF and point the profile at it, atomically.

    Unlike a project image — which is stored first and only becomes content when
    the form is saved — the resume *is* the profile field, so accepting the upload
    is the save: the object is written to the private bucket, then
    `site_profile.resume` is set to `/api/resume` with `resume_key` recorded, in one
    audited transaction. The object superseded by that transaction is deleted only
    *after* it commits, so a failure anywhere leaves the previous resume live and
    still the one `GET /api/resume` serves.

    The bytes never get a public URL: the bucket is private and `GET /api/resume`
    is the only way to read them.
    """
    settings = get_settings()
    if not settings.object_storage_configured:
        # Not configured is an operator gap, not the caller's mistake: report it
        # plainly (503), exactly as the image upload and `/api/admin/publish` do.
        raise APIError(
            503,
            INTERNAL,
            "Resume storage is not configured. Set AWS_ACCESS_KEY_ID, "
            "AWS_SECRET_ACCESS_KEY and AWS_ENDPOINT_URL_S3 on the backend.",
            event="admin_resume_unconfigured",
        )

    # A declared type that is plainly not a PDF is refused before the body is
    # read; an absent or generic type is left to the signature check below.
    declared = (file.content_type or "").split(";", 1)[0].strip().lower()
    if declared and declared not in _PDF_CONTENT_TYPES:
        raise _invalid_upload("Only PDF documents are supported.")

    # Read one byte past the cap so an over-size body is detected without ever
    # holding an unbounded upload in memory.
    data = await file.read(settings.S3_RESUME_MAX_BYTES + 1)
    if not data:
        raise _invalid_upload("The uploaded file is empty.")
    if len(data) > settings.S3_RESUME_MAX_BYTES:
        raise _invalid_upload(
            f"Resume must be at most {settings.S3_RESUME_MAX_BYTES} bytes."
        )

    try:
        stored = await storage.store_resume(data)
    except storage.UnsupportedResume as exc:
        raise _invalid_upload(str(exc)) from exc

    try:
        mutation, previous_key = await service.set_resume(
            db,
            actor_user_id=authenticated.user.id,
            key=stored.key,
        )
    except Exception:
        # The profile write failed (most likely there is no profile row yet), so
        # the object just stored is orphaned. Remove it rather than leave an
        # unreferenced PDF behind, then re-raise so the real error is reported.
        await storage.delete_resume(stored.key)
        raise

    if previous_key and previous_key != stored.key:
        # Best-effort: the database already points at the new object, so a failure
        # here only leaves a stale object behind (see `storage.delete_resume`).
        await storage.delete_resume(previous_key)

    return ResumeUploadOut(
        resume=service.RESUME_PUBLIC_PATH,
        key=stored.key,
        audit_id=mutation.audit_id,
    )


# --------------------------------------------------------------------------
# Messages
# --------------------------------------------------------------------------


@router.get("/messages", response_model=MessagePage)
async def list_messages(
    authenticated: AdminSessionReadBudget,
    db: DatabaseSession,
    status_filter: Literal["unread", "read", "archived"] | None = Query(
        default=None, alias="status"
    ),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> MessagePage:
    rows, total = await service.list_messages(
        db,
        status=status_filter,
        page=page,
        page_size=page_size,
    )
    return MessagePage(
        items=[MessageOut(
            id=str(row.id),
            name=row.name,
            email=row.email,
            subject=row.subject,
            message=row.message,
            status=row.status,
            delivery_status=row.delivery_status,
            created_at=row.created_at,
        ) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.patch("/messages/{message_id}", response_model=Mutated)
async def update_message(
    payload: MessageUpdateIn,
    message_id: str,
    authenticated: AdminSessionWithCsrf,
    db: DatabaseSession,
) -> Mutated:
    mutation = await service.update_message(
        db, message_id, payload, actor_user_id=authenticated.user.id
    )
    return _mutated(mutation)


# --------------------------------------------------------------------------
# Publish
# --------------------------------------------------------------------------


@router.post("/publish", response_model=PublishStatus)
async def trigger_publish(
    authenticated: AdminSessionWithCsrf,
    db: DatabaseSession,
) -> PublishStatus:
    """Start a rebuild of the public site and refresh the AI knowledge base.

    The deploy-hook URL and the AI admin token are capability tokens and stay
    server-side; the browser only ever calls this route. Every attempt is audited
    (see `service.record_publish`), including the not-configured and failed cases,
    so "why didn't the site update?" is answerable from the audit trail. A CSRF
    token is required because this is an unsafe, state-changing action.
    """
    outcome = await publish_service.publish_all()
    await service.record_publish(
        db,
        actor_user_id=authenticated.user.id,
        status=outcome.status,
        ok=outcome.ok,
        rebuild_status=outcome.rebuild.status,
        rebuild_ok=outcome.rebuild.ok,
        reingest_status=outcome.reingest.status,
        reingest_ok=outcome.reingest.ok,
    )
    return PublishStatus(
        ok=outcome.ok,
        status=outcome.status,
        message=outcome.message,
        rebuild=PublishStep(
            name=outcome.rebuild.name,
            configured=outcome.rebuild.configured,
            ok=outcome.rebuild.ok,
            status=outcome.rebuild.status,
            message=outcome.rebuild.message,
        ),
        reingest=PublishStep(
            name=outcome.reingest.name,
            configured=outcome.reingest.configured,
            ok=outcome.reingest.ok,
            status=outcome.reingest.status,
            message=outcome.reingest.message,
        ),
    )