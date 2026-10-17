# API Specification

**Document Status:** Active — **Phase 4 implemented 2026-10-04: Admin authentication, server-side sessions, Argon2id, cookie policy, CSRF, login rate limiting. Phase 3 public content API + Phase 2 database. Phase 6 (2026-10-06): the §5.1.3a conflicts (robots, credential/description) are resolved and the contract payload is seeded + verified field-by-field.**
**Document Type:** Interface Contract
**Version:** 4.1 — Phase 6 resolved the §5.1.3a source conflicts
**Last Verified Against Code:** uncommitted working tree (`backend/app/routes/content.py`, `backend/db/seed.py`, `scripts/compare-content.mjs`)

---

## Reading Convention

| Label | Meaning |
|---|---|
| **CURRENT** | Exists today. Verified. |
| **TARGET** | Contract for the next phase. Not built. |
| **MIGRATION** | How one becomes the other. |

Ownership and design rationale: `ARCHITECTURE.md`. Data shapes: `DATABASE.md`.
Phase plan: `MIGRATION.md`.

**Base URLs**

| Environment | Base URL |
|---|---|
| Public (via Vercel rewrite) | `https://riturajlabs.vercel.app/api/*` |
| Local frontend | `http://localhost:5173/api/*` |
| Local `ai_service` | `http://localhost:8000` |
| Local `backend/` (**TARGET**) | `http://localhost:8001` |

---

# 1. CURRENT API Surface — Complete Inventory

Every network call the application makes, verified against the code. **This is
the entire current API: 6 paths, across one service, 2 of them authenticated.**

| # | Method | Path | Service | Auth | Called by | Rate limit |
|---|---|---|---|---|---|---|
| 1 | `POST` | `/chat` | `ai_service` | `X-API-Key` | `ChatAssistant.jsx` (fallback) | 10/min |
| 2 | `POST` | `/chat/stream` | `ai_service` | `X-API-Key` | `ChatAssistant.jsx` (default) | 10/min |
| 3 | `GET` | `/api/github` | `backend/` | **Public** | `useGithub.js` → `GithubStats` | none (300 s cache) |
| 4 | `POST` | `/api/contact` | `backend/` | **Public** | `emailService.js` → `Contact` | 5/min |
| 5 | `GET` | `/health` | `ai_service` | **Public** | Render health check | none |
| 6 | `GET` | `/ready` | `ai_service` | **Public** | Render traffic gate | none |

**Chat is the only authenticated endpoint.** `chat.py:24` declares
`APIRouter(dependencies=[Depends(verify_api_key)])`. The two public endpoints
moved to `backend/` in Phase 8 and declare no dependency. `middleware.js`
injects `X-API-Key` for `/api/chat/*` only; contact is not in its matcher and no
service verifies a key on it. Contact is therefore reachable by anyone who knows
the Render hostname, bypassing Vercel entirely. Its controls are the 5/min IP
limit and the honeypot. This is documented as a **CURRENT** finding rather than
silently "fixed", because requiring a key would alter the contact form's
behaviour.

**Structural notes**

* `chat.py` uses `router = APIRouter(...)` with **no prefix**, so the path on
  Render is `/chat`. `vercel.json` therefore rewrites `/api/chat` →
  `https://portfolio-lxdx.onrender.com/chat`. The browser never sees `/chat`.
* `backend/app/routes/github.py` and `backend/app/routes/contact.py` both use
  `prefix="/api"`, so their Render paths are `/api/github` and `/api/contact`,
  matching `vercel.json` 1:1 (both rewrites point at `portfolio-api-j7xc.onrender.com`
  since Phase 8).
* The rewrites are **explicit per path**, not a catch-all `/api/*` rule. Adding
  a new endpoint requires adding a rewrite entry — a real operational step
  worth knowing about.
* `/ready` returns `503` while ChromaDB ingestion runs and `200` afterwards.
  Since Phase 9 the ingestion reads this service's own content fetch
  (`GET /api/content`, §5.1); if that fetch or its strict validation fails,
  `/ready` stays `503` — fail-closed, **no** fallback to `knowledge_base.json`
  (the fallback is the explicit `KNOWLEDGE_SOURCE=file` switch only).
* Auth lives in `ai_service/core/security.py`, applied as a router-level
  dependency in `chat.py:24` — **not** in `app.py`.
* `ENV=development` **bypasses chat authentication entirely**
  (`core/security.py:55-84`). Production is the default (`ENV` unset →
  `production`), so this fails safe.
* `ai_service` has **no** content API, **no** admin API and **no** database. Every
  document that previously claimed otherwise was wrong. The content API now exists,
  but in `backend/` — see §5.1. Since Phase 9 `ai_service` is a **consumer** of
  that endpoint (startup ingestion, `KNOWLEDGE_SOURCE=api`), not a server of one.

---

# 2. CURRENT — `ai_service` Endpoints

## 2.1 `POST /api/chat`

Streaming chat with retrieval-augmented generation.

**Auth** `X-API-Key: <BACKEND_API_KEY>` — verified in
`ai_service/core/security.py:19` (`hmac.compare_digest`, constant-time) and wired
in as a router dependency at `chat.py:24`.
**Rate limit** 10 requests/minute per IP (`chat.py:284,293`, slowapi).
**Content-Type** `application/json`

**Request**

| Field | Type | Required | Notes |
|---|---|---|---|
| `message` | `string` | yes | 1–2000 chars, non-empty after trim |
| `sessionId` | `string` | no | Server-side conversation memory key; auto-created when absent |
| `history` | `array` | no | Prior turns for context |

Unknown fields are **rejected** — Pydantic models use `extra="forbid"`.

**Response** `text/event-stream` (SSE)

| Event | `data` payload |
|---|---|
| `sources` | JSON array of `{ title, url }` |
| `token` | Plain text delta |
| `done` | `{"sources": [...], "messageId": "..."}` |
| `error` | `{"error": "<message>"}` |

On failure the stream emits `error` then terminates. Upstream calls Groq, then
falls back to Gemini (`ai_service/routes/chat.py`). LLM responses are cached
in-process for 120 s.

**Frontend contract — must not change**

* `ChatAssistant.jsx` calls `POST /api/chat/stream` as its default path.
* `sessionStorage` holds `portfolio-chat-session-v1`.
* The widget shows its own error message on stream failure. It must keep
  behaving identically after `MIGRATION.md` Phase 9.

## 2.2 `GET /api/github`

Server-side GitHub proxy. Served by `backend/` since Phase 8.

**Auth** none (public). **Rate limit** none; 300 s in-process cache.

**Why a proxy exists** — `backend/app/services/github.py`: the GitHub REST API
allows 60 unauthenticated requests/hour per IP. A chat widget calling GitHub on
every page view exhausts that quota. A server-side `GITHUB_TOKEN` raises the
limit to 5000/hour and keeps the token out of the browser bundle.

**Response**

