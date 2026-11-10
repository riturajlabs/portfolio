# U10.1 — Case Study Architecture Design

**Status:** Design only. No implementation, migration, schema change, API change, generated-content change, dependency change, or external-repository change has been made.
**Baseline branch:** `feature/portfolio-u8-work`
**Baseline HEAD:** `0ccc7ef0deea9d8710af4b7225b2eb8799e53723`
**Permitted output:** this file only.
**Pre-existing untracked file:** `reports/U10_PROJECT_CASE_STUDY_AUDIT.md` (prior U10 read-only audit; not modified).

**Evidence labels used throughout:**

- **VERIFIED** — directly observed in the repository at the baseline above.
- **INFERRED** — a conclusion drawn from verified code or documentation, without executing the behaviour in this phase.
- **PROPOSED** — a design decision for owner approval, not yet implemented.

---

## 1. Executive Summary

**PROPOSED** Add one nullable `case_study JSONB` column to `project`, storing a versioned, structured case-study document. Keep `long_description` exactly as it is: the bullet encoding that produces `projects[].highlights`. Do not repurpose it for prose case studies.

The recommended architecture is:

1. A nullable `project.case_study` JSONB column with a database-level object-type check and no backfill.
2. A versioned document contract, currently `schemaVersion: 1`, with camelCase keys shared by the public API, admin API, frontend validator, and AI validator.
3. Strict Pydantic validation at the admin write boundary and a mirrored validator in the AI service.
4. A public `projects[].caseStudy` field that is always present after the backend migration and is `null` for projects without a case study. New clients also tolerate a missing key during rollout and rollback, normalizing it to `null`.
5. An admin `projects[].case_study` field whose outer key follows the existing admin snake_case convention, while the nested JSONB document uses the canonical camelCase contract.
6. A single progressive `ProjectPage` renderer that adds case-study sections only when data exists and falls back to today's page for every existing project.
7. A dedicated AI knowledge section for case studies, plus removal of the hardcoded three-project prompt that currently contradicts the five-project content.
8. An evidence model that distinguishes verified, reported, and unverified claims. Quantitative outcomes require an explicit status and descriptive source; unverified quantitative outcomes are omitted from public rendering and AI ingestion. The application validates evidence metadata, not the truth of the claim.

**Key decisions at a glance:**

| Decision | Recommendation | Why |
| --- | --- | --- |
| Storage | Nullable JSONB column on `project` | Atomic with the project row, one query, no new tables, consistent with existing JSONB precedent. |
| Contract shape | Structured sections, versioned | Stable renderer, validation, SEO, and AI ingestion. |
| Case-study presence | Optional; `NULL` means absent | Existing projects must keep working unchanged. |
| Public key | `caseStudy`, always present after migration, `null` when absent; clients tolerate missing | One deterministic public shape after rollout; missing-tolerant clients make backend-first rollback safe. |
| Admin key | `case_study` (outer), camelCase nested document | Preserves the existing admin/public naming split without creating two nested contracts. |
| Update semantics | `PUT` remains partial; omitted = unchanged; explicit `null` = clear; `{}` = invalid | Precise, testable behaviour that matches the existing route. |
| Empty object | Rejected; use `null` to clear | Removes the ambiguity between “no case study” and “an empty one”. |
| Draft state | None in v1; the project's existing `status` controls visibility | Avoids a second publishing model and a new draft/publish workflow. |
| Outcomes | Evidence-backed quantitative; unverified quantitative omitted; qualitative allowed | Prevents unverifiable metrics from becoming public or AI-stated facts. |
| Rendering | One renderer for all projects | No per-project page implementations, no SEO drift. |
| AI | Dedicated case-study section; prompt fixed; version bumped | Current prompt hardcodes three projects while the content API has five. |

**Approval gate:** implementation must not begin until the owner approves this report, especially the contract shape, evidence rules, null semantics, and rollout order.

---

## 2. Verified Existing Architecture

### 2.1 Repository and baseline

- **VERIFIED** The working tree is on `feature/portfolio-u8-work` at `0ccc7ef0deea9d8710af4b7225b2eb8799e53723`.
- **VERIFIED** The only pre-existing untracked file is `reports/U10_PROJECT_CASE_STUDY_AUDIT.md`.
- **VERIFIED** No U10.1 source, database, dependency, generated-content, or external-repository change has been made.

### 2.2 Database and project model

- **VERIFIED** `project` is a single table. `category` and `tech_stack` are columns, not tables. `tech_stack` is `text[]`. See `backend/app/models/project.py:30-77`.
- **VERIFIED** `project` already carries build-critical CHECK constraints for slug shape/length, image path/URL, positive image dimensions, status values, category length, and SEO title/description length. See `backend/app/models/project.py:61-77`.
- **VERIFIED** JSONB is already an established storage type: `site_profile.stats`, `site_profile.social`, `site_profile.about`, `site_profile.seo`, and `admin_audit_log.before/after` are JSONB. See `backend/alembic/versions/0001_initial.py` and `backend/tests/test_database_schema.py:37-40,139-140`.
- **VERIFIED** The current Alembic head is `0004_profile_resume_key`. The revision chain is `0001_initial` → `0002_certification_unique` → `0003_project_image_url` → `0004_profile_resume_key`.
- **VERIFIED** `0004` establishes the nullable-column migration convention: add a nullable column, no data movement, no backfill. See `backend/alembic/versions/0004_profile_resume_key.py:35-40`.

### 2.3 Public content pipeline

- **VERIFIED** The only public content endpoint is `GET /api/content`. There are no `/api/projects` endpoints. See `backend/app/routes/content.py`.
- **VERIFIED** The public response is assembled in `backend/app/services/content.py::load_content` at `:113`. Project columns are selected explicitly in `_published_projects()` at `:271-309`.
- **VERIFIED** The public contract is strict Pydantic with `extra="forbid"`. See `backend/app/schemas/content.py:34,103-132,247-258`.
- **VERIFIED** `projects[].description` is `project.short_description`; `longDescription` is the stored long description; `highlights` is derived from `long_description` by `_highlights()` at `backend/app/services/content.py:80-100` and attached at `:167`.
- **VERIFIED** The frontend renders `highlights` as a bullet list and never renders `longDescription` as prose. See `src/components/pages/ProjectPage.jsx:168-182` and `src/components/common/ProjectCard.jsx`.
- **VERIFIED** The public content endpoint uses strong ETags, conditional requests, and `Cache-Control: public, max-age=300, stale-while-revalidate=600`. See `backend/app/routes/content.py`.
- **VERIFIED** `meta.generated_at` is the newest contributing row timestamp, not request time. See `backend/app/services/content.py:229-241,255-268`.

### 2.4 Admin content pipeline

- **VERIFIED** Admin project routes are `GET/POST /api/admin/projects`, `GET/PUT/DELETE /api/admin/projects/{project_id}`, `POST /api/admin/uploads`, and `POST /api/admin/publish`. See `backend/app/routes/admin_content.py`.
- **VERIFIED** `POST /api/admin/uploads` stores project images under a flat, server-generated key `project-images/<uuid>.<ext>` in the public-read bucket. It is not project-scoped and accepts no caller-supplied path. It sniffs WebP/PNG/JPEG/GIF headers, measures dimensions server-side, enforces `S3_IMAGE_MAX_BYTES` (default 5,000,000), and returns the public URL, measured width/height, key, and audit id. The sniff is a header check, not a full image decode. See `backend/app/services/storage.py:45,157-180,208-240`, `backend/app/routes/admin_content.py:343-411`, and `backend/tests/test_admin_uploads.py:83-87`.
- **VERIFIED** The existing `project.image` validator and database CHECK accept only the flat `/images/projects/<slug>.webp` path or an absolute `http(s)` URL, not a nested `/images/projects/<slug>/<file>.webp` path. See `backend/app/schemas/admin_content.py:42-50`.
- **VERIFIED** The project update route is `PUT` but is deliberately partial: omitted fields are unchanged. See `backend/app/schemas/admin_content.py:246-323` and `backend/app/services/admin_content.py:338-391`.
- **VERIFIED** `ProjectUpdateIn` uses `model_fields_set` and `model_dump(exclude_unset=True)` to distinguish omitted fields from explicit values.
- **VERIFIED** Explicit `null` for a non-nullable column is rejected with a `422`; nullable columns can be cleared. `_PROJECT_NON_NULLABLE` is at `backend/app/schemas/admin_content.py:60-74`.
- **VERIFIED** Slug is validated as a shape and then rejected with `409 SLUG_IMMUTABLE` when the row is published. See `backend/app/services/admin_content.py:357-362`.
- **VERIFIED** Every admin mutation writes exactly one `admin_audit_log` row in the same transaction. See `backend/app/services/admin_content.py:1-16,151-172,300-430`.
- **VERIFIED** `_dump()` serializes every ORM column for audit `before`/`after`, so a new column automatically appears in audit records unless explicitly excluded. See `backend/app/services/admin_content.py:134-143`.
- **VERIFIED** Project deletion is soft: `status = "hidden"` and `indexable = false`. See `backend/app/services/admin_content.py:394-430`.
- **VERIFIED** `POST /api/admin/publish` triggers the static rebuild and AI re-ingestion. See `backend/app/services/publish.py`.
- **VERIFIED** Admin schemas are `extra="forbid"` and speak snake_case column names. See `backend/app/schemas/admin_content.py:1-21`.

### 2.5 Frontend build, prerender, and SEO

- **VERIFIED** The build chain is `node scripts/build-content.mjs && vite build && node scripts/assert-admin-bundle.mjs && vite build --config vite.prerender.config.js && node scripts/generate-project-pages.mjs && node scripts/generate-seo-discovery.mjs`. See `package.json`.
- **VERIFIED** `scripts/build-content.mjs` fetches `GET /api/content` once, validates it fail-closed through `src/lib/content.js`, and writes `src/generated/content.js`. There is no fallback to `src/data/*.js`.
- **VERIFIED** `src/generated/content.js` is generated and overwritten by the build. `src/data/**` is frozen by the CI tripwire. See `.github/workflows/ci.yml`.
- **VERIFIED** `src/lib/content.js::validateContent` at `:462` and `validateProjects` at `:594` enforce the public contract independently of the backend.
- **VERIFIED** `validateProjects` validates known project fields but does not reject unknown project-level keys; only unknown top-level keys are rejected at `src/lib/content.js:472-475`. This matters for rollout: an old frontend tolerates an extra `caseStudy` project key, while the AI service does not.
- **VERIFIED** `ProjectPage.jsx` is rendered two ways from one source: client SPA and build-time static markup. See `src/components/pages/ProjectPage.jsx:1-15`.
- **VERIFIED** `ProjectPage.jsx` currently repeats `project.description` in the header at `:75-76` and in “About this project” at `:143-146`.
- **VERIFIED** `ProjectPage.jsx` renders header, sticky section nav, cover image, tech stack, highlights, actions, related projects, and a footer. It uses no browser globals and is safe for prerender.
- **VERIFIED** `src/lib/projectPages.js` is the single source of truth for project-page SEO, canonical URLs, image dimensions, related projects, and JSON-LD. See `src/lib/projectPages.js:1-19,266-412`.
- **VERIFIED** Discovery outputs are `dist/sitemap.xml`, `dist/sitemap-images.xml`, `dist/robots.txt`, and `dist/llms.txt`. Case-study content does not create new URLs.

### 2.6 AI pipeline

- **VERIFIED** The AI service defaults to `KNOWLEDGE_SOURCE=api`, so all five public projects are indexed from `GET /api/content`. See `ai_service/config/settings.py:61`.
- **VERIFIED** `ai_service/services/content_api.py` mirrors the public schema key-for-key with `extra="forbid"`. See `ai_service/services/content_api.py:106-126,204-214,278-304`.
- **VERIFIED** Project knowledge chunks are built by `sections_from_content` at `ai_service/services/content_api.py:310-337`. Today each project becomes one chunk keyed by slug because the `projects` section is a dict of project dicts.
- **VERIFIED** The current project chunks contain `longDescription` and `highlights`, but no architecture, challenges, decisions, or learnings because those fields do not exist publicly.
- **VERIFIED** The prompt hardcodes “three main projects” at `ai_service/core/prompts.py:17-20` and “strictly limited to Orbit AI, Stayora, and Scientific Calculator” at `:48`. The prompt version is `2.2.0` at `:5`.
- **VERIFIED** The current content API has five projects, including Zerodha Clone, which the prompt does not name.
- **VERIFIED** The legacy `ai_service/knowledge_base.json` has richer `overview`, `technologies`, `features`, `architecture`, `challenges`, `learnings`, and `completionYear` for four projects: Orbit AI, Stayora, Scientific Calculator, and WebChat AI. It omits Zerodha Clone, is rollback-only, and contains unpublished personal data. It is not a public or CMS authority.
- **VERIFIED** WebChat AI implementation source is absent from this repository. The only known external links are `https://github.com/riturajlabs/webchat-AI` and `https://webchat-ai-dashboard.vercel.app/`. No implementation or performance claim can be verified from this repository.

### 2.7 Test and CI coverage relevant to this design

