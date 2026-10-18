# Portfolio Upgrade — Final Audit-First Blueprint

**Document Status:** ACTIVE — audit complete; **Phase U1 verified complete**; awaiting owner approval to start **Phase U2**.
**Document Type:** Audit report + upgrade blueprint (single coherent authority)
**Version:** 2.0 — reconciled with the final audit-first brief; supersedes v1.0 phase structure
**Last Verified Against Code:** commit `5c684c9` (HEAD, `portfolio-upgrade`), 2026-10-17 — full re-audit this session
**Live deployment (recorded baseline target):** `https://riturajlabs.vercel.app` (inspected 2026-10-17, Phase U1)

---

## 0. Read this first — change control

This upgrade intentionally edits areas the migration-era documents froze. That
conflict was resolved through the repository's own change-control process:

| Original rule | Resolution | Where |
|---|---|---|
| "Redesigning the public UI" non-goal | Superseded | ADR-018, `PRODUCT_REQUIREMENTS.md` §5 |
| `src/styles/**` zero changes (D1–D3, N4) | Superseded — styles unfrozen for this track | ADR-018, `DESIGN_SYSTEM.md` §2/§8 |
| `src/data/**` freeze (N4 reworded, N5) | **Retained and mechanically enforced** | tripwire + CI guard |
| Admin isolation, bundle budget, SEO/contact/GitHub contracts, API/schema, auth | **Retained, mandatory** | ADR-018 "Retained" list |

**Governing rules for every phase:**

1. One independently revertible commit per approved phase on `portfolio-upgrade`.
2. Approval is phase-specific: U2 approval does not authorize U3+.
3. No push, merge, deploy or production-config change without separate explicit authorization.
4. No framework/CSS-framework/SSR/database/API/deployment change; no new dependency without separately approved justification.
5. `src/data/**` stays frozen (tripwire + CI enforce; changing it requires a separate explicit decision).
6. Backend/AI/CMS code changes (U7) require evidence-backed justification and may be split into separately approved sub-phases.
7. Unavailable measurements, skipped tests, assumptions and unresolved decisions are marked explicitly — never papered over.

---

## 1. Executive summary

The application is a mature, well-tested, content-managed static portfolio with
a working AI assistant, CMS, contact pipeline and SEO pipeline. The independent
re-audit this session (§2) confirmed every material claim of the original
blueprint and U1, and found **no P0 defects in the backend, AI service, admin,
security or SEO subsystems**. The upgrade is therefore **surgical**:

1. **Correctness/accessibility defects in the public frontend** (all verified, all cheap): broken GitHub cold-start fallback, ignored reduced-motion preference, undefined renders (`blog.date`, `certificate.description`), a Loader built from non-existent CSS classes, a no-op `ScrollToTop`, hardcoded About/Contact content that bypasses the CMS, and missing ARIA state on the mobile nav.
2. **Theme architecture**: a light theme exists as tokens (`[data-theme="light"]`) and a working toggle, but has no pre-paint script, no `prefers-color-scheme` support, and was never deliberately designed or contrast-tested. The brief makes dark **and** light first-class.
3. **Visual modernization** ("futuristic tech"): restrained evolution of the existing dark slate + blue/violet identity with a real elevation scale, disciplined typography, subtle grid/border/glow treatment, and a deliberately designed light counterpart — layered on top of the fixes, phase by phase.

Backend, AI-service, admin and deployment findings (§5.5–5.7) are **P2-grade
hardening items or deployment-shape observations**, not blockers; any of them
that touch code are scheduled in U7 behind separate approval.

---

## 2. Verified current architecture and Git state

### 2.1 Git and change-control state (independently re-verified 2026-10-17)

| Item | Verified value |
|---|---|
| Branch | `portfolio-upgrade` (local-only; **no upstream, never pushed**) |
| HEAD | `5c684c9` — *docs(upgrade): record ADR-018 and narrow tripwire to src/data (Phase U1)* |
| Parent of HEAD | `eec84e1` = `main` = `origin/main` (linear; merge-base = `eec84e1`) |
| Working tree | **Clean** — no staged, unstaged or untracked files; no stashes |
| U1 diff | 9 files, +846/−45, **docs + tests + CI only** (no application code, no `src/styles`, no `src/data`) — inspected in full |
| CI history | Last 4 `main` runs **success** (`gh run list`); one earlier failure at `580901a` fixed by subsequent commits |
| Unrelated local work | None found |

**U1 claim verification (re-run this session):**

