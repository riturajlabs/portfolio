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

import re
from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    model_validator,
)

_STRICT = ConfigDict(extra="forbid")

_CASE_STUDY_MAX_BYTES = 32 * 1024
_CASE_STUDY_DATE_RE = re.compile(r"^(?:[0-9]{4}|[0-9]{4}-(?:0[1-9]|1[0-2]))$")
_CASE_STUDY_WHITESPACE = (
    "\u0009"
    "\u000a"
    "\u000b"
    "\u000c"
    "\u000d"
    "\u0020"
    "\u0085"
    "\u00a0"
    "\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000"
)
_CASE_STUDY_WHITESPACE_CLASS = (
    "\u0009-\u000d"
    "\u0020"
    "\u0085"
    "\u00a0"
    "\u1680"
    "\u2000-\u200a"
    "\u2028\u2029"
    "\u202f"
    "\u205f"
    "\u3000"
)
_CASE_STUDY_WHITESPACE_RE = re.compile(f"[{_CASE_STUDY_WHITESPACE_CLASS}]")
_BARE_URL_RE = re.compile(
    f"^https?://[^{_CASE_STUDY_WHITESPACE_CLASS}]+$"
)
_HTTP_URL_RE = re.compile(
    f"^https?://[^{_CASE_STUDY_WHITESPACE_CLASS}\"'<>]+$"
)
_FLAT_IMAGE_PATH_RE = re.compile(r"^/images/projects/[a-z0-9-]+\.webp$")
_IMAGE_SRC_ERROR = (
    "src must be an absolute http(s) URL or /images/projects/<slug>.webp."
)


def _trim_text(value: str) -> str:
    return value.strip(_CASE_STUDY_WHITESPACE)


def _required_text(max_length: int | None = None):
    def _validate(value: str) -> str:
        value = _trim_text(value)
        if not value:
            raise ValueError("Must not be blank.")
        if max_length is not None and len(value) > max_length:
            raise ValueError(f"Must be {max_length} characters or fewer.")
        return value

    return Annotated[str, AfterValidator(_validate)]


def _optional_text(max_length: int, min_length: int = 1):
    def _validate(value: str | None) -> str | None:
        if value is None:
            return None
        value = _trim_text(value)
        if not value:
            return None
        if len(value) < min_length or len(value) > max_length:
            raise ValueError(
                f"Must be {min_length}-{max_length} characters when present."
            )
        return value

    return Annotated[str | None, AfterValidator(_validate)]


def _required_http_url(value: str) -> str:
    if _CASE_STUDY_WHITESPACE_RE.search(value) or not _HTTP_URL_RE.fullmatch(
        value
    ):
        raise ValueError("Must be an absolute http(s) URL.")
    return value


