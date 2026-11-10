"""Client + validator for the canonical knowledge source: `GET /api/content`.

Phase 9 makes the backend's public content payload the authoritative AI
knowledge source (see `docs/MIGRATION.md` Phase 9). This module is that
boundary in code:

* **HTTP fetch** — a single `httpx` GET against `CONTENT_API_URL` with a hard
  timeout. Every transport/HTTP failure raises `ContentAPIError`; there is no
  silent fallback to `knowledge_base.json` (that file is now a rollback source
  selected explicitly via `KNOWLEDGE_SOURCE=file`).
* **Strict validation** — the Pydantic models below mirror
  `backend/app/schemas/content.py` **key-for-key, including `extra="forbid"` at
  every level**. A backend column that leaks into the payload, a typo'd key, or
  an administrative field would fail validation here instead of quietly
  entering the retrieval store. Administrative data (`contact_message`,
  `admin_*`) has no representation in this contract and is rejected.
* **Semantic rules** the schema can't express — duplicate project slugs and
  project `status` values outside the database CHECK set
  (`published`/`hidden`) are rejected explicitly.

Not copied into the store: `meta` (payload provenance). Everything else
(`profile`, `about`, `projects`, `skills`, `certifications`, `seo`) becomes a
knowledge section whose chunk IDs are derived from stable logical keys (the
project slug, the skill name, the certification title) — see
`sections_from_content`.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Annotated, Literal

import httpx
from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    ValidationError,
    model_validator,
)

from config.settings import settings

logger = logging.getLogger(__name__)

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

# The database CHECK on project.status (backend/app/models/project.py). The
# payload only ever returns `published` (the query filters on it), but the
# full CHECK set is accepted so a future backend change fails here with a
# clear reason rather than a silent schema mismatch.
_PROJECT_STATUSES = frozenset({"published", "hidden"})


class ContentAPIError(Exception):
    """Any failure while obtaining valid `/api/content` bytes.

    Raised for: unreachable host, timeout, non-200 status, undecodable JSON,
    contract violation (`extra="forbid"` or missing/typed-wrong fields), or a
    semantic rule violation. The ingestion layer treats this as fail-closed:
    nothing is indexed, `/ready` stays 503.
    """


# ---------------------------------------------------------------------------
# Contract mirror. Do not diverge from backend/app/schemas/content.py.
# ---------------------------------------------------------------------------
class Stat(BaseModel):
    model_config = _STRICT
    label: str
    value: str


class Social(BaseModel):
    model_config = _STRICT
    github: str
    linkedin: str
    email: str


class Profile(BaseModel):
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
    model_config = _STRICT
    icon_key: str
    title: str
    description: str


class About(BaseModel):
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
    caseStudy: CaseStudy | None = None


class SkillCategory(BaseModel):
    model_config = _STRICT
    name: str
    icon_key: str
    display_order: int = 0


class Skill(BaseModel):
    model_config = _STRICT
    name: str
    icon_key: str
    display_order: int = 0
    category: SkillCategory


class Certification(BaseModel):
    model_config = _STRICT
    title: str
    issuer: str
    icon: str | None = None
    issued_on: str | None = None
    credential_id: str | None = None
    credential_url: str | None = None
    display_order: int = 0


class Robots(BaseModel):
    model_config = _STRICT
    index: bool = True
    follow: bool = True


class PostalAddress(BaseModel):
    model_config = _STRICT
    locality: str
    region: str
    country: str


class Person(BaseModel):
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


# ---------------------------------------------------------------------------
# HTTP fetch + validation
# ---------------------------------------------------------------------------
def fetch_content_raw(client: httpx.Client | None = None) -> dict:
    """GET `/api/content` and return the parsed JSON body.

    `client` is injectable for tests (httpx `MockTransport`); when omitted a
    throwaway client is created and closed here.
    """
    made_client = client is None
    if client is None:
        client = httpx.Client(timeout=settings.CONTENT_API_TIMEOUT)
    try:
        try:
            resp = client.get(settings.CONTENT_API_URL)
        except httpx.HTTPError as exc:
            raise ContentAPIError(
                f"content API unreachable ({settings.CONTENT_API_URL}): {exc}"
            ) from exc
    finally:
        if made_client:
            client.close()

    if resp.status_code != 200:
        raise ContentAPIError(
            f"content API returned HTTP {resp.status_code} for "
            f"{settings.CONTENT_API_URL}"
        )

    try:
        return resp.json()
    except ValueError as exc:
        raise ContentAPIError(
            f"content API returned non-JSON body ({type(exc).__name__})"
        ) from exc


def _validate_semantic_rules(content: Content) -> None:
    """Cross-field rules the Pydantic schema can't express."""
    dup_slugs = sorted(
        slug for slug in {p.slug for p in content.projects}
        if sum(p.slug == slug for p in content.projects) > 1
    )
    if dup_slugs:
        raise ContentAPIError(
            f"content API has duplicate project slug(s): {dup_slugs}"
        )

    bad_statuses = sorted(
        {p.status for p in content.projects} - _PROJECT_STATUSES
    )
    if bad_statuses:
        raise ContentAPIError(
            f"content API has project status outside the CHECK set "
            f"{sorted(_PROJECT_STATUSES)}: {bad_statuses}"
        )

    if any(not p.slug for p in content.projects):
        raise ContentAPIError("content API has an empty project slug")