| Claim | Result |
|---|---|
| `npm run lint` | **clean** ✅ |
| `npm test` | **160 passed / 14 files** ✅ (matches "was 162: two styles-tripwire tests removed") |
| `npm run test:migration-validation` | **13 passed** ✅ |
| `npm run test:ai_service` | **95 passed** ✅ (15 pre-existing chromadb deprecation warnings) |
| `npm run test:api` | **Not runnable in this environment** (no local Postgres; CI runs it green) |
| Tripwire protects `src/data` | Verified by inspection: vitest checks tracked + untracked changes; CI checks merge-base diff. Logic sound; not mutation-tested this session (working tree intentionally untouched) |
| `src/styles` unfrozen | Verified: no styles guard remains in test or CI |
| ADR-018 records superseded vs retained invariants | Verified in full (`docs/ARCHITECTURE.md:590-659`) |
| Baseline captured | `docs/upgrade-baselines/U1-before.md` — method + full numbers present |

**U1 discrepancies: none material.** Minor notes: (a) backend pytest and
Playwright e2e were not re-run locally this session — no local Postgres — but CI
covers both and the last 4 `main` runs are green; (b) the Lighthouse baseline
numbers are accepted as recorded evidence (method and environment fully
documented; raw JSON intentionally gitignored under `/tmp/opencode/`); (c) the
tripwire was verified by inspection, not by a deliberate mutation test.

### 2.2 Stack (verified against code)

| Layer | Technology | Evidence |
|---|---|---|
| Frontend | React 19.2 + Vite 8; React Router 7 **admin-only** | `package.json`, `src/admin/AdminApp.jsx:5` |
| Animation | Framer Motion 12 (**no** `MotionConfig`/`useReducedMotion` usage anywhere — P0-2) | grep; `package.json` |
| Icons | react-icons 5 + emoji (certifications) | `DESIGN_SYSTEM.md` §1.6 |
| Styling | 16 hand-written CSS files + custom properties; light tokens exist at `variables.css:178` | `src/styles/**` |
| Backend | FastAPI + SQLAlchemy 2 (async) + Alembic, PostgreSQL 16, 9 tables, 4 migrations | `backend/app/**` |
| AI service | FastAPI + ChromaDB (768-dim `gemini-embedding-001`) + Groq/Gemini, SSE streaming | `ai_service/**` |
| Hosting | Vercel (static + edge middleware) + 1 Render service (`portfolio-api`) + separate AI-service deploy + Neon PG | `vercel.json`, `render.yaml` |
| Content | Build-time only: `GET /api/content` → `src/generated/content.js` → static bundle (**no runtime content fetch**) | `scripts/build-content.mjs`; grep confirms no `ContentContext`/`useContent` |

### 2.3 Public surface (verified)

- One route `/` with 8 in-page sections (`home, about, skills, projects, github, certifications, blog, contact`) — `src/pages/Home.jsx`.
- 5 prerendered project pages at `/projects/<slug>/` (`orbit-ai`, `scientific-calculator`, `stayora`, `webchat-ai`, `zerodha-clone`).
- Discovery files: `sitemap.xml` (7 URLs), `sitemap-images.xml`, `robots.txt`, `llms.txt` — all self-validated at build.
- Floating AI chat widget (lazy-loaded, SSE, cold-start retry).
- Admin SPA at `/admin/*` — separate entry, separate bundle, `no-store` + `noindex`.

### 2.4 Backend API (verified from `backend/app/routes/**` + OpenAPI)

| Group | Endpoints |
|---|---|
| Public | `GET /health`, `GET /ready`, `GET /api/content` (ETag/SWR, 300/min/IP), `GET /api/github` (300 s cache), `POST /api/contact` (honeypot, 5/min/IP), `GET /api/resume` (private bucket, 60/min/IP) |
| Admin auth | `POST /api/admin/auth/login` (dual IP+email limiter), `POST /api/admin/auth/logout` (CSRF), `GET /api/admin/me` (issues CSRF token) |
| Admin content | 21 CRUD/upload/publish routes for projects, skill-categories, skills, certifications, profile, messages — **every mutating route CSRF-enumerated in `test_phase10_gaps.py`** |
| Admin bootstrap | `POST /api/admin/bootstrap` (token-gated, 404 when unset, advisory DB lock) |

### 2.5 Security posture (verified — unusually strong for this class of project)

