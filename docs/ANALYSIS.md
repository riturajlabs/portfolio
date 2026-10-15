# Codebase Analysis & Documentation Audit

**Document Status:** Active
**Document Type:** Analysis Report (Phase 0)
**Last Verified Against Code:** commit `a6895e5` (`main`)
**Rule for this repository:** `codebase > documentation`

---

## How To Read Every Document In `docs/`

This repository documents three different things. They are never mixed.

| Label | Meaning |
|---|---|
| **CURRENT** | Verified to exist in the code at the commit named above. File paths and line numbers are real. |
| **TARGET** | Does not exist yet. This is the contract for the next phase. |
| **MIGRATION** | The specific steps that turn CURRENT into TARGET, with rollback. |

A statement with no label is a **PRINCIPLE** (durable rule) and is expected to
hold in both CURRENT and TARGET.

---

# 1. Executive Summary

## 1.1 What the portfolio actually is (CURRENT)

A **single-page React 19 + Vite 8 static site** deployed to Vercel. There is no
client-side router. All navigation is in-page anchors on one route (`/`), plus
**five prerendered static HTML documents** at `/projects/<slug>/` generated at
build time by a bespoke React-`renderToStaticMarkup` pipeline.

Content is **hardcoded in JavaScript modules** under `src/data/` and inline JSX
inside section components. There is **no database, no content API, no admin
dashboard, and no authentication**.

A **separate Python/FastAPI service** (`ai_service/`) is deployed to Render and
provides three endpoints: an RAG chat assistant (`/chat`, `/chat/stream`), a
GitHub proxy (`/api/github`) and a contact-form mailer (`/api/contact`).

## 1.2 Major findings