- **VERIFIED** Backend tests include schema shape, constraints, migration rollback, public content contract, payload snapshot, admin CRUD, publish, uploads, and security. See `backend/tests/`.
- **VERIFIED** The payload snapshot is committed at `backend/tests/snapshots/content_payload.json` and compares the whole public response except `meta.generated_at`. See `backend/tests/test_payload_snapshot.py`.
- **VERIFIED** Frontend tests include `ProjectPage.test.jsx`, `content.test.js`, `ProjectCard.test.jsx`, and `projectPages.test.js`.
- **VERIFIED** AI tests include contract validation, section/chunk generation, ingestion, parity, and prompt-adjacent behaviour. See `ai_service/tests/`.
- **VERIFIED** CI runs frontend lint, frontend unit tests, backend pytest, AI lint and pytest, a real backend-backed build, migration validation, and Playwright. See `.github/workflows/ci.yml`.
- **VERIFIED** The existing payload-size test targets ≤60 KB gzipped for the current five-project dataset. See `backend/tests/test_content_api.py:964-1000`.

### 2.8 Gaps this design must close

- **VERIFIED** There is no case-study field, contract, admin editor, public renderer, or AI ingestion section today.
- **VERIFIED** `long_description` is a bullet encoding for `highlights`; it is not a prose case-study store.
- **VERIFIED** Project pages are summaries, not case studies.
- **VERIFIED** The AI prompt contradicts the current content and would deny the existence of two of the five projects.
- **VERIFIED** The legacy knowledge base cannot be imported wholesale without publishing unverified and potentially private material.

---

## 3. Database Design

### 3.1 Recommended column

**PROPOSED**

```sql
ALTER TABLE project
ADD COLUMN case_study jsonb NULL;

ALTER TABLE project
ADD CONSTRAINT ck_project_case_study_object
CHECK (case_study IS NULL OR jsonb_typeof(case_study) = 'object');
```

**ORM change:**

```python
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID

case_study: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
```

**Migration:** new `0005_project_case_study` with `down_revision = "0004_profile_resume_key"`.

**Why this shape:**

- **VERIFIED** JSONB is already used for structured profile content and audit payloads.
- **PROPOSED** A nullable column means every existing row remains valid without a backfill.
- **PROPOSED** `NULL` is the only representation of “no case study”. It is not `{}` and not a default empty document.
- **PROPOSED** The object-type CHECK prevents an array, scalar, or JSON `null` from being stored as a case study. Full structural validation stays in the application layer so the contract can evolve without a migration for every field change.
- **PROPOSED** No index is needed. Case studies are read only as part of a project row and are never filtered or searched by JSONB operators. A GIN index would add write cost with no query benefit at this scale.
- **PROPOSED** No `NOT NULL DEFAULT '{}'`. A default empty object would create a second representation of absence and make the admin/public semantics ambiguous.

### 3.2 Size and audit considerations

- **PROPOSED** Enforce a per-project serialized case-study limit of **32 KiB** in the application layer. This is large enough for a rich case study and small enough to keep the public payload, admin audit rows, and AI ingestion bounded.
- **PROPOSED** Do not add a `pg_column_size` CHECK in v1. `pg_column_size` interacts with TOAST and is not a stable substitute for validating the serialized document. The application validator is the authoritative size gate.
- **INFERRED** `_dump()` will include `case_study` in audit `before`/`after` automatically because it iterates all columns. The 32 KiB cap keeps those audit rows reasonable. Case-study content is public, so there is no new secret exposure in the audit table.
- **PROPOSED** If a future migration needs to change the contract, it must be a new `schemaVersion` and a new validator, not an in-place reinterpretation of stored v1 documents.

### 3.3 JSONB column versus relational table

| Criterion | Nullable JSONB column | Relational case-study tables | Decision |
| --- | --- | --- | --- |
| Fit to current model | One case study per project; one row read | Would need `case_study`, `case_study_section`, `case_study_outcome`, `case_study_evidence`, etc. | JSONB |
| Atomicity | Case study changes in the same row and same audit transaction as the project | Multiple tables and ordering rules | JSONB |
| Public assembly | One additional selected column | Joins or additional queries | JSONB |
| Schema flexibility | Contract evolves with `schemaVersion` and Pydantic | Every field change is a migration | JSONB |
| Database constraints | Object-type CHECK only; structure validated in app | Strong per-column constraints and foreign keys | Relational wins, but is overkill here |
| Query/reporting | Not queryable by field without JSONB operators | Easy SQL reporting | Relational wins, but no current need |
| Admin complexity | One form, one PUT | Multiple nested endpoints or transaction orchestration | JSONB |
| Scale | Five projects today | Justified only at much larger scale or if outcomes need cross-project analytics | JSONB |

**Recommendation:** JSONB. The repository already treats structured profile content as JSONB, the case study is a document authored and rendered as a whole, and the current scale does not justify a normalized graph.

---

## 4. Proposed JSONB Contract

### 4.1 Canonical v1 document

**PROPOSED** The stored document uses camelCase keys. The outer admin key remains `case_study`; the public key is `caseStudy`. The nested document is the same contract in both APIs.

```json
{
  "schemaVersion": 1,
  "role": "Solo full-stack developer",
  "timeline": {
    "label": "Jan – Mar 2025",
    "start": "2025-01",
    "end": "2025-03",
    "duration": "10 weeks"
  },
  "team": {
    "size": 1,
    "roles": ["Frontend", "Backend", "Deployment"],
    "note": "Solo build"
  },
  "problem": {
    "summary": "Support teams had no way to answer repeat questions without escalating to an engineer.",
    "context": "The product needed a self-serve assistant that could answer from a curated knowledge base."
  },
  "constraints": [
    "No paid vector database at launch.",
    "The assistant had to stream answers in the browser.",
    "The dashboard had to work on a small free-tier deployment."
  ],
  "approach": [
    {
      "heading": "Ingestion",
      "body": "Documents were normalized, chunked, embedded, and stored in a vector collection keyed by tenant."
    },
    {
      "heading": "Answering",
      "body": "The API retrieved the closest chunks, built a grounded prompt, and streamed the response to the dashboard."
    }
  ],
  "architecture": {
    "summary": "A React dashboard talks to a Node API, which delegates retrieval and generation to a Python service.",
    "components": [
      {
        "name": "Dashboard",
        "role": "Tenant-facing chat and knowledge management",
        "technology": "React, Vite"
      },
      {
        "name": "API",
        "role": "Authentication, tenant isolation, and request routing",
        "technology": "Node.js, Express"
      },
      {
        "name": "AI service",
        "role": "Chunking, embeddings, retrieval, and streaming",
        "technology": "Python, FastAPI"
      }
    ],
    "diagram": {
      "src": "https://media.example.com/project-images/4d2f7a91.webp",
      "alt": "WebChat AI architecture diagram showing the dashboard, API, AI service, and vector store.",
      "width": 1600,
      "height": 900,
      "caption": "Request path from the dashboard to the AI service."
    }
  },
  "keyDecisions": [
    {
      "decision": "Use server-sent events for streaming answers.",
      "rationale": "The browser needed incremental tokens without a WebSocket server.",
      "tradeoff": "One-way streaming only; interactive follow-ups use a new request."
    }
  ],
  "challenges": [
    {
      "problem": "Tenant isolation had to hold across ingestion and retrieval.",
      "resolution": "Every stored chunk and query carried a tenant identifier.",
      "lesson": "Isolation is cheaper to enforce at the data model than to patch at the UI."
    }
  ],
  "outcomes": [
    {
      "kind": "quantitative",
      "statement": "Reduced median first-token latency from 1.8 s to 420 ms on the reference deployment.",
      "metric": "median first-token latency",
      "value": "420",
      "unit": "ms",
      "baseline": "1.8 s",
      "direction": "lower",
      "evidence": {
        "status": "verified",
        "source": "Lighthouse and server timing report captured on 2025-03-14; stored in the project evidence folder.",
        "url": "https://example.com/evidence/webchat-latency",
        "note": "Reference deployment only; not a production SLA."
      }
    },
    {
      "kind": "qualitative",
      "statement": "The dashboard let a non-engineer update the knowledge base without a redeploy.",
      "evidence": null
    }
  ],
  "learnings": [
    "Grounding the prompt in retrieved chunks was more valuable than increasing model size.",
    "Streaming changed the perceived latency more than a faster non-streaming response."
  ],
  "gallery": [
    {
      "src": "https://media.example.com/project-images/9f2c1a7e.webp",
      "alt": "WebChat AI chat panel with a streamed answer and source citations.",
      "width": 1600,
      "height": 900,
      "caption": "Streamed answer with retrieved sources."
    }
  ],
  "links": [
    {
      "label": "Source code",
      "url": "https://github.com/riturajlabs/webchat-AI",
      "kind": "source"
    }
  ]
}
```

The example is illustrative. It is not a claim that those WebChat AI facts or metrics are verified; see §11. Gallery and diagram `src` values use the flat object-storage URL returned by the existing `POST /api/admin/uploads`; the current upload path is `project-images/<uuid>.<ext>` and is not project-scoped. Nested local paths are not assumed; see §5.10.

### 4.2 Key naming and API mapping

| Layer | Outer key | Nested keys | Rule |
| --- | --- | --- | --- |
| Database | `case_study` | camelCase | Column name follows the existing snake_case schema. The JSONB document is the versioned contract. |
| Admin API | `case_study` | camelCase | Preserves the admin snake_case convention for the column while keeping one nested contract. |
| Public API | `caseStudy` | camelCase | Mirrors the existing public camelCase project shape. |
| Frontend validator | `caseStudy` | camelCase | Same contract as the public API. |
| AI validator | `caseStudy` | camelCase | Mirrors the public API key-for-key. |

**PROPOSED** This is a deliberate exception to the admin snake_case rule. Creating a second snake_case nested document and mapping it to camelCase would produce two contracts and two sets of validators for no benefit. The outer key split is preserved exactly; only the document body is canonical camelCase.

### 4.3 Presence and clearing semantics

| Operation | Request | Stored result | Public result | Meaning |
| --- | --- | --- | --- | --- |
| Create, field omitted | `POST /api/admin/projects` without `case_study` | `NULL` | `caseStudy: null` | No case study. |
| Create, explicit null | `case_study: null` | `NULL` | `caseStudy: null` | No case study. |
| Create, empty object | `case_study: {}` | Rejected `422` | n/a | Invalid; use `null` to mean absent. |
| Create, version only | `case_study: {"schemaVersion": 1}` | Rejected `422` | n/a | Empty case study; use `null` to mean absent. |
| Update, field omitted | `PUT` without `case_study` | Unchanged | Unchanged | Partial update. |
| Update, explicit null | `case_study: null` | `NULL` | `caseStudy: null` | Clear the case study. |
| Update, valid object | `case_study: {...}` | Whole document replaced | New document | Replace, never deep-merge. |
| Update, invalid object | `case_study: {...}` | Rejected `422` | Unchanged | Validation failure. |
| Read, stored invalid/unknown version | n/a | Remains in row | `caseStudy: null` + warning log | Public page degrades to fallback; admin can recover the raw value. |
| Read, pre-migration backend | n/a | n/a | Key absent | New frontend and AI clients normalize a missing key to `null`; this is the rollout/rollback tolerance path. |

**PROPOSED** The canonical post-migration public shape always includes `caseStudy`. A pre-migration backend omits it. New clients must accept both shapes so that new frontend/AI code can run against an older backend and so that backend-first rollback is safe. See §14.3.

**PROPOSED** `PUT` is not changed to `PATCH`. The route keeps its existing name and partial semantics. When `case_study` is present, the whole document is replaced. There is no deep merge, because a merge would silently retain nested fields the author removed and would make stale evidence hard to delete.

### 4.4 Text and value rules

- **PROPOSED** All text is plain text. No HTML, no Markdown, no `dangerouslySetInnerHTML`. The renderer escapes text and preserves paragraph breaks.
- **PROPOSED** Strings are trimmed. Optional strings that become empty are normalized to `null`. Required strings that are blank are rejected.
- **PROPOSED** Arrays preserve author order. The renderer uses that order. No client-side sorting.
- **PROPOSED** Unknown keys are rejected at every level on the server and in the AI mirror with `extra="forbid"`.
- **PROPOSED** `schemaVersion` is required and must be exactly `1` in this phase. A future version is a new contract and a new validator.
- **PROPOSED** A non-null document must contain at least one substantive field besides `schemaVersion`. A document containing only `schemaVersion` is rejected.
- **PROPOSED** `long_description` is not read or written by the case-study contract. It remains exclusively the source of `highlights`.

---

## 5. Field Validation Matrix

**PROPOSED** The following matrix is the implementation contract. Every nested object is `extra="forbid"`. Every field is optional unless marked required. The server is the authority; the admin UI mirrors the rules for feedback only.

### 5.1 Top-level document

| Path | Type | Required | Rules | Consumer |
| --- | --- | --- | --- | --- |
| `schemaVersion` | integer | Yes | Exactly `1`. Unsupported versions are `422`. | Backend, frontend, AI |
| `role` | string or null | No | Trimmed; 1–120 characters when present. | Public, admin, AI |
| `timeline` | object or null | No | See 5.2. At least one field when present. | Public, admin, AI |
| `team` | object or null | No | See 5.3. At least one field when present. | Public, admin, AI |
| `problem` | object or null | No | See 5.4. | Public, admin, AI |
| `constraints` | array of strings | No | Max 12 items; each 1–240 characters; no blank items. | Public, admin, AI |
| `approach` | array of objects | No | Max 12 items; see 5.5. | Public, admin, AI |
| `architecture` | object or null | No | See 5.6. | Public, admin, AI |
| `keyDecisions` | array of objects | No | Max 10 items; see 5.7. | Public, admin, AI |
| `challenges` | array of objects | No | Max 10 items; see 5.8. | Public, admin, AI |
| `outcomes` | array of objects | No | Max 12 items; see 5.9 and §6. | Public, admin, AI |
| `learnings` | array of strings | No | Max 12 items; each 1–300 characters; no blank items. | Public, admin, AI |
| `gallery` | array of image objects | No | Max 12 items; see 5.10. | Public, admin |
| `links` | array of link objects | No | Max 10 items; see 5.11. | Public, admin, AI |