- **Argon2id** (Type.ID, OWASP baseline, timing equaliser for unknown emails).
- **Sessions:** 256-bit token, SHA-256-hash-at-rest, idle 12 h sliding + absolute 7 d, server-side revocation.
- **CSRF:** HMAC synchronizer bound to session token, constant-time compare, required on every unsafe admin method; issued only via `GET /api/admin/me`.
- **Cookies:** `HttpOnly`, `SameSite=Strict`, `Secure` in staging/prod.
- **CORS (backend):** explicit allow-list; wildcard refused at startup in prod/staging; credentials off; GET-only.
- **Rate limits:** content/contact/resume/admin-read/login, all with `Retry-After`.
- **Client IP:** only `CF-Connecting-IP` trusted; `X-Forwarded-For` refused; edge middleware overwrites and HMAC-signs the IP for `/api/chat/*`.
- **Error disclosure:** generic messages + `request_id` correlation; no stack traces/SQL/hostnames in responses; Resend errors email-masked.
- **Secrets:** no committed secrets (env history scanned); `.env` untracked + gitignored + `.vercelignore`d; `render.yaml` secrets `sync: false`.
- **XSS:** one `dangerouslySetInnerHTML` (JSON-LD, `<`-escaped); no `eval`; `react-markdown` without `rehype-raw`; `target=_blank` always paired with `noopener noreferrer`.
- **Admin enforcement is server-side** (route dependencies), not frontend convention; bundle isolation enforced by `assert-admin-bundle.mjs` inside `npm run build` (executed clean this session: 12 public chunks, 0 violations, admin separate).

### 2.6 Deployment (verified)

- `vercel.json`: rewrites for `/admin*`, `/api/admin*`, `/api/resume`, `/api/contact`, `/api/github`, `/api/chat*`, `/health`, `/ready`; strong security headers; immutable caching for `/assets`,`/images`; admin HTML `no-store`+`noindex`. **`/api/content` deliberately not rewritten (404 publicly — build fetches server-to-server).**
- `middleware.js`: edge; injects `X-API-Key` + HMAC-signed client IP for `/api/chat/*` only; fail-closed (503) when key missing.
- `render.yaml`: single service `portfolio-api`; AI service deploys separately; `autoDeployTrigger: "off"`; health check `/ready`.

---

## 3. Audit findings (this session — severity, evidence, confidence)

Legend: **[V]** verified directly in code/live this session · **[R]** reported by code read, re-confirm in-phase · **[A]** assumption.
Finding IDs: `FE` = frontend, `BE` = backend, `AI` = AI service, `SEC` = security/deploy, `OPS` = operations.

### 3.1 P0 — must fix in Phase U2 (all frontend; all [V])

| ID | Finding | Evidence |
|---|---|---|
| FE-1 | GitHub cold-start fallback renders **broken avatar + `@undefined`**: `FALLBACK_PROFILE` lacks `avatar_url`/`login`/`name`; `GithubStats.jsx` renders them unguarded. Error state unreachable (`getGithubData()` never throws) | `src/services/githubService.js:19-24`, `src/components/sections/GithubStats.jsx:154-168` |
| FE-2 | **`prefers-reduced-motion` ignored by all Framer Motion animations** — no `MotionConfig`/`useReducedMotion` anywhere; only the CSS blanket override exists; measured: 42 animated inline elements under `reduce`, identical to normal | grep; `docs/upgrade-baselines/U1-before.md` §4 |
| FE-3 | `Loader.jsx` (Suspense fallback for every lazy section) uses classes that exist **nowhere** (`placeholder-glow`, `placeholder`, `mb-3`, `py-5`) → unstyled layout flash | `src/components/common/Loader.jsx:5-17`; no definitions in `src/styles/**` |
| FE-4 | `Blog.jsx` renders `blog.date` — field does not exist in `src/data/blogs.js`; `status` never shown; section bypasses content pipeline | `Blog.jsx:8,110`; `data/blogs.js` |
| FE-5 | `Certifications.jsx` renders `certificate.description` — adapter deliberately omits it → always `undefined` paragraph | `Certifications.jsx:106`; `publicContent.js:134-139` |
| FE-6 | `About.jsx` fully hardcoded; **CMS `about` payload has no public consumer** — admin edits silently do nothing | `About.jsx:14-88`; `src/generated/content.js:63`; `publicContent.js:34-40` |
| FE-7 | `ScrollToTop.jsx` is a no-op (handler returns early at `scrollY===0` and does nothing otherwise), mounted as a feature in `App.jsx` | `ScrollToTop.jsx:6-14`; `App.jsx:29` |
| FE-8 | Hero: literal `color="red"` + stray `c` prop on map icon; `SocialLinks` receives `showLabels` but expects `showLabel` | `Hero.jsx:76,129`; `SocialLinks.jsx:6` |

### 3.2 P1 — scheduled in U2–U6 (frontend)

