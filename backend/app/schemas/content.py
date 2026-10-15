"""Public response schemas.

`GET /api/content` has exactly one response shape, specified in `docs/API.md`
§5.1.2 and mapped column-by-column in `docs/DATABASE.md` §11.2. This module is
that specification in code.

Three rules from the locked documents shape the design:

1. **`extra="forbid"` everywhere** (`API.md` §5.1.4.6, `DATABASE.md` §11.4.3).
   A column added later must not appear in the public payload by accident, and a
   typo in the assembly layer must fail loudly instead of silently dropping a
   field. Both failure modes are invisible from the browser otherwise.
2. **Key names are the contract, not an implementation detail.** They mirror the
   current `src/data/*.js` modules so components need no mapper
   (`DATABASE.md` §11.1). `image_width`/`image_height` are the only snake_case
   keys and that is deliberate (`DATABASE.md` §11.3).
3. **Nothing here exposes an administrative field.** No `id`, no `created_at`,
   no `updated_at`, and nothing from `admin_*` or `contact_message`. The
   assembly layer selects named columns, not whole ORM rows, so an administrative
   column cannot be added to the payload by a later schema change.

`url` and `verification` are deliberately absent from `SeoOut`. They belong to the
deployment, not to the person (`DATABASE.md` §5.1.3) and are merged in from
`src/config/seo.js` by the build. `sameAs` is derived from `profile.social` at the
assembly layer so one fact has one source.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

_STRICT = ConfigDict(extra="forbid")


class Stat(BaseModel):
    """One hero statistic, e.g. `{"label": "Projects", "value": "4+"}`."""

    model_config = _STRICT

    label: str
    value: str


class Social(BaseModel):
    """The three social URLs the site links to. Replaces a `social_link` table."""

    model_config = _STRICT

    github: str
    linkedin: str
    email: str


class Profile(BaseModel):
    """`site_profile`, minus the singleton flag and the timestamps."""

    model_config = _STRICT

    name: str
    title: str
    greeting: str | None = None
    roles: list[str] = Field(default_factory=list)
    availableForInternship: bool = False
    internshipText: str | None = None
    description: str | None = None
    location: str | None = None
    resume: str
    stats: list[Stat] = Field(default_factory=list)
    social: Social


class AboutCard(BaseModel):
    """One about card.

    `icon_key` is a **new** key (`API.md` §5.1.4.2). Today the key is `icon` and
    holds a React component reference, which cannot be stored in a database or
    serialised to JSON; `icon_key` names a registry entry the frontend resolves
    to an icon.
    """

    model_config = _STRICT

    icon_key: str
    title: str
    description: str


class About(BaseModel):
    """The `site_profile.about` jsonb column, passed through without flattening."""

    model_config = _STRICT

    tag: str
    title: str
    description: str
    heading: str
    paragraphs: list[str] = Field(default_factory=list)
    cards: list[AboutCard] = Field(default_factory=list)


class Project(BaseModel):
    """One published project.

    `indexable` is exposed rather than filtered on: a project can be published and
    visible in the UI while still excluded from `sitemap.xml` and `llms.txt`. The
    build splits the payload on that flag (`API.md` §5.1.1), so filtering here
    would make those two outputs impossible.
    """

    model_config = _STRICT

    slug: str
    title: str
    description: str
    longDescription: str | None = None
    image: str
    image_width: int = Field(gt=0)
    image_height: int = Field(gt=0)
    imageAlt: str
    category: str | None = None
    techStack: list[str] = Field(default_factory=list)
    highlights: list[str] = Field(default_factory=list)
    featured: bool = False
    indexable: bool = True
    status: str
    display_order: int = 0
    live: str | None = None
    github: str | None = None
    seoTitle: str
    seoDescription: str


class SkillCategory(BaseModel):
    """The category a skill belongs to, nested exactly as `skills.js` nests it."""

    model_config = _STRICT

    name: str
    icon_key: str
    display_order: int = 0


class Skill(BaseModel):
    """One skill. `icon` → `icon_key` for the same reason as `AboutCard.icon_key`."""

    model_config = _STRICT

    name: str
    icon_key: str
    display_order: int = 0
    category: SkillCategory


class Certification(BaseModel):
    """One certification.

    `issued_on` is free text because the stored values are `"June 2025"`-style
    display strings (`DATABASE.md` §5.5).
    """

    model_config = _STRICT

    title: str
    issuer: str
    icon: str | None = None
    issued_on: str | None = None
    credential_id: str | None = None
    credential_url: str | None = None
    display_order: int = 0


class Robots(BaseModel):
    """Structured `robots` directives (`API.md` §5.1.2)."""

    model_config = _STRICT

    index: bool = True
    follow: bool = True


class PostalAddress(BaseModel):
    """`schema.org` PostalAddress, the only structured type in the SEO payload."""

    model_config = _STRICT

    locality: str
    region: str
    country: str


class Person(BaseModel):
    """`schema.org` Person, used by the JSON-LD the build emits."""

    model_config = _STRICT

    name: str
    alternateName: str | None = None
    jobTitle: str | None = None
    email: str | None = None
    address: PostalAddress | None = None
    nationality: str | None = None
    credential: str | None = None
    knowsAbout: list[str] = Field(default_factory=list)


class Seo(BaseModel):
    """The `site_profile.seo` jsonb column plus the derived `sameAs`.

    `url` and `verification` are absent on purpose — see the module docstring and
    `DATABASE.md` §5.1.3.
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
    sameAs: list[str] = Field(default_factory=list)


class Meta(BaseModel):
    """Payload provenance.

    `generated_at` is the most recent content mutation, not the request time. A
    request-time stamp would change the bytes on every call, which would make the
    `ETag` useless and turn every conditional request into a cache miss.
    """

    model_config = _STRICT

    generated_at: datetime
    version: int = 1


class Content(BaseModel):
    """The complete `GET /api/content` body. One shape, no variants."""

    model_config = _STRICT

    profile: Profile
    about: About
    projects: list[Project] = Field(default_factory=list)
    skills: list[Skill] = Field(default_factory=list)
    certifications: list[Certification] = Field(default_factory=list)
    seo: Seo
    meta: Meta


__all__ = [
    "About",
    "AboutCard",
    "Certification",
    "Content",
    "Meta",
    "Person",
    "Profile",
    "Project",
    "Robots",
    "Seo",
    "Skill",
    "SkillCategory",
    "Social",
    "Stat",
]