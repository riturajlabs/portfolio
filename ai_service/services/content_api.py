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
from datetime import datetime

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from config.settings import settings

logger = logging.getLogger(__name__)

_STRICT = ConfigDict(extra="forbid")

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
        "projects": {p.slug: p.model_dump() for p in content.projects},
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
    "Certification",
    "Content",
    "ContentAPIError",
    "Meta",
    "Person",
    "PostalAddress",
    "Profile",
    "Project",
    "Robots",
    "Seo",
    "Skill",
    "SkillCategory",
    "Social",
    "Stat",
    "chunks_from_sections",
    "fetch_content_raw",
    "fetch_validated_content",
    "sections_from_content",
    "validate_content_payload",
]