| ID | Finding | Evidence | Phase |
|---|---|---|---|
| FE-9 | Navbar: mobile toggle lacks `aria-expanded`/`aria-controls`; no `aria-current` on active link; `#github` section has no nav entry (scroll-spy can activate an id with no link) | `Navbar.jsx:10-19,93-114` | U4 |
| FE-10 | Theme: no pre-paint script (possible flash), no `prefers-color-scheme`, provider value not memoized; **light mode never deliberately designed/contrast-tested** | `index.html`; `ThemeContext.jsx:13-35,75-90` | U3 |
| FE-11 | Contact hardcodes email + LinkedIn + GitHub instead of CMS `profile.social` (Footer correctly uses the pipeline — claim partially overstated in v1) | `Contact.jsx:158-181`; `Footer.jsx:4-5` | U6 |
| FE-12 | Project modal lacks full focus trap (Tab can leave dialog); contrast with `ChatAssistant.jsx:269-297` which implements one | `ProjectCard.jsx:35-54` | U5 |
| FE-13 | 21 interactive targets < 44×44 px desktop / 49 mobile (nav links ~45×20, theme toggle 42×42, copy button 38×38) | `U1-before.md` §4 | U4–U6 |
| FE-14 | Global `user-select: none !important` on links/buttons; global `.btn { width:100% }` under 576 px applies to modal/ghost buttons too | `index.css:45-46`, `global.css:33`; `button.css:148-154` | U3/U4 |
| FE-15 | 9 distinct box-shadows; no elevation scale; project cards have none | `U1-before.md` §3 | U3 |
| FE-16 | Light theme: ~5–7 hardcoded dark overlays/shadows outside `variables.css` (`button.css:81`, `projects.css:44,131,246`, `global.css:165,173` fallbacks) — heavy in light mode | grep (scoped) | U3/U5 |
| FE-17 | Blog is 4 disabled "Coming Soon" placeholders with no reading route | `data/blogs.js`; `Blog.jsx:148-161` | U6 (pending decision Q1) |
| FE-18 | `index.html` static JSON-LD/meta baseline hand-duplicates CMS `seo` (drift risk) | `index.html:233-278` | U8 review |

### 3.3 Backend / AI service (all P2 or deployment-shape; **no P0/P1 code defects**)

| ID | Finding | Evidence | Disposition |
|---|---|---|---|
| BE-1 | In-process rate limiters multiply by instance count if scaled horizontally (documented single-instance assumption, ADR-014) | `rate_limit.py:7-12` | Document; no change |
| BE-2 | Per-request `httpx.AsyncClient` (no pooling) — fine at portfolio traffic | `services/github.py:80`, `contact.py:169`, `publish.py:96,165` | U7 optional |
| BE-3 | PII in logs: contact-delivery logs sender name/email; login audit stores attempted email cleartext | `routes/contact.py:183-189`; `services/auth.py:191` | U7 candidate (redaction) |
| BE-4 | No `pool_recycle` (mitigated by `pool_pre_ping`) | `db/session.py:28-34` | U7 optional |
| BE-5 | `failed_attempts`/`locked_until` DB columns recorded but never consulted (in-memory limiter enforces) — operator confusion risk | `services/auth.py:10-16` | Document |
| BE-6 | Bootstrap endpoint remains an internet-reachable write surface while token set (well-guarded: ≥32-char token, constant-time, 404 when unset) | `routes/admin_bootstrap.py` | Document |
| AI-1 | AI-service CORS materially broader than backend: `allow_credentials=True`, `*` methods/headers, warn-only | `ai_service/app.py:83-92` | **U7 candidate (tighten to match backend)** |
| AI-2 | Provider clients built at import with possibly-empty keys — misconfig fails at first request, not startup | `routes/chat.py:30-32` | U7 optional |
| AI-3 | No explicit provider retry/backoff; fallback is order-based (short-query→Groq first, long→Gemini first; `PRIMARY_PROVIDER` override exists for rollback) | `config/settings.py:105-115` | Document; architecture change requires separate approval |

### 3.4 Security / deployment hardening (no exploitable defect found)

| ID | Finding | Evidence | Disposition |
|---|---|---|---|
| SEC-1 | **No Content-Security-Policy** anywhere (self-documented in `README.md:672`) — no XSS defence-in-depth | `vercel.json:50-226` | Requires production-config change → **decision Q5** |
| SEC-2 | Login exempt from CSRF on both sides (deliberate; login-CSRF bounded by rate limits + attacker needing valid credentials) | `client.js:12-15`; `admin_auth.py:44` | Document; no change |
| SEC-3 | No Origin/Referer check on admin mutations; relies on `SameSite=Strict` + synchronizer token (acceptable stack) | `admin_auth.py:101-130` | Optional U7 defence-in-depth |
| SEC-4 | Same secret doubles as chat `X-API-Key` and IP HMAC signing key (rotation coupling) | `middleware.js:38,57,67`; `ai_service/.env.example` | Document; ops decision |
| SEC-5 | `X-Frame-Options: SAMEORIGIN` without `frame-ancestors` (same-origin framing of `/admin` possible) | `vercel.json:59-61` | Optional with SEC-1 |
| SEC-6 | Admin JS under `/assets` receives immutable caching (HTML is `no-store`; hashed filenames make this acceptable) | `vercel.json:127-135` | Document |