```json
{
  "profile": { "login": "...", "name": "...", "avatar_url": "...", "public_repos": 42, "followers": 7 },
  "repositories": [
    { "id": 1, "name": "...", "html_url": "...", "description": "...",
      "stargazers_count": 3, "forks_count": 1, "language": "JavaScript",
      "topics": ["react", "fastapi"], "fork": false, "pushed_at": "2026-01-01T00:00:00Z" }
  ],
  "cached": false
}
```

**Error mapping** (already implemented, preserve it)

| Upstream | Response |
|---|---|
| Network error | `502` `Unable to reach GitHub. Please try again later.` |
| 403 rate limit | `429` `GitHub API rate limit reached.` |
| 404 | `404` `GitHub user not found.` |
| other non-2xx | upstream status, truncated body |

**Frontend contract** — `githubService.js:19-26` already catches failures and
renders a fallback. `GithubStats` must keep working unchanged.

## 2.3 `POST /api/contact`

Validated contact form delivery via Resend, **now persisted** by `backend/`
(Phase 8): a `contact_message` row is stored before the email is sent
(§5.2), so a Resend outage loses nothing.

**Auth** **none.** `backend/app/routes/contact.py` declares
`APIRouter(prefix="/api", tags=["contact"])` with **no**
`dependencies=[Depends(verify_api_key)]`. The `X-API-Key` header injected by
`middleware.js` is received and never checked.

**Consequences**

* The endpoint is reachable by anyone who knows the Render hostname, bypassing
  Vercel and the edge middleware.
* Rate limiting (5/min per IP) is the **only** control.
* The middleware entry for `/api/contact` in `middleware.js` provides no
  protection today — it adds a header nothing reads.

**This is a CURRENT finding, not a TARGET requirement.** Phase 8 re-pointed the
destination and keeps the schema and status codes identical. Fixing it is a
separate change: add `dependencies=[Depends(verify_api_key)]` to
`backend/app/routes/contact.py`. Until then, treat contact as a public endpoint.

**Rate limit** 5/minute per IP (`CONTACT_RATE_LIMIT`). Honeypot field checked.

**Request**

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | `string` | yes | 2–80 chars |
| `email` | `string` | yes | Valid email, ≤ 254 chars |
| `subject` | `string` | no | 3–150 chars. The shipped form omits it; the server stores a derived subject (`Portfolio contact: {name}`) |
| `message` | `string` | yes | 10–2000 chars |
| `website` | `string` | no | Honeypot. Non-empty ⇒ silently `200`, nothing stored or sent |

**Responses**

| Code | Meaning |
|---|---|
| `200` | Sent, or honeypot tripped (deliberately indistinguishable) |
| `422` | Validation failed — FastAPI field errors |
| `429` | Rate limited |
| `502` | Resend rejected or timed out (`delivery_status='failed'`, row kept) |
| `503` | Contact storage unreachable |

## 2.4 `GET /health` and `GET /ready`

| Endpoint | Returns `200` when | Returns non-`200` when |
|---|---|---|
| `/health` | The process is alive | Never (no dependency check — deliberately) |
| `/ready` | Uvicorn started **and** ChromaDB ingestion finished | `503` with `{"detail": "..."}` during ingestion |

`/ready` gates traffic on Render. `/health` is the liveness probe. Keeping
liveness dependency-free is correct: a slow vector index must not cause a restart
loop.

---

# 3. Authentication — CURRENT

One mechanism, applied to one route.

```text
Browser  ──►  Vercel edge (middleware.js)
                │  X-API-Key: <BACKEND_API_KEY>   injected for /api/chat/*
                ▼
             Render ai_service
                │  verify_api_key() — chat only (chat.py:24)
                ▼
             Route handler
```

**Properties**

* The key lives in a Vercel edge environment variable, so it never reaches the
  public bundle.
* The browser never holds the key; the edge injects it.
* `BACKEND_API_KEY` (Vercel) and `AI_SERVICE_KEY` (Render) **must be equal**.
* Comparison is constant-time (`hmac.compare_digest`).
* `/api/contact` is **not** gated by `X-API-Key`: it is served by the backend,
  which does not verify the header, so the matcher no longer covers it. The
  backend's own rate limiting and payload validation protect it (§2.3).
* **`ENV=development` disables authentication** (`core/security.py:61-84`).
  `ENV` defaults to `production` when unset, so it fails safe. Never set
  `ENV=development` in a deployed environment.
* Even when verified, the key identifies a *route*, not a *user* — see
  `SECURITY.md` §3.3.

**Not authentication.** A shared secret identifies a route, not a user. It has
no identity, no revocation and no audit trail. It is adequate for hiding an
LLM bill from casual abuse; it is not adequate for content management, which
is why **TARGET** adds real sessions (`ARCHITECTURE.md` ADR-009).

---

# 4. Endpoint Minimality Review

Phase 1.5 required every proposed endpoint to answer: **who calls it?**

Phase 0 proposed ~25. **Seven are removed.** The rule applied is the API
counterpart of `DATABASE.md` §1.1: *an endpoint exists only if a named caller
needs it.*

## 4.1 Removed endpoints

| Removed endpoint | Phase 0 rationale | Verdict |
|---|---|---|
| `GET /api/projects` | "project list for build + AI" | **No caller.** The build and the AI service both need `profile` + `seo` + `projects` together — `scripts/prerender/entry.jsx` imports all three, and `discover.mjs` requires `resolveDiscoveryInputs()` (`scripts/seo/discovery.mjs:385-392`). A projects-only endpoint would force a second call. |
| `GET /api/projects/{slug}` | "one project" | **No caller.** Project pages are prerendered from the same snapshot; nothing fetches a single project at runtime. |
| `POST /api/admin/projects/reorder` | "bulk `display_order` write" | **No caller.** The admin drag-list already holds the full array and issues ordinary `PUT`s. At 5–20 rows an N-request reorder is 20 local HTTP calls, not a scalability problem. One endpoint saved, one transaction saved. |
| `PUT /api/admin/projects/{id}/image-meta` | "set `image_width`/`image_height`" | **Redundant.** Those are two columns on `project`. A dedicated endpoint for two fields on an entity that already has `PUT /api/admin/projects/{id}` is duplication, and it creates a second write path for one row. |
| `GET/POST/PUT/DELETE /api/admin/education` | "education CRUD" | **No entity and no UI.** `About.jsx` has no education section — the only education text is prose in `aboutCards[0].description` (`About.jsx:18-20`). The table was removed in `DATABASE.md` §1.3; the endpoints follow it out. |
| `GET/POST/PUT/DELETE /api/admin/social-links` | "social links CRUD" | **No entity.** Order, display names and icons are hardcoded in `src/data/socials.js:9-25`. A CRUD screen would edit three URLs while a developer still maintained the order in code. |
| `GET/POST/PUT/DELETE /api/admin/blog` | "blog metadata CRUD (no route yet)" | **No entity.** All 4 rows in `blogs.js` are `status: "Coming Soon"`, `link: "#"`. An admin screen to edit four "Coming Soon" strings is the clearest possible demonstration of over-engineering. `DATABASE.md` §9. |