def validate_content_payload(data: dict) -> Content:
    """Parse + validate one `/api/content` body into `Content`.

    Raises `ContentAPIError` on any contract or semantic violation. Unknown
    keys anywhere in the payload (`extra="forbid"`) are a violation — this is
    the guard that keeps administrative/contact fields out of the store.
    """
    try:
        content = Content.model_validate(data)
    except ValidationError as exc:
        raise ContentAPIError(
            "content API violates the /api/content contract: "
            f"{exc.error_count()} validation error(s), first: "
            f"{exc.errors()[0] if exc.errors() else 'n/a'}"
        ) from exc
    _validate_semantic_rules(content)
    return content


def fetch_validated_content(client: httpx.Client | None = None) -> Content:
    """Fetch + validate a single call's worth of canonical content.

    Fail-closed: any error raises `ContentAPIError`; nothing is returned
    partial or substituted.
    """
    raw = fetch_content_raw(client)
    return validate_content_payload(raw)


# ---------------------------------------------------------------------------
# Transform: /api/content -> knowledge sections
# ---------------------------------------------------------------------------
def sections_from_content(content: Content) -> dict:
    """Turn a validated payload into the sectioned knowledge shape the RAG
    chunker consumes (`services/knowledge_loader._chunk_section`).

    Design rules:
      * Collections become **dicts keyed by a stable logical id** — project
        slug, skill name, certification title — instead of positional list
        items. Chunk IDs are then derived from `(section, key, text)`, so an
        item's ID survives re-indexing as long as its content is unchanged,
        and a content edit produces a *new* ID that the reconcile step replaces
        (old ID deleted as stale).
      * `meta` is omitted: it is provenance, not knowledge.
      * `profile`/`about`/`seo` pass through as dicts; the chunker already
        splits long strings into sliding windows.
    """
    return {
        "profile": content.profile.model_dump(),
        "about": content.about.model_dump(),
        "projects": {
            p.slug: p.model_dump(exclude={"caseStudy"}) for p in content.projects
        },
        "skills": {
            s.name: {"name": s.name, "category": s.category.name}
            for s in content.skills
        },
        "certifications": {
            c.title: c.model_dump() for c in content.certifications
        },
        "seo": content.seo.model_dump(),
    }


def chunks_from_sections(sections: dict) -> list[dict]:
    """Run the shared chunker over content-derived sections.

    Lives here (rather than in the loader) so callers of
    `sections_from_content` get the final document set without importing the
    Chroma layer. Reuses `services.knowledge_loader._chunk_section` and the
    same `<20 char` noise rule as file-mode ingestion, so both sources
    produce comparable chunk stats.
    """
    from services.knowledge_loader import _chunk_section

    chunks: list[dict] = []
    for section, data in sections.items():
        for chunk in _chunk_section(section, data):
            text = chunk["text"].strip()
            if len(text) < 20:
                continue
            chunks.append(chunk)
    return chunks


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
    "ContentAPIError",
    "Evidence",
    "ImageAsset",
    "KeyDecision",
    "Meta",
    "Outcome",
    "Person",
    "PostalAddress",
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
    "chunks_from_sections",
    "fetch_content_raw",
    "fetch_validated_content",
    "sections_from_content",
    "validate_content_payload",
]