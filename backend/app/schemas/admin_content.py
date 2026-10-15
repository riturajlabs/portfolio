"""Admin CRUD request and response bodies — the `API.md` §6.3/§6.4 contract.

Naming rule, settled from the only concrete admin example the contract contains:
**the admin API speaks the column names.** `API.md` §6.5 shows a `PUT` body of
`{"title", "featured", "display_order", "image_width", "image_height"}` — snake
case, matching `project`. The camelCase rule in §5.1.4 governs `GET /api/content`,
which must mirror `src/data/*.js` so the public components need no mapper; the
admin has a mapper of its own and gains nothing from inheriting a public
serialization detail. (`TESTING.md` §7.4 refers to `seoTitle` in one row; that is
the public key name, quoted from `discover.mjs`, not an admin field.)

Every model here is `extra="forbid"`. A typo must be a `422` naming the field,
not a silent no-op that leaves the admin staring at an unchanged row — and for
`PUT` in particular, a rejected unknown field is the only thing standing between
"the form sent `is_visible`" and "the form meant `status`".

Validation is deliberately server-side and shared rather than trusted to the
browser: `slug`, `image`, dimensions, `icon_key` and URL schemes are enforced here
(`API.md` §6.4), and the admin UI mirrors them for feedback — never as the only
gate.
"""

from __future__ import annotations

import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.registry import ICON_KEYS, UNKNOWN_ICON_KEY
from app.schemas.content import About, Person, Robots, Social, Stat

_STRICT = ConfigDict(extra="forbid")

# `API.md` §6.4 and the `project.slug_format` / `slug_length` CHECKs.
SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SLUG_MAX_LENGTH = 80

# The `project.image_path` CHECK accepts two shapes, and this is the same pair.
#
# 1. The original in-repo path: an image committed under
#    `public/images/projects/<slug>.webp`. Path traversal never reaches a
#    filesystem here and cannot match the pattern in any case: `..` and extra `/`
#    are not in the character class after the fixed prefix.
# 2. An object-storage URL written by `POST /api/admin/uploads`: the anonymous
#    public URL of a `public_read` bucket. It is absolute http(s) and carries no
#    whitespace, quotes or angle brackets, so it is a valid HTML attribute value
#    and a valid `src`. No other scheme (`javascript:`, `data:`) is admitted,
#    because the value is emitted straight into the build as an `<img src>`.
IMAGE_PATTERN = re.compile(r"^/images/projects/[a-z0-9-]+\.webp$")
IMAGE_URL_PATTERN = re.compile(r"^https?://[^\s\"'<>]+$")

PROJECT_STATUS_VALUES = ("published", "hidden")
MESSAGE_STATUS_VALUES = ("read", "archived")

# `project` columns that are `NOT NULL`. A `PUT` naming any of these with an
# explicit `null` is refused by `ProjectUpdateIn` before it can reach the
# database. The nullable columns (`long_description`, `category`, `live_url`,
# `github_url`) are deliberately not listed — clearing them is valid.
_PROJECT_NON_NULLABLE = (
    "slug",
    "title",
    "short_description",
    "image",
    "image_width",
    "image_height",
    "image_alt",
    "status",
    "featured",
    "indexable",
    "display_order",
    "seo_title",
    "seo_description",
)

HTTP_URL_PATTERN = re.compile(r"^https?://")


def validate_slug(value: str) -> str:
    if len(value) > SLUG_MAX_LENGTH:
        raise ValueError(f"Must be {SLUG_MAX_LENGTH} characters or fewer.")
    if not SLUG_PATTERN.match(value):
        raise ValueError("Must be lowercase letters, digits and single hyphens.")
    return value


def validate_icon_key(value: str) -> str:
    if value not in ICON_KEYS:
        raise ValueError(UNKNOWN_ICON_KEY)
    return value