**Result: ~25 → 18** (5 public + 24 admin combinations would have been 29 route
entries; Phase 0's 25 was already undercounting the real set — the precise
post-prune counts are in §5 and §6).

**`redirect_from` handling is removed too.** It existed only to feed the
`redirect` table, which `DATABASE.md` §1.3 removed in favour of slug
immutability. `PUT /api/admin/projects/{id}` returns `409 SLUG_IMMUTABLE` if a
published project's slug is changed.

---

# 5. TARGET Public API — `backend/`

| Method | Path | Auth | Purpose | Phase |
|---|---|---|---|---|
| `GET` | `/health` | none | Liveness | 1 |
| `GET` | `/ready` | none | Readiness (DB reachable + migrations applied) | 1 |
| `GET` | `/api/content` | none | **All public content in one payload** | 3 |
| `POST` | `/api/contact` | none (public, rate limited) | Store **and** send | 8 |
| `GET` | `/api/github` | none | GitHub proxy (moved) | 8 |

**5 endpoints. One of them is the only content endpoint.**

**IMPLEMENTED 2026-10-04 — `/health` and `/ready` only.** The other three are
later phases. Live responses, verified against a migrated database:

| Request | Response |
|---|---|
| `GET /health` | `200` `{"status":"ok"}` |
| `GET /ready` (reachable, head applied) | `200` `{"status":"ready"}` |
| `GET /ready` (unreachable) | `503` `{"detail":"database not ready"}` |
| `GET /ready` (reachable, no migration) | `503` `{"detail":"database not ready"}` |
| `GET /ready` (stale revision) | `503` `{"detail":"database not ready"}` |
| `GET /ready` (missing tables) | `503` `{"detail":"database not ready"}` |

`/ready` reports *one* detail string for all five failure modes on purpose: a
probe response is not an error channel, and the reason is logged server-side as
a `readiness_failed` event. `/health` performs no database work at all, so a
total database outage still reports 200 there — otherwise a restart loop would
be indistinguishable from a crash loop. The three remaining readiness failures
are asserted in `backend/tests/test_readiness.py`.

## 5.1 `GET /api/content`

The single endpoint the browser, the build and the AI service all call.

**Auth** none. **Cache** `ETag` + `Cache-Control: public, max-age=300, stale-while-revalidate=600`.

### 5.1.1 Why one endpoint is sufficient — the caller table

| Caller | What it needs | Where it runs | Served by |
|---|---|---|---|
| `ContentContext` / `useContent` | everything | Browser runtime | this endpoint |
| `scripts/prerender/entry.jsx` | `projects` + `profile` + `seo` + dimensions | Build time | this endpoint |
| `scripts/seo/discovery.mjs` | `profile` (resume, name) + `seo` + `projects` | Build time | this endpoint |
| `scripts/generate-project-pages.mjs` | `projects` + dimensions | Build time | this endpoint |
| `ai_service` ingestion | projects + profile + skills + certifications | Startup (Phase 9) | this endpoint |

**Every caller needs more than projects alone**, which is precisely why
`GET /api/projects` was dropped rather than kept as an optimisation.

**Verified build-time requirements** (this is why the payload shape is a hard
contract, not a preference):

| Requirement | Source | Fails build if absent |
|---|---|---|
| `projects[].slug`, `title`, `description`, `image` | `generate-project-pages.mjs:207-218` | yes |
| `projects[].image_width`, `image_height` | `generate-project-pages.mjs:264-293` | yes |
| `projects[].seoTitle`, `seoDescription`, `live`, `github` | `discover.mjs` sitemap + JSON-LD | yes |
| `profile.resume`, `profile.name` | `discover.mjs` `resolveDiscoveryInputs()` (`:385-392`) | yes |
| `seo.siteName`, `seo.title`, `seo.description`, `seo.person.*`, `seo.sameAs`, `seo.keywords`, `seo.robots`, `seo.image`, `seo.imageAlt`, `seo.twitterCard`, `seo.locale`, `seo.type`, `seo.author`, `seo.twitterSite` | `discover.mjs` + `projectPages.js` JSON-LD | yes |
| `seo.url`, `seo.verification` | **Not from this endpoint.** Deployment-owned; the build imports `src/config/seo.js` directly (`scripts/prerender/entry.jsx:24`) and passes `siteUrl` separately (`generate-seo-discovery.mjs:115`). | n/a — see §5.1.3 |

### 5.1.2 Response shape — hard contract

Keys mirror the current JS module shapes so component props do not change.

```json
{
  "profile": {
    "name": "Ritu Raj",
    "title": "Full Stack Developer",
    "greeting": "👋 Hello, I'm",
    "roles": ["Full Stack Developer", "AI & ML Student", "MERN Stack Developer", "Building AI Solutions"],
    "availableForInternship": true,
    "internshipText": "Available for Software Development Internship",
    "description": "Full Stack Developer passionate about building scalable web applications...",
    "location": "Pune, Maharashtra, India",
    "resume": "/Ritu_Raj_Full_Stack_Developer_Resume.pdf",
    "stats": [
      { "label": "Projects", "value": "4+" },
      { "label": "DSA Problems", "value": "10+" },
      { "label": "Tech Stack", "value": "MERN" }
    ],
    "social": {
      "github": "https://github.com/riturajlabs",
      "linkedin": "https://linkedin.com/in/riturajlabs",
      "email": "riturajlabs@outlook.com"
    }
  },
  "about": {
    "tag": "About Me",
    "title": "Building Software. Exploring Intelligence.",
    "description": "I am an Artificial Intelligence and Machine Learning student passionate about...",
    "heading": "My Journey",
    "paragraphs": [
      "My journey started with web development and problem solving...",
      "Currently, I am strengthening my skills in Data Structures & Algorithms..."
    ],
    "cards": [
      { "icon_key": "FaGraduationCap", "title": "Education", "description": "B.Sc. Artificial Intelligence & Machine Learning student..." },
      { "icon_key": "FaCode", "title": "Development", "description": "Full Stack Developer focused on building scalable web applications..." },
      { "icon_key": "FaBrain", "title": "AI & Machine Learning", "description": "Exploring Machine Learning, Deep Learning, Generative AI..." },
      { "icon_key": "FaRocket", "title": "Career Goal", "description": "Aspiring AI Engineer combining Software Engineering and Artificial Intelligence..." }
    ]
  },
  "projects": [
    {
      "slug": "webchat-ai",
      "title": "WebChat AI",
      "description": "Real-time AI chat application with streaming responses.",
      "longDescription": "...",
      "image": "/images/projects/webchat-ai.webp",
      "image_width": 1200,
      "image_height": 750,
      "imageAlt": "...",
      "category": "AI/ML",
      "techStack": ["React", "Node.js"],
      "highlights": ["..."],
      "featured": true,
      "indexable": true,
      "status": "published",
      "display_order": 0,
      "live": "https://...",
      "github": "https://github.com/...",
      "seoTitle": "...",
      "seoDescription": "..."
    }
  ],
  "skills": [
    {
      "name": "React",
      "icon_key": "FaReact",
      "display_order": 0,
      "category": {
        "name": "Frontend Development",
        "icon_key": "FaCode",
        "display_order": 0
      }
    }
  ],
  "certifications": [
    { "title": "...", "issuer": "...", "icon": "🌐", "issued_on": "June 2025", "credential_id": "...", "credential_url": "...", "display_order": 0 }
  ],
  "seo": {
    "siteName": "Ritu Raj",
    "title": "...",
    "description": "...",
    "keywords": ["..."],
    "author": "Ritu Raj",
    "image": "https://riturajlabs.vercel.app/images/portfolio-og.jpg",
    "imageAlt": "Ritu Raj - Full Stack Developer & AI/ML Student portfolio",
    "twitterCard": "summary_large_image",
    "twitterSite": "@riturajlabs",
    "locale": "en_IN",
    "type": "website",
    "robots": { "index": true, "follow": true },
    "person": {
      "name": "Ritu Raj",
      "alternateName": "riturajlabs",
      "jobTitle": "Full Stack Developer",
      "email": "riturajlabs@outlook.com",
      "address": { "locality": "Pune", "region": "Maharashtra", "country": "IN" },
      "nationality": "Indian",
      "credential": "B.Sc. Artificial Intelligence & Machine Learning",
      "knowsAbout": ["..."]
    },
    "sameAs": ["https://github.com/riturajlabs", "https://linkedin.com/in/riturajlabs"]
  },
  "meta": { "generated_at": "2026-01-01T00:00:00Z", "version": 1 }
}
```