### 3.5 Explicitly verified working — do not regress

CI green (last 4 `main` runs); build fail-closed; SEO complete (canonical, OG,
Twitter, JSON-LD Person+WebSite+SoftwareApplication+BreadcrumbList on project
pages; 7-URL sitemap validated against `dist/`); admin isolation + bundle
assertion (executed clean this session); Argon2id/sessions/CSRF/rate-limits;
contact store-before-send with Resend failure → `failed` status, no message
loss; publish flow honest `ok/partial/failed` verdicts + audit trail; AI chat
SSE with keepalive, bounded cold-start wait, source attribution, `/ready` gate;
seed snapshot deterministic and CI-enforced; XSS surface clean.

---

## 4. Facts, assumptions and unresolved questions

### 4.1 Verified facts
Everything in §2 and §3 marked [V], plus all numbers in
`docs/upgrade-baselines/U1-before.md` (recorded with method during U1).

### 4.2 Assumptions (re-confirm in-phase)
- FE-9/FE-10 sub-details (exact ARIA gaps, FOUC occurrence on slow connections) were verified by code read; re-confirm in a real browser during U2/U3.
- Lighthouse baseline accepted as recorded (method documented; raw JSON gitignored by design).
- Desktop Lighthouse preset, Firefox/Safari and real-device behavior: **not measured** (documented gap in `U1-before.md` §5).

### 4.3 Unresolved decisions (owner)

| # | Decision | Needed by | Recommendation |
|---|---|---|---|
| Q1 | **Blog:** keep restyled placeholders / hide section / author real posts (would add a reading route — needs separate approval) | Before U6 | Keep restyled placeholders + show real `status`/`readTime`; no new route |
| Q2 | **`@axe-core/playwright` devDependency** for automated a11y gates (deferred in U1 §17) | **U2 approval** | Approve — U2 is accessibility work; axe gives a repeatable gate |
| Q3 | **Self-host Inter** (remove render-blocking Google Fonts request) — new dependency-free but adds font assets | U3 | Approve — measurable perf win, no runtime dep |
| Q4 | **Light-theme default:** saved preference → `prefers-color-scheme` → dark | U3 | Approve: system-aware default, dark fallback; pre-paint script prevents flash |
| Q5 | **CSP header** addition (production-config change; needs separate authorization even if proposed in U8) | U8 | Propose report-only CSP in U8; enforcement only with explicit approval |
| Q6 | Backend P2 hardening set (BE-2/BE-3/BE-4, AI-1, SEC-3) — approve as U7 sub-scope or defer entirely | U7 | Approve AI-1 + BE-3 (smallest, highest value); defer the rest |

---

## 5. Futuristic-tech design direction and theme rules

### 5.1 Visual language (supersedes/refines v1 §6 and §17 item 2)

**Principle — evolve, don't replace.** Keep the identity (dark slate surfaces,
Inter, blue→violet brand accent, pill tags, single-page IA, glass-tilt cards)
and raise craft to a precise, modern, developer-tool / AI-product register:

- **Dark mode:** deep navy (`#0F172A` family), charcoal and slate surfaces; fine 1 px borders at low opacity; restrained cyan / electric-blue / violet accents; **selective** glow (focus rings, one hero accent — not every card); optional subtle grid backdrop behind hero only.
- **Light mode (first-class, deliberately designed):** clean white, cool gray and subtle blue-tinted surfaces; same accent hues at light-mode-safe saturation; borders replace shadows as the primary separation device; glow effects suppressed or reduced to tints.
- **Avoid:** excessive neon, constant pulsing, heavy glassmorphism, noisy backgrounds, oversized gradients, gratuitous particles, decorative-everywhere animation.
- **Motion:** exists to explain state changes or guide attention (section reveals, modal enter/exit, skeleton shimmer) — never as ambient decoration; centrally gated on `prefers-reduced-motion`.

### 5.2 Theme architecture rules

1. **Semantic tokens only** — every colour, spacing, radius, elevation, duration and type-size is a CSS custom property in `src/styles/variables.css`, with `[data-theme="light"]` overrides living **only** in that file. Component stylesheets consume tokens; hardcoded hex/rgb in component CSS is a defect (D4 retained).
2. Existing token **names** kept; new tokens added additively (`--space-1..8`, `--elev-1..3`, `--dur-fast/base/slow`, `--fs-*`, `--accent-cyan` etc.).
3. Preference mechanism: `localStorage.theme` → `prefers-color-scheme` → `dark`; a tiny inline pre-paint script in `index.html` sets `data-theme` before first paint (no flash); `ThemeContext` reads the same source of truth and memoizes its value.
4. No component duplication per theme — one component tree, token-driven.
5. Both themes verified at 390 / 768 / 1024 / 1440 widths in U3 (tokens + pre-paint), per-section in U4–U6, and in full in U8.
6. Contrast: WCAG AA for all text, icons, inputs, borders-on-text, tags and disabled states — measured with axe + manual spot checks in both themes.