| # | Finding | Severity |
|---|---|---|
| F1 | **All 8 existing `docs/*.md` describe a different product.** They specify a "Personal Developer Platform" — a Next.js + Prisma + PostgreSQL CMS with blog revisions, scheduled publishing, autosave, analytics, media library, custom pages, navigation management and site search. Zero occurrences of React, Vite, Vercel, FastAPI, MongoDB, Express, ChromaDB, Groq, Gemini or Resend in any of them. | **Critical** |
| F2 | **`docs/API.md` and `docs/DATABASE.md` claim shipped implementation that does not exist** — "Implemented Authentication Endpoints (Phase 03)", "46 application tables implemented with Prisma in `prisma/schema.prisma`", two named migrations, `src/lib/db/`, `vitest.db.config.ts`, `scripts/verify-migrations.sh`, `pnpm test:db`. None of those files or directories exist. The repo has no `prisma/`, no `backend/`, no `app/`, no `tests/`, and no test framework in `package.json`. | **Critical** |
| F3 | **`docs/DESIGN_SYSTEM.md` describes a design system that is not implemented.** It specifies semantic tokens (`--foreground`, `--destructive-foreground`, `--focus-ring`, `--surface-elevated`) and a typography scale. The real system is hand-rolled CSS with concrete hex tokens (`--bg`, `--surface`, `--card`, `--primary`) and a single webfont (Inter 300–800). | **High** |
| F4 | **Portfolio content is duplicated in two places and has already drifted.** `ai_service/knowledge_base.json` holds 4 projects; `src/data/projects.js` holds 5. `Zerodha Clone` is missing from the AI's knowledge base, so the assistant cannot answer questions about it. | **High** |
| F5 | **`README.md` is materially wrong.** It advertises "EmailJS integration" (the site uses a FastAPI + Resend backend), lists 3 of 5 projects, and shows a project tree that does not match the repository. | **Medium** |
| F6 | **Adding a project through any future CMS will break `npm run build`** unless the build-time image contract is addressed. `PROJECT_IMAGE_DIMENSIONS` (`src/lib/projectPages.js:105`) is a hardcoded slug→size map, and `scripts/generate-project-pages.mjs:212` hard-requires `project.image === /images/projects/<slug>.webp`. A DB-only project insert fails the build. | **High** |
| F7 | `docs/` is **entirely untracked by git** (`?? docs/`), i.e. it was generated locally and never committed. Nothing in the current build, runtime or deployment depends on it. | Low |
| F8 | Minor pre-existing frontend defects, unrelated to migration and **not** in scope to fix: `Blog.jsx:110` reads `blog.date` which does not exist in `blogs.js`; `Hero.jsx:127` passes `showLabels` but `SocialLinks` declares `showLabel`; `ScrollToTop` is a no-op; `settings.ADMIN_TOKEN` (`ai_service/config/settings.py:84`) references a `/admin/cache/*` route that does not exist; `src/utils/githubUtils.js` is unreferenced. | Low |
| F9 | **`/api/contact` is effectively public.** `middleware.js` lists `/api/contact` in its matcher and injects `X-API-Key`, but `ai_service/routes/contact.py:35` declares its router with **no** `dependencies=[Depends(verify_api_key)]` — the same dependency `chat.py:24` applies. Nothing on the service reads the header. The endpoint is reachable directly at `https://portfolio-lxdx.onrender.com/api/contact`, bypassing Vercel and the edge entirely; only the 5/min IP rate limit and the honeypot protect it. Impact: outbound email abuse from the portfolio's sender domain, not data exposure. One-line fix (`dependencies=[Depends(verify_api_key)]` on the contact router) — deliberately **not** applied during the migration because it changes public endpoint behaviour. Recorded in `SECURITY.md` §2.5 and §3.5. | Medium |
| F10 | **No Vite dev proxy.** `vite.config.js` defines no `server.proxy`, so local API calls depend on `VITE_BACKEND_URL` being set in `.env` (cross-origin to `:8000`, permitted by `ai_service`'s default CORS origins). Anyone who clones the repo without copying `.env.example` gets a working static site with three silently broken features. | Low |

## 1.3 Migration objective

Make portfolio **content** manageable without editing `src/data/*.js`, while
leaving the public site's **UI, routes, animations, SEO surface and build
pipeline byte-for-byte compatible**.

## 1.4 The five real risks

1. **SEO regression.** Project pages, sitemap, image sitemap and `llms.txt` are
   produced from static JS at build time. Naively moving data to an API at
   request time deletes five indexable URLs and every discovery file.
   → Mitigated by ADR-004 (build-time API fetch) and ADR-005 (static fallback).
2. **Content drift.** The AI knowledge base already drifted once. A second
   source of truth is the cause.
   → Mitigated by ADR-006 (AI reads the content API, `knowledge_base.json` is
   retired).
3. **Build breakage on new content.** See F6.
   → Mitigated by ADR-007 (image dimensions become data, still verified
   against the real file at build time).
4. **Coupling portfolio availability to AI availability.** `ai_service` cold
   starts while ingesting ChromaDB and `/ready` returns 503 until it finishes.
   Content must not be served by that process.
   → Mitigated by ADR-002 (new `backend/` service; AI stays separate).
5. **Secret leakage.** The current `X-API-Key` injection in `middleware.js` is a
   shared secret across all visitors. Admin credentials must not reuse it.
   → Mitigated by ADR-009 (separate session cookie, real user auth).

---

# 2. Current Architecture (VERIFIED)

```mermaid
flowchart TD
    V["Visitor"]

    subgraph Vercel["Vercel (riturajlabs.vercel.app)"]
        direction TB
        CD["dist/ static output<br/>index.html + 5 project pages<br/>+ 4 discovery files"]
        MW["middleware.js<br/>(edge, matcher: /api/chat/*)<br/>injects X-API-Key"]
        RW["vercel.json rewrites<br/>/api/chat*, /health, /ready -> portfolio-lxdx<br/>/api/admin*, /api/contact, /api/github -> portfolio-api (TARGET)<br/>no /api/content or /api/projects rewrite"]
        AS["admin.html (separate admin SPA entry)"]
    end

    subgraph SPA["React 19 SPA (in-browser, route = /)"]
        direction TB
        SECTIONS["Sections: Hero, About, Skills,<br/>Projects, GithubStats,<br/>Certifications, Blog, Contact"]
        STATIC["src/data/*.js<br/>projects, profile, skills,<br/>certificates, blogs, socials"]
        LIBS["src/lib/projectPages.js<br/>(single source of project SEO)"]
        CHAT["ChatAssistant (SSE + sessionStorage)"]
    end

    subgraph Build["Build time (npm run build)"]
        direction TB
        V1["vite build (SPA) -> dist/"]
        V2["vite build --config vite.prerender.config.js -> .prerender/entry.mjs"]
        G1["generate-project-pages.mjs<br/>-> dist/projects/&lt;slug&gt;/index.html"]
        G2["generate-seo-discovery.mjs<br/>-> sitemap.xml, sitemap-images.xml,<br/>robots.txt, llms.txt"]
    end

    subgraph AI["Render: portfolio-lxdx (ai_service, Python 3.11.9)"]
        direction TB
        CHATP["POST /chat, POST /chat/stream<br/>X-API-Key required"]
        RAG["ChromaDB vector store<br/>+ Gemini embeddings (768d)"]
        LLM["Groq llama-3.3-70b<br/>+ Gemini gemini-embedding-001"]
        KB["knowledge_base.json<br/>(hand-maintained; rollback source)"]
    end

    subgraph BE["Render: portfolio-api (backend, Python 3.11.9) — TARGET"]
        direction TB
        GH["GET /api/github<br/>(PUBLIC, 5min in-proc cache)"]
        CT["POST /api/contact<br/>(PUBLIC, 5/min, honeypot) -> Resend"]
        ADMAPI["/api/admin/* (session-cookie auth)"]
        CONTENT["GET /api/content<br/>(public, ETag + cache)"]
    end

    V --> CD
    V --> SPA
    V --> AS
    SPA --> STATIC
    SPA --> LIBS
    SPA --> CHAT
    SPA -->|"/api/github", "/api/contact", "/api/admin/*"| RW
    SPA -->|"/api/chat/*"| MW
    MW --> RW
    RW --> CHATP
    RW --> GH
    RW --> CT
    RW --> ADMAPI
    CHATP --> RAG --> LLM
    KB -.->|"rollback: KNOWLEDGE_SOURCE=file"| RAG
    V2 --> G1
    V2 --> G2
    G1 -.->|"GET /api/content at build time"| CONTENT
    CONTENT --> RAG

    Build --> CD
```

## 2.1 Verified frontend facts

| Concern | Verified value | Source |
|---|---|---|
| Framework | React `^19.2.7`, Vite `^8.1.1` (Rolldown) | `package.json:19-26` |
| Routing | **None.** No `react-router`. `App.jsx` renders `<Home />` unconditionally | `src/App.jsx:36-40` |
| Routes served | `/` and `/projects/<slug>/` (×5) | `find dist -name '*.html'` |
| In-page anchors | `#home #about #skills #projects #github #certifications #blog #contact` | `src/components/layout/Navbar.jsx:10-19` |
| State | One React context (`ThemeContext`) + local `useState`. No global store | `src/context/` |
| Styling | Hand-rolled CSS + CSS custom properties. No CSS framework | `src/styles/*.css` |
| Grid | A 130-line Bootstrap subset (Reboot, `.container`, `.col-*`, `.d-*`) replacing ~230 KB of Bootstrap | `src/styles/bootstrap-grid-utilities.css:1-16` |
| Fonts | Inter 300–800 via Google Fonts `@import` (render-blocking CSS import) | `src/styles/global.css:4` |
| Animation | `framer-motion@^12` throughout | `package.json:18` |
| SEO runtime | `react-helmet-async` adopted over static tags via `data-rh="true"` | `index.html:29-66` |
| Analytics | `@vercel/speed-insights/react` only (no event analytics) | `src/App.jsx:52` |
| Lazy loading | `GithubStats`, `Certifications`, `Blog`, `Contact`, `Projects`, `ChatAssistant` | `src/pages/Home.jsx:13-31` |
| Env vars in bundle | `VITE_BACKEND_URL`, `VITE_API_URL` | `src/components/common/ChatAssistant.jsx:53`, `src/services/*.js:16` |

## 2.2 Verified `ai_service` facts

| Concern | Verified value | Source |
|---|---|---|
| Runtime | Python 3.11.9, FastAPI, uvicorn | `ai_service/runtime.txt`, `Procfile` |
| Deployment | Render (from `vercel.json` destination host) | `vercel.json:5,13,17` |
| Endpoints | `POST /chat`, `POST /chat/stream`, `GET /api/github`, `POST /api/contact`, `GET /`, `GET /health`, `GET /ready` | `ai_service/routes/*.py` |
| Auth | `X-API-Key` via `verify_api_key` — **applied to the chat router only** | `ai_service/routes/chat.py:24` |
| Auth bypass | `ENV=development` disables the key check entirely | `ai_service/core/security.py:75-84` |
| Provider routing | Short queries → Groq; long → Gemini. `PRIMARY_PROVIDER=auto` | `ai_service/config/settings.py:73-78` |
| Embeddings | `models/gemini-embedding-001`, `output_dimensionality=768` (RAM-bound choice) | `ai_service/services/embeddings.py:61-62` |
| Vector store | ChromaDB, persistent, rebuilt on every deploy | `ai_service/core/startup.py` |
| Caching | LLM response TTL cache (120 s, 256 entries); SQLite embedding query cache; in-proc 300 s GitHub cache | `llm_response_cache.py`, `embedding_cache.py`, `routes/github.py:33-34` |
| Rate limits | `/chat*` 10/60 s (env-tunable), `/api/contact` 5/min | `core/rate_limit.py`, `routes/contact.py:123` |
| CORS | Default allow-list `riturajlabs.vercel.app` + localhost:5173 | `app.py:64-92` |
| Mail | Resend HTTPS API (Render blocks outbound SMTP) | `routes/contact.py:8-12` |
| Knowledge | `knowledge_base.json`, 1003 lines, 8 top-level sections | `ai_service/knowledge_base.json` |

## 2.3 Verified environment variables

**Frontend (Vercel, server-side):**

| Var | Used by | Exposure |
|---|---|---|
| `BACKEND_API_KEY` | `middleware.js:13` | Server-only. Must equal `AI_SERVICE_KEY`. |

**Frontend (local dev only — must never be set in production):**

| Var | Used by |
|---|---|
| `VITE_BACKEND_URL` | `ChatAssistant.jsx:53`, `emailService.js:16`, `githubService.js:17` |
| `VITE_API_URL` | `emailService.js:16`, `githubService.js:17` |

`.env.example:14-19` documents the exact production hazard: any `VITE_*` var is
inlined into the public bundle, so setting `VITE_BACKEND_URL` in production
bypasses the middleware and returns `401` on `/chat`.

**Backend (`ai_service`):** `AI_SERVICE_KEY`, `GROQ_API_KEY`, `GROQ_MODEL`,
`GEMINI_API_KEY`, `GITHUB_TOKEN`, `GITHUB_USERNAME`, `CHROMA_DB_PATH`,
`KNOWLEDGE_FILE`, `COLLECTION_NAME`, `CHAT_TOP_K`, `CHAT_SCORE_THRESHOLD`,
`CHAT_RATE_LIMIT`, `CHAT_RATE_WINDOW`, `CHAT_TEMPERATURE`, `LLM_CACHE_*`,
`EMBEDDING_CACHE_*`, `SHORT_QUERY_TOKEN_THRESHOLD`, `PRIMARY_PROVIDER`,
`ADMIN_TOKEN` *(unused — the `/admin/cache/*` route it documents does not exist)*, `RESEND_API_KEY`,
`CONTACT_FROM_EMAIL`, `CONTACT_TO_EMAIL`, `ALLOWED_ORIGINS`, `ENV`, `PORT`,
`FORCE_REINGEST`.

---

# 3. Current Content Inventory (VERIFIED)

Every piece of portfolio content and exactly where it lives **today**.

## 3.1 Data files

| File | Lines | Exports | Consumed by |
|---|---|---|---|
| `src/data/projects.js` | 205 | 5 project objects | `ProjectCard.jsx`, `Projects.jsx`, `lib/projectPages.js`, `scripts/prerender/entry.jsx` |
| `src/data/profile.js` | 114 | identity, hero stats, resume path, socials | `Hero.jsx`, `Navbar.jsx`, `Footer.jsx`, `data/socials.js`, `scripts/prerender/entry.jsx` |
| `src/data/skills.js` | 116 | 4 skill categories + 16 skills (icon components) | `Skills.jsx` |
| `src/data/certificates.js` | 50 | 3 certifications | `Certifications.jsx` |
| `src/data/blogs.js` | 73 | 4 placeholder posts, all `link: "#"` | `Blog.jsx` |
| `src/data/socials.js` | 27 | 3 social links derived from `profile.social` | `SocialLinks.jsx`, `Footer.jsx` |
| `src/config/seo.js` | 243 | site identity, keywords, person, `sameAs` | `SEO.jsx`, `lib/projectPages.js`, `scripts/prerender/entry.jsx` |

## 3.2 Content embedded in JSX (not in any data file)

This is the part a naive "move `src/data` to the database" plan misses.

| Content | Location | Note |
|---|---|---|
| `aboutCards` — 4 cards (Education / Development / AI & ML / Career Goal) | `src/components/sections/About.jsx:14-39` | Module-level array inside the component file |
| "My Journey" prose — 2 paragraphs | `src/components/sections/About.jsx:73-89` | Raw JSX text |
| `navigation` — 7 anchor items | `src/components/layout/Navbar.jsx:10-19` | Order is user-visible |
| `footerLinks` — 7 anchor items | `src/components/layout/Footer.jsx:10-18` | Duplicates `navigation` |
| `footer-role` ("AI & ML Student") and footer tagline | `src/components/layout/Footer.jsx:47-54` | Hardcoded |
| `contactLinks` — email / LinkedIn / GitHub | `src/components/sections/Contact.jsx:158-181` | **Hardcoded strings**, not `profile.social` |
| Contact copy ("I am open to internship opportunities…") | `src/components/sections/Contact.jsx:285-289` | Hardcoded |
| Section titles/tags/descriptions — 6 sections | `SectionTitle` props in each section | Hardcoded |
| `GREETING_TEXT`, `SUGGESTED_QUESTIONS` | `src/components/common/ChatAssistant.jsx:58-68` | Hardcoded |
| `llms.txt` About/Education/Skills prose | `scripts/seo/discovery.mjs:277-290` | **Hardcoded inside the generator**, not derived |
| Home/resume `lastmod` | `scripts/generate-seo-discovery.mjs:111-112` | Hardcoded preserved values |
| `PROJECT_IMAGE_DIMENSIONS` | `src/lib/projectPages.js:105-111` | Hardcoded slug→size map |

## 3.3 Content duplicated into `ai_service/knowledge_base.json`

| KB section | Drift vs frontend |
|---|---|
| `projects` (4) | **Missing `Zerodha Clone`** (frontend has 5) |
| `profile` | Richer (tagline, university, semester, CGPA, availability flags) — not on the public site |
| `education` | **College name, CGPA 9.16, semester 3, graduation 2028** — none of this is on the public site |
| `skills` | 11 groups vs the site's 4 — richer |
| `certifications` (3) | Same 3, but with `category`, `issueDate`, `credentialId`, `skills` |
| `socials` | Consistent with `profile.social` |
| `recruiter` | Entirely AI-only |
| `faq` | AI-only |

`profile.js:92-111` also contains a **nested `seo` object that nothing imports** —
dead duplicate of `src/config/seo.js`.

## 3.4 Hardcoded structural rules that the database must not be allowed to break

| Rule | Where | Consequence if it changes |
|---|---|---|
| `project.image` must equal `/images/projects/<slug>.webp` | `scripts/generate-project-pages.mjs:212` | Build fails |
| The WebP file must exist in `dist/images/projects/` | `scripts/generate-project-pages.mjs:227` | Build fails |
| `PROJECT_IMAGE_DIMENSIONS[slug]` must exist and match the real WebP header | `src/lib/projectPages.js:117`, checked at `generate-project-pages.mjs:282` | Build fails |
| Exactly one `<link rel=preload as=image>`, in `<head>` | `generate-project-pages.mjs:275-280` | Build fails |
| Every indexable project URL must exist as a file in `dist/` | `scripts/generate-seo-discovery.mjs:222-230` | Build fails |
| A non-indexable project must have no page and appear in no discovery file | `generate-seo-discovery.mjs:260-289` | Build fails |
| Every URL in `llms.txt` must exist in the project data | `scripts/seo/discovery.mjs:626-659` | Build fails |
| `index.html` metadata and `config/seo.js` must match (via `data-rh`) | `index.html:29-66` vs `config/seo.js` | Duplicate tags |

**Conclusion: the build is already a schema validator for project content. The
migration must move that validation to build time over API-fetched data, not
delete it.**

---

# 4. Documentation Audit Results

Status key: **Accurate** / **Partially accurate** / **Outdated** / **Incorrect** /
**Missing** / **Contradictory**

| File | Lines | Status | Findings | Action |
|---|---|---|---|---|
| `docs/ARCHITECTURE.md` | 1004 | **Incorrect** | Describes a "Personal Developer Platform" with `Application Layer`, `Presentation Layer`, PostgreSQL, object storage and a generic AI pipeline. Mentions neither the real stack nor the real problems. Contradicts itself by proposing a monolith while the repo already has two services. | Rewritten |
| `docs/API.md` | 2136 | **Incorrect** | 74 sections covering ~150 endpoints, most of which the portfolio does not need. Section 5 is headed *"Implemented Authentication Endpoints (Phase 03)"* — no such implementation exists. Documents neither the 7 endpoints that *do* exist nor the `X-API-Key` scheme in `middleware.js`. | Rewritten |
| `docs/DATABASE.md` | 1533 | **Incorrect** | Specifies 46 Prisma tables in `prisma/schema.prisma`. Section 61 claims the schema, two named migrations (`20260914035118_init`, `20260914044407_add_public_listing_indexes`), a `portfolio_dev` database on port 5433, `src/lib/db/`, and `scripts/verify-migrations.sh`. **None exist.** | Rewritten |
| `docs/DEPLOYMENT.md` | 1378 | **Outdated / Missing** | Entirely platform-agnostic. Never names Vercel, Render, or `middleware.js`. No record of the current `npm run build` 4-stage pipeline, `vercel.json` rewrites/headers, or the `BACKEND_API_KEY` → `AI_SERVICE_KEY` binding — the single most important deployment fact in the repo. | Rewritten |
| `docs/DESIGN_SYSTEM.md` | 1546 | **Incorrect** | Specifies semantic tokens (`--foreground`, `--surface-elevated`, `--destructive-foreground`, `--focus-ring`) and a 10-step type scale that do not exist. Describes blog-reading, media-library, analytics and admin-dashboard UI for surfaces that do not exist. | Rewritten |
| `docs/PRODUCT_REQUIREMENTS.md` | 1231 | **Partially accurate** | The *intent* (data-driven content, SEO parity, no redesign) matches, but every page requirement assumes a router and separate routes (`/projects`, `/experience`, `/achievements`, `/open-source`) that do not exist. | Rewritten |
| `docs/SECURITY.md` | 1580 | **Partially accurate** | Principles are sound; specifics are wrong. Documents CSRF tokens for cookie sessions that do not exist, and is silent on the actual implemented controls (`middleware.js` key injection, `hmac.compare_digest`, `slowapi`, Resend, honeypot, `extra="forbid"`, Vercel headers). | Rewritten |
| `docs/TESTING.md` | 1697 | **Incorrect** | Section 56 states tests run against `portfolio_test` via `TEST_DATABASE_URL … pnpm test:db` and `vitest.db.config.ts`. The repo uses **npm**, has **no test framework**, and has **zero test files**. | Rewritten |
| `README.md` | 291 | **Outdated** | "EmailJS integration"; 3 of 5 projects; wrong project tree. | Corrected |

---

# 5. Risk Register

Scales: Impact / Probability ∈ {Low, Medium, High, Critical}.

| ID | Risk | Impact | Probability | Mitigation | Owner phase |
|---|---|---|---|---|---|
| R1 | Prerendered project pages stop being generated, losing 5 indexed URLs | Critical | High | Build fetches content from the API at build time and **fails** if the API is unreachable or returns no projects. Never silently degrade. | M7 |
| R2 | `sitemap.xml` / `llms.txt` / `robots.txt` are absent or empty | Critical | High | Keep the existing generator and its validators verbatim; only change where data comes from. Add a post-build assertion that all four files exist and are non-empty. | M7 |
| R3 | New project breaks the build (image contract, F6) | High | High | Move `width`/`height` onto the `project` row; keep the WebP-header verification in the generator. Admin form validates both. | M2/M7 |
| R4 | AI assistant content drifts again | High | High | `ai_service` fetches its knowledge base from the content API at startup; `knowledge_base.json` becomes a generated artifact or is deleted. Add a CI check comparing the two while both exist. | M9 |
| R5 | AI cold start (`/ready` 503) blocks portfolio content | High | Medium | Content is served by `backend/`, never by `ai_service`. No shared process, no shared health gate. | M1 |
| R6 | Admin credentials leak or are brute-forced | Critical | Low | Argon2id hashing, `HttpOnly`+`SameSite=Strict`+`Secure` session cookie, server-side session table, per-IP **and** per-email rate limits, uniform failure messages, constant-time comparison. | M4 |
| R7 | `VITE_*` var leaks the backend host into the bundle | High | Medium | All production calls stay same-origin under `/api/*`; the Vercel rewrite + middleware pattern is extended, not replaced. `.env.example` warning preserved. | M3 |
| R8 | Public API has no cache and is hit on every page view | Medium | High | Single aggregated `GET /api/content` endpoint + `ETag`/`Cache-Control: public, max-age=300, stale-while-revalidate` + build-time static fallback snapshot. | M3/M7 |
| R9 | Existing project slugs change and break live URLs | Critical | **None** | **Slug is immutable once published**; the API returns `409 SLUG_IMMUTABLE`. No redirect table, no `redirect_from` field, nothing to migrate. The migration never renames an existing slug. (`ARCHITECTURE.md` ADR-016) | M2/M6 |
| R10 | Backend platform migration disturbs the working Vercel/Render setup | High | Medium | Content API is deployed **alongside** on Render first; `vercel.json` rewrites are the only coupling and are one-line, revertable changes. | M11 |
| R11 | Over-engineering — the docs' original CMS scope is rebuilt | High | High | Explicit entity scope table in `DATABASE.md`; `PRODUCT_REQUIREMENTS.md` non-goals; every PR must cite a real requirement. | All |
| R12 | Prerender SSR bundle pulls in API code and breaks | Medium | Medium | `.prerender/entry.jsx` must import only `lib/projectPages.js` + a data-source module, never a browser-only service. Verified by `npm run build`. | M7 |
| R13 | Chat `401` regression from a middleware/rewrite edit | High | Medium | Keep `middleware.js` matcher semantics; add `/api/content*` to the matcher only if a server-side key is genuinely needed (it is not for public reads). Verify `/chat` before and after. | M11 |
| R14 | Blog content made dynamic but no blog route exists | Medium | High | v1 stores blog metadata only and renders exactly today's five fields. `/blog/:slug` is explicitly deferred behind a documented approval gate. | M8 |
| R15 | Resume PDF URL breaks | Critical | Low | `site_profile.resume` seeds today's `/Ritu_Raj_Full_Stack_Developer_Resume.pdf`; the sitemap entry is asserted to resolve to a real file. | M6/M7 |

---

# 6. What Is Explicitly **Not** Being Migrated

Recorded here so no future phase silently adds it.

| Item | Why excluded |
|---|---|
| Client-side router / `react-router` | The site has one route. Adding a router changes bundle size, navigation behaviour and the prerender contract for zero user-visible gain. |
| SSR framework (Next.js, Remix, Nuxt) | The existing prerender pipeline already produces fully server-rendered project pages with correct metadata. SSR would be a rewrite, not an upgrade. |
| GraphQL | One consumer, one payload shape. REST is sufficient. |
| Redis / message queue / event bus | No workload that needs them. In-process TTL caches already exist where they help. |
| Object storage + media library | Project images are 5 committed WebP files that a build verifies byte-level. A media library is a redesign. |
| Blog revisions, autosave, scheduling, comments | No such feature exists today. |
| Analytics event pipeline | Only Vercel Speed Insights is used today. |
| Custom pages, navigation management, appearance management | Single-page layout is fixed; not configurable today. |
| Experience / Achievements / Open Source sections | Not present on the site. Designed in `DATABASE.md` §10 but **not built** in v1. |
| Microservices / Kubernetes / multiple databases | Explicit non-goal. |

---

# 7. Verification Commands Used In This Audit

Run from the repository root. All are read-only with respect to tracked files
(`dist/` and `.prerender/` are gitignored).

```bash
# Dependency / build surface
cat package.json

# Confirm zero client-side routing
rg -n "react-router|BrowserRouter|Routes" src package.json

# Confirm the real stack is absent from every doc
rg -ci "React|Vite|FastAPI|MongoDB|ChromaDB|Groq|Resend" docs/*.md

# Confirm the docs' claimed implementation is absent
ls prisma backend src/lib/db vitest.db.config.ts scripts/verify-migrations.sh

# Confirm no test infrastructure exists
rg -n "vitest|jest|playwright|@testing-library" package.json

# Build pipeline green + prerender/discovery output
npm run lint && npm run build

# SEO surface
cat dist/robots.txt dist/sitemap.xml dist/sitemap-images.xml
find dist -name '*.html'

# AI service surface
cat ai_service/Procfile ai_service/runtime.txt ai_service/requirements.txt
rg -n "APIRouter" ai_service/routes/*.py

# Deployment surface
cat vercel.json middleware.js .vercel/output/config.json
```

---

# 8. Analysis Outcome

| Question | Answer |
|---|---|
| Does the current portfolio work? | **Yes.** `npm run lint` and `npm run build` are green; 5 project pages and 4 discovery files are generated. |
| Does the current documentation describe it? | **No.** All 8 documents describe a different product, and 2 of them assert shipped code that does not exist. |
| Is a backend needed? | **Yes**, for content only. Chat/GitHub/contact already have one. |
| Must the frontend be rewritten? | **No.** A service + hook layer between the data and the existing components is sufficient. |
| Must prerendering/SSR change? | **No.** Only the *source* of the data changes (JS module → build-time API fetch). |
| Must SEO change? | **No.** The generators and their validators stay; their input source changes. |
| Is the existing AI service the right backend? | **Partly.** It is the right *runtime and language* but the wrong *service* — it must not own content. |
| Ready to implement? | **Yes**, on the contract in `MIGRATION.md` and the specs in the other docs. |

---

# 9. Phase 1.5 Final Architecture Review

A documentation-only review pass run against the repository **after** Phase 0.
Its purpose was to eliminate every ambiguity that would have forced a decision
during implementation. No source file was modified.

## 9.1 The headline finding

Phase 0's `DATABASE.md` claimed **"Tables in scope: 14"** while enumerating **16**
entities. Phase 1.5 resolved this — and the correct answer was **neither number**.

> **Final: 9 tables.** Seven proposed entities were removed because they fail the
> independence test in `DATABASE.md` §1.1. The 14-vs-16 discrepancy was a symptom;
> the real problem was that seven things should never have been tables.

## 9.2 What the review changed

| Area | Phase 0 | Phase 1.5 |
|---|---|---|
| Tables | "14", while listing 16 | **9**, each justified; 7 removals documented |
| Public content endpoints | `content`, `projects`, `projects/{slug}` | **`content` only** — the other two had no caller |
| Admin endpoints | ~25 | **24**; reorder, image-meta, education, social-links and blog groups removed |
| Blog | table + CRUD + route planned | static; deferred until a real post exists |
| Publishing | `draft \| published \| archived` | **no drafts** — two independent flags (ADR-016) |
| Build trigger | "content changes trigger a rebuild" (unowned) | **admin button → Vercel deploy hook**, explicit (ADR-017) |
| Admin routing | an open sub-decision | **closed**: `react-router-dom`, admin entry only (ADR-010) |
| `profile.seo`, `profile.techStack` | implicitly migrated | **dead code — verified zero consumers, deleted** |
| `site_profile` | ~19 columns | **16**, each traced to a verified consumer |
| Icon registry | assumed to exist | **new file — does not exist today** (ADR-008) |
| Public component diff | claimed "none" | **1 file** (`About.jsx`, icon imports) |
| Build pipeline diff | claimed "one line" | fetch step + snapshot-derived dimensions |
| `vite.config.js` | claimed unmodified | **must change** — multi-entry build (ADR-010) |
| Bootstrap order | implied | **9 explicit steps** (`MIGRATION.md` §3) |
| Rollback | "revert if something breaks" | **10-row matrix**, each with trigger + action + restore source (`MIGRATION.md` §4) |

## 9.3 Corrections to Phase 0's own factual claims

Phase 0 introduced errors that Phase 1.5 had to fix. Recorded because a document
that is confidently wrong is worse than one that is silent:

| Claim | Reality |
|---|---|
| "Tables in scope: 14" | 16 were listed; 9 are correct |
| Icon registry "already exists" | **No such directory.** `icon_key` appears nowhere in `src/` |
| Public frontend diff is zero | `About.jsx` must change for icon serialisation |
| Build pipeline diff is one line | Both generators need a fetch step |
| `vite.config.js` is not modified | A multi-entry admin build requires modifying it |
| `site_profile.resume_path` / `hero_stats` / `bio` | The real keys are `resume`, `stats`, `description` |
| `site_profile.avatar` | `profileImage` is a **Vite asset import** — not string content |
| Chat rate limit 20/min | `chat.py:284,293` enforces **10/min** |
| `profile.techStack` | Defined at `profile.js:78`, **read by nothing** |
| `profile.seo` | Defined at `profile.js:92`, **read by nothing** |

## 9.4 Verified-against-code additions

Facts confirmed by direct inspection during the review, each of which constrains
the design:

| Fact | Consequence |
|---|---|
| `socials.js:9-25` hardcodes order, labels and `react-icons` components | `social_link` table removed; `site_profile.social` keeps its exact object shape |
| `relatedProjects()` (`projectPages.js:171-185`) intersects in-memory arrays | `project_technology` removed; `tech_stack text[]` suffices |
| `Projects.jsx` renders `indexableProjects()` in array order and never filters by category | `project_category` removed; `category text` suffices |
| `discover.mjs:385-392` needs `profile.resume` **and** `seo` | `GET /api/projects` could never serve the build alone |
| `About.jsx:51,73-89` holds prose outside the cards array | `about` is one structured jsonb column, not a flat text field |
| `image` must equal `/images/projects/<slug>.webp` (`generate-project-pages.mjs:207-218`) | Enforced by a DB CHECK, because a CMS insert can break the build |
| `projectImageDimensions()` throws on an unknown slug | `PROJECT_IMAGE_DIMENSIONS` becomes snapshot-derived, not deleted |
| `ENV` defaults to production when unset | The dev auth bypass fails safe |

## 9.5 Review outcome

| Question | Answer |
|---|---|
| Are the table count, API surface and source of truth unambiguous? | **Yes.** `DATABASE.md` §0, `ARCHITECTURE.md` §17. |
| Is the minimal v1 feature set agreed? | **Yes.** 9 tables, 5 public endpoints, 24 admin endpoints. |
| Are draft/publish and the build trigger defined? | **Yes.** ADR-016 and ADR-017; no drafts, explicit rebuild. |
| Is the admin routing decision closed? | **Yes.** ADR-010. |
| Is first-run bootstrap ordered? | **Yes.** `MIGRATION.md` §3, 9 steps. |
| Is every dangerous transition revertible with a named source? | **Yes.** `MIGRATION.md` §4, 10 rows. |
| Was any production code changed? | **No.** Documentation only. |

---

# END OF ANALYSIS