def validate_http_url(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    if not HTTP_URL_PATTERN.match(value):
        raise ValueError("Must start with http:// or https://.")
    return value


def validate_image(value: str) -> str:
    """Accept the in-repo path or an object-storage URL (`API.md` §6.4).

    Both shapes are what the database CHECK accepts, so a value that passes here
    cannot be rejected by the constraint. Anything else — a relative path, a
    `data:`/`javascript:` URL, a URL with a space — is a `422` naming the field.
    """
    if IMAGE_PATTERN.match(value) or IMAGE_URL_PATTERN.match(value):
        return value
    raise ValueError("Must be /images/projects/<slug>.webp or an absolute http(s) URL.")


def validate_status(value: str) -> str:
    if value not in PROJECT_STATUS_VALUES:
        raise ValueError("Must be 'published' or 'hidden'.")
    return value


def _require_field_set(model: BaseModel) -> None:
    """A `PUT`/`PATCH` that changes nothing is a client bug, not a no-op success.

    Returning `200` for an empty body would let a broken form appear to work while
    the audit log records an update that altered no column.
    """
    if not model.model_fields_set:
        raise ValueError("Provide at least one field to update.")


# --------------------------------------------------------------------------
# Projects
# --------------------------------------------------------------------------


class ProjectListItem(BaseModel):
    """One row of the dashboard list.

    The bodies are deliberately absent (`API.md` §6.3): returning
    `long_description` for every row would grow the payload with the portfolio and
    hand the UI a second source of truth to reconcile against the editor. The two
    visibility flags *are* present, because the UI must render both controls
    (ADR-016) and a list that showed only `status` would misrepresent what the
    site is actually doing.
    """

    model_config = _STRICT

    id: str
    slug: str
    title: str
    status: str
    indexable: bool
    featured: bool
    display_order: int
    updated_at: datetime


class ProjectOut(ProjectListItem):
    """The full row, as returned by create/update and `GET /{id}`."""

    model_config = _STRICT

    short_description: str
    long_description: str | None = None
    image: str
    image_width: int
    image_height: int
    image_alt: str
    category: str | None = None
    tech_stack: list[str] = Field(default_factory=list)
    live_url: str | None = None
    github_url: str | None = None
    seo_title: str
    seo_description: str
    created_at: datetime


class ProjectCreateIn(BaseModel):
    """`POST /api/admin/projects`.

    Everything the build needs is required here — `image`, `image_width`,
    `image_height`, `seo_title`, `seo_description` are the fields
    `generate-project-pages.mjs` and `discover.mjs` assert on, so allowing a row
    into the table without them would let a save succeed and the next build fail.

    `slug` is **optional**. The admin does not author URLs: when it is omitted the
    service derives a unique slug from `title` (`app.services.slugs`). A slug is
    still accepted so scripts and tests can pin an exact address, and an explicit
    slug that is already taken remains a `409 SLUG_TAKEN` rather than being
    silently suffixed.
    """

    model_config = _STRICT

    slug: str | None = None
    title: str
    short_description: str
    image: str
    image_width: int = Field(gt=0)
    image_height: int = Field(gt=0)
    image_alt: str
    seo_title: str = Field(min_length=1)
    seo_description: str = Field(min_length=1)
    long_description: str | None = None
    category: str | None = None
    tech_stack: list[str] = Field(default_factory=list)
    status: str = "published"
    featured: bool = False
    indexable: bool = True
    display_order: int = 0
    live_url: str | None = None
    github_url: str | None = None

    @field_validator("slug")
    @classmethod
    def _slug(cls, value: str | None) -> str | None:
        # `None` means "generate one from the title"; an empty string is treated
        # the same way so a form that submits `""` is not a `422` for a field the
        # owner no longer sees.
        if value is None or value == "":
            return None
        return validate_slug(value)

    @field_validator("image")
    @classmethod
    def _image(cls, value: str) -> str:
        return validate_image(value)

    @field_validator("status")
    @classmethod
    def _status(cls, value: str) -> str:
        return validate_status(value)

    @field_validator("live_url", "github_url")
    @classmethod
    def _urls(cls, value: str | None) -> str | None:
        return validate_http_url(value)

    @field_validator("image_width", "image_height")
    @classmethod
    def _positive_dimensions(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("Must be greater than 0.")
        return value


class ProjectUpdateIn(BaseModel):
    """`PUT /api/admin/projects/{id}` — partial. Omitted fields are unchanged.

    `slug` is accepted here on purpose: it is validated as a *shape*, then refused
    by the service with `409 SLUG_IMMUTABLE` when the row is currently published.
    Rejecting it in the schema instead would return a `422` saying nothing about
    why, and `API.md` §6.5 fixes that case as a `409`.
    """

    model_config = _STRICT

    slug: str | None = None
    title: str | None = None
    short_description: str | None = None
    long_description: str | None = None
    image: str | None = None
    image_width: int | None = None
    image_height: int | None = None
    image_alt: str | None = None
    category: str | None = None
    tech_stack: list[str] | None = None
    status: str | None = None
    featured: bool | None = None
    indexable: bool | None = None
    display_order: int | None = None
    live_url: str | None = None
    github_url: str | None = None
    seo_title: str | None = None
    seo_description: str | None = None

    @field_validator("slug")
    @classmethod
    def _slug(cls, value: str | None) -> str | None:
        return validate_slug(value) if value is not None else None

    @field_validator("image")
    @classmethod
    def _image(cls, value: str | None) -> str | None:
        return validate_image(value) if value is not None else None

    @field_validator("status")
    @classmethod
    def _status(cls, value: str | None) -> str | None:
        return validate_status(value) if value is not None else None

    @field_validator("live_url", "github_url")
    @classmethod
    def _urls(cls, value: str | None) -> str | None:
        return validate_http_url(value)

    @field_validator("image_width", "image_height")
    @classmethod
    def _positive_dimensions(cls, value: int | None) -> int | None:
        if value is not None and value <= 0:
            raise ValueError("Must be greater than 0.")
        return value

    @model_validator(mode="after")
    def _non_empty(self) -> ProjectUpdateIn:
        _require_field_set(self)
        return self

    @model_validator(mode="after")
    def _reject_explicit_nulls(self) -> ProjectUpdateIn:
        """An explicit `null` for a non-nullable column is a `422`, not a `500`.

        These fields are `NOT NULL` in `project`. Without this guard an explicit
        `{"title": null}` reaches the service, `setattr`s `None`, and fails at
        `flush()` as an `IntegrityError` that the service misreports as a slug
        problem — a confusing error for a request the schema could have refused
        outright. The nullable columns (`long_description`, `category`,
        `live_url`, `github_url`) are intentionally absent: clearing them is a
        legitimate edit.
        """
        for name in _PROJECT_NON_NULLABLE:
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null.")
        return self


# --------------------------------------------------------------------------
# Skill categories
# --------------------------------------------------------------------------


class SkillCategoryOut(BaseModel):
    model_config = _STRICT

    id: str
    name: str
    icon_key: str
    display_order: int
    is_visible: bool
    created_at: datetime
    updated_at: datetime
    skill_count: int = 0


class SkillCategoryCreateIn(BaseModel):
    model_config = _STRICT

    name: str = Field(min_length=1, max_length=60)
    icon_key: str
    display_order: int = 0
    is_visible: bool = True

    @field_validator("icon_key")
    @classmethod
    def _icon(cls, value: str) -> str:
        return validate_icon_key(value)


class SkillCategoryUpdateIn(BaseModel):
    model_config = _STRICT

    name: str | None = Field(default=None, min_length=1, max_length=60)
    icon_key: str | None = None
    display_order: int | None = None
    is_visible: bool | None = None

    @field_validator("icon_key")
    @classmethod
    def _icon(cls, value: str | None) -> str | None:
        return validate_icon_key(value) if value is not None else None

    @model_validator(mode="after")
    def _non_empty(self) -> SkillCategoryUpdateIn:
        _require_field_set(self)
        return self


# --------------------------------------------------------------------------
# Skills
# --------------------------------------------------------------------------


class SkillOut(BaseModel):
    model_config = _STRICT

    id: str
    category_id: str
    name: str
    icon_key: str
    display_order: int
    is_visible: bool
    created_at: datetime
    updated_at: datetime


class SkillCreateIn(BaseModel):
    model_config = _STRICT

    category_id: str
    name: str = Field(min_length=1, max_length=60)
    icon_key: str
    display_order: int = 0
    is_visible: bool = True

    @field_validator("icon_key")
    @classmethod
    def _icon(cls, value: str) -> str:
        return validate_icon_key(value)


class SkillUpdateIn(BaseModel):
    model_config = _STRICT

    category_id: str | None = None
    name: str | None = Field(default=None, min_length=1, max_length=60)
    icon_key: str | None = None
    display_order: int | None = None
    is_visible: bool | None = None

    @field_validator("icon_key")
    @classmethod
    def _icon(cls, value: str | None) -> str | None:
        return validate_icon_key(value) if value is not None else None

    @model_validator(mode="after")
    def _non_empty(self) -> SkillUpdateIn:
        _require_field_set(self)
        return self


# --------------------------------------------------------------------------
# Certifications
# --------------------------------------------------------------------------


class CertificationOut(BaseModel):
    model_config = _STRICT

    id: str
    title: str
    issuer: str
    icon: str | None = None
    issued_on: str | None = None
    credential_id: str | None = None
    credential_url: str | None = None
    display_order: int = 0
    created_at: datetime
    updated_at: datetime


class CertificationCreateIn(BaseModel):
    model_config = _STRICT

    title: str = Field(min_length=1)
    issuer: str = Field(min_length=1)
    icon: str | None = None
    issued_on: str | None = None
    credential_id: str | None = None
    credential_url: str | None = None
    display_order: int = 0

    @field_validator("credential_url")
    @classmethod
    def _url(cls, value: str | None) -> str | None:
        return validate_http_url(value)


class CertificationUpdateIn(BaseModel):
    model_config = _STRICT

    title: str | None = Field(default=None, min_length=1)
    issuer: str | None = Field(default=None, min_length=1)
    icon: str | None = None
    issued_on: str | None = None
    credential_id: str | None = None
    credential_url: str | None = None
    display_order: int | None = None

    @field_validator("credential_url")
    @classmethod
    def _url(cls, value: str | None) -> str | None:
        return validate_http_url(value)

    @model_validator(mode="after")
    def _non_empty(self) -> CertificationUpdateIn:
        _require_field_set(self)
        return self


# --------------------------------------------------------------------------
# Site profile
# --------------------------------------------------------------------------


class SeoAdmin(BaseModel):
    """`site_profile.seo`, minus the keys the repository derives.

    `url` and `verification` are deployment constants, and `sameAs` is derived
    from `social` (`API.md` §5.1.4.4/5). None of the three are stored, so none
    are accepted — sending one is `extra="forbid"`.
    """

    model_config = _STRICT

    siteName: str
    title: str
    description: str
    keywords: list[str] = Field(default_factory=list)
    author: str
    image: str
    imageAlt: str
    twitterCard: str
    twitterSite: str | None = None
    locale: str
    type: str
    robots: Robots = Field(default_factory=Robots)
    person: Person


class ProfileOut(BaseModel):
    model_config = _STRICT

    id: str
    name: str
    title: str
    greeting: str | None = None
    roles: list[str] = Field(default_factory=list)
    available_for_internship: bool = False
    internship_text: str | None = None
    description: str | None = None
    location: str | None = None
    resume: str
    # The object key behind `resume` when it is an admin upload, else `None`. Not a
    # secret — the bucket is private and the key alone fetches nothing — but only
    # the admin GET exposes it; the public content payload never does.
    resume_key: str | None = None
    stats: list[Stat] = Field(default_factory=list)
    social: Social
    about: About
    seo: SeoAdmin
    updated_at: datetime


class ProfileUpdateIn(BaseModel):
    """`PUT /api/admin/profile` — partial. `site_profile` is one row (§5.1)."""

    model_config = _STRICT

    name: str | None = None
    title: str | None = None
    greeting: str | None = None
    roles: list[str] | None = None
    available_for_internship: bool | None = None
    internship_text: str | None = None
    description: str | None = None
    location: str | None = None
    resume: str | None = None
    stats: list[Stat] | None = None
    social: Social | None = None
    about: About | None = None
    seo: SeoAdmin | None = None

    @model_validator(mode="after")
    def _non_empty(self) -> ProfileUpdateIn:
        _require_field_set(self)
        return self


# --------------------------------------------------------------------------
# Messages
# --------------------------------------------------------------------------


class MessageOut(BaseModel):
    """One inbox row.

    `source_ip_hash` and `user_agent` are deliberately absent: they are
    fraud-investigation columns, and an inbox view has no business rendering a
    hashed IP next to a recruiter's name.
    """

    model_config = _STRICT

    id: str
    name: str
    email: str
    subject: str
    message: str
    status: str
    delivery_status: str
    created_at: datetime


class MessagePage(BaseModel):
    model_config = _STRICT

    items: list[MessageOut]
    total: int
    page: int
    page_size: int


class MessageUpdateIn(BaseModel):
    """`PATCH /api/admin/messages/{id}` — read/archived only.

    `unread` is deliberately not accepted: `API.md` §6.6 offers "mark read /
    archived", and a mark-unread action has no use in a single-admin inbox while
    widening the surface of a route that exists only to move a row between two
    states.
    """

    model_config = _STRICT

    status: str

    @field_validator("status")
    @classmethod
    def _known_status(cls, value: str) -> str:
        if value not in MESSAGE_STATUS_VALUES:
            raise ValueError("Must be 'read' or 'archived'.")
        return value


class Mutated(BaseModel):
    """The wrapper every mutating response uses.

    `audit_id` names the `admin_audit_log` row written in the same transaction as
    the change (`API.md` §6.4). Returning it turns "did that save actually audit?"
    from a database query into something the client already holds.
    """

    model_config = _STRICT

    entity: dict
    audit_id: str


class UploadOut(BaseModel):
    """`POST /api/admin/uploads` — a stored image and the fields it fills.

    The response is shaped so the editor can drop it straight into the project
    form: `image`, `image_width` and `image_height` are exactly the three fields
    the create/update body needs (with the server-measured dimensions, never the
    browser's guess). `key` and `audit_id` are diagnostics — the object key for
    support, the audit row for the "did that upload audit?" question the other
    mutations answer with `Mutated`.
    """

    model_config = _STRICT

    image: str
    image_width: int
    image_height: int
    key: str
    audit_id: str


class ResumeUploadOut(BaseModel):
    """`POST /api/admin/profile/resume` — a stored resume and its public route.

    Unlike `UploadOut`, whose fields feed a later project save, this response *is*
    the save: the server points the profile at `resume` before replying. `resume`
    is the stable public route (`/api/resume`) the admin form should show, so no
    reconciliation is needed. `key` and `audit_id` are diagnostics — the object key
    for support, the audit row for the "did that upload audit?" question.
    """

    model_config = _STRICT

    resume: str
    key: str
    audit_id: str


class PublishStep(BaseModel):
    """One downstream effect of a publish: the static rebuild or AI re-ingestion.

    `configured` and `ok` are separate because they are different failures: an
    operator who has not wired a step (`configured=false`) has a deployment gap to
    close, while a set-but-unreachable integration (`configured=true, ok=false`)
    is a transient error the owner can retry. Collapsing them would tell the owner
    to retry a setting that is simply missing.
    """

    model_config = _STRICT

    name: str
    configured: bool
    ok: bool
    status: str
    message: str


class PublishStatus(BaseModel):
    """`POST /api/admin/publish` — the outcome of the whole publish.

    `ok` is true only when no step failed; `status` is `ok`, `partial` (a step is
    unconfigured) or `failed`. Each step's detail is included so the owner can see
    exactly which half of the publish did or did not happen.
    """

    model_config = _STRICT

    ok: bool
    status: str
    message: str
    rebuild: PublishStep
    reingest: PublishStep