### 5.3 Typography, spacing, elevation, motion

| Family | Rule |
|---|---|
| Type scale | Explicit `--fs-*` steps (eyebrow / body / lead / section / display); `.hero-title` drops from 76.8 px to a responsive clamp; body line-height 1.6; max content width ~1120 px, prose ~65ch |
| Spacing | `--space-1..8` (4→64 px) replaces ad-hoc rem values in touched files |
| Elevation | `--elev-1..3` consolidates the measured 9 shadows; project cards gain `--elev-1` |
| Radius | Existing `--radius-*` kept; cards standardized on `--radius-lg` |
| Motion | `--dur-fast/base/slow` + one `Reveal` wrapper (or `MotionConfig reducedMotion="user"`) centralizing Framer Motion + reduced-motion |

### 5.4 Reusable components to standardize (audit targets)

`Button` (size prop, focus ring, hit area), `SectionTitle`, `Loader` → real
`Skeleton` primitive, new `Reveal`, `ProjectCard` (elevation + full focus
trap), `ThemeToggle` (`aria-pressed`, ≥44 px), `Navbar`/`Footer` (shared link
array incl. `#github`), form input/validation/feedback states, AI chat status
indicators. Reuse existing primitives; **no new runtime dependency**.

---

## 6. Complete full-stack scope and preserved contracts

### 6.1 Preserved contracts (default — change requires separate approval)

- All API endpoints, request/response schemas and error envelopes.
- Database schema (9 tables), migrations, seed/snapshot pipeline.
- CMS content models, publish flow (deploy hook + AI re-ingest), `status`/`indexable` semantics (ADR-016/017).
- Auth: Argon2id, sessions, CSRF, rate limits, cookie flags, bootstrap flow.
- Contact: validation, honeypot, store-before-send, Resend delivery contract.
- AI: provider order, embeddings (768-dim), retrieval params, SSE protocol, source attribution, `PRIMARY_PROVIDER` rollback lever.
- GitHub proxy caching/error mapping; build-time content fetch (`/api/content` not public).
- SEO: 6 HTML docs, canonical/OG/JSON-LD per URL, 4 discovery files, prerender parity checks.
- Deployment: Vercel rewrites/headers/caching, edge middleware contract, `render.yaml`, env-var names, admin/public bundle isolation.
- `src/data/**` frozen.

### 6.2 In-scope surfaces by phase (summary; details in §7)

| Area | Phases |
|---|---|
| Public: all 8 sections + project pages + chat widget + footer | U2–U7 |
| Theme/token architecture, both themes | U3 (foundation), U4–U6 (per-section), U8 (full pass) |
| CMS wiring of existing `about` payload (no schema change) | U2 (wiring), U4 (visual) |
| Admin | Audit only (verified healthy); **restyle deferred**; reliability fixes only if evidence-backed, in U7, separately approved |
| Backend / AI service | Audit complete; only Q6-approved items in U7 |
| Security | No change by default; CSP only via Q5; any header change is production-config and needs authorization |

---

## 7. Phase plan U2–U8 (refined against the real audit)

Each phase: **one independently revertible commit**; scope → files → acceptance
→ tests → browser checks → risk → rollback → **stop for approval**.

### U2 — Correctness and accessibility (P0, mostly non-visual)
- **Problem:** FE-1…FE-8 verified defects; reduced-motion ignored; undefined renders; CMS `about` payload orphaned.
- **Files:** `src/services/githubService.js`, `src/components/sections/{GithubStats,Blog,Certifications,Hero,About}.jsx`, `src/components/common/{Loader,ScrollToTop,SocialLinks}.jsx`, `src/lib/publicContent.js` (about adapter), new `Reveal`/`Skeleton` primitives, matching unit tests, possibly `src/App.jsx` (drop ScrollToTop or replace with working version).
- **Behavior before → after:** cold GitHub shows a complete fallback profile (no broken image/`@undefined`); reduced-motion honoured by every animation; Suspense fallback is a real skeleton; no `undefined` in DOM; CMS about edits render; ScrollToTop either works or is removed; Hero has no off-token colour; SocialLinks prop matches.
- **Acceptance:** all FE-1…FE-8 closed; axe clean on `/` (needs Q2); no console errors; `npm test` + lint green; new regression tests per fix.
- **Tests:** unit tests for fallback data, adapter, Loader render, Blog/Certifications fields; Playwright a11y snapshot if Q2 approved.
- **Risk:** low — frontend-only, no contracts. **Rollback:** `git revert` the phase commit.
- **Explicitly out:** visual redesign, token work, Navbar ARIA (U4), modal focus trap (U5).