**Semantic rule:** at least one of `role`, `timeline`, `team`, `problem`, `constraints`, `approach`, `architecture`, `keyDecisions`, `challenges`, `outcomes`, `learnings`, `gallery`, or `links` must be substantive. `{"schemaVersion": 1}` and all-blank documents are rejected.

### 5.2 `timeline`

| Path | Type | Required | Rules |
| --- | --- | --- | --- |
| `timeline.label` | string or null | No | 1–80 characters when present. |
| `timeline.start` | string or null | No | `YYYY` or `YYYY-MM`; month must be `01`–`12`. |
| `timeline.end` | string or null | No | Same shape as `start`. If both are present, compare normalized endpoints, not raw strings. |
| `timeline.duration` | string or null | No | 1–40 characters when present. |

At least one of `label`, `start`, `end`, or `duration` must be present and non-blank when `timeline` is present.

**Comparison rule:** normalize each endpoint to a `(year, month)` pair before comparing. For `start`, a year-only value expands to `YYYY-01` (beginning of year). For `end`, a year-only value expands to `YYYY-12` (end of year). A `YYYY-MM` value is unchanged. The timeline is valid when normalized `start <= end`. Partial dates are allowed, and `start` and `end` may be independently partial. No day component is accepted: `YYYY-MM-DD` is invalid. Invalid months such as `2025-00`, `2025-13`, or `2025-1` are rejected.

| `start` | `end` | Normalized comparison | Result |
| --- | --- | --- | --- |
| `2025` | `2025-12` | `2025-01 <= 2025-12` | Valid |
| `2025-06` | `2025` | `2025-06 <= 2025-12` | Valid |
| `2025` | `2025` | `2025-01 <= 2025-12` | Valid |
| `2025-06` | `2025-06` | `2025-06 <= 2025-06` | Valid |
| `2026-01` | `2025` | `2026-01 <= 2025-12` | Invalid |
| `2025-12` | `2025-06` | `2025-12 <= 2025-06` | Invalid |
| `2025-13` | any | n/a | Invalid month |

If only `start` or only `end` is present, no comparison is performed. `duration` remains free text and is not derived from `start`/`end`.

### 5.3 `team`

| Path | Type | Required | Rules |
| --- | --- | --- | --- |
| `team.size` | integer or null | No | `1 <= size <= 1000`. |
| `team.roles` | array of strings | No | Max 10 items; each 1–60 characters; no blank items. |
| `team.note` | string or null | No | 1–200 characters when present. |

At least one of `size`, `roles`, or `note` must be present and non-blank when `team` is present.

### 5.4 `problem`

| Path | Type | Required | Rules |
| --- | --- | --- | --- |
| `problem.summary` | string | Yes when `problem` is present | 1–1200 characters; non-blank. |
| `problem.context` | string or null | No | 1–2000 characters when present. |

### 5.5 `approach[]`

| Path | Type | Required | Rules |
| --- | --- | --- | --- |
| `approach[].heading` | string | Yes | 1–120 characters; non-blank. |
| `approach[].body` | string | Yes | 1–2000 characters; non-blank. |

### 5.6 `architecture`

| Path | Type | Required | Rules |
| --- | --- | --- | --- |
| `architecture.summary` | string | Yes when `architecture` is present | 1–2000 characters; non-blank. |
| `architecture.components` | array of objects | No | Max 20 items. |
| `architecture.components[].name` | string | Yes | 1–80 characters; non-blank. |
| `architecture.components[].role` | string | Yes | 1–240 characters; non-blank. |
| `architecture.components[].technology` | string or null | No | 1–120 characters when present. |
| `architecture.diagram` | image object or null | No | See 5.10. |

### 5.7 `keyDecisions[]`

| Path | Type | Required | Rules |
| --- | --- | --- | --- |
| `keyDecisions[].decision` | string | Yes | 1–240 characters; non-blank. |
| `keyDecisions[].rationale` | string | Yes | 1–1200 characters; non-blank. |
| `keyDecisions[].tradeoff` | string or null | No | 1–800 characters when present. |

### 5.8 `challenges[]`

| Path | Type | Required | Rules |
| --- | --- | --- | --- |
| `challenges[].problem` | string | Yes | 1–600 characters; non-blank. |
| `challenges[].resolution` | string | Yes | 1–1200 characters; non-blank. |
| `challenges[].lesson` | string or null | No | 1–600 characters when present. |

### 5.9 `outcomes[]`

| Path | Type | Required | Rules |
| --- | --- | --- | --- |
| `outcomes[].kind` | string | Yes | `"quantitative"` or `"qualitative"`. |
| `outcomes[].statement` | string | Yes | 1–400 characters; non-blank. |
| `outcomes[].metric` | string or null | Quantitative: yes | 1–120 characters when present. |
| `outcomes[].value` | string or null | Quantitative: yes | 1–60 characters when present. String preserves formatting such as `"420"` or `"<1"`. |
| `outcomes[].unit` | string or null | No | 1–30 characters when present. |
| `outcomes[].baseline` | string or null | No | 1–120 characters when present. |
| `outcomes[].direction` | string or null | No | `"higher"`, `"lower"`, `"neutral"`, or `null`. |
| `outcomes[].evidence` | object or null | Quantitative: yes | See 5.12. |

**Semantic rules:**

- Quantitative outcomes require `metric`, `value`, and `evidence`.
- Qualitative outcomes must not carry `metric`, `value`, `unit`, `baseline`, or `direction`. They may carry `evidence` or `null`.
- Quantitative outcomes with `evidence.status = "unverified"` are stored for admin review but omitted from public rendering and AI ingestion. They do not render as metric cards, values, or placeholders.
- `statement` is the only required human-readable field for a qualitative outcome.

### 5.10 Image object (`gallery[]`, `architecture.diagram`)

| Path | Type | Required | Rules |
| --- | --- | --- | --- |
| `src` | string | Yes | Absolute `http(s)` URL or the existing flat in-repo path `/images/projects/<project-slug>.webp`. No nested local path, `data:`, `javascript:`, whitespace, quotes, or angle brackets. |
| `alt` | string | Yes | 1–300 characters; non-blank. |
| `width` | integer | Yes | Positive integer. |
| `height` | integer | Yes | Positive integer. |
| `caption` | string or null | No | 1–300 characters when present. |

**Source rule:** gallery and diagram images should use the object-storage URL returned by the existing `POST /api/admin/uploads` route. That route stores a flat, server-generated key `project-images/<uuid>.<ext>`; it does not create nested project directories and returns the anonymous public URL plus server-measured dimensions. It is deliberately not project-scoped and accepts no caller-supplied path, so path traversal and cross-project path selection do not apply to the upload itself. The existing `project.image` validator and database CHECK accept only the flat `/images/projects/<slug>.webp` path or an absolute `http(s)` URL; they do not accept `/images/projects/<slug>/<file>.webp`. Gallery/diagram `src` lives inside JSONB, so it is validated by the case-study schema rather than the cover-image CHECK. Supporting nested committed gallery paths would require a new validator rule; changing the cover-image column would separately require a database CHECK change. Both are out of scope for this design. Remote URLs are not fetched by the build.

**Dimension rule:** the server measures the uploaded image bytes; the admin must not trust or accept client-supplied width/height as authoritative. The existing upload determines the format from the bytes, not from the filename or client MIME type, then measures dimensions from the WebP/PNG/JPEG/GIF header. The WebP check is a RIFF/WEBP header sniff plus variant-header parsing, not a full decode. It is a format sniff, not a full image decode, and it does not prove the image is visually valid. The build cross-checks persisted cover-image dimensions against the real file; gallery/diagram dimensions should come from the same upload response.

### 5.11 `links[]`

| Path | Type | Required | Rules |
| --- | --- | --- | --- |
| `links[].label` | string | Yes | 1–80 characters; non-blank. |
| `links[].url` | string | Yes | Absolute `http(s)` URL; no whitespace, quotes, or angle brackets. |
| `links[].kind` | string | Yes | `"demo"`, `"source"`, `"writeup"`, or `"other"`. |

Duplicate URLs within `links` are rejected or de-duplicated deterministically. The recommendation is to reject duplicates with a field error so the author sees the mistake.

### 5.12 `evidence`

| Path | Type | Required | Rules |
| --- | --- | --- | --- |
| `evidence.status` | string | Yes when `evidence` is present | `"verified"`, `"reported"`, or `"unverified"`. |
| `evidence.source` | string or null | Yes for `verified` and `reported` | 8–500 characters; must be descriptive prose, not a bare URL. |
| `evidence.url` | string or null | No | Absolute `http(s)` URL; supplementary only. |
| `evidence.note` | string or null | No | 1–500 characters when present. |

**Semantic rules:**

- `source` must not match `^https?://\S+$`. A URL alone is never a source.
- `verified` requires a descriptive `source` that names an inspectable artifact: a benchmark report, Lighthouse export, test log, commit, dashboard export, issue, or design document.
- `reported` requires a descriptive `source` that identifies the claim as owner-reported when no artifact exists.
- `unverified` may omit `source`; if present, it must still be descriptive.
- `url` is optional for every status and never substitutes for `source`.
- The server validates evidence metadata only. It does not fetch `url`, open the artifact, or prove that the artifact supports the claim.

### 5.13 Size and normalization

- **PROPOSED** Maximum serialized UTF-8 size of the whole case-study document: 32 KiB.
- **PROPOSED** Maximum nesting depth: 4 (document → section → item → evidence). This is naturally enforced by the schema.
- **PROPOSED** Strings are normalized with `strip()`. Empty optional strings become `null`. Empty required strings are `422`.
- **PROPOSED** Unknown keys anywhere are `422` with a field path such as `case_study.outcomes[0].evidence.source`.
- **PROPOSED** No HTML or Markdown is accepted as a special format. Text is text.

---

## 6. Evidence and Outcome Model

### 6.1 Why evidence is part of the contract

**INFERRED** A portfolio case study is a trust document. Unsupported numerical claims are the easiest thing to fabricate and the hardest thing for a reader to check. The contract therefore makes evidence a first-class part of an outcome rather than a free-text metric string.

**PROPOSED** Every numerical metric must have an explicit evidence status and a source. Outcomes without numerical metrics are allowed as qualitative statements. A URL alone is not verification.

**Attestation boundary:** `verified` is an author attestation that an inspectable artifact was examined and supports the claim. The application can validate the presence and shape of evidence metadata; it cannot independently prove that an artifact exists or that it supports the claim. It does not fetch evidence URLs, inspect private artifacts, or verify benchmark methodology. Manual review remains necessary.

### 6.2 Evidence statuses

| Status | Meaning | Source requirement | Public rendering | AI ingestion |
| --- | --- | --- | --- | --- |
| `verified` | The author attests that an inspectable artifact was actually examined and supports the claim. | Required; descriptive prose naming the artifact. | Quantitative: normal metric rendering with a “Verified” badge. Qualitative: statement with a “Verified” badge. | Included with the exact `verified` status. |
| `reported` | The author reports the result, but no independently examined artifact is available. | Required; must identify the claim as reported. | Quantitative: metric rendering with a visible “Reported” badge. Qualitative: statement with a “Reported” label. | Included with the exact `reported` status. |
| `unverified` | The claim exists but has insufficient evidence to support it. | Optional. | Quantitative: omitted from public rendering. Qualitative: statement with a “Reported” label when rendered; never a measured fact. | Quantitative: excluded. Qualitative: included only as status-preserving context, never as a measured fact. |

**PROPOSED** A URL is a pointer, not evidence. `https://example.com` in `evidence.url` does not make a claim `verified`. `evidence.source` must name what the URL contains or what artifact exists. The validator rejects a `source` that is only a URL. A source description or URL alone never establishes `verified`; it only satisfies the metadata requirement for the author's attestation.

**PROPOSED** Qualitative outcomes without verification are identified as reported when rendered. This includes qualitative outcomes with no `evidence`, `reported` evidence, or `unverified` evidence. They never receive a “Verified” badge and never become measured outcomes. The stored status is preserved for admin and AI; the public “Reported” label is a display choice, not an upgrade to `reported`.

### 6.3 Quantitative outcomes

**PROPOSED** A quantitative outcome is a claim that includes a metric and a value. It requires:

- `kind: "quantitative"`
- `metric`
- `value`
- `evidence`
- optionally `unit`, `baseline`, and `direction`

Examples of valid quantitative claims:

- “Reduced p95 response time from 1.8 s to 420 ms.”
- “Cut build time from 90 s to 35 s.”
- “Reduced bundle size by 38%.”

The evidence source must describe how the number was obtained. A commit URL alone is not sufficient unless the commit contains the benchmark or measurement artifact.

### 6.4 Qualitative outcomes

**PROPOSED** A qualitative outcome is a factual statement without a numerical metric. It does not require evidence, but it must not smuggle a number into `statement` while omitting the quantitative fields. If evidence is absent, `reported`, or `unverified`, the public renderer labels the statement “Reported”; only `verified` qualitative outcomes receive a “Verified” badge.

Examples:

- “The dashboard let a non-engineer update the knowledge base without a redeploy.”
- “The system isolated tenant data across ingestion and retrieval.”

**PROPOSED** The validator does not attempt to detect every number inside prose. The admin UI warns when a qualitative statement appears to contain a number, but the hard rule is that the structured `metric`/`value` fields are what make an outcome quantitative. Authors who want a numerical claim must use the quantitative shape.

### 6.5 Rendering rules

**PROPOSED**

- `verified` quantitative outcomes render normally with a “Verified” badge and an optional source link.
- `reported` quantitative outcomes render with a “Reported” badge and a visible source note.
- `unverified` quantitative outcomes are omitted from public rendering entirely. Do not render the statement, metric, value, unit, baseline, or a placeholder; the admin preview shows them as withheld.
- Qualitative outcomes render as statements without metric cards.
- Qualitative outcomes with `verified` evidence render with a “Verified” badge. Qualitative outcomes with no evidence, `reported`, or `unverified` evidence render with a “Reported” label.
- The public page must not aggregate outcomes into a single “results” number. Aggregation would invent a claim the evidence does not support.
- JSON-LD must not add `aggregateRating`, `review`, `offers`, `numberOfDownloads`, user counts, or awards based on case-study outcomes. The existing `SoftwareApplication` graph remains unchanged.

### 6.6 AI rules

**PROPOSED**

- Only `verified` and `reported` quantitative outcomes are ingested.
- `unverified` quantitative outcomes are excluded from the AI knowledge store.
- Qualitative outcomes may be ingested as project context with their exact stored evidence status. If no evidence is present, mark the chunk as reported context; never mark it verified.
- The chunk text preserves the exact status, for example “Outcome (reported): …” or “Outcome (unverified, qualitative): …”.
- The prompt must instruct the model never to upgrade `reported` or `unverified` to `verified`, never to present unverified quantitative values, and never to invent a metric.
- The model must not turn qualitative statements into measured outcomes.

### 6.7 WebChat AI evidence

**VERIFIED** The WebChat AI implementation source is absent from this repository. The external repository and live URL are known, but neither is evidence of implementation details or performance.

**PROPOSED** For WebChat AI, the default evidence status is `unverified` until an inspectable artifact is supplied. A source repository URL alone is not enough to mark architecture claims `verified`; the author must point to the specific commit, file, diagram, or report. Performance metrics require a measurement artifact; if absent, use `unverified` and the value will be withheld from public rendering and AI. Qualitative claims can be published as “Reported” with `reported`/`unverified` status.

---

## 7. Backend/API Design

### 7.1 Model and schemas

**PROPOSED**

- `backend/app/models/project.py`: add `case_study: Mapped[dict[str, Any] | None] = mapped_column(JSONB)` and the object-type CHECK.
- `backend/alembic/versions/0005_project_case_study.py`: add the nullable column and CHECK. No backfill.
- `backend/app/schemas/content.py`: add `CaseStudy`, `Timeline`, `Team`, `Problem`, `ApproachSection`, `Architecture`, `ArchitectureComponent`, `KeyDecision`, `Challenge`, `Outcome`, `Evidence`, `ImageAsset`, and `CaseStudyLink` models. Add `caseStudy: CaseStudy | None = None` to `Project`.
- `backend/app/schemas/admin_content.py`: import and reuse the public `CaseStudy` model for create/update validation. Add `case_study: CaseStudy | None = None` to `ProjectCreateIn` and `ProjectUpdateIn`. Add `case_study: dict[str, Any] | None = None` to `ProjectOut` as a raw recovery value.
- `backend/app/services/content.py`: select `Project.case_study`; validate it with the v1 model; attach `caseStudy` to each public project dict.
- `backend/app/services/admin_content.py`: the existing generic `model_dump()`/`setattr()` update path already handles a new field. No new upload behavior is needed. Validate gallery/diagram `src` with the existing flat in-repo pattern or an absolute upload URL; do not add a slug-dependent nested-path check.
- `backend/app/routes/admin_content.py`: include `case_study=row.case_study` in `_project_out`.
- No new route is required. `PUT /api/admin/projects/{id}` remains the single update path.

### 7.2 Public API contract

**PROPOSED** `GET /api/content` gains one field on each project:

```json
{
  "slug": "webchat-ai",
  "title": "WebChat AI",
  "description": "...",
  "longDescription": "...",
  "highlights": ["..."],
  "caseStudy": null
}
```

- `caseStudy` is always present after the backend migration. It is `null` for projects with `case_study = NULL`. New frontend and AI clients also accept a missing key and normalize it to `null` during rollout and rollback.
- The key is camelCase, matching the rest of the public project contract.
- The existing `description`, `longDescription`, and `highlights` semantics are unchanged.
- The existing ETag and cache headers are unchanged. Saving a case study updates `project.updated_at`, so `meta.generated_at` changes and the ETag changes.
- `meta.version` remains `1`; the case-study contract has its own `schemaVersion`.

**PROPOSED** If a stored case study is invalid or has an unsupported `schemaVersion`, the public assembly logs a structured warning and emits `caseStudy: null` for that project rather than failing the whole content endpoint. This keeps the public site and build available while the owner fixes the row. The admin GET returns the raw stored object so it can be recovered. A test must pin this degradation behavior.

**Rationale:** The existing content endpoint is fail-closed for missing profile data, but a single malformed optional section should not take down all five project pages and the homepage. The admin write boundary is strict, so invalid stored data is a bug, not an expected state. The warning log makes it visible.

### 7.3 Admin API contract

**PROPOSED**

- `ProjectOut` gains `case_study` (snake_case outer key). Its value is the raw JSONB object or `null`.
- `ProjectCreateIn` and `ProjectUpdateIn` accept `case_study` as a validated `CaseStudy` object or `null`.
- `ProjectListItem` does not gain `case_study`. The list stays small; the editor loads the full row.
- `ProjectUpdateIn._PROJECT_NON_NULLABLE` does not include `case_study`, so explicit `null` is allowed and clears it.
- `PUT` remains partial. Omitted `case_study` means unchanged. Present `null` means clear. Present object means replace.
- `POST /api/admin/projects` omitted or `null` stores `NULL`.
- `POST /api/admin/projects` with `{}` or `{"schemaVersion": 1}` is `422`.
- `PUT` with `{}` or `{"schemaVersion": 1}` is `422`.
- Unsupported `schemaVersion` is `422`.
- Unknown nested keys are `422` with field paths.
- Invalid image paths, URLs, evidence sources, and sizes are `422`.
- The existing `If-Unmodified-Since` concurrency check still applies.
- The existing slug immutability rule still applies and is unrelated to case studies.
- Every save writes one `admin_audit_log` row with `case_study` in `before`/`after`.

### 7.4 Error shape

**PROPOSED** Reuse the existing `422 VALIDATION_ERROR` envelope and `fields[]` array. Field names use the admin path, for example:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "fields": [
      {
        "field": "case_study.outcomes[0].evidence.source",
        "message": "Verified outcomes need a descriptive source, not just a URL."
      }
    ]
  }
}
```

No new HTTP status is introduced. No new top-level error code is required; the field path and message carry the specificity. If the owner wants machine-readable subcodes later, they can be added without changing the status.

### 7.5 `long_description` boundary

**PROPOSED** `long_description` remains exactly what it is today: the storage for the bullet lines that `_highlights()` turns into `highlights`. The case-study editor must not write prose into it. The admin UI should add a hint to the existing “Long description” field: “Bullet lines only; these become the Highlights list. Use the Case study section for prose.” This is a UX clarification, not a data migration.

### 7.6 No new endpoint

**PROPOSED** Do not add `PUT /api/admin/projects/{id}/case-study`. The case study is part of the project aggregate. A separate endpoint would need its own concurrency, audit, validation, and publish semantics, and would make it possible to save a project and its case study in two inconsistent transactions. The existing project `PUT` is the correct boundary.

---

## 8. Admin CMS UX Design

### 8.1 Placement and structure

**PROPOSED** Add a “Case study” card to `src/admin/pages/ProjectEditor.jsx`, below “Basics” and above or beside “Search engine”. The card is progressively disclosed:

- When `case_study` is `null`: show a short explanation and an “Add case study” button.
- When `case_study` is present: show a status line (“Case study v1”) and a “Remove case study” button.
- The rest of the fields are grouped into collapsible sections so the editor does not become one wall of inputs.

Recommended groups:

1. **Overview** — role, timeline, team.
2. **Problem** — summary, context.
3. **Constraints and approach** — constraints list, approach sections.
4. **Architecture** — summary, components, diagram.
5. **Decisions and challenges** — key decisions, challenges.
6. **Outcomes and evidence** — outcomes, evidence editor.
7. **Learnings and links** — learnings, links.
8. **Gallery** — image assets.

### 8.2 Field controls

| Contract field | Admin control |
| --- | --- |
| `role` | Text input. |
| `timeline` | Text inputs for label/start/end/duration. Start/end accept `YYYY` or `YYYY-MM`; the client mirrors the normalized year-only start/end comparison. |
| `team` | Number input for size; repeatable text inputs for roles; textarea for note. |
| `problem` | Textarea for summary; textarea for context. |
| `constraints` | Repeatable single-line text inputs with add/remove and up/down order controls. |
| `approach` | Repeatable group: heading input + body textarea. |
| `architecture` | Summary textarea; repeatable component group (name, role, technology); image asset group for diagram. |
| `keyDecisions` | Repeatable group: decision, rationale, tradeoff. |
| `challenges` | Repeatable group: problem, resolution, lesson. |
| `outcomes` | Repeatable group: kind select, statement, metric, value, unit, baseline, direction, evidence subgroup. |
| `learnings` | Repeatable single-line text inputs. |
| `gallery` | Repeatable image group: source/upload, alt, width, height, caption. |
| `links` | Repeatable group: label, URL, kind select. |

### 8.3 Evidence editor

**PROPOSED** The evidence subgroup is not a raw JSON box. It has:

- Status select: `verified`, `reported`, `unverified`.
- Source textarea with a hint: “Name the artifact. A URL alone is not a source.”
- URL input, optional.
- Note textarea, optional.

Live client-side warnings:

- Quantitative outcome with no evidence: “Quantitative outcomes need evidence before this can be saved.”
- `verified` with a source that looks like a bare URL: “A URL alone is not verification. Describe the artifact.”
- `reported` with no source: “Say what the claim is based on.”
- `unverified` with a metric: “This will be stored for admin review but will be omitted from the public page and the AI.”

The server remains the authority. The client warnings are for feedback and should mirror the server messages. The evidence status is an author attestation; the server validates metadata only and cannot prove the artifact supports the claim.

### 8.4 Add, remove, and clear

**PROPOSED**

- “Add case study” creates a local draft object `{schemaVersion: 1}` in the form, but the form must not submit that object until it has at least one substantive field. The save path sends the full object or `null`.
- “Remove case study” opens a confirmation dialog. On confirm, the form sets `case_study` to `null` and the save sends `case_study: null`. This is the only clear operation.
- The editor never sends `{}`. An empty local draft is treated as “not yet a case study” and is not submitted.
- If the owner saves a project with no case study, the request omits `case_study` on create or sends `null` only when clearing on update. This distinction matters for the partial `PUT` semantics.

### 8.5 Draft and publish behavior

**PROPOSED** There is no case-study-specific draft state in v1. The project's existing `status` (`published`/`hidden`) and `indexable` controls remain the only visibility controls.

- A case study is saved as part of the project row and is immediately part of the public content when the project is published.
- The owner can keep a project `hidden` while authoring a case study.
- There is no separate “publish case study” button. `POST /api/admin/publish` remains the rebuild/re-ingest trigger after content changes.
- Incomplete case studies are allowed as long as the document is structurally valid. The renderer skips absent sections. The editor shows a completeness hint but does not block a valid partial document.
- If the owner wants a hard “not ready” state, they should use `status: "hidden"` or omit `case_study` until ready. Adding a `caseStudy.status` field would create a second publishing model and is not recommended.

### 8.6 Recovery and raw JSON fallback

**PROPOSED** Because the admin GET returns the raw stored object, the editor can detect a stored document that does not validate. In that case it shows a warning banner and a raw JSON textarea pre-filled with the stored value, alongside the structured editor. The owner can fix the raw value and save. This is a recovery path only; the normal authoring path is the structured form.

### 8.7 Accessibility and interaction

**PROPOSED**

- Use `fieldset`/`legend` for repeatable groups.
- Every input has a label and inline error, following the existing `Field` primitive.
- Errors use `role="alert"` and field paths.
- Reordering uses explicit “Move up”/“Move down” buttons, not drag-only interaction.
- Remove buttons are labelled with the item they remove, not just “Remove”.
- The card is keyboard operable and does not trap focus.
- The editor does not autosave; the existing explicit save model is preserved.

### 8.8 Save path

**PROPOSED** The editor builds the same request body as today, adding:

```js
case_study: form.case_study === null ? null : form.case_study
```

For create, if the owner has not added a case study, omit the key. For update, only include `case_study` when the owner changed it or explicitly cleared it. The existing `If-Unmodified-Since` header remains. No new API client method is needed.

---

## 9. Public Frontend Design

### 9.1 One renderer, progressive sections

**PROPOSED** Keep a single `ProjectPage` renderer for every project. Add a `CaseStudy` component that receives `project.caseStudy` and renders only the sections that exist.

Recommended order:

1. Overview facts: role, timeline, team.
2. Problem.
3. Constraints.
4. Approach.
5. Architecture.
6. Key decisions.
7. Challenges.
8. Outcomes.
9. Learnings.
10. Gallery.
11. Links.

The existing header, cover image, tech stack, highlights, actions, related projects, and footer remain.

### 9.2 Fallback behavior

**PROPOSED**

- `caseStudy === null` or absent: render exactly today's page. No new empty headings, no “Case study coming soon”, no layout shift.
- `caseStudy` present but a section absent: skip that section and its nav link.
- `caseStudy.problem` absent: keep the existing “About this project” section as the fallback prose block. If `problem` is present, use the Problem section and do not render the duplicate “About this project” paragraph. This resolves the current duplicate description at `ProjectPage.jsx:75-76` and `:143-146` for case-study pages without changing fallback pages.
- Existing `highlights` remain independent and continue to render from `long_description`.

### 9.3 Section navigation

**PROPOSED** Extend the sticky nav to include only case-study sections that are actually rendered. The nav must not contain dead anchors. A helper such as `caseStudySections(caseStudy)` can return the ordered section descriptors and is shared by the nav and the body.

The existing nav behavior and CSS-sticky, no-JS approach remain. Add `scroll-margin-top` for the new section ids.

### 9.4 Outcomes rendering

**PROPOSED**

- Quantitative verified: metric value, unit, baseline, statement, “Verified” badge, optional source link.
- Quantitative reported: same, with a “Reported” badge.
- Quantitative unverified: omitted entirely from public rendering; no statement, metric, value, unit, baseline, or placeholder.
- Qualitative verified: statement with a “Verified” badge and optional evidence note.
- Qualitative with no evidence, `reported`, or `unverified` evidence: statement with a “Reported” label. No metric card.
- Do not aggregate outcomes.
- Do not use outcome text in JSON-LD ratings or reviews.

### 9.5 Gallery and images

**PROPOSED**

- Render `<figure>` with `<img width height loading="lazy" decoding="async" alt="...">` and optional `<figcaption>`.
- Use explicit dimensions from the contract to reserve layout space. For uploaded images, those dimensions come from the server-measured upload response, not from client input.
- Gallery and diagram images use the object-storage URL returned by the existing flat `POST /api/admin/uploads` route, or the existing flat `/images/projects/<slug>.webp` path where appropriate. The build does not fetch remote images.
- Nested local paths such as `/images/projects/<slug>/<file>.webp` are not supported by the current flat cover-image convention and are not added by the gallery schema; they are out of scope unless a separate validator change is approved.
- The cover image remains eager/high priority; gallery images are lazy.
- No lightbox or client-side JavaScript is required in v1. A plain image grid is sufficient and keeps the page static.

### 9.6 Links

**PROPOSED**

- Render case-study links as a labelled list or button group.
- De-duplicate by URL against `project.live` and `project.github`.
- Do not render a case-study link that points to `#` or an empty value.
- Keep `rel="noopener noreferrer"` and `target="_blank"` for external links.