### 5.1.3 What is deliberately absent, and why

| Absent key | Reason |
|---|---|
| `profile.profileImage` | It is a **Vite asset import** (`profile.js:1`, read at `Hero.jsx:145`). The bundler resolves it to a content-hashed URL; there is no string to put in a database. It stays a code import. |
| `profile.seo` | **Dead data.** `profile.js:92-111` defines it; `grep -rn "profile\.seo" src/ scripts/` returns **no matches**. Deleted, not migrated. |
| `profile.techStack` | **Dead data.** `profile.js:78` defines it; every `techStack` consumer is `project.techStack`. Deleted, not migrated. |
| `projects[].id` | No public consumer. Projects are identified by `slug`. The admin API uses `id`. |
| `education` | No entity, no UI (`DATABASE.md` §1.3). |
| `social_links` | No entity. `profile.social` is the source (`DATABASE.md` §5.1.2). |
| `blog_posts` | No entity, no route (`DATABASE.md` §9). |
| `projects[].created_at` / `updated_at` | No public consumer; the admin API returns them. Read internally to compute `meta.generated_at`, never copied into the payload. |
| `seo.url` | **The domain**, not the person (`DATABASE.md` §5.1.3). A content edit must not be able to repoint every canonical tag, sitemap entry and `llms.txt` line at another host. Stays in `seo.js`; the build passes `siteUrl` separately. |
| `seo.verification` | Same reasoning, and it is only meaningful next to `url`. Stays in `seo.js`. |
| `skills[].id`, `skills[].category.id` | No public consumer. Categories are identified by `name`, which is unique. |

### 5.1.3a Implemented in `backend/` (Phase 3)

What the shipped code does where this document and `DATABASE.md` left room:

* **Four queries, always** — profile, projects, skills joined to categories,
  certifications. Categories share the skill query, so there is no fifth round trip.
* **Every select names its columns.** No `select(Model)`, so an administrative
  column added by a later migration cannot leak into the payload; with
  `extra="forbid"` it would be a 500, not a silent exposure.
* **Read-only at the database.** Every statement carries
  `postgresql_readonly=True`, so a write added here is refused by PostgreSQL rather
  than committed behind a `GET`.
* **`meta.generated_at` is the newest `updated_at` across the profile, projects,
  skills and categories in the payload** — not the request time (which would flap
  the ETag) and not the profile's timestamp alone (which would go stale on any
  project or skill edit). Rows excluded from the payload do not contribute.
* **`projects[].highlights` is derived** from `long_description` by splitting on
  newlines and dropping blanks, per `DATABASE.md` §11.2. There is no column. A
  project with no `long_description` yields `[]`. **Known limitation:** this
  treats prose paragraphs as bullets, so a paragraph-form `long_description` comes
  back as one bullet per paragraph. A real `highlights` column is deferred to a
  later phase rather than guessed at here.
* **`seo.robots` is `{index, follow}`**, matching this contract and
  `DATABASE.md` §5.1.3. **Resolved in Phase 6:** `src/config/seo.js` stores
  `robots` as a **string** (`"index, follow"`). The extractor transforms it
  one-way into the object at snapshot time and fails if the string parses to
  anything other than `{"index": true, "follow": true}` — a future
  `"noindex"` must be reconciled consciously, not silently dropped
  (`docs/CONTENT_MAPPING.md` §9).
* **`certifications[]` uses `credential_id` / `credential_url`**, as in the sample
  above and in the `certification` table. **Resolved in Phase 6:**
  `src/data/certificates.js`'s `credential` is a URL, so it maps to
  `credential_url`; `credential_id` and `issued_on` are NULL (the source has no
  data for them). The source's `description` has **no column and no payload key**
  — it is omitted, asserted present in the source so the omission is a
  documented decision rather than an accident, and listed per-field in the
  snapshot's `_migration.omitted` (`docs/CONTENT_MAPPING.md` §8).
* **`404 {"detail": "Site profile not found."}`** for a missing singleton profile —
  Phase 3 ships no seed, so this is the normal state of a fresh database. An empty
  collection is `[]`, never a fabricated placeholder.
* **`503 {"detail": "Content is temporarily unavailable."}`** for any database
  failure, including a refused connection surfaced as a bare `ConnectionRefusedError`
  rather than a `SQLAlchemyError`.
* **Rate limiting: 300/min per IP**, `Retry-After` on 429, excluded from
  `/health` and `/ready` — see `SECURITY.md` §3.6a.
* **CORS:** explicit allow-list, wildcard refused in production and staging — see
  `SECURITY.md` §2.3.

### 5.1.4 Field-name rules (enforced in Phase 3)

1. Keys match the current `src/data/*.js` shapes, **including camelCase**. The
   frontend needs no mapper; `backend/repositories/` owns every rename
   (`DATABASE.md` §11.1).
2. `about.cards[].icon_key` and `skills[].icon_key` are **new keys**. They
   replace React component references, which cannot be serialised. Today
   `skills.js:25-110` stores `icon: FaReact` and `About.jsx:3-8` imports its four
   icons directly — `icon_key` appears **nowhere** in the codebase today.
3. `projects[].image_width` / `image_height` are the only snake_case keys.
   Build-only consumers, so no mapping is justified (`DATABASE.md` §11.3).