### U3 — Theme architecture and design foundation
- **Problem:** FE-10, FE-14 (token half), FE-15, FE-16; light mode never designed; no pre-paint; 9 shadows; no motion/type/spacing token system.
- **Files:** `index.html` (pre-paint script), `src/context/ThemeContext.jsx`, `src/styles/variables.css` (token families + light overrides), `src/styles/{global,button}.css` (elevation tokens, remove blanket width rule scope), touched component tokens only — **no per-section restyle yet**.
- **Behavior before → after:** no theme flash; system preference respected on first visit (per Q4); both themes deliberately specified with AA contrast; shadows collapse to `--elev-1..3`; motion/type/spacing tokens exist and are documented.
- **Acceptance:** token audit — zero hardcoded colours outside `variables.css` in touched rules; both themes pass axe contrast at 390/768/1440; reduced-motion still honoured; preference persists across reload.
- **Tests:** ThemeContext unit tests (pref ladder, persistence, memoization); visual spot checks recorded.
- **Risk:** medium — global stylesheet surface. **Rollback:** revert commit; tokens are additive so partial revert is safe.
- **Gates:** Q3 (self-host Inter) and Q4 decisions at approval time.

### U4 — Navigation, hero, about and skills
- **Files:** `src/components/layout/{Navbar,Footer}.jsx`, `src/components/sections/{Hero,About,Skills}.jsx`, `src/styles/{navbar,hero,about,skills,footer}.css`.
- **Scope:** FE-9 (aria-expanded/controls, `aria-current`, `#github` entry, ≥44 px targets); hero hierarchy + gradient accent + portrait treatment (responsive type via U3 tokens); About visual pass on top of U2's pipeline wiring (journey/timeline visual); skills chip consistency; futuristic-tech language (fine borders, restrained glow, optional hero grid).
- **Preserve:** routes, section ids, content contracts, single-page IA.
- **Acceptance:** keyboard pass (menu open/close/trap, focus visibility); 390/768/1024/1440 no overflow; both themes; axe clean; no new console noise.
- **Rollback:** revert commit.

### U5 — Projects and project-detail pages
- **Files:** `src/components/common/ProjectCard.jsx`, `src/components/sections/Projects.jsx`, `src/components/pages/ProjectPage.jsx`, `src/styles/{projects,project-page}.css`.
- **Scope:** FE-12 (full modal focus trap — model on `ChatAssistant.jsx:269-297`); FE-16 (replace hardcoded dark overlays with theme tokens); unified elevation, image treatment/ratio, tag lists, featured emphasis; project-page header band + sticky section nav.
- **Preserve:** canonical URLs, slugs, prerender output, structured data, `verify-parity` + migration-validation contracts.
- **Acceptance:** `npm run build` + `test:migration-validation` green; 5 pages unchanged in URL/SEO parity; both themes; image perf (lazy, explicit dimensions — no CLS regression vs baseline 0.003/0).
- **Rollback:** revert commit; if parity fails, restore prior styles only.

### U6 — GitHub, certifications, blog and contact
- **Files:** `src/components/sections/{GithubStats,Certifications,Blog,Contact}.jsx`, `src/styles/{github,certifications,blogs,contacts}.css`, possibly `publicContent.js`.
- **Scope:** GitHub skeleton matching final layout + status chip (fallback already fixed in U2); certifications icon/description treatment; Blog presentation per Q1 decision (fix date/status display); Contact wired to CMS `profile.social` (FE-11) + validation feedback polish **without changing the delivery contract**; FE-13 remaining tap targets.
- **Acceptance:** cold-start GitHub renders complete profile; contact e2e still passes; blog shows no `undefined`; both themes; axe clean.
- **Rollback:** revert commit.
- **Gate:** Q1 decision required at phase approval.

### U7 — AI assistant, CMS/admin reliability and integration review
- **Files (only Q6-approved items):** candidate set — `ai_service/app.py` (AI-1 CORS tighten), `backend/app/routes/contact.py` + `services/auth.py` (BE-3 log redaction); chat UI polish in `src/components/common/ChatAssistant.jsx` + `src/styles/chat.css` (tokens, aria-live streaming behavior, larger targets) is in-scope **without** backend changes.
- **Preserve:** SSE protocol, provider order, embeddings, retrieval, admin restyle deferred, all auth boundaries.
- **Acceptance:** `npm run test:api` + `test:ai_service` + `e2e/chat.spec.js` green (CI/local where Postgres available); chat e2e streaming intact; any backend diff individually justified.
- **Rollback:** revert commit; backend items are independent and can be split into sub-commits.
- **Gate:** Q6 decision required at phase approval. If backend work grows beyond the approved set, stop and re-plan.