### 9.7 SEO and structured data

**PROPOSED**

- `seoTitle`, `seoDescription`, canonical URL, Open Graph, Twitter card, and JSON-LD remain driven by `src/lib/projectPages.js` and the existing project fields.
- Do not auto-generate meta descriptions from case-study text in v1. That would introduce a second SEO source of truth.
- Case-study text is present in the prerendered HTML, so crawlers can read it.
- Do not add `aggregateRating`, `review`, `offers`, user counts, or performance claims to JSON-LD from case-study outcomes.
- The `SoftwareApplication` `description` remains `seoDescription`.
- The sitemap and `llms.txt` URL set do not change. Case studies do not create new routes.

### 9.8 Performance and static safety

**PROPOSED**

- `CaseStudy` must not touch browser globals, so it remains safe for `renderToStaticMarkup`.
- No new runtime dependency.
- Case-study HTML increases page weight; the 32 KiB document cap and the payload budget test keep this bounded.
- Images use explicit dimensions to avoid CLS.
- The page still ships no JavaScript for the case-study sections.

### 9.9 Styling

**PROPOSED** Add styles to `src/styles/project-page.css` for:

- `.project-page-case-study`
- `.project-page-facts`
- `.project-page-outcome`
- `.project-page-evidence-badge`
- `.project-page-gallery`
- `.project-page-decisions`
- `.project-page-challenges`

Use existing CSS variables and design tokens. Do not introduce a new design system or a CSS framework.

### 9.10 Component boundaries

**PROPOSED**

- `src/components/project/CaseStudy.jsx` — top-level progressive renderer.
- `src/components/project/CaseStudyOutcome.jsx` — outcome card and evidence badge.
- `src/components/project/CaseStudyImage.jsx` — optional shared image/figure renderer.
- `src/components/pages/ProjectPage.jsx` — imports `CaseStudy` and extends the nav.

Keep the components small and prop-driven. No project-specific branching by slug.

---

## 10. AI Integration Design

### 10.1 Contract mirror

**PROPOSED** Add the same `CaseStudy` models to `ai_service/services/content_api.py` and add `caseStudy: CaseStudy | None = None` to its `Project` model. Keep `extra="forbid"` at every level.

**Critical rollout constraint:** the AI validator is strict. If the backend starts emitting `caseStudy` before the AI service accepts it, ingestion fails closed and `/ready` stays unavailable. The AI validator must accept absent, `null`, and valid documents, and must be deployed before or with the backend change that emits the field. The new AI service must also tolerate an older backend that omits the key. See §14.3.

### 10.2 Section and chunk design

**PROPOSED** Keep the existing `projects` section for summary facts, but explicitly exclude `caseStudy` from it:

```python
"projects": {
    p.slug: p.model_dump(exclude={"caseStudy"})
    for p in content.projects
}
```

Add a dedicated section:

```python
"project_case_studies": {
    p.slug: _case_study_sections(p.caseStudy)
    for p in content.projects
    if p.caseStudy is not None
}
```

`_case_study_sections` should produce readable, field-level text rather than one giant nested dict. Recommended keys:

- `overview` — role, timeline, team, problem summary/context.
- `constraints` — bullet list.
- `approach` — heading/body pairs.
- `architecture` — summary, components, diagram caption.
- `key_decisions` — decision/rationale/tradeoff pairs.
- `challenges` — problem/resolution/lesson pairs.
- `outcomes` — verified and reported quantitative outcomes, plus qualitative outcomes with their exact evidence status and source.
- `learnings` — bullet list.
- `links` — label/URL pairs, if useful for retrieval.

Why a separate section:

- **VERIFIED** `_chunk_section` emits one chunk per top-level key of a dict. If `caseStudy` stayed inside the project dict, the entire case study would become one large nested chunk and would not get the long-text sliding-window treatment.
- **PROPOSED** Field-level keys produce smaller, more retrievable chunks and preserve stable chunk IDs per field.

### 10.3 Knowledge source registry

**PROPOSED** Add `project_case_studies` to `KNOWLEDGE_SOURCES` in `ai_service/services/knowledge_loader.py:443-456` and update `ai_service/tests/test_ingestion.py` to pin the new set.

The intent classifier does not need a new rule in v1. Queries about architecture, decisions, challenges, or outcomes will fall through to an unfiltered scan and can retrieve the new chunks. Adding a narrow rule later is possible but not required.

### 10.4 Evidence handling

**PROPOSED**

- Ingest `verified` and `reported` quantitative outcomes.
- Exclude `unverified` quantitative outcomes from the AI store.
- Include qualitative outcomes as project context with their exact evidence status; if no evidence is present, label them as reported context.
- Include the exact evidence status in the chunk text, for example: “Outcome (reported): … Source: …” or “Outcome (unverified, qualitative): …”.
- Never let the model present a reported or unverified claim as verified, and never let it turn a qualitative statement into a measured outcome.

### 10.5 Prompt correction

**VERIFIED** The current prompt says “three main projects” and names only Orbit AI, Stayora, and Scientific Calculator. The content API has five projects.

**PROPOSED** Rewrite the prompt rules so they are content-driven:

- Replace “Ritu has developed three main projects” with a generic instruction to list only the projects present in the retrieved context.
- Replace the hardcoded project whitelist with: “The projects are exactly those present in the provided context. Do not hardcode a count or a list. If a project is not in the context, do not claim it exists.”
- Update the few-shot example so it does not enumerate a fixed project set. A generic example or a placeholder-free example is safer than a list that will drift.
- Add a rule about evidence status: “Never state an unverified metric as fact. If the context marks a result as reported, say it is reported.”
- Add a rule: “Do not invent architecture, challenges, decisions, or outcomes that are not in the context.”
- Bump `PROMPT_VERSION` from `2.2.0` to `2.3.0`. This is a behaviour change, not a patch.

### 10.6 Re-ingestion

**PROPOSED** No new ingestion route. `POST /api/admin/publish` already triggers `POST /admin/reingest` on the AI service. Saving a case study updates `project.updated_at`, so the next publish/reingest reconciles the new chunks and deletes stale ones.

### 10.7 Legacy knowledge base

**VERIFIED** `ai_service/knowledge_base.json` is the rollback source and is not the public authority.

**PROPOSED**

- Do not import it wholesale.
- Do not use it to fill case studies automatically.
- If `KNOWLEDGE_SOURCE=file` is used as a rollback, case studies are absent from the AI knowledge, which is acceptable for a rollback mode.
- The parity test should remain an honest `FAIL` and be updated for the new API-only section rather than weakened.

### 10.8 AI tests

**PROPOSED** Add tests for:

- The AI contract accepts an absent `caseStudy`, `caseStudy: null`, and a valid document.
- An old-backend payload without `caseStudy` ingests safely.
- The AI contract rejects unknown nested keys and unsupported versions.
- `sections_from_content` includes `project_case_studies` only for projects with a case study.
- The `projects` section does not duplicate `caseStudy`.
- Unverified quantitative outcomes are not ingested; unverified qualitative outcomes preserve their exact status.
- Chunk IDs are stable for unchanged case-study text and change when the text changes.
- The prompt no longer contains a hardcoded project count or whitelist.
- The prompt version is `2.3.0`.
- The ingestion source set includes `project_case_studies`.

---

## 11. WebChat AI Evidence Requirements

**VERIFIED** This repository does not contain the WebChat AI implementation. The only external links are the source repository and the live deployment. No architecture, performance, scale, user, or reliability claim can be verified from this repository.

**PROPOSED** Before WebChat AI is used as a flagship case study, the owner must supply or confirm inspectable evidence for each claim. The following matrix defines the minimum.

| Claim type | Minimum evidence for `verified` | If unavailable |
| --- | --- | --- |
| Role and team | Owner statement plus a commit history, PR, or project document that supports the role/team description. | Use `reported` and label it. |
| Timeline | Owner statement plus dated commits, releases, or project notes. | Use `reported` or omit exact dates. |
| Problem and constraints | A design note, README, issue, or owner statement. | Use `reported`; do not present as externally verified. |
| Architecture | A diagram, README section, source file, or deployment configuration that names the components. | Use `reported`; do not invent components. |
| Key decisions | A design note, commit message, PR discussion, or owner statement explaining the trade-off. | Use `reported`; label the rationale as owner-reported. |
| Challenges | A commit, issue, PR, or owner statement describing the problem and resolution. | Use `reported`; do not invent a challenge. |
| Quantitative outcomes | A benchmark report, Lighthouse export, test log, analytics export, or measured comparison with method and date. | Use `unverified` (stored but withheld from public and AI) or omit the metric. Do not publish it as a measured result. |
| Qualitative outcomes | Owner statement or project artifact. | `reported` is acceptable. |
| Screenshots/gallery | Actual screenshots or diagrams with alt text and dimensions. | Omit the gallery item. |

**Explicit non-evidence:**

- The live URL alone is not verification of implementation details or performance.
- The GitHub repository URL alone is not verification of architecture, role, timeline, or outcomes.
- A README claim is owner-authored; it can support `reported` but does not independently verify a metric.
- A screenshot without a source or context is not a performance measurement.
- A local demo that cannot be reproduced is not a verified benchmark.

**PROPOSED** Even when this matrix is satisfied, `verified` remains an author attestation. The application validates the metadata and the described source; it does not inspect the artifact or prove that the artifact supports the claim.

**PROPOSED** If the source remains unavailable, the WebChat AI case study can still be published with `reported` problem/approach/learnings and no quantitative outcomes. That is honest and still useful. The AI must not answer implementation questions beyond that content.

---

## 12. Alternatives and Trade-offs

### 12.1 JSONB column versus relational table

| Option | Strengths | Weaknesses | Verdict |
| --- | --- | --- | --- |
| Nullable JSONB column | Atomic with project, one query, flexible contract, existing precedent, simple admin | Weak DB-level structural constraints, not relational-queryable | **Recommended** |
| Relational case-study tables | Strong constraints, queryable outcomes, normalized | Many tables, joins, migrations per field, complex admin and audit, overkill at five projects | Rejected for v1 |

**Decision:** JSONB. Revisit only if outcomes need cross-project analytics or if the document becomes a shared entity across projects.

### 12.2 Structured sections versus generic blocks

| Option | Strengths | Weaknesses | Verdict |
| --- | --- | --- | --- |
| Structured sections | Stable renderer, validation, nav, SEO, AI chunks, predictable authoring | Less free-form; new section types need a contract change | **Recommended** |
| Generic blocks (`type`, `data`) | Maximum flexibility | Renderer must interpret arbitrary blocks; validation and AI chunking become generic; inconsistent output; harder to test | Rejected for v1 |

**Decision:** Structured sections. The case study is a known document type, not a page builder.