4. `seo.sameAs` is **derived** from `profile.social` at the repository layer and
   not stored, so one fact has one source (`DATABASE.md` §5.1.3).
5. `seo.url` stays in `src/config/seo.js` as a **deployment constant** and is
   merged into the payload by the build. It is a property of the domain, not the
   person; making it editable would let a content change repoint every canonical
   tag, the sitemap and `llms.txt` at the wrong host.
6. `extra="forbid"` on every response model, so a typo in a repository becomes a
   `500` in tests rather than a silently missing field in production.

**Contract tests are mandatory** — see `TESTING.md` §7. They assert the payload
key set equals the JS module key set for every surviving entity.

### 5.1.5 Caching and conditional requests

```
GET /api/content
→ 200 ETag: "sha256-…"  Cache-Control: public, max-age=300, stale-while-revalidate=600

GET /api/content  If-None-Match: "sha256-…"
→ 304 Not Modified  (no body)
```

`ETag` = SHA-256 over the canonicalised JSON body. It changes on any content
write, so an edit invalidates every client on the next request. **No cache purge
step exists**, because there is nothing to purge: the public payload changes
only when a build runs.

## 5.2 `POST /api/contact`

Same path, same request schema, same status codes, **same public auth model** as
**CURRENT** §2.3. **The only change is that it now also persists.** Implemented
in Phase 8: `backend/app/routes/contact.py` + `backend/app/services/contact.py`,
exercised by `backend/tests/test_contact_api.py` (§7.5).

**Auth decision.** The endpoint stays **public and rate-limited**. Adding
`X-API-Key` verification would change the endpoint's behaviour, and the
migration's mandate is to preserve behaviour while moving the data layer. The
gap is recorded in `SECURITY.md` §2.5 with a one-line fix, to be applied as a
separate approved change. `middleware.js` no longer injects a key here (it never
verified one), so an unset `BACKEND_API_KEY` cannot break contact.

```text
validate → rate limit → honeypot check
        → INSERT contact_message (status='unread', delivery_status='pending')
        → send via Resend
        → UPDATE contact_message SET delivery_status='sent' | 'failed'
```

| Case | Status | `delivery_status` |
|---|---|---|
| Sent | `200` | `sent` |
| Resend failed/timed out | `502` | `failed` (row kept) |
| Honeypot tripped | `200` | no row, nothing sent |
| Validation failed | `422` | no row |
| Storage unreachable | `503` | no row |

**A Resend outage must never lose a message.** The row is written before the send
attempt, and `delivery_status` distinguishes stored from delivered.

**Retry is manual in v1.** A `failed` row is visible in the inbox with its
message intact, so the owner can read it there. There is **no** automated retry
queue and **no** `/api/admin/messages/{id}/resend` endpoint: a retry queue needs
a worker process, and a resend button needs a second Resend code path in the
admin UI, for a feature whose volume is a handful of recruiter messages a month.
Adding either later is additive and needs no migration. Documented as a
non-goal in `ARCHITECTURE.md` §7.

**DONE (Phase 8)** `vercel.json` rewrites `/api/contact` to
`backend/`; `Contact.jsx` and `emailService.js` are unmodified.

## 5.3 `GET /api/github`

Path, response shape and error mapping are **byte-compatible** with **CURRENT**
§2.2. `ai_service/routes/github.py` moved to `backend/app/services/github.py`
(router: `backend/app/routes/github.py`) with the 300 s `_CACHE` TTL, the
`asyncio.gather` of profile + repos, and the 403/404/upstream error mapping
preserved. Exercised by `backend/tests/test_github_api.py` (§7.5).

**DONE (Phase 8)** one rewrite destination changed in `vercel.json`.
`useGithub`/`githubService`/`GithubStats` are unmodified.

## 5.4 Chat — NOT in `backend/`

`POST /api/chat` and `POST /api/chat/stream` **stay on `ai_service`** (ADR-002).
`backend/` does not proxy them and does not know they exist.

Rationale: chat readiness depends on ChromaDB ingestion. Coupling content
availability to vector-index availability would make a non-critical dependency
critical. The frontend contract is unchanged, so this is invisible to users.

**MIGRATION** `ai_service` builds its knowledge base from `GET /api/content`
(Phase 9, **implemented**) instead of `knowledge_base.json`. Any fetch or
validation failure raises and `/ready` stays `503`; `KNOWLEDGE_SOURCE=file` is
the deliberate rollback, never an automatic one.

**`ai_service` endpoint count after Phase 9: 4** (`/chat`, `/chat/stream`,
`/health`, `/ready`).

---

# 6. TARGET Admin API — 25 endpoints

## 6.1 Authentication — 3

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/admin/auth/login` | Start a session |
| `POST` | `/api/admin/auth/logout` | Revoke the session |
| `GET` | `/api/admin/me` | Current admin user |

### `POST /api/admin/auth/login`

```http
POST /api/admin/auth/login
Content-Type: application/json