### U8 — Full regression and release readiness
- **Scope:** full suite (lint, unit, migration-validation, api, ai_service, e2e) where runnable; axe both themes × 3 viewports; Lighthouse × 3 runs per page with the U1 methodology, compared against `docs/upgrade-baselines/U1-before.md`; console/network/overflow sweep on `/` + 5 project pages; SEO parity (sitemap/robots/llms/canonical/JSON-LD); security-sensitive diff review; documentation + rollback instructions finalized; release-readiness report.
- **Acceptance (proposed targets — to be confirmed against measured U1 baseline):** no P0/P1 open; a11y ≥ U1 baseline (96 home / 95 project) and ideally ≥ 98; SEO = 100 both pages; perf ≥ U1 median (46 home / 82 project) — **do not claim improvement without before/after numbers**; reduced-motion verified in real browser; both themes verified.
- **Explicitly excluded:** deploy, push, merge, production-config changes (incl. CSP enforcement per Q5) — separate authorization.

---

## 8. Testing, measurement and comparison methodology

**Per phase:** `npm run lint` · `npm test` · `npm run test:migration-validation` (after rebuild) · `npm run test:ai_service` (chat/AI touched) · `npm run test:api` (backend touched; needs Postgres — CI or local stack) · `npx playwright test` (affected specs) · axe per page (Q2) · manual keyboard + reduced-motion pass (`docs/LOCAL_MANUAL_TEST_CHECKLIST.md`) · real-browser sweep at 390/768/1024/1440 in **both themes**.

**Baseline comparison (U8):** Lighthouse 12.x, Chrome for Testing, headless, mobile preset, simulated throttling, **3 runs per page, median** — identical method to `U1-before.md` §1.1. Desktop preset optional (documented gap). Any methodology change is recorded before comparing.

**Environment note (this session):** Node 24.19.0 / npm 11.17.0; Python 3.12.3 venvs present; **no local Postgres** → backend pytest + full build/e2e not run here (covered by CI; last 4 `main` runs green). Lighthouse not re-run this session (baseline is the U1 record).

---

## 9. Risks, exclusions and rollback

| Risk | Mitigation |
|---|---|
| SEO/prerender regression | parity checks + migration-validation stay in every build; U5/U8 verify discovery files against `dist/` |
| Theme change breaks a section visually | tokens additive; per-section phases (U4–U6) each carry a both-theme check |
| Light mode ships half-designed | U3 is a dedicated phase with acceptance criteria; U4–U6 each re-verify; U8 full pass |
| Unrevertible mixed diff | one phase = one commit; backend items in U7 split further |
| A11y regression | axe gate (Q2) + manual keyboard pass; reduced-motion centralized in U2's `Reveal`/`MotionConfig` |
| Content-pipeline break on About/Blog moves | wire data first (U2), test, then restyle (U4/U6) |
| Free-tier cold starts skew perf measurement | compare medians of 3; record cold/warm state |

**Out of scope without separate approval (unchanged from brief §11):** framework/SSR change; new public routes or blog architecture; schema/migrations; API contract changes; AI model/retrieval/embedding changes; paid services; new dependencies (incl. Q2/Q3 pending); self-hosted fonts (pending Q3); admin redesign; production config/push/merge/deploy; deleting user content; `src/data/**` changes.

**Rollback:** every phase is a revert; the branch is never pushed without authorization; `main` stays untouched until an explicitly approved merge; content/DB/SEO contracts are untouched by U2–U6 so rollback never involves data.

---

## 10. Deliverables and current documentation diff

Finalized by this audit (documentation only — no application code touched):

| File | Change |
|---|---|
| `docs/PORTFOLIO_UPGRADE.md` | **Rewritten to v2.0** — this document: re-audit results, new BE/AI/SEC findings, U2–U8 phase structure, theme/light-mode rules, decisions Q1–Q6 |
| `docs/DESIGN_SYSTEM.md` | §8 amended: light mode first-class + futuristic-tech direction pointer (2-line edit) |
| Everything else | **Unchanged** — ADR-018, PRODUCT_REQUIREMENTS, TESTING, MIGRATION, tripwire, CI, `U1-before.md` already consistent with this brief |

---

## 11. The exact decision required from you now

**Approve or reject Phase U2** (correctness + accessibility, FE-1…FE-8) as
specified in §7, including:

1. The U2 file/behavior/acceptance list above.
2. **Q2:** adding `@axe-core/playwright` as a devDependency for the a11y gate (deferred in U1; recommended for U2).
3. Confirmation that U2 remains frontend-only (no backend, no `src/data`, no dependencies besides Q2).

U3+ remain blocked until U2 is implemented, verified, committed and separately
approved. No push, merge, deploy or production change is requested or implied.

---

# END OF PORTFOLIO UPGRADE BLUEPRINT