### 12.3 One renderer versus project-specific pages

| Option | Strengths | Weaknesses | Verdict |
| --- | --- | --- | --- |
| One progressive renderer | One code path, one SEO source, consistent accessibility, no drift, static-safe | Less bespoke per project | **Recommended** |
| Project-specific pages | Maximum bespoke layout | N implementations, duplicated SEO, inconsistent design, build complexity, drift | Rejected |

**Decision:** One renderer. Per-project variation comes from content, not code.

### 12.4 Optional versus mandatory case-study content

| Option | Strengths | Weaknesses | Verdict |
| --- | --- | --- | --- |
| Optional (`NULL` allowed) | Existing projects keep working; progressive authoring; no forced backfill | Some pages remain summaries; inconsistent depth | **Recommended** |
| Mandatory for published projects | Every project has a case study | Breaks all existing projects, forces invented content, blocks publishing, requires backfill | Rejected |

**Decision:** Optional. The site must remain honest; a project without a case study is better than a fabricated one.

### 12.5 Evidence-backed outcomes versus unrestricted free-text metrics

| Option | Strengths | Weaknesses | Verdict |
| --- | --- | --- | --- |
| Evidence-backed outcomes | Trustworthy, AI-safe, explicit uncertainty, supports qualitative outcomes; unverified quantitative claims are withheld from public and AI | More authoring effort; some claims remain unverified; metadata validation cannot prove claim truth | **Recommended** |
| Unrestricted free-text metrics | Easy to write | Unverifiable claims, AI hallucination risk, no way to distinguish measured from guessed | Rejected |

**Decision:** Evidence-backed. Quantitative outcomes require evidence; qualitative outcomes are allowed.

### 12.6 Additional trade-offs

| Decision | Alternative | Why the recommendation wins |
| --- | --- | --- |
| `case_study` on `project` | Separate case-study endpoint | One aggregate, one audit, one concurrency check, one publish. |
| Whole-document replace | Deep merge on update | A merge retains removed fields and stale evidence; replace is predictable. |
| `null` clears; `{}` invalid | `{}` means empty | Two representations of absence are worse than one. |
| Always emit `caseStudy: null` after migration | Omit key when null | One deterministic public shape; new clients tolerate a missing key, so rollout is not lockstep and backend-first rollback is safe. |
| No draft state | `caseStudy.status` | The project already has `status`; a second state machine adds complexity without a clear need. |
| 32 KiB cap | No cap | Protects payload, audit, AI ingestion, and admin performance. |
| Raw admin read | Typed admin read | Raw lets the owner recover invalid stored data; writes are still strictly validated. |

---

## 13. Exact File Impact Map

**PROPOSED** The following files are expected to change in implementation. This map is design guidance; no file below has been modified in U10.1.

### 13.1 Backend

| File | Change | Notes |
| --- | --- | --- |
| `backend/app/models/project.py` | Add `JSONB` import, `case_study` mapped column, object-type CHECK. | Keep existing constraints unchanged. |
| `backend/alembic/versions/0005_project_case_study.py` | New migration: add nullable column + CHECK. | `down_revision = "0004_profile_resume_key"`. |
| `backend/app/schemas/content.py` | Add case-study models; add `caseStudy` to `Project`. | Strict `extra="forbid"` at every level. |
| `backend/app/schemas/admin_content.py` | Import/reuse `CaseStudy`; add `case_study` to create/update; add raw `case_study` to `ProjectOut`. | Do not add to `_PROJECT_NON_NULLABLE`. |
| `backend/app/services/content.py` | Select `Project.case_study`; validate and attach `caseStudy`. | Keep `_highlights()` and `long_description` unchanged. |
| `backend/app/services/admin_content.py` | No new upload behavior. | Existing generic update/audit path handles the field; gallery/diagram `src` uses the existing flat image validator or an absolute upload URL. |
| `backend/app/routes/admin_content.py` | Include `case_study` in `_project_out`. | No new route; reuse `POST /api/admin/uploads` and its flat `project-images/<uuid>.<ext>` key. |
| `backend/app/routes/content.py` | No functional change expected. | Verify ETag/cache behavior with the new field. |
| `backend/tests/test_database_schema.py` | Assert the new column/type/nullability/check. | |
| `backend/tests/test_constraints.py` | Assert JSONB object-type check rejects arrays/scalars. | |
| `backend/tests/test_migration_rollback.py` | Assert upgrade/downgrade for `0005`. | Downgrade drops data; test only in the test database. |
| `backend/tests/test_content_api.py` | Add public contract tests for null/valid/invalid/version/evidence. | |
| `backend/tests/test_payload_snapshot.py` | Regenerate and review the snapshot. | `backend/tests/snapshots/content_payload.json`. |
| `backend/tests/test_admin_content.py` | Add create/update/clear/empty/invalid/audit tests. | |
| `backend/tests/test_admin_uploads.py` | Keep the existing flat-key, format-sniff, server-measured-dimension, and size-cap tests; add gallery-source acceptance coverage if needed. | Reuse the existing upload route; no new upload capability. |
| `backend/tests/test_phase10_gaps.py` or a new test file | Add cross-cutting gaps if appropriate. | Avoid duplicating existing coverage. |

### 13.2 AI service

| File | Change | Notes |
| --- | --- | --- |
| `ai_service/services/content_api.py` | Mirror case-study models; add `caseStudy`; exclude it from the `projects` section; add `project_case_studies`. | Must stay key-for-key with the backend public schema. |
| `ai_service/services/knowledge_loader.py` | Add `project_case_studies` to `KNOWLEDGE_SOURCES`. | Classifier rules optional. |
| `ai_service/core/prompts.py` | Remove hardcoded project count/whitelist; add evidence rules; bump version to `2.3.0`. | |
| `ai_service/tests/test_content_api.py` | Add contract/section/chunk tests. | |
| `ai_service/tests/test_ingestion.py` | Pin the new source set. | |
| `ai_service/tests/test_parity.py` | Update for the new API-only section. | Keep the honest `FAIL` verdict. |
| `ai_service/tests/test_admin_routes.py` | Verify reingest still works. | If the test covers prompt content, update. |

### 13.3 Frontend

| File | Change | Notes |
| --- | --- | --- |
| `src/lib/content.js` | Add `caseStudy` validation to `validateProjects`. | Missing `caseStudy` normalizes to `null`; validate the nested document strictly. Preserve the current tolerance for unknown project-level keys unless a separate strictness change is approved. |
| `src/generated/content.js` | Regenerated by the build. | Never hand-edit. |
| `src/components/pages/ProjectPage.jsx` | Import and render `CaseStudy`; extend nav; resolve duplicate About when a problem section exists. | Fallback must remain byte-equivalent in structure for projects without a case study. |
| `src/components/project/CaseStudy.jsx` | New progressive renderer. | No browser globals. |
| `src/components/project/CaseStudyOutcome.jsx` | New outcome/evidence renderer. | Text badges, not color-only. |
| `src/components/project/CaseStudyImage.jsx` | New optional image/figure renderer. | Explicit dimensions, lazy loading. |
| `src/styles/project-page.css` | Add case-study styles. | Use existing tokens. |
| `src/lib/projectPages.js` | Optional: add a `caseStudySections` helper if shared by nav/tests. | Do not change canonical/SEO behavior. |
| `src/components/common/ProjectCard.jsx` | No change expected. | Cards remain summaries. |
| `src/admin/pages/ProjectEditor.jsx` | Add the Case study card and save-path handling. | One PUT, existing concurrency header. |
| `src/admin/components/CaseStudyEditor.jsx` | New structured editor. | Progressive disclosure and raw recovery fallback; reuse the existing image upload contract for gallery/diagram and do not add nested local paths. |
| `src/admin/components/RepeatableFieldGroup.jsx` | Optional new helper for repeatable groups. | Use existing `Field`/`Form` primitives. |
| `src/admin/lib/validators.js` | Add case-study client validators. | Mirror server messages; reuse existing `IMAGE_RE`/`IMAGE_URL_RE`; do not add nested local gallery paths. |
| `src/admin/api/client.js` | No change expected. | `put` already exists. |
| `src/components/pages/ProjectPage.test.jsx` | Add case-study and fallback tests. | Existing U5 nav tests must still pass. |
| `src/lib/content.test.js` | Add validator tests. | |
| `src/lib/projectPages.test.js` | Add helper tests if a helper is added. | |
| `src/admin/pages/ProjectEditor.test.jsx` | New editor tests if the project has no existing editor test. | Use the repo's testing patterns. |

### 13.4 Build, scripts, and docs

| File | Change | Notes |
| --- | --- | --- |
| `scripts/build-content.mjs` | No functional change required if `src/lib/content.js` validates the field. Optional case-study count log. | Generated snapshot will include `caseStudy`. |
| `scripts/generate-project-pages.mjs` | No change expected. | It renders `ProjectPage` from the snapshot. |
| `scripts/prerender/entry.jsx` | No change expected. | |
| `scripts/prerender/document.jsx` | No change expected unless SEO is intentionally changed. | This design keeps SEO unchanged. |
| `scripts/generate-seo-discovery.mjs` / `scripts/seo/discovery.mjs` | No change expected. | No new URLs. |
| `docs/API.md` | Document `caseStudy`/`case_study`, null semantics, evidence rules. | Implementation phase. |
| `docs/DATABASE.md` | Document the column, JSONB contract, and migration. | Implementation phase. |
| `docs/ARCHITECTURE.md` | Add an ADR for the case-study document and evidence model. | Implementation phase. |
| `docs/TESTING.md` | Add case-study test coverage expectations. | Implementation phase. |
| `e2e/public.spec.js` | Add public case-study rendering/fallback tests. | |
| `e2e/admin.spec.js` | Add admin create/edit/clear case-study flow. | |
| `src/data/**` | No change. | Frozen by CI. |
| `ai_service/knowledge_base.json` | No change. | Rollback-only; do not import. |

### 13.5 Files explicitly out of scope for U10.1

- No source file.
- No migration.
- No generated content.
- No dependency manifest.
- No external WebChat AI repository.
- No new upload route, nested local gallery path, or project-scoped upload.
- No database writes.
- No commit, push, merge, or deploy.

---

## 14. Migration and Rollout Strategy

### 14.1 Preconditions

**PROPOSED**

1. Owner approves this design.
2. Confirm Alembic head is `0004_profile_resume_key` in the target environment.
3. Take a database backup or snapshot before the migration. The column addition is low-risk, but the downgrade drops data.
4. Confirm the AI service and frontend validators accept absent, `null`, and valid `caseStudy` before the backend emits it.
5. Confirm the public payload size budget and test expectations.

### 14.2 Migration steps

**PROPOSED**

```bash
cd backend
python -m alembic upgrade head
```

The `0005` migration:

- Adds `case_study jsonb NULL`.
- Adds `ck_project_case_study_object`.
- Does not backfill.
- Does not rewrite rows.

For a small table, a normal `ADD COLUMN` and `ADD CONSTRAINT` is fine. If the table were large, the CHECK could be added `NOT VALID` and validated separately; that is not necessary at five rows but can be noted for safety.

### 14.3 Compatibility contract

**VERIFIED** The current frontend `validateProjects` does not reject unknown project-level keys; it only rejects unknown top-level keys. An old frontend therefore tolerates an extra `caseStudy` project key and simply does not render it. The AI service is strict: its contract uses `extra="forbid"`, so an old AI service rejects the key and fails ingestion.

The AI validator's strictness makes version order matter. The contract is:

- **Canonical post-migration public shape:** `caseStudy` is always present and is either `null` or a valid document.
- **Pre-migration public shape:** the key is absent.
- **New frontend validator:** `caseStudy` is optional. A missing key normalizes to `null`; an explicit `null` stays `null`; a present value must be a valid document. Unknown nested keys are still rejected.
- **New AI validator:** `caseStudy` is optional with a default of `None`. It accepts an absent key, explicit `null`, and a valid document. Unknown nested keys are still rejected.
- **New backend + old AI:** unsafe. The old AI contract rejects the unknown `caseStudy` key. Deploy the AI service before the backend.
- **New backend + old frontend:** safe but degraded. The current frontend ignores the extra project-level key and does not render the case study. It does not crash or fail the build.
- **Old backend + new clients:** safe. The new frontend normalizes the missing key to `null` and renders the fallback page; the new AI sees no case-study chunks.
- **Rollback:** roll back the backend first. The old backend omits the key, and the new clients tolerate absence. Then clients may be rolled back if needed. Backend-first is required because the old AI is strict; the old frontend is lenient but should not be relied on for the rollback contract.
- **Backend compatibility emission:** not required. The design relies on missing-tolerant clients plus backend-first rollback. If an operator cannot roll back the backend first, a temporary feature flag that suppresses `caseStudy` could be added as an emergency measure, but it is not part of the recommended design and would need its own tests.

**Forward rollout matrix:**

| DB | Backend | Public frontend | AI | Safe? | Why |
| --- | --- | --- | --- | --- | --- |
| `0004` | old | old | old | Yes | Baseline. |
| `0004` | old | new | new | Yes | New clients normalize the missing key to `null`. |
| `0004` | old | new | old | Yes | New frontend tolerates missing; old AI sees the old backend. |
| `0004` | old | old | new | Yes | Old frontend sees the old backend; new AI tolerates missing. |
| `0005` | new | new | new | Yes | Canonical post-migration shape. |
| `0005` | new | old | new | Yes | Old frontend ignores the extra project key; new AI accepts it. |
| `0005` | new | new | old | No | Old AI rejects the unknown key. |
| `0005` | new | old | old | No | Old AI rejects the unknown key. |
| `0004` | new | any | any | No | Backend expects the column; migration must precede backend code. |