def _optional_http_url(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    return _required_http_url(value)


def _image_src(value: str) -> str:
    if _CASE_STUDY_WHITESPACE_RE.search(value) or not (
        _FLAT_IMAGE_PATH_RE.fullmatch(value)
        or _HTTP_URL_RE.fullmatch(value)
    ):
        raise ValueError(_IMAGE_SRC_ERROR)
    return value


_HttpUrl = Annotated[str, AfterValidator(_required_http_url)]
_OptionalHttpUrl = Annotated[str | None, AfterValidator(_optional_http_url)]
_ImageSrc = Annotated[str, AfterValidator(_image_src)]


def _date_endpoint(value: str, *, is_end: bool) -> tuple[int, int]:
    if len(value) == 4:
        return int(value), 12 if is_end else 1
    year, month = value.split("-")
    return int(year), int(month)


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


class Timeline(BaseModel):
    model_config = _STRICT

    label: _optional_text(80) = None
    start: _optional_text(10) = None
    end: _optional_text(10) = None
    duration: _optional_text(40) = None

    @model_validator(mode="after")
    def _validate_timeline(self) -> Timeline:
        if all(
            value is None
            for value in (self.label, self.start, self.end, self.duration)
        ):
            raise ValueError("timeline must contain at least one field.")
        for name in ("start", "end"):
            value = getattr(self, name)
            if value is not None and not _CASE_STUDY_DATE_RE.fullmatch(value):
                raise ValueError(f"timeline.{name} must be YYYY or YYYY-MM.")
        if self.start is not None and self.end is not None:
            start = _date_endpoint(self.start, is_end=False)
            end = _date_endpoint(self.end, is_end=True)
            if start > end:
                raise ValueError("timeline.start must be on or before timeline.end.")
        return self


class Team(BaseModel):
    model_config = _STRICT

    size: StrictInt | None = Field(default=None, ge=1, le=1000)
    roles: list[_required_text(60)] = Field(default_factory=list, max_length=10)
    note: _optional_text(200) = None

    @model_validator(mode="after")
    def _validate_team(self) -> Team:
        if self.size is None and not self.roles and self.note is None:
            raise ValueError("team must contain at least one field.")
        return self


class Problem(BaseModel):
    model_config = _STRICT

    summary: _required_text(1200)
    context: _optional_text(2000) = None


class ApproachSection(BaseModel):
    model_config = _STRICT

    heading: _required_text(120)
    body: _required_text(2000)


class ImageAsset(BaseModel):
    model_config = _STRICT

    src: _ImageSrc
    alt: _required_text(300)
    width: StrictInt = Field(gt=0)
    height: StrictInt = Field(gt=0)
    caption: _optional_text(300) = None


class ArchitectureComponent(BaseModel):
    model_config = _STRICT

    name: _required_text(80)
    role: _required_text(240)
    technology: _optional_text(120) = None


class Architecture(BaseModel):
    model_config = _STRICT

    summary: _required_text(2000)
    components: list[ArchitectureComponent] = Field(
        default_factory=list, max_length=20
    )
    diagram: ImageAsset | None = None


class KeyDecision(BaseModel):
    model_config = _STRICT

    decision: _required_text(240)
    rationale: _required_text(1200)
    tradeoff: _optional_text(800) = None


class Challenge(BaseModel):
    model_config = _STRICT

    problem: _required_text(600)
    resolution: _required_text(1200)
    lesson: _optional_text(600) = None


class Evidence(BaseModel):
    model_config = _STRICT

    status: Literal["verified", "reported", "unverified"]
    source: _optional_text(500, min_length=8) = None
    url: _OptionalHttpUrl = None
    note: _optional_text(500) = None

    @model_validator(mode="after")
    def _validate_evidence(self) -> Evidence:
        if self.status in ("verified", "reported") and self.source is None:
            raise ValueError(
                f"evidence.source is required when status is {self.status}."
            )
        if self.source is not None and _BARE_URL_RE.fullmatch(self.source):
            raise ValueError(
                "evidence.source must describe the artifact, not just a URL."
            )
        return self


class Outcome(BaseModel):
    model_config = _STRICT

    kind: Literal["quantitative", "qualitative"]
    statement: _required_text(400)
    metric: _optional_text(120) = None
    value: _optional_text(60) = None
    unit: _optional_text(30) = None
    baseline: _optional_text(120) = None
    direction: Literal["higher", "lower", "neutral"] | None = None
    evidence: Evidence | None = None

    @model_validator(mode="after")
    def _validate_outcome(self) -> Outcome:
        if self.kind == "quantitative":
            if self.metric is None or self.value is None or self.evidence is None:
                raise ValueError(
                    "quantitative outcomes require metric, value, and evidence."
                )
        elif any(
            value is not None
            for value in (
                self.metric,
                self.value,
                self.unit,
                self.baseline,
                self.direction,
            )
        ):
            raise ValueError(
                "qualitative outcomes must not include metric, value, unit, "
                "baseline, or direction."
            )
        return self


class CaseStudyLink(BaseModel):
    model_config = _STRICT

    label: _required_text(80)
    url: _HttpUrl
    kind: Literal["demo", "source", "writeup", "other"]


class CaseStudy(BaseModel):
    model_config = _STRICT

    schemaVersion: StrictInt = Field(ge=1, le=1)
    role: _optional_text(120) = None
    timeline: Timeline | None = None
    team: Team | None = None
    problem: Problem | None = None
    constraints: list[_required_text(240)] = Field(
        default_factory=list, max_length=12
    )
    approach: list[ApproachSection] = Field(default_factory=list, max_length=12)
    architecture: Architecture | None = None
    keyDecisions: list[KeyDecision] = Field(default_factory=list, max_length=10)
    challenges: list[Challenge] = Field(default_factory=list, max_length=10)
    outcomes: list[Outcome] = Field(default_factory=list, max_length=12)
    learnings: list[_required_text(300)] = Field(
        default_factory=list, max_length=12
    )
    gallery: list[ImageAsset] = Field(default_factory=list, max_length=12)
    links: list[CaseStudyLink] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def _validate_document(self) -> CaseStudy:
        if not any(
            (
                self.role is not None,
                self.timeline is not None,
                self.team is not None,
                self.problem is not None,
                bool(self.constraints),
                bool(self.approach),
                self.architecture is not None,
                bool(self.keyDecisions),
                bool(self.challenges),
                bool(self.outcomes),
                bool(self.learnings),
                bool(self.gallery),
                bool(self.links),
            )
        ):
            raise ValueError(
                "case study must contain at least one substantive field "
                "besides schemaVersion."
            )
        seen_urls: set[str] = set()
        for index, link in enumerate(self.links):
            if link.url in seen_urls:
                raise ValueError(f"links[{index}].url duplicates an earlier link.")
            seen_urls.add(link.url)
        if len(self.model_dump_json().encode("utf-8")) > _CASE_STUDY_MAX_BYTES:
            raise ValueError(
                f"case study must be {_CASE_STUDY_MAX_BYTES} bytes or fewer "
                "when serialized."
            )
        return self


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
    caseStudy: CaseStudy | None = None
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
    "ApproachSection",
    "Architecture",
    "ArchitectureComponent",
    "CaseStudy",
    "CaseStudyLink",
    "Certification",
    "Challenge",
    "Content",
    "Evidence",
    "ImageAsset",
    "KeyDecision",
    "Meta",
    "Outcome",
    "Person",
    "Problem",
    "Profile",
    "Project",
    "Robots",
    "Seo",
    "Skill",
    "SkillCategory",
    "Social",
    "Stat",
    "Team",
    "Timeline",
]