{ "email": "owner@example.com", "password": "..." }
```

**200** → sets the session cookie.

```http
Set-Cookie: portfolio_admin_session=<opaque>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200
```

`Secure` is present whenever `ENVIRONMENT` is not `development`; locally over
plaintext HTTP it is omitted so the cookie can be set at all. Every other
attribute is unconditional.

```json
{ "user": { "id": "uuid", "email": "...", "role": "ADMIN", "last_login_at": "2026-01-01T00:00:00Z" } }
```

| Code | Meaning |
|---|---|
| `200` | Authenticated |
| `401` | Unknown user, wrong password, or disabled account — **identical response body and comparable timing** |
| `429` | Rate limited (10 / 15 min per IP, 5 failures / 15 min per email) |
| `422` | Malformed body |

**Design rules**

* Opaque 256-bit token; only its SHA-256 hash is stored. A database dump cannot
  be replayed as a session.
* `Secure` — never over plaintext HTTP.
* `SameSite=Strict` — never sent on a cross-site request, so it is never
  forwarded to the chat proxy.
* **No token in `localStorage`, no token in the response body, no `Authorization`
  header.** A `HttpOnly` cookie is not reachable from JavaScript, which is the
  entire point (XSS).
* Logout sets `revoked_at` server-side; a revoked token stops working immediately.
* Idle timeout 12 h, absolute 7 days.

**There is no public registration endpoint**, and in Phase 4 there is also **no
provisioning command** — creating the first admin is deliberately still out of
scope. Nothing in the application writes an `admin_user`; the row is inserted by
an operator or by a test helper. See `SECURITY.md` §4.4.

### `GET /api/admin/me`

```http
GET /api/admin/me
Cookie: portfolio_admin_session=<token>
```

**200** → the current user plus the CSRF token the client must echo on unsafe
requests. This is the only place the token is ever disclosed.

```json
{
  "user": { "id": "uuid", "email": "...", "role": "ADMIN", "last_login_at": "2026-01-01T00:00:00Z" },
  "csrf_token": "<64 hex characters>"
}
```

| Code | Meaning |
|---|---|
| `200` | Authenticated |
| `401` | Missing, unknown, revoked, idle-expired or absolute-expired session, or a deactivated account |

`csrf_token` is not stored in a column: it is re-derived from the session token on
every call (`SECURITY.md` §4.2). `user` carries exactly `id`, `email`, `role`,
`last_login_at` — never `password_hash`, `failed_attempts` or `locked_until`.

### `POST /api/admin/auth/logout`

```http
POST /api/admin/auth/logout
Cookie: portfolio_admin_session=<token>
X-CSRF-Token: <64 hex>
```

**204** → sets `revoked_at` on the session and returns `Set-Cookie` with the cookie
cleared (`Max-Age=0`).

| Code | Meaning |
|---|---|
| `204` | Session revoked, cookie cleared |
| `401` | No valid session to log out of |
| `403` | Session valid but `X-CSRF-Token` missing or wrong |

Logout is **not** idempotent: with no session there is nothing to revoke, so a
second logout is `401` rather than a second `204`. Authentication is checked
before CSRF, so an anonymous caller gets `401` and a session-holder who forgot the
header gets `403`. Logging out one session leaves every other session for the same
user intact.

## 6.2 Authorization

| Rule | Enforcement |
|---|---|
| Every `/api/admin/*` route requires a valid session | **Server-side dependency on every router.** Verified by a test that iterates all routes. |
| No client-side-only guard is trusted | ADR-015 |
| `X-API-Key` is never accepted on admin routes | No code path reads it there |
| The admin session cookie is never forwarded to `/api/chat/*` | `SameSite=Strict` + a middleware path matcher |
| Every mutation writes an audit row | `admin_audit_log` (`DATABASE.md` §5.9) |
| v1 has one role | `ADMIN`. No role UI. |

## 6.3 Resource endpoints — 24

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/projects` | List (id, title, slug, status, order — **not** full bodies) |
| `POST` | `/api/admin/projects` | Create |
| `GET` | `/api/admin/projects/{id}` | Read one, for the edit form |
| `PUT` | `/api/admin/projects/{id}` | Update |
| `DELETE` | `/api/admin/projects/{id}` | Soft delete (`status='hidden'`, `indexable=false`) |
| `GET` | `/api/admin/skill-categories` | List |
| `POST` | `/api/admin/skill-categories` | Create |
| `PUT` | `/api/admin/skill-categories/{id}` | Update (name, `icon_key`, order, visibility) |
| `DELETE` | `/api/admin/skill-categories/{id}` | Hard delete (cascades skills) |
| `GET` | `/api/admin/skills` | List |
| `POST` | `/api/admin/skills` | Create |
| `PUT` | `/api/admin/skills/{id}` | Update (name, `category_id`, `icon_key`, order, visibility) |
| `DELETE` | `/api/admin/skills/{id}` | Hard delete |
| `GET` | `/api/admin/certifications` | List |
| `POST` | `/api/admin/certifications` | Create |
| `PUT` | `/api/admin/certifications/{id}` | Update |
| `DELETE` | `/api/admin/certifications/{id}` | Hard delete |
| `GET` | `/api/admin/profile` | Read `site_profile` |
| `PUT` | `/api/admin/profile` | Update `site_profile` |
| `GET` | `/api/admin/messages` | Inbox, filtered + paginated |
| `PATCH` | `/api/admin/messages/{id}` | Mark `read` / `archived` |
| `POST` | `/api/admin/publish` | Trigger a public-site rebuild via the server-side deploy hook (`ADR-017`, §6.7) |
| `POST` | `/api/admin/uploads` | Store a project cover image in object storage; return its public URL and measured dimensions (§6.3.1) |
| `POST` | `/api/admin/profile/resume` | Store the resume PDF in the private bucket and repoint the profile at `/api/resume` (§6.3.2) |

**Why projects get a `GET /{id}` and the others do not.** A project payload
carries `longDescription`, `highlights`, SEO fields and URLs — the admin edit
form needs it, and a list of five full payloads is wasteful. `skill`,
`skill_category` and `certification` rows are one label plus an icon key; the
list response is already the whole entity, so a `GET /{id}` would return bytes
the client already has.

**Why the projects list omits bodies.** The list drives a dashboard. Returning
`longDescription` for every row would make the payload grow with the portfolio
and give the admin UI a second source of truth to reconcile against the detail
view.

### 6.3.1 `POST /api/admin/uploads`

`multipart/form-data` with one part, `file` (WebP, PNG, JPEG or GIF;
`S3_IMAGE_MAX_BYTES`, default 5 MB). Requires a session **and** `X-CSRF-Token`
like every other mutation.

- `201` → `{ "image", "image_width", "image_height", "key", "audit_id" }`. The
  three image fields are exactly what a project create/update body needs, so the
  editor writes them into its form and then saves through the ordinary
  `POST`/`PUT /api/admin/projects`. The dimensions are **server-measured** (the
  build cross-checks them against the stored image), not trusted from the
  browser.
- `422 VALIDATION_ERROR` with `fields: [{ field: "file", … }]` when the body is
  empty, over the cap, or not a supported image.
- `503 INTERNAL` when object storage is not configured
  (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_ENDPOINT_URL_S3` unset). The
  editor then falls back to the committed `/images/projects/<slug>.webp` path.
- The stored object is `public_read` and the returned `image` URL is absolute and
  stable — it is baked into the static build, so a presigned URL would not work
  (`ADR-012`). An upload writes one `admin_audit_log` row with
  `entity='upload'`, `action='create'`, `entity_id=<object key>`.

### 6.3.2 `POST /api/admin/profile/resume`

`multipart/form-data` with one part, `file` (PDF; `S3_RESUME_MAX_BYTES`, default
10 MB). Requires a session **and** `X-CSRF-Token` like every other mutation.

- `201` → `{ "resume", "key", "audit_id" }`. `resume` is the stable public route
  `/api/resume`; `key` is the server-generated object key
  (`resumes/<uuid4>.pdf`), exposed only so the editor can show the upload landed.
  The editor writes both into its form and they are already persisted — this call
  *is* the save for the resume; no separate `PUT /api/admin/profile` is needed.
- `422 VALIDATION_ERROR` with `fields: [{ field: "file", … }]` when the body is
  empty, over the cap, or lacks the `%PDF-` signature.
- `503 INTERNAL` when object storage is not configured
  (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_ENDPOINT_URL_S3` unset).
- Stored in the **private** `uploads` bucket (`S3_RESUME_BUCKET`), never the
  `public_read` `media` bucket — a resume is a document, not a web asset, and its
  bucket's access mode is fixed at creation. It has no anonymous URL. Replacing a
  resume stores a new key, repoints `site_profile.resume_key` and deletes the
  superseded object **after** commit (best-effort cleanup). An upload writes one
  `admin_audit_log` row with `entity='site_profile'`, `action='update'`.

  Failure ordering is deliberate: nothing is written to the database until the
  object is stored, and the superseded object is deleted only after the pointer
  swap commits, so a failed upload always leaves the previous resume live. If the
  profile write itself fails after the upload, the just-stored object is deleted
  (best-effort). Both the "upload then failed update" and "superseded object
  delete failed" paths can leave an **orphaned** object in the private bucket —
  unreferenced, never publicly reachable, and safe to reap with a bucket
  lifecycle rule keyed on the `resumes/` prefix; it is never a broken resume.

**Public read: `GET /api/resume`** (§5.1-style bare-body route, no auth). Streams
the object named by `site_profile.resume_key` as `application/pdf` with
`Content-Disposition: inline; filename="resume.pdf"` and
`X-Content-Type-Options: nosniff`. The response is `Cache-Control: no-cache` with
an `ETag` equal to the object key, so `If-None-Match` yields a `304` and a
replacement is picked up immediately. A missing key (the resume is still the
in-repo PDF) or a stale object is a bare `404 {"detail": …}`; an unreachable store
is a bare `503`. It never returns a presigned redirect — the bucket stays private
and this route is the only reader. The key comes from the database, never from
the caller, so it cannot be pointed at another object.

## 6.4 Conventions

| Aspect | Rule |
|---|---|
| PUT | Partial update: omitted fields unchanged. `extra="forbid"` rejects unknown fields. |
| Ordering | Set `display_order` in the ordinary `PUT`. **No reorder endpoint** (§4.1). |
| Deletion | `project` → soft (`status='hidden'` + `indexable=false`). `skill`, `skill_category`, `certification` → hard. `contact_message`, `admin_audit_log` → never deleted. |
| Slug generation | `slug` is **optional on create**: omitted (or empty), the server derives it from `title` (lowercase, runs of non-alphanumerics → `-`, trimmed, ≤ 80) and disambiguates a collision as `slug-2`, `slug-3`, … The admin UI never sends a slug. A slug is stored once and is the project's permanent URL; editing the title later does **not** move it. |
| Slug | **Immutable once the project has ever been `published`.** An explicitly supplied change returns `409 SLUG_IMMUTABLE`. `DATABASE.md` §8. |
| Slug conflict | Creating (or re-slugging) a project with an **explicitly supplied** slug already in use — even by a hidden row — returns `409 SLUG_TAKEN` (§7.2). A generated slug is suffixed instead of rejected. |
| Certification conflict | Creating (or editing) a certification whose `(title, issuer)` pair already exists returns `422 VALIDATION_ERROR` (`DATABASE.md` §5.5, §13). |
| Status | Two values only: `'published'` \| `'hidden'`. **No `draft`, no `archived`** (`DATABASE.md` §8.1). |
| Visibility | Two independent flags: `status` hides from the site; `indexable` controls sitemap/JSON-LD/page generation. |
| Validation | Shared validators: slug `^[a-z0-9]+(?:-[a-z0-9]+)*$` ≤ 80; `image` must match `^/images/projects/[a-z0-9-]+\.webp$`; `image_width`/`image_height` > 0; `icon_key` ∈ the Phase 5 registry; URLs must be `http(s)`. |
| Concurrency | Project `PUT` accepts `If-Unmodified-Since`; a newer `updated_at` returns `409 STALE_WRITE`. |
| Audit | Every mutation writes one `admin_audit_log` row in the **same transaction** as the change. |
| Response | Always returns the persisted entity, so the admin UI updates from the server response rather than guessing. |

## 6.5 Example: update a project

```http
PUT /api/admin/projects/8f2c...-...
Content-Type: application/json
Cookie: portfolio_admin_session=<opaque>

{
  "title": "WebChat AI",
  "featured": true,
  "display_order": 0,
  "image_width": 1200,
  "image_height": 750
}
```

**200**

```json
{
  "id": "8f2c...-...",
  "slug": "webchat-ai",
  "title": "WebChat AI",
  "status": "published",
  "indexable": true,
  "updated_at": "2026-01-01T00:00:00Z",
  "audit_id": "c1d2..."
}
```

| Code | Meaning |
|---|---|
| `200` | Updated |
| `401` | No/invalid session |
| `404` | Unknown id |
| `409` | `SLUG_IMMUTABLE` or `STALE_WRITE` |
| `422` | Validation failed — field-level errors |

## 6.6 Messages inbox

`GET /api/admin/messages?status=unread&page=1&page_size=50` — read-only list plus
`PATCH .../{id}` to mark `read` / `archived`. **No delete, no resend**
(§5.2). A recruiter's message is not the portfolio owner's to erase, and a
read-only inbox needs no CSRF-prone destructive action.

## 6.7 Publish

`POST /api/admin/publish` runs the two downstream effects of a content publish.
The public pages are prerendered from content, and the AI assistant answers from
a vector store built from the same content API, so a change is fully visible only
once both have run (`ADR-017`):

1. **Rebuild** — start the public site's next build (Vercel Deploy Hook).
2. **Re-ingest** — ask the AI service to re-read `GET /api/content`. It
   reconciles its collection (adding new chunks, deleting chunks for hidden or
   removed content) and clears its LLM response cache, so chat stops quoting
   stale data.

```http
POST /api/admin/publish
Cookie: portfolio_admin_session=<opaque>
X-CSRF-Token: <from GET /api/admin/me>
```

**200**

```json
{
  "ok": true,
  "status": "ok",
  "message": "Rebuild started. The site will update in a few minutes. AI knowledge updated.",
  "rebuild": {
    "name": "rebuild",
    "configured": true,
    "ok": true,
    "status": "triggered",
    "message": "Rebuild started. The site will update in a few minutes."
  },
  "reingest": {
    "name": "reingest",
    "configured": true,
    "ok": true,
    "status": "updated",
    "message": "AI knowledge updated."
  }
}
```

| Field | Meaning |
|---|---|
| `ok` | True only when neither step failed. |
| `status` | `ok` \| `partial` (a step is unconfigured) \| `failed`. |
| `message` | The step messages concatenated; show as-is. |
| `rebuild` / `reingest` | Per-step detail: `configured`, `ok`, `status`, `message`. |

Per-step `status` values: rebuild is `triggered` \| `not_configured` \| `failed`;
re-ingestion is `updated` \| `not_configured` \| `failed`.

* Both secrets — the deploy-hook URL (`DEPLOY_HOOK_URL`) and the AI admin token
  (`AI_SERVICE_ADMIN_TOKEN`, matched by `ADMIN_TOKEN` on the AI service) — are
  **capability tokens**: they live only in the server environment and are never
  returned to the browser, which is why the browser calls this route instead.
* `configured=false` is not an error — it means the operator has not set the
  variables for that step. `configured=true, ok=false` is a transient failure
  worth retrying. The two are reported separately per step so the owner knows
  which they have. A step that is unconfigured makes the overall `status`
  `partial`, never `ok`.
* Every attempt — including `not_configured` and `failed` — writes an
  `admin_audit_log` row (`entity='deployment'`, `action='publish'`) recording the
  outcome of both steps, so "why didn't the site update?" is answerable from the
  audit trail.
* CSRF required (unsafe, state-changing). The backend never deploys itself; it
  only triggers the configured build and re-ingestion.

---

# 7. Error Format

## 7.1 CURRENT

FastAPI default:

```json
{ "detail": "GitHub API rate limit reached." }
```

`422` returns FastAPI's `[{ "loc": [...], "msg": "...", "type": "..." }]` — but
only on **non-admin** paths, which are handed back to FastAPI's own handler so the
Phase 3 contract stays byte-identical. Every `/api/admin/*` `422` now uses §7.2's
envelope.

## 7.2 TARGET

Unified envelope. **Compatibility note:** the public endpoints keep returning
bare `{"detail": "..."}` for contact/github because the existing frontend already
parses that shape; `GET /api/resume` (§6.3.2) does the same, and deliberately
re-emits its storage failure as a bare `503` because the shared `APIError`
handler would otherwise render the admin envelope on a public path. Only admin
endpoints use the enriched form.

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "fields": [{ "field": "image_width", "message": "Must be greater than 0." }],
    "request_id": "01JQ..."
  }
}
```

| `code` | Status | Used by |
|---|---|---|
| `VALIDATION_ERROR` | 422 | admin |
| `UNAUTHENTICATED` | 401 | admin |
| `FORBIDDEN` | 403 | admin |
| `NOT_FOUND` | 404 | admin (unknown admin route) |
| `SLUG_IMMUTABLE` | 409 | admin |
| `SLUG_TAKEN` | 409 | admin |
| `STALE_WRITE` | 409 | admin |
| `RATE_LIMITED` | 429 | admin |
| `UPSTREAM_UNAVAILABLE` | 502 | github, contact (public paths, so the bare `{"detail"}` form per the note above) |
| `INTERNAL` | 500 | admin |

Every code in this table is currently emitted only on `/api/admin/*`. Where a
non-admin route raises the same condition today it returns the bare
`{"detail": "..."}` body instead — see the compatibility note in §7.2.

**Rules**

* Never leak a stack trace, SQL string, file path or internal hostname in a
  response.
* `request_id` is logged server-side and returned so a user-reported error can be
  traced.
* Unknown routes return `404` with the same envelope — no route listing.

**Implemented as of Phase 4, on admin paths only.**

Every `/api/admin/*` response — success or failure — uses this envelope:
`VALIDATION_ERROR` (422), `UNAUTHENTICATED` (401), `FORBIDDEN` (403),
`NOT_FOUND` (404 for an unknown admin route), `RATE_LIMITED` (429) and
`INTERNAL` (500, including an unhandled exception) all carry `error.code` and a
`request_id` that is also written to exactly one log event.

Non-admin paths are untouched: an unknown route still returns bare
`{"detail": "Not found."}`, an unhandled exception still returns bare
`{"detail": "Internal server error."}`, and `/api/content` keeps the Phase 3 body
it always had. `NOT_FOUND` and `INTERNAL` are listed above as "admin" for that
reason — the public variants of the same conditions are the bare forms.

---

# 8. Rate Limits (TARGET)

| Scope | Limit | Key | Response |
|---|---|---|---|
| `POST /api/contact` | 5 / min | IP | 429 |
| `POST /api/chat`, `/chat/stream` | **10 / min** | IP | 429 |
| `POST /api/admin/auth/login` | 10 / 15 min | IP | 429 |
| `POST /api/admin/auth/login` | 5 / 15 min | email | 429 |
| `GET /api/content` | 300 / min | IP | 429 |
| `GET /api/resume` | **60 / min** (`RESUME_RATE_LIMIT`) | IP | 429 |
| `GET /api/github` | 60 / min | IP | 429 |
| `GET /api/admin/*` (authenticated) | 600 / min | user | 429 |

**Policy**

* In-memory TTL store — sufficient for a single-instance service. No Redis.
* Responses include `Retry-After`.
* A `429` body is human-readable: `"Too many requests. Please try again shortly."`
* No global ban list. There is no legitimate need and it creates a
  denial-of-service vector against yourself.
* Rationale for every limit is in `SECURITY.md` §5.

**The chat limit is 10/min, matching `chat.py:284,293`.** An earlier revision of
this document listed 20/min. That was wrong.

---

# 9. CORS (TARGET)

```text
allow_origins = [
  "https://riturajlabs.vercel.app",
  "https://<preview-domain>",
  "http://localhost:5173",
]
allow_credentials = true          # required for the admin cookie
allow_methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
allow_headers = ["Content-Type", "X-CSRF-Token", "If-None-Match", "If-Unmodified-Since"]
expose_headers = ["ETag", "Retry-After"]
```

* **Never `"*"`.** It is invalid with credentials and unsafe.
* A `"*"` in production logs a startup warning and does not start.
* Preview domains are added explicitly, never by wildcard suffix.
* `X-API-Key` is **not** in `allow_headers`: no browser-side caller sends it, and
  the edge injects it server-to-server. Allowing it would advertise a header the
  public client has no use for.

---

# 10. MIGRATION — API-Level Changes

| # | Change | Impact | Revert |
|---|---|---|---|
| 1 | Add `backend/` with `/health`, `/ready`, `GET /api/content` | none — no traffic yet | delete directory |
| 2 | Add admin routes + icon registry | none | disable router |
| 3 | Build-time `GET /api/content` in `generate-project-pages.mjs` + `generate-seo-discovery.mjs` | **build depends on API** | `git checkout` the scripts |
| 4 | Prerender entry reads the fetched snapshot | 5 indexable URLs | `git checkout` the entry |
| 5 | `/api/contact` rewrite → `backend/` | contact only | restore one rewrite |
| 6 | `/api/github` rewrite → `backend/` | GitHub stats only | restore one rewrite |
| 7 | `ai_service` reads `GET /api/content` | chat only | `KNOWLEDGE_SOURCE=file` |
| 8 | Admin SPA at `/admin/*` | new path | delete entry + rewrite |

**Invariants that hold at every step**

* `/api/chat`, `/api/chat/stream`, `/api/github`, `/api/contact` keep their
  paths, request schemas, response shapes and status codes.
* The public bundle never gains a secret.
* No indexable URL is removed.
* No discovery file changes shape.

---

# 11. Documentation Rules

* This file is the contract. Code that deviates is a bug, not a doc update.
* When an endpoint changes: update this file, `DATABASE.md` (if the shape
  changed), `TESTING.md` (add or update the contract test) and `MIGRATION.md` (if
  a phase is affected) in the same change.
* Public endpoints additionally require a snapshot test asserting the exact key
  set, so an accidental field rename fails CI instead of production.
* Every endpoint in §5 and §6 must have a row in `TESTING.md` §7. An untested
  endpoint is not finished.

---

# END OF API