**Rollback target matrix:**

| DB | Backend | Public frontend | AI | Safe? | Why |
| --- | --- | --- | --- | --- | --- |
| `0005` | old | new | new | Yes | Backend omits the key; new clients normalize it to `null`; column data is preserved. |
| `0005` | old | old | old | Yes | Old clients talk to the old backend; the unused nullable column is harmless. |
| `0005` | old | old | new | Yes | Old frontend talks to the old backend; new AI tolerates the missing key. |
| `0005` | old | new | old | Yes | New frontend tolerates missing; old AI sees the old backend. |
| `0005` | new | old | new | Yes | Old frontend ignores the extra key; new AI accepts it. |
| `0005` | new | old | old | No | Old AI rejects the key; roll back the backend first. |
| `0005` | new | new | old | No | Old AI rejects the key; roll back the backend first. |
| `0004` | new | any | any | No | New backend expects the column; never downgrade before rolling back code. |

The admin UI is deployed with the backend and is not part of the public compatibility contract. Under the documented `PUT` semantics, an update that omits `case_study` leaves the stored value unchanged.

### 14.4 Deployment order

1. **AI service first (mandatory):** deploy the AI contract mirror that accepts absent, `null`, and valid `caseStudy`. This prevents ingestion failure when the backend starts emitting the key, and the new AI remains compatible with the old backend.
2. **Frontend validator:** deploy `src/lib/content.js` with optional `caseStudy` validation and missing-to-`null` normalization. The new frontend remains compatible with the old backend. The frontend can be deployed before or after the backend because the current frontend already ignores unknown project-level keys; deploying it first is still the cleanest order.
3. **Backend + migration:** deploy the nullable column, public `caseStudy` field (all `null` initially), admin `case_study` support, and tests. The migration must run before the new backend code.
4. **Regenerate content snapshot and build:** run `npm run build`. Verify the fallback pages are unchanged and the payload includes `caseStudy: null`.
5. **Admin authoring:** add a case study to one project. Prefer a project whose claims are well supported. Save, then `POST /api/admin/publish`.
6. **Verify:** public page, AI re-ingestion, sitemap unchanged, JSON-LD unchanged, payload size, no build warnings.

A coordinated release is still preferred, but the hard ordering constraint is the AI service before the backend. The frontend is tolerant of both the old and new backend shapes. A feature flag is not required for the recommended rollout.

### 14.5 Rollback

**PROPOSED**

- **Order:** roll back the backend first. It stops emitting `caseStudy`; the new frontend and AI tolerate the missing key. Then the AI and frontend may be rolled back in either order. Do not roll back the AI first while the new backend is still emitting the key; the old frontend is tolerant, but backend-first is the recommended contract.
- **Backend compatibility emission:** not required. Backend-first rollback is the contract. A temporary suppression flag is an emergency option only.
- **Database rollback:** keep the `0005` column during a code rollback. The old backend ignores it and the data is preserved. `alembic downgrade 0004` drops the column and all case-study data; export the JSONB values first if the content matters.
- **AI rollback:** if `KNOWLEDGE_SOURCE=file` is used, case studies are absent from the AI store. That is acceptable for rollback but must be documented.
- **Frontend rollback:** the new renderer handles `caseStudy: null` and a missing key. The current frontend ignores unknown project-level keys, so it tolerates the extra key, but backend-first rollback is still required because the old AI is strict.
- **Rollback drill:** use a fixture payload without `caseStudy` and verify the new frontend and AI still pass before declaring the rollback path safe.

### 14.6 Data backfill

**PROPOSED** No automatic backfill.

- Do not import `ai_service/knowledge_base.json`.
- Do not derive case studies from `long_description`.
- Do not auto-generate case studies from `short_description`.
- Author content through the admin editor with evidence.

### 14.7 Rollback triggers

**PROPOSED** Consider rollback or a hotfix if:

- The AI service fails to ingest the new payload.
- The frontend build fails on the new key.
- The public payload exceeds the agreed size budget.
- A stored case study causes the public endpoint to fail or a page to render incorrectly.
- The admin save path corrupts or clears case studies unexpectedly.
- SEO output changes unexpectedly.
- The prompt still denies valid projects or invents content.

### 14.8 Post-deployment verification

**PROPOSED**

- `GET /api/content` returns `caseStudy: null` for existing projects.
- A fixture payload without `caseStudy` passes the new frontend validator and normalizes to `null`.
- A fixture payload without `caseStudy` passes the new AI validator and ingests without case-study chunks.
- The ETag changes after a case-study save.
- `npm run build` passes.
- `dist/projects/<slug>/index.html` for a project without a case study is structurally unchanged.
- A project with a case study renders its sections and nav anchors.
- `POST /api/admin/publish` reports both rebuild and reingest status.
- AI `/ready` is 200 and re-ingestion added the new chunks.
- `sitemap.xml` and `llms.txt` URLs are unchanged.
- JSON-LD contains no new ratings/reviews.
- Payload size is within the agreed budget.

---

## 15. Testing Strategy

### 15.1 Backend tests

**PROPOSED**

| Area | Tests |
| --- | --- |
| Schema | `project.case_study` exists, is `jsonb`, nullable, and has the object-type check. |
| Constraints | Direct insert of an array/scalar into `case_study` fails the CHECK; `NULL` and an object succeed. |
| Migration | Upgrade to `0005` and downgrade to `0004` work in the test database. Document the destructive downgrade. |
| Public null | A project with `NULL` case study returns `caseStudy: null`; the key is present. |
| Public valid | A valid document is returned with camelCase keys and all nested data. |
| Public invalid | A stored invalid/unknown-version document returns `caseStudy: null` and logs a warning. |
| Public compatibility | The canonical payload includes `caseStudy`; separate frontend/AI tests cover a pre-migration payload that omits the key. |
| Timeline | Accept `YYYY` and `YYYY-MM`; reject invalid months and day components; verify the normalized comparison examples in §5.2. |
| Gallery source | Accept an absolute upload URL and the existing flat `/images/projects/<slug>.webp` path; reject a nested local path. Existing upload tests still cover flat server-generated keys, server-measured dimensions, format sniffing, and the size cap. |
| Evidence metadata | `verified`/`reported` require descriptive `source`; a bare URL is rejected; `unverified` quantitative outcomes are stored but withheld from public/AI output. |
| Public ETag | Saving a case study changes `updated_at`, `meta.generated_at`, and the ETag. |
| Public size | The payload stays within the existing budget for current data; a representative full case study stays within an agreed worst-case budget. |
| Admin create | Omitted/null stores `NULL`; valid object stores it; `{}` and `{"schemaVersion": 1}` are `422`. |
| Admin update | Omitted leaves unchanged; `null` clears; object replaces; no deep merge. |
| Admin validation | Unknown keys, unsupported versions, bad evidence, bad URLs, bad image paths, oversized documents, and duplicate links are `422` with field paths. |
| Admin concurrency | `If-Unmodified-Since` still returns `409 STALE_WRITE`. |
| Admin slug | Slug immutability and `SLUG_TAKEN` behavior are unchanged. |
| Admin audit | Exactly one audit row per mutation; `before`/`after` include `case_study`; no secret leakage. |
| Admin delete | Soft delete still works and does not clear `case_study` data unexpectedly. |
| Payload snapshot | Update `backend/tests/snapshots/content_payload.json` and review the diff. |

### 15.2 Frontend tests

**PROPOSED**

| Area | Tests |
| --- | --- |
| Validator | Missing `caseStudy` normalizes to `null`; explicit `null` and valid documents are accepted; unknown nested case-study keys, bad versions, bad evidence, bad URLs, and bad dimensions are rejected with clear problems. |
| ProjectPage fallback | A project without `caseStudy` renders the current page; a pre-migration payload with no key renders the fallback; existing U5 nav tests still pass; no empty case-study headings. |
| ProjectPage case study | All present sections render; absent sections are skipped; nav anchors resolve; no dead links. |
| Timeline | Accept `YYYY` and `YYYY-MM`; reject invalid months/day components; verify year-only start/end normalization and the §5.2 examples. |
| Outcomes | Verified/reported quantitative badges render; unverified quantitative outcomes are absent; qualitative outcomes with no/`reported`/`unverified` evidence show “Reported”; no aggregation. |
| Gallery | Images have alt text, width/height, lazy loading; captions render; upload URL and flat in-repo path pass; nested local path fails. |
| Links | Case-study links render and dedupe against live/github; no `#` links. |
| Security | Text containing `<script>` is escaped, not executed; URLs with `javascript:` are rejected by the validator. |
| Accessibility | Headings are hierarchical; figures have captions; badges have text; focus styles exist; nav is keyboard operable. |
| Admin editor | Add/remove case study; empty draft is not submitted; clear sends `null`; nested field errors display; evidence warnings display; gallery upload fills server-measured dimensions; save body is correct. |
| ProjectCard | No case-study content is added to cards; existing card tests pass. |

### 15.3 AI tests

**PROPOSED**

| Area | Tests |
| --- | --- |
| Contract | Accepts an absent `caseStudy`, explicit `null`, and a valid document; rejects unknown nested keys and unsupported versions; an old-backend payload without the key ingests safely. |
| Sections | `project_case_studies` contains only projects with a case study; `projects` excludes `caseStudy`. |
| Chunks | Field-level chunks are produced; IDs are stable for unchanged text; unverified quantitative outcomes are excluded. |
| Evidence | Exact reported/verified status is preserved in chunk text; unverified quantitative values are absent; unverified qualitative context stays unverified/reported and never becomes measured. |
| Prompt | No hardcoded project count or whitelist; evidence rules present; version is `2.3.0`. |
| Ingestion | The source set includes `project_case_studies`; re-ingestion reconciles added/removed chunks. |
| Parity | The honest `FAIL` verdict remains; the new API-only section is classified correctly. |

### 15.4 Build, SEO, and E2E tests

**PROPOSED**

| Area | Tests |
| --- | --- |
| Build | `npm run build` succeeds with the new field and snapshot. |
| Prerender | A project page with a case study is generated with all sections; a page without one is unchanged in structure. |
| SEO | Canonical, Open Graph, Twitter, and JSON-LD remain unchanged; no new ratings/reviews; sitemap and `llms.txt` URL sets are unchanged. |
| Payload | The generated `src/generated/content.js` is deterministic for unchanged content. |
| E2E public | Visit a project with a case study; verify sections, nav, evidence badges, gallery, links, unverified quantitative omission, and qualitative “Reported” labels. Visit a project without one; verify fallback. |
| E2E admin | Create/edit/clear a case study; save; publish; reload; verify persistence and public output. |
| No-JS | The static project page renders the case study without JavaScript. |
| Responsive | The case-study sections and gallery work at mobile and desktop widths. |

### 15.5 Commands

**VERIFIED** The repository provides these commands in `package.json` and CI:

```bash
npm run lint
npm test
npm run test:api
npm run lint:ai_service
npm run test:ai_service
npm run build
npm run test:migration-validation
npm run test:e2e
```

**PROPOSED** Run the full CI-equivalent suite before merging implementation. Do not run tests against shared production environments. Use the test database and local build only.

### 15.6 Test data

**PROPOSED**

- Add at least one project fixture with a full case study covering every section and every evidence status.
- Add at least one project fixture with `case_study = NULL`.
- Add at least one pre-migration fixture with no `caseStudy` key for frontend/AI compatibility tests.
- Add at least one fixture with a qualitative-only outcome.
- Add timeline fixtures for valid year/year-month pairs and invalid months/comparisons.
- Add gallery fixtures using a flat upload URL and a flat in-repo path; include a rejected nested local path.
- Add at least one invalid stored document to test public degradation and admin recovery.
- Do not use WebChat AI claims as test data unless they are clearly marked `reported` or `unverified`.

---

## 16. Security and Privacy Considerations

### 16.1 Public content

**PROPOSED**

- A case study is public content. Do not store secrets, private URLs, customer names, personal data, internal hostnames, API keys, signed URLs, or unpublished client information.
- `evidence.url` must be a public or safely shareable URL. Do not link to a private dashboard, a signed URL, or a document containing personal data.
- `team` and `timeline` can reveal personal or client information. The owner should publish only what they are comfortable making public.
- The admin editor should include a short privacy hint: “This content is public. Do not include private client data or credentials.”

### 16.2 Rendering safety

**PROPOSED**

- All case-study text is plain text and is escaped by React. Do not use `dangerouslySetInnerHTML`.
- Do not add a Markdown renderer or HTML sanitizer for v1. Plain text is safer and simpler.
- Links and image sources are restricted to absolute `http(s)` URLs or the existing flat root-relative `/images/projects/<slug>.webp` path. No `javascript:`, `data:`, `file:`, protocol-relative, or nested local paths.
- Image `alt` is required and rendered as an attribute, not as HTML.
- Structured data is serialized with the existing `<` escaping in `serializeStructuredData`.

### 16.3 Validation and DoS

**PROPOSED**

- Enforce the 32 KiB document cap and all array/string limits on the server.
- Reject unknown keys at every level.
- Do not allow unbounded gallery arrays or nested objects.
- The public read path should not fetch remote images or evidence URLs.
- The admin route's existing auth, CSRF, rate limits, and audit rules apply unchanged.

### 16.4 Audit and privacy

