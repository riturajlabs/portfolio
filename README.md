# Ritu Raj — Portfolio

[![Live](https://img.shields.io/badge/live-riturajlabs.vercel.app-2563EB?style=flat-square)](https://riturajlabs.vercel.app/)
[![GitHub](https://img.shields.io/badge/GitHub-riturajlabs-181717?style=flat-square&logo=github)](https://github.com/riturajlabs)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Ritu%20Raj-0A66C2?style=flat-square&logo=linkedin)](https://linkedin.com/in/riturajlabs)
[![Contact](https://img.shields.io/badge/email-riturajlabs@outlook.com-EA4335?style=flat-square&logo=gmail)](mailto:riturajlabs@outlook.com)

A single-page personal portfolio with five individually indexable project pages,
a static-site SEO pipeline, live GitHub statistics, a working contact form and a
retrieval-augmented AI assistant.

**Stack:** React 19 · Vite 8 · FastAPI · ChromaDB · Vercel · Render

> **In progress:** content has been migrated from hardcoded JS modules to a
> PostgreSQL-backed content API. The design, routes, SEO output and public
> components are unchanged by that work — see [`docs/MIGRATION.md`](docs/MIGRATION.md).
>
> **Status:** the `backend/` service hosts the **admin dashboard** as well.
> Its 9-table schema (`alembic 0001_initial`), `/health`, `/ready`, `GET
> /api/content` (with `ETag`/`304`, CORS and rate limiting) and Argon2id
> login/server-side sessions/CSRF are joined by **21 admin resource endpoints**
> (`/api/admin/*` — projects, skills, certifications, profile, messages) — a
> **445-test backend suite**.
>
> The admin UI is a **separate Vite entry** routed by `react-router-dom`,
> served at `/admin`, with its API proxied same-origin to
> `portfolio-api-j7xc.onrender.com` in production and `localhost:8001` in dev. A
> build-time guard (`scripts/assert-admin-bundle.mjs`) fails the build if any
> admin or router code leaks into the public bundle. Frontend tests run under
> vitest (`npm test`).
>
> **Phase 7 (read path) is done:** every `npm run build` / `npm run dev` first
> runs `scripts/build-content.mjs`, which fetches `GET /api/content`, validates
> it strictly and writes a committed, byte-deterministic snapshot
> (`src/generated/content.js`) that the bundler bakes into the static site —
> so the browser never calls the API at runtime, the site stays up even with
> the API down, and the build **fails closed** if content is unreachable or
> invalid. `src/data/*.js` remains only as the migration source.
>
> **Phase 8 (write path) is done:** `POST /api/contact` (validated, rate
> limited 5/min, persisted to `contact_message`, delivered via Resend) and
> `GET /api/github` (server-side proxy with a 300 s cache) moved from
> `ai_service` to the `backend/` service. The frontend contract is unchanged;
> `middleware.js` and chat routing are untouched. Backend suite is now
> **445 tests** (`tests/test_contact_api.py`, `tests/test_github_api.py`).
>
> **Phase 9 (knowledge re-point) is done locally:** `ai_service` now builds its
> ChromaDB index from `GET /api/content` at startup (`KNOWLEDGE_SOURCE=api`,
> the default) instead of `knowledge_base.json`, so chat can answer about all
> 5 projects with no file edit or redeploy. A fetch or validation failure is
> **fail-closed** — `/ready` stays `503`; the committed `knowledge_base.json`
> is retained only for the `KNOWLEDGE_SOURCE=file` rollback (see
> `docs/MIGRATION.md` Phase 9 and `docs/DEPLOYMENT.md` §6.4).

---

## Table of contents

- [Architecture](#architecture)
- [Quick start](#quick-start)
- [Build pipeline](#build-pipeline)
- [Routes](#routes)
- [Project structure](#project-structure)
- [Scripts](#scripts)
- [Backend services](#backend-services)
- [Environment variables](#environment-variables)
- [Testing](#testing)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [Documentation](#documentation)
- [Known issues](#known-issues)
- [License](#license)

---

## Architecture

```text
                            ┌─────────────────────────────┐
    Browser  ──────────────▶│  Vercel                    │
                            │  static dist/               │◀── npm run build
                            │    /  + 5 project pages     │    (content snapshot + build)
                            │    + admin SPA at /admin    │
                            │    + 4 discovery files      │
                            │                             │
                            │  middleware.js              │
                            │    injects X-API-Key        │
                            └──────┬──────────────────────┘
                                   │
                ┌──────────────────┼──────────────────┐
                │ /api/chat        │ /api/contact     │ /api/github
                ▼                  ▼                  ▼
   ┌────────────────────────┐   ┌──────────────────────────────────────┐
   │ portfolio-lxdx         │   │ portfolio-api                       │
   │ ai_service — FastAPI   │   │ backend/ — FastAPI + PostgreSQL     │
   │  /chat, /chat/stream   │   │  /api/admin/* (24, session)         │
   │  (SSE, LLM)            │   │  /api/content (ETag/304, limited)   │
   │  GET /api/content      │   │  /api/contact (persist + Resend)    │
   │   → ChromaDB           │   │  /api/github  (proxy, 300 s cache)  │
   └────────────────────────┘   └──────────────────────────────────────┘
```

| Component | Tech | Platform |
|---|---|---|
| Frontend | React 19 + Vite 8, static output | Vercel |
| AI service | Python 3.11 + FastAPI + ChromaDB | Render (`portfolio-lxdx`) |
| Backend | Python 3.11 + FastAPI + PostgreSQL | Render (`portfolio-api`) |
| Database | PostgreSQL 16, content API (`portfolio-api-j7xc.onrender.com/api/content`) | Render or any managed Postgres (Neon recommended — Render's free tier expires after 30 days) |
| Email | Resend (via backend) | — |
| LLM | Groq, Gemini fallback | — |

**Key properties**

- The public site is **static**. No SSR framework, no client-side router.
- All 5 project pages are **prerendered at build time** with complete `<head>`
  metadata, JSON-LD and measured image dimensions.
- The build **validates** project data, image dimensions and discovery-file
  consistency, and fails rather than producing incomplete output.
- `ai_service` is a **separate deployment**. An outage cannot take the portfolio
  down.

---

## Quick start

**Requirements:** Node.js 22+, npm 10+.

```bash
git clone https://github.com/riturajlabs/portfolio.git
cd portfolio
npm install
npm run dev
```

Open <http://localhost:5173>.

The AI chat widget needs `ai_service` running (see
[Backend services](#backend-services)); contact and GitHub stats need the
`backend/` service. Everything else works standalone.

**Vite dev proxies.** `vite.config.js` forwards `/api/admin`, `/api/contact`
and `/api/github` to the backend on `:8001`, so those work out of the box with
just `backend/` running. Chat is the one call with **no** proxy: copy
`.env.example` to `.env` and leave `VITE_BACKEND_URL=http://localhost:8000` set,
and the browser calls `ai_service` directly on `:8000`
(`ai_service`'s default CORS origins already allow `http://localhost:5173`).

---

## Build pipeline

`npm run build` runs **five** stages in order. This is the most important thing
to understand about the repository.

```bash
npm run build
│
├── 0. node scripts/build-content.mjs                 → src/generated/     content snapshot
├── 1. vite build                                    → dist/            client bundle
├── 2. node scripts/assert-admin-bundle.mjs           → —                admin/public isolation (fails the build)
├── 3. vite build --config vite.prerender.config.js   → .prerender/       SSR bundle
├── 4. node scripts/generate-project-pages.mjs        → dist/projects/    5 HTML pages
└── 5. node scripts/generate-seo-discovery.mjs        → dist/             discovery files
```

**Output**

| Artifact | Path |
|---|---|
| Homepage | `dist/index.html` |
| Project pages | `dist/projects/<slug>/index.html` × 5 |
| Sitemap | `dist/sitemap.xml` |
| Image sitemap | `dist/sitemap-images.xml` |
| Robots | `dist/robots.txt` |
| LLM summary | `dist/llms.txt` |

Stages 4 and 5 are **validators as much as generators**. The build fails when:

- the content API is unreachable, invalid, or returns zero projects (stage 0)
- a project is missing required fields
- `project.image !== /images/projects/<slug>.webp`
- `image_width`/`image_height` disagree with the real WebP header
- a slug is duplicated
- `sitemap.xml`, `robots.txt` or `llms.txt` would be internally inconsistent
- admin or router code leaks into the public bundle (stage 2)

A failed build is the intended outcome for invalid content — not a warning.

### Bundle analysis

```bash
ANALYZE=1 npm run build    # writes stats.html
```

| Chunk | Contents |
|---|---|
| `react-*` | `react`, `react-dom`, scheduler |
| `motion-*` | `framer-motion` |
| `icons-*` | `react-icons` (tree-shaken) |
| `markdown-*` | `react-markdown` + remark plugins |
| `index-*` | App entry and components |

`markdown-*` is lazy-loaded — it ships when the chat widget first opens, not at
first paint.

---

## Routes

| URL | Content | Indexable |
|---|---|---|
| `/` | Single-page portfolio, 7 sections | yes |
| `/projects/webchat-ai/` | Project page | yes |
| `/projects/orbit-ai/` | Project page | yes |
| `/projects/stayora/` | Project page | yes |
| `/projects/zerodha-clone/` | Project page | yes |
| `/projects/scientific-calculator/` | Project page | yes |

**Homepage sections:** `#home` · `#about` · `#skills` · `#projects` ·
`#github` · `#certifications` · `#blog` · `#contact`

---

## Project structure

```text
portfolio/
├── backend/                  FastAPI + PostgreSQL content service (new)
│   ├── app/
│   │   ├── config.py         DATABASE_URL / ENVIRONMENT settings
│   │   ├── logging.py        JSON logging
│   │   ├── db/               async engine, session, Alembic helper
│   │   ├── models/           the 9 tables (DATABASE.md §5)
│   │   └── routes/           health, public content, admin API (/api/admin/*)
│   ├── alembic/versions/     0001_initial — the 9 tables
│   ├── tests/                445 tests against a real PostgreSQL
│   ├── alembic.ini
│   └── pyproject.toml
│
├── ai_service/               FastAPI AI assistant (Render)
│   ├── routes/               chat.py, github.py, contact.py
│   ├── services/             LLM providers, embeddings
│   ├── core/                 rate limiting, startup, knowledge loading
│   ├── config/               settings
│   ├── knowledge_base.json   RAG rollback source (KNOWLEDGE_SOURCE=file)
│   ├── Procfile
│   └── runtime.txt
│
├── scripts/
│   ├── prerender/
│   │   ├── entry.jsx         Compiles project data → .prerender/entry.mjs
│   │   └── document.jsx      Serializes a full project-page document
│   ├── seo/
│   │   └── discovery.mjs     Pure builders for sitemap / robots / llms.txt
│   ├── generate-project-pages.mjs
│   ├── generate-seo-discovery.mjs
│   └── assert-admin-bundle.mjs  Fails the build if admin/router code leaks into the public bundle
│
├── src/
│   ├── components/
│   │   ├── common/           Button, SectionTitle, SocialLinks, ProjectCard,
│   │   │                     SEO, Loader, ScrollProgress, ScrollToTop,
│   │   │                     ChatAssistant
│   │   ├── layout/           Navbar, Footer, ThemeToggle
│   │   ├── pages/            ProjectPage (rendered at build time)
│   │   └── sections/         Hero, About, Skills, Projects, GithubStats,
│   │                         Certifications, Blog, Contact
│   ├── config/
│   │   └── seo.js            Site metadata — url + verification only (merged into the content snapshot)
│   ├── context/              ThemeContext
│   ├── data/                 ⚠️ migration source only — NOT the runtime authority (docs/CONTENT_MAPPING.md)
│   │   ├── projects.js       5 projects
│   │   ├── skills.js         4 categories, 16 skills
│   │   ├── profile.js        Hero, bio, socials, resume
│   │   ├── certificates.js   3 certifications
│   │   ├── blogs.js          4 placeholders
│   │   └── socials.js        Derived from profile.js
│   ├── generated/
│   │   └── content.js        ⚠️ generated — DO NOT EDIT. Build-time GET /api/content snapshot
│   ├── hooks/                useTheme, useScrollSpy, useGithub
│   ├── lib/
│   │   ├── projectPages.js   single authority for project-page SEO (reads generated content)
│   │   ├── content.js        build-time loader + strict validation (fail-closed, Node side)
│   │   └── publicContent.js  adapter — profile, socials, skillCategories, certificates for the public site
│   ├── pages/Home.jsx
│   ├── services/             emailService, githubService
│   ├── styles/               16 CSS files + design tokens
│   ├── admin/                Admin SPA — own Vite entry at /admin
│   │   ├── api/              HTTP client (CSRF, session-expiry, 429 Retry-After)
│   │   ├── components/       Form, DataTable, Toast, ConfirmDialog, pickers
│   │   ├── context/          AuthContext
│   │   ├── layout/           AdminLayout (nav + topbar)
│   │   ├── lib/              validators, icon registry hook
│   │   ├── pages/            Login, Dashboard, Projects, Skills,
│   │   │                     Certifications, Profile, Messages
│   │   ├── AdminApp.jsx      Router + auth gate
│   │   └── admin.css         Admin design tokens (never imported by public code)
│   ├── App.jsx
│   └── main.jsx
│
├── public/                   images, resume PDF, favicons, security.txt
├── docs/                     architecture, API, database, deployment, …
├── index.html                static SEO baseline
├── admin.html                admin SPA entry (noindex, no-store)
├── middleware.js             Vercel edge — X-API-Key injection
├── vercel.json               rewrites (incl. /admin + /api/admin), security headers, cache policy
└── vite.config.js            multi-entry build, /api/admin dev proxy
```

**Editing public content today:** change it in the **admin dashboard** (or the
database) and rebuild — `npm run build` / `npm run dev` fetch `GET
/api/content`, validate it strictly and write `src/generated/content.js` (a
committed snapshot regenerated on every build). The browser never calls the
API at runtime; a build with unreachable/invalid content **fails closed**.
`src/data/*.js` is the migration source only — after a reseed + `npm run
seed:extract`, edit there and extract if you need the seed snapshot without
touching the database.

---

## Scripts

| Command | Description |
|---|---|---|
| `npm run dev` | `build-content` then Vite dev server on `:5173`. Chat goes direct to `:8000` via `VITE_BACKEND_URL` in `.env`; `/api/admin`, `/api/contact` and `/api/github` are proxied to `:8001` (the backend) |
| `npm run build` | `build-content` then the 5-stage production build — Vite compile → bundle-isolation assert → prerender → project pages → discovery files |
| `npm run content:build` | Stage 0 only — fetch `GET /api/content` → validate → emit `src/generated/content.js` (fails closed) |
| `npm run build:spa` | Stages 1 only — fast iteration, no prerender |
| `npm test` | Vitest — admin unit + component tests, seed pipeline tests (`scripts/*.test.mjs`) |
| `npm run lint` | ESLint across the project |
| `npm run prerender` | Stage 3 only — regenerate project pages |
| `npm run discovery` | Stage 4 only — regenerate discovery files |
| `npm run seed:extract` | `src/data/*.js` + `About.jsx` constants → `.cache/content-snapshot.json` (deterministic, fail-closed) |
| `npm run seed:load` | Snapshot → PostgreSQL (idempotent; `DATABASE_URL` required, `alembic upgrade head` first) |
| `npm run seed:verify` | Field-by-field diff of `GET /api/content` vs the snapshot; exits non-zero on any difference |
| `npm run admin:bootstrap` | One-time production bootstrap — POSTs the admin email/password + snapshot to `POST /api/admin/bootstrap` over HTTPS. Needs `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_BOOTSTRAP_TOKEN` (≥32 chars) and `CONTENT_API_URL`. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) §6.6 |
| `npm run admin:setup` | **Local only** — create the first admin via `python -m db.admin` (needs a migrated local database) |
| `npm run admin:reset` | **Local only** — replace the admin via `python -m db.admin --reset` |
| `npm run preview` | Serve the production build locally |
| `ANALYZE=1 npm run build` | Bundle treemap → `stats.html` |

---

## Backend services

Two independent Python services exist. They do not share code, a process or a
database.

### `backend/` — content service (PostgreSQL)

The service that will own portfolio content. **Hosts the admin area:**
schema, migrations, health endpoints, `GET /api/content`, Argon2id login with
server-side sessions/CSRF, **21 admin resource endpoints** (`/api/admin/*`)
for projects, skills, certifications, profile and messages, and — since
Phase 8 — `POST /api/contact` (persist + Resend) and `GET /api/github`
(proxy). `GET /api/projects` was deliberately dropped — see
[`docs/API.md`](docs/API.md) §5.1.1. Everything from the `/admin` SPA is served
by Vercel and talks to this service only through the same-origin `/api/admin`
rewrite; `/api/contact` and `/api/github` are public rewrites that land here
too (dev: proxied to `:8001`).

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env            # then set DATABASE_URL

export DATABASE_URL="postgresql://user@localhost:5432/portfolio_dev"
python -m alembic upgrade head
python -m uvicorn app.main:app --reload --port 8001
```

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/content` | none | All public content in one payload. `ETag` + `Cache-Control: public, max-age=300, stale-while-revalidate=600`; 304 on `If-None-Match`. 404 if the profile singleton is absent, 503 if the database is unreachable. 300 req/min per IP |
| `GET /health` | none | Liveness — no database call, 200 even if the database is down |
| `GET /ready` | none | Readiness — 503 unless the database is reachable, migrated, and complete |
| `POST /api/admin/auth/login` | none | Argon2id verify, sets an `HttpOnly` `SameSite=Strict` session cookie. 10 attempts/15 min per IP **and** 5 failures/15 min per email → 429 |
| `POST /api/admin/auth/logout` | session + CSRF | Revokes the session server-side, clears the cookie. 204, or 401 without a session |
| `GET /api/admin/me` | session | Safe admin identity plus the CSRF token unsafe admin requests must echo back |
| `GET/POST /api/admin/projects` | session + CSRF | List (no bodies) / create |
| `GET/PUT/DELETE /api/admin/projects/{id}` | session + CSRF | Detail / update / soft delete (`status='hidden'`, `indexable=false`) |
| `GET/POST /api/admin/skill-categories` · `PUT/DELETE /{id}` | session + CSRF | CRUD (delete cascades skills, refuses unless `?cascade=true`) |
| `GET/POST /api/admin/skills` · `PUT/DELETE /{id}` | session + CSRF | CRUD |
| `GET/POST /api/admin/certifications` · `PUT/DELETE /{id}` | session + CSRF | CRUD |
| `GET/PUT /api/admin/profile` | session + CSRF | Read / replace-validated `site_profile` |
| `GET /api/admin/messages` · `PATCH /{id}` | session + CSRF | Filtered/paginated inbox; mark `read`/`archived`. No delete, no resend |
| `POST /api/contact` | none | Validated contact form → `contact_message` row → Resend (Phase 8). 5/min per IP, honeypot, 502 on Resend failure (row kept) |
| `GET /api/github` | none | Server-side GitHub proxy — `{profile, repositories, cached}` shape, 300 s cache, `GITHUB_TOKEN` raised quota (Phase 8) |

`/health` and `/ready` answer differently on purpose. `/ready` returning 503 on a
database outage is information; `/health` returning 503 on the same outage would
make an infrastructure problem look like an application crash and trigger a
restart loop. Neither is rate limited, for the same reason.

`/api/content` is read-only at the database as well as in intent: every query runs
with `postgresql_readonly=True`, so a write cannot slip in behind a `GET`. It reads
the schema as it stands — Phase 3 added no migration and no dependency. Phase 4
likewise added no migration: `admin_user`, `admin_session` and `admin_audit_log`
already existed. It did add one dependency, `argon2-cffi`.

### `ai_service` — AI assistant

A separate Python deployment on Render.

```bash
cd ai_service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # add your keys
uvicorn app:app --reload --port 8000
```

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /chat` | `X-API-Key` | Chat, SSE streaming (both `/chat` routes stream; `/chat/stream` is the widget's primary path) |
| `POST /chat/stream` | `X-API-Key` | Chat, SSE streaming (used by the widget) |
| `GET /api/github` | none | **Removed in Phase 8** — now served by `backend/` (see above). The copy that still exists here is unreachable via Vercel |
| `POST /api/contact` | none | **Removed in Phase 8** — now served by `backend/`. The copy that still exists here is unreachable via Vercel |
| `GET /health` | none | Liveness — no dependency check |
| `GET /ready` | none | Readiness — `503` while ChromaDB ingests |

The Vercel rewrite in `vercel.json` maps `/api/chat` → `/chat` (the service
registers chat at the root) and `/api/github`, `/api/contact` 1:1 — the latter
two to `portfolio-api-j7xc.onrender.com` (the `backend/` service) since Phase 8. Do
not change one side without the other.

**Knowledge source (Phase 9).** At startup the service fetches
`GET /api/content` (strictly validated, fail-closed), chunks it and converges
its ChromaDB collection; `/ready` reports `503` until that finishes. The
`KNOWLEDGE_SOURCE=file` switch rebuilds the index from the committed
`knowledge_base.json` instead — that is the rollback (`docs/DEPLOYMENT.md`
§6.4). `ai_service/services/parity.py` diffs the two sources for evidence.

---

## Environment variables

**Frontend runtime:** the deployed portfolio needs **no** client-side secrets or
runtime environment variables. The Vercel edge injects `X-API-Key`, so the
browser never holds a secret.

**Frontend build (Vercel):** the production build requires one non-secret
variable, `CONTENT_API_URL`, pointing at the deployed backend's `/api/content`
endpoint (e.g. `https://portfolio-api-j7xc.onrender.com/api/content`). `npm run build`
fetches the content snapshot from it and **fails closed** if the endpoint is
unreachable or returns zero projects — a static build cannot be produced without
a reachable, seeded backend. It is not a secret and is never sent to the browser.

> **Never name a secret `VITE_*`.** Any `VITE_` variable is inlined into the
> public bundle at build time and is visible to anyone who views source.

**`backend/`:**

| Variable | Secret | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | **Required.** PostgreSQL URL. `postgresql://` is rewritten to the asyncpg driver automatically. Never committed — `alembic.ini` contains no credentials |
| `ENVIRONMENT` | no | `development`, `staging` or `production`. Defaults to `development` |
| `TEST_DATABASE_URL` | yes | Tests only. A throwaway database — see [Testing](#testing) |
| `ALLOWED_ORIGINS` | no | CORS allow-list for `/api/content`, comma-separated bare origins. Defaults to the Vercel domain plus both localhost hosts. `*` is refused in `staging` and `production` |
| `TRUSTED_PROXY_HEADER` | no | Header the edge overwrites with the real client IP for per-IP rate limits. **Set `cf-connecting-ip` on Render**; leave unset locally. Only `cf-connecting-ip` is accepted |
| `CONTENT_RATE_LIMIT` | no | Requests per window per IP on `/api/content`. Defaults to `300` |
| `CONTENT_RATE_WINDOW_SECONDS` | no | Defaults to `60` |
| `RESEND_API_KEY` | yes | Contact delivery (Phase 8; required to send) |
| `CONTACT_TO_EMAIL` | no | Contact recipient. Defaults to `riturajlabs@outlook.com` |
| `CONTACT_FROM_EMAIL` | no | Verified Resend sender. Defaults to `onboarding@resend.dev` |
| `CONTACT_RATE_LIMIT` | no | Contact requests per window per IP. Defaults to `5` |
| `CONTACT_RATE_WINDOW_SECONDS` | no | Defaults to `60` |
| `GITHUB_USERNAME` | no | GitHub proxy target (Phase 8) |
| `GITHUB_TOKEN` | yes | Raises the GitHub API quota; optional |
| `ADMIN_BOOTSTRAP_TOKEN` | yes | One-time (≥32 chars). While set on Render it enables `POST /api/admin/bootstrap`, which creates the first admin **and** seeds content atomically. **Remove it after a successful `npm run admin:bootstrap`** — the endpoint then returns `404` ([`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) §6.6) |

> This is the common subset. [`docs/ENVIRONMENT_VARIABLES.md`](docs/ENVIRONMENT_VARIABLES.md)
> is authoritative for the full list (admin session limits, `DEPLOY_HOOK_URL`,
> `AI_SERVICE_*`, `PYTHON_VERSION`, …).

**`ai_service` (Render):**

| Variable | Secret | Purpose |
|---|---|---|
| `AI_SERVICE_KEY` | yes | Must equal Vercel's `BACKEND_API_KEY`. Verified in constant time |
| `GROQ_API_KEY` | yes | Primary LLM |
| `GEMINI_API_KEY` | yes | Fallback LLM |
| `RESEND_API_KEY` | yes | Contact delivery — **still read**, but contact is served by `backend/` since Phase 8 |
| `CONTACT_TO_EMAIL` | no | Contact recipient (as above) |
| `GITHUB_TOKEN` | yes | Raises the API rate limit (as above) |
| `GITHUB_USERNAME` | no | Proxy target (as above) |
| `CONTACT_FROM_EMAIL` | no | Verified Resend sender (as above) |
| `ALLOWED_ORIGINS` | no | CORS allow-list. Never `*` |
| `ENV` | no | **Must stay unset or `production`.** `ENV=development` disables chat auth entirely |
| `CHROMA_DB_PATH` | no | ChromaDB persistence path |
| `CONTENT_API_URL` | no | Knowledge source endpoint. Defaults to `http://127.0.0.1:8001/api/content`; set to the `backend/` origin in production (Phase 9) |
| `CONTENT_API_TIMEOUT` | no | Seconds to wait for the content API. Defaults to `10` |
| `KNOWLEDGE_SOURCE` | no | `api` (default, Phase 9) indexes `GET /api/content`; `file` indexes the committed `knowledge_base.json` (rollback) |
| `TRUSTED_CLIENT_IP_HEADER` | no | Header Vercel's edge signs with the real client IP for per-client chat limits. **Set `x-vercel-client-ip` on Render**; leave unset locally. Only `x-vercel-client-ip` is accepted. Unset = every caller shares one global bucket |
| `CLIENT_IP_SIGNING_SECRET` | yes | Optional; defaults to `AI_SERVICE_KEY` (the value the edge signs with). Set only to rotate it independently |

**Vercel:** `BACKEND_API_KEY` (Production + Preview, secret) plus
`CONTENT_API_URL` (**build-time**, non-secret:
`https://portfolio-api-j7xc.onrender.com/api/content`). No `VITE_*` variable is set.

---

## Testing

### Frontend

```bash
npm run lint     # ESLint
npm test         # vitest — admin unit + component tests (116 passed)
npm run build    # content validation + bundle-isolation assert + full production build
```

**The frontend gate is lint + unit/component tests + the build.** `npm test`
runs the vitest suite (`src/admin/**/*.test.*` — validators, the API error
mapping, a table component). `npm run build` performs real validation of
project data, image dimensions, discovery-file consistency, and — via
`scripts/assert-admin-bundle.mjs` — fails if any admin or `react-router-dom`
code leaked into the public bundle.

### End to end (Playwright)

```bash
npm run build                 # e2e serves and rebuilds dist itself in CI
npm run test:e2e              # 14 tests against throwaway DBs (Chromium)
npm run test:migration-validation   # 13 dist-structure + metadata contracts
```

The e2e suite boots three disposable servers (site on :4173 serving the built
`dist/`, backend on :8901 with its own `portfolio_e2e` database, a Resend safe
on :8902) and sandboxes every `localhost:8000` call the public bundle makes, so
chat, contact and GitHub never touch a real service. Admin login runs the real
CSRF flow with a real session cookie. Needs a reachable PostgreSQL and builds
`dist/` first (CI does both in the same job). See
[`docs/TESTING.md`](docs/TESTING.md) §9 and `.github/workflows/ci.yml`.

### `backend/`

```bash
cd backend
python -m ruff check .                                    # lint
TEST_DATABASE_URL="postgresql://user@localhost:5432/portfolio_test" \
  python -m pytest -q                                     # 445 tests
```

The backend suite runs against a **real PostgreSQL instance**, not SQLite.
`citext`, `jsonb`, `text[]`, UUID defaults and `ON DELETE CASCADE` either do not
exist or behave differently in SQLite, so a green SQLite run would prove nothing.
The fixtures drop and recreate the schema, then build it by running
`alembic upgrade head` — the migration is exercised on every run rather than
assumed. With no database configured, collection fails with instructions instead
of skipping.

### `ai_service/`

```bash
npm run lint:ai_service    # ruff check .
npm run test:ai_service    # pytest — 60 tests, no API/keys/DB required
```

The suite runs fully offline: a fake embedding function stands in for Gemini,
`content_api` is tested against a strict Pydantic mirror of `GET /api/content`,
and the SSE protocol tests stub the LLM SDK modules at import time. Coverage
notes and the parity tool (`python -m services.parity`) are in
[`docs/TESTING.md`](docs/TESTING.md) §8.

---

## Deployment

| Piece | Platform | Trigger |
|---|---|---|
| Frontend | Vercel | Auto-deploy on push to `main` |
| `backend/` (`portfolio-api`) | Render (free) | Blueprint deploy from [`render.yaml`](render.yaml); migrations (`alembic upgrade head`) run in the **build**. Owns `/api/admin/*`, `/api/contact`, `/api/github` and public `GET /api/content` |
| `ai_service` | Render (free) | Manual deploy (or a Render GitHub hook) |
| Database | Render / Neon (free) | Managed PostgreSQL; `DATABASE_URL` is supplied to `portfolio-api` (`sync: false`). Prefer Neon — Render's free Postgres **expires 30 days after creation** |

**Before any deploy**

```bash
npm ci && npm run lint && npm test && npm run build
ls dist/projects/*/index.html | wc -l     # must be 5
git status                                 # must be clean
```

Rollback: Vercel instant rollback to a previous deployment; Render rollback to
a previous deploy. Full runbook: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

**First deployment is an ordered runbook, not a `git push`.** Follow
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) §6: provision Postgres → deploy the
backend (migrations run in the build) → verify `/health`/`/ready` → bootstrap the
first admin + content over HTTPS (`npm run admin:bootstrap`) → verify parity →
remove the bootstrap token → deploy the frontend. Steps 1–10 have no user-facing
impact.

**Resume:** before the first admin upload the site serves the bundled static PDF;
after it, the profile points at the stable `/api/resume` route and the statically
generated frontend needs **one** rebuild to pick that up (`docs/DEPLOYMENT.md`
§6.7). Later resume replacements need no rebuild.

---

## Contributing

1. Create a branch.
2. Run `npm run lint`, `npm test` and `npm run build`. All three must pass. If
   you touched `backend/`, also run `python -m ruff check .` and
   `python -m pytest -q` from `backend/` — the suite needs a PostgreSQL
   database, see [Testing](#testing).
3. If you changed content, run `npm run content:build` (regenerates
   `src/generated/content.js`), then verify the generated output —
   `dist/sitemap.xml`, `dist/llms.txt`, each `dist/projects/*/index.html`,
   and `node scripts/verify-parity.mjs` against the pre-cutover baseline if
   one applies.
4. Open a PR describing what changed and which URLs are affected.

Content changes and design changes belong in **separate** PRs. The build
validates content; it cannot validate a visual regression.

---

## Documentation

| Document | Contents |
|---|---|
| [`docs/ANALYSIS.md`](docs/ANALYSIS.md) | Current-state audit, verified inventory, risks, Phase 1.5 review outcome |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Architecture, 17 ADRs, failure isolation, **final decision register** |
| [`docs/API.md`](docs/API.md) | Endpoint contracts, endpoint-minimality review, auth, errors, rate limits |
| [`docs/DATABASE.md`](docs/DATABASE.md) | **9 tables**, entity-minimality review, constraints, migration strategy |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Runbooks, environments, bootstrap order, rollback, DR |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Threat model, controls, gaps, checklists |
| [`docs/TESTING.md`](docs/TESTING.md) | Test strategy, phase plan, CI |
| [`docs/PRODUCT_REQUIREMENTS.md`](docs/PRODUCT_REQUIREMENTS.md) | Requirements, personas, non-goals |
| [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) | Tokens, conventions, boundaries |
| [`docs/MIGRATION.md`](docs/MIGRATION.md) | 13-phase plan, **bootstrap order**, **rollback matrix** |

Every document labels its content **CURRENT**, **TARGET** or **MIGRATION**, so
it is always clear what exists today and what is planned.

**Where every "why" is settled.** The contested decisions are not scattered —
they are closed in [`docs/ARCHITECTURE.md` §17](docs/ARCHITECTURE.md), an
18-row register that names the superseded value for each row so the change is
auditable. Two things to read first:

| Question | Answer | Where |
|---|---|---|
| How many tables? | **9**, with 7 proposed entities removed | [`DATABASE.md` §0–§1](docs/DATABASE.md) |
| Is the site dynamic? | Content is managed dynamically, served **statically** | [`ARCHITECTURE.md` §9.1](docs/ARCHITECTURE.md) |
| What happens after an admin edit? | Saved to the DB immediately; live after an explicit rebuild | [`ARCHITECTURE.md` ADR-017](docs/ARCHITECTURE.md) |
| What can go wrong, and how is it undone? | 10 named transitions, each with a restore source | [`MIGRATION.md` §4](docs/MIGRATION.md) |

---

## Known issues

Documented, not yet fixed.

| # | Issue | Impact |
|---|---|---|
| 1 | `ai_service/knowledge_base.json` had 4 of 5 projects | **Fixed by Phase 9 locally** — the index is now built from `GET /api/content` (all 5 projects answerable); the file is kept only for the `KNOWLEDGE_SOURCE=file` rollback. Production verification pending (`docs/DEPLOYMENT.md` §6.4) |
| 2 | Content changes require a developer, an edit and a deploy | Primary motivation for the content migration |
| 3 | `src/components/sections/Blog.jsx` reads `blog.date`, which does not exist | Undefined rendered |
| 4 | `Hero.jsx` passes `showLabels`; `SocialLinks` expects `showLabel` | Prop ignored |
| 5 | `ScrollToTop` is a no-op | Deep links do not reset scroll |
| 6 | `ai_service/config/settings.py:84` declares `ADMIN_TOKEN` for a `/admin/cache/*` route that does not exist | Misleading — invites a shared-secret admin pattern |
| 7 | `src/utils/githubUtils.js` is unused | Dead code |
| 8 | No automated tests, no CI | Regressions found manually |
| 9 | No Content-Security-Policy header | No defence-in-depth against XSS |
| 10 | ChromaDB is ephemeral unless `CHROMA_DB_PATH` is a persistent disk | `/ready` returns `503` on cold start |

Full analysis with file references: [`docs/ANALYSIS.md`](docs/ANALYSIS.md).

---

## Connect

[![GitHub](https://img.shields.io/badge/GitHub-riturajlabs-181717?style=for-the-badge&logo=github)](https://github.com/riturajlabs)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Connect-0A66C2?style=for-the-badge&logo=linkedin)](https://linkedin.com/in/riturajlabs)
[![Email](https://img.shields.io/badge/Email-Contact-EA4335?style=for-the-badge&logo=gmail)](mailto:riturajlabs@outlook.com)

---

## License

Code in this repository is for portfolio and demonstration purposes.
All rights reserved.