**PROPOSED**

- `admin_audit_log.before/after` will contain the case study. The audit table is admin-only and is not public.
- Case-study content is public, but timeline/team/evidence may still be sensitive. Keep the audit table access restricted to the admin API/database operators.
- Do not log the full case-study body in application logs. Log only the project id/slug, validation error paths, and a short error summary.
- Do not log evidence URLs if they might contain tokens. Prefer logging the field path and a generic message.

### 16.5 AI privacy

**PROPOSED**

- Only public content is ingested into the AI knowledge store.
- Do not ingest `unverified` quantitative outcomes.
- Do not ingest private evidence artifacts, even if the owner uses them to justify a `verified` status. The public source description should point to a shareable artifact; the private artifact itself stays out of the knowledge store.
- The AI service's existing auth, CORS, rate limits, and prompt-injection protections remain unchanged.

### 16.6 WebChat AI

**PROPOSED**

- Do not publish unverified implementation details or metrics.
- Do not include private repository contents or credentials in the case study.
- If the source repository is private, describe the evidence at a level that does not leak it; use `reported` where appropriate.

---

## 17. Risks and Open Questions

### 17.1 Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| AI ingestion breaks because the backend emits `caseStudy` before the AI validator accepts it | Medium if deployed separately | High: `/ready` fails, knowledge stale | Deploy AI first; accept absent/null/valid; explicit rollout and backend-first rollback order. |
| New frontend validator accidentally rejects a missing `caseStudy` | Medium | High: build fails against an old backend | Normalize a missing key to `null`; add pre-migration payload tests. The current frontend ignores extra project-level keys, so an old frontend tolerates the new backend. |
| Public payload grows beyond the budget | Medium | Medium: slower build/cache | 32 KiB cap; payload-size tests; monitor gzip size. |
| Invalid stored JSONB reaches production | Low | Medium: hidden section or 500 | Strict admin validation; public read degrades to `null` with a warning; admin raw recovery. |
| Case studies become marketing prose with unverifiable metrics | Medium | High: trust/AI hallucination | Evidence model; quantitative evidence required; unverified quantitative outcomes are omitted from public rendering and AI. |
| A `verified` attestation is mistaken for independent proof | Medium | High: false trust | Explicit attestation boundary; metadata validation only; manual review; no “independently verified” claim in the UI. |
| WebChat AI claims remain unverifiable | High | Medium: credibility | Require evidence; default to `reported`/`unverified`; do not publish metrics without artifacts. |
| Admin form becomes too complex | Medium | Medium: authoring friction | Progressive disclosure; repeatable groups; completeness hints; raw fallback only for recovery. |
| Audit rows become large | Low | Low: storage/read cost | 32 KiB cap; audit is admin-only. |
| `PUT` whole-document replace surprises authors | Low | Medium: lost nested edits | Clear UI copy; no deep merge; confirm clear; concurrency header. |
| No draft state leads to incomplete published case studies | Medium | Medium: quality | Use `status: hidden` while authoring; renderer skips absent sections; completeness hint. |
| Legacy KB is accidentally imported | Low | High: private/stale content | Explicitly forbid; keep parity test; document rollback-only status. |
| Prompt drift after adding case studies | Medium | Medium: AI overclaims | Prompt rules + version bump + tests; AI ingests only supported outcomes. |
| Schema evolution becomes ad hoc | Low | Medium: inconsistent data | `schemaVersion`; reject unknown versions; new version = new validator. |
| Gallery images are missing or have wrong dimensions | Medium | Low: broken layout | Required width/height/alt; reuse the flat upload URL and server-measured dimensions; flat in-repo path only; nested local paths out of scope; renderer uses explicit sizes. |
| Evidence URLs leak private data | Low | High: privacy breach | Admin privacy hint; URL scheme validation; manual review; no private artifacts in AI. |
| Public page duplication between description and case study | Medium | Low: confusing copy | Use Problem section instead of About when present; keep header summary. |
| SEO expectations exceed what the contract supports | Low | Medium: scope creep | Keep SEO source of truth unchanged; no auto meta generation; no new JSON-LD claims. |

### 17.2 Open questions for the owner

**PROPOSED** These require explicit owner decisions before implementation:

1. **Contract shape:** approve the exact field set and shapes in §4/§5, especially `timeline`, `team`, `problem`, `architecture`, and `outcomes`.
2. **Nested naming:** approve camelCase inside the JSONB document while keeping `case_study` as the admin outer key.
3. **Public null shape:** approve always emitting `caseStudy: null` after migration while new clients also accept a missing key and normalize it to `null` during rollout/rollback.
4. **Evidence policy:** approve the requirement that quantitative outcomes need evidence; approve omitting unverified quantitative outcomes from public rendering and AI; approve the “Reported” label for qualitative outcomes without verification; approve the metadata-only attestation boundary.
5. **Draft state:** confirm there is no case-study-specific draft state in v1 and that `status: hidden` is the authoring mechanism.
6. **Size cap:** approve 32 KiB per project, or choose a different limit.
7. **Gallery uploads:** confirm gallery/diagram images reuse the existing flat `POST /api/admin/uploads` path and its returned URL/dimensions. The recommendation is reuse.
8. **Local gallery paths:** confirm gallery/diagram `src` uses the upload URL or the existing flat `/images/projects/<slug>.webp` path; nested `/images/projects/<slug>/<file>.webp` is out of scope unless separately approved.
9. **WebChat AI evidence:** confirm what evidence the owner can supply. If none, the case study must use `reported`/`unverified` and omit quantitative metrics.
10. **Legacy KB:** confirm it will not be imported.
11. **AI prompt change:** approve removing the hardcoded project list and bumping the prompt version to `2.3.0`.
12. **Rollout:** approve AI-first deployment, then frontend/backend in either order (recommended AI → frontend → backend), with missing-tolerant clients and backend-first rollback with no required compatibility-emission mode.
13. **Timeline:** approve the normalized `YYYY`/`YYYY-MM` comparison in §5.2, including year-only start/end semantics.
14. **Payload budget:** approve the existing budget test plus a new representative worst-case test.
15. **SEO:** confirm case studies do not change meta/JSON-LD in v1.

---

## 18. Final Recommended Architecture

**PROPOSED** The final architecture is:

```
PostgreSQL project.case_study JSONB NULL
        │
        ├── Admin API: case_study (snake_case outer key)
        │       └── validated CaseStudy v1 (camelCase document)
        │               ├── admin editor (structured form)
        │               ├── one audit row per mutation
        │               └── publish → rebuild + AI reingest
        │
        ├── Public API: caseStudy (camelCase)
        │       ├── null for projects without a case study
        │       └── validated v1 document for projects with one
        │
        ├── Frontend build validator
        │       └── generated content snapshot
        │               └── one progressive ProjectPage renderer
        │
        └── AI service
                ├── mirrored validator
                ├── projects section (summary, no caseStudy duplication)
                ├── project_case_studies section (field-level chunks)
                └── corrected prompt (content-driven, evidence-aware)
```

**What stays the same:**

- `long_description` remains the highlight encoding.
- `highlights` remains derived exactly as today.
- The public content endpoint remains the only content endpoint.
- The admin project `PUT` remains the only project update path.
- The project `status`/`indexable` controls remain the only visibility controls.
- SEO metadata and JSON-LD remain driven by `src/lib/projectPages.js`.
- Project pages remain static, no-JS, and prerendered.
- The legacy knowledge base remains rollback-only.

**What is new:**

- One nullable JSONB column and one migration.
- One versioned case-study contract.
- One strict admin write validator and one mirrored AI validator.
- One progressive public renderer.
- One dedicated AI knowledge section.
- One evidence model that distinguishes verified, reported, and unverified claims, with an explicit metadata-only attestation boundary.
- One prompt correction that stops hardcoding a three-project list.

**Why this is the right scope:** it adds depth without breaking the existing contract, without a normalized schema the project does not need, without per-project page code, and without turning `long_description` into a second content system.

---

## 19. Implementation Phase Breakdown

**PROPOSED** Implementation should proceed in small, reviewable phases after owner approval. Each phase must leave the repository buildable and testable.

### Phase U10.2 — Contract and validators (no public emission yet)

- Add the `CaseStudy` Pydantic models to the backend public schema.
- Add the same models to the AI contract mirror.
- Add `caseStudy` validation to `src/lib/content.js`.
- Add unit tests for absent/null/valid/invalid/version/evidence and missing-to-`null` normalization.
- Do not emit the field from the backend yet, or keep the public assembly unchanged behind a temporary guard.
- Gate: all validators agree; a pre-migration payload without `caseStudy` passes; no public payload change.

### Phase U10.3 — Database and backend emission

- Add migration `0005_project_case_study`.
- Add the model column and CHECK.
- Select/validate/attach `caseStudy` in the public assembly.
- Add `case_study` to admin create/update/out.
- Add backend tests and update the payload snapshot.
- Gate: `GET /api/content` includes `caseStudy: null`; existing pages unchanged; admin round-trip works.

### Phase U10.4 — Admin editor

- Add `CaseStudyEditor` and the ProjectEditor card.
- Add client validators, repeatable groups, evidence editor, gallery handling, raw recovery fallback.
- Reuse the existing flat upload response for gallery/diagram URLs and server-measured dimensions; do not add nested local paths.
- Add admin unit tests.
- Gate: create/edit/clear works; no empty-object submissions; audit and concurrency still pass.

### Phase U10.5 — Public renderer

- Add `CaseStudy`, `CaseStudyOutcome`, and `CaseStudyImage`.
- Integrate into `ProjectPage` and the section nav.
- Add CSS.
- Update `ProjectPage.test.jsx` and content validator tests.
- Gate: fallback pages unchanged; case-study pages render all present sections; no dead anchors; static HTML safe.

### Phase U10.6 — AI ingestion and prompt

- Add `project_case_studies` section generation.
- Exclude `caseStudy` from the `projects` section.
- Exclude unverified quantitative outcomes; preserve exact status for qualitative outcomes.
- Fix the prompt and bump to `2.3.0`.
- Update AI tests and parity expectations, including an old-backend payload without `caseStudy`.
- Gate: AI contract passes; re-ingestion works; prompt no longer denies valid projects.

### Phase U10.7 — End-to-end and content authoring

- Add E2E public/admin coverage.
- Run the full build and migration validation.
- Author one real case study with evidence.
- Publish and verify rebuild/reingest.
- Gate: full CI-equivalent suite passes; one real case study is live; fallback project pages unchanged.

### Phase U10.8 — Documentation and final review

- Update `docs/API.md`, `docs/DATABASE.md`, `docs/ARCHITECTURE.md`, and `docs/TESTING.md`.
- Add the ADR for the case-study document and evidence model.
- Review payload size, SEO parity, and rollback instructions.
- Gate: owner review and sign-off.

**Deployment note:** phases can be implemented in one branch, but production deployment must put the AI validator first; the recommended order is AI → frontend → backend in §14.4, with backend-first rollback in §14.5.

---

## 20. Approval Checklist

**PROPOSED** The owner should explicitly confirm each item before implementation starts:

- [ ] The nullable `project.case_study JSONB` column is the chosen storage model.
- [ ] The object-type CHECK and no-backfill migration are approved.
- [ ] The v1 contract field set and shapes in §4/§5 are approved.
- [ ] The nested camelCase document with a snake_case admin outer key is approved.
- [ ] `NULL` means no case study; `{}` is invalid; explicit `null` clears.
- [ ] `PUT` remains partial; omitted means unchanged; present object means whole-document replace.
- [ ] `caseStudy` is always present in the post-migration public payload and is `null` when absent; new clients accept a missing key and normalize it to `null`.
- [ ] No case-study-specific draft state is added in v1.
- [ ] Quantitative outcomes require evidence; qualitative outcomes are allowed.
- [ ] The `verified`/`reported`/`unverified` semantics, attestation boundary, and rendering rules are approved.
- [ ] Unverified quantitative outcomes are omitted from public rendering and AI ingestion.
- [ ] Qualitative outcomes without verification are labeled “Reported” and never become measured outcomes.
- [ ] A URL alone is not accepted as verification; the app validates metadata, not claim truth.
- [ ] The 32 KiB per-project size cap is approved.
- [ ] The admin editor is a structured form with a raw recovery fallback.
- [ ] The public renderer is one progressive renderer with fallback to today's page.
- [ ] Timeline validation uses normalized `YYYY`/`YYYY-MM` comparison with year-only start at January and year-only end at December.
- [ ] SEO metadata and JSON-LD remain unchanged in v1.
- [ ] `long_description` remains exclusively the highlight encoding.
- [ ] The AI service gets a dedicated `project_case_studies` section.
- [ ] The hardcoded three-project prompt is removed and the prompt version is bumped to `2.3.0`.
- [ ] The legacy `knowledge_base.json` is not imported.
- [ ] WebChat AI claims will be `reported`/`unverified` unless inspectable evidence is supplied.
- [ ] Gallery/diagram images reuse the existing flat upload URL and server-measured dimensions; nested local paths are out of scope.
- [ ] The rollout order (AI validator first; frontend and backend in either order, recommended AI → frontend → backend) is approved.
- [ ] The rollback order (backend first, then clients) is approved, with no required compatibility-emission mode.
- [ ] The compatibility matrices in §14.3 are approved.
- [ ] The testing strategy in §15 is approved.
- [ ] No implementation begins until this checklist is signed off.

**End of U10.1 design.** No source, database, dependency, generated-content, or external-repository change has been made.
