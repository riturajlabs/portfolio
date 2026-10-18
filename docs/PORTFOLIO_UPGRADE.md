# Portfolio Upgrade — Audit & Blueprint

**Document Status:** ACTIVE — direction approved 2026-10-17; **Phase U1 in progress** (documentation + guard only). Phases U2+ not started.
**Document Type:** Audit report + upgrade blueprint
**Version:** 1.0 — first pass, verified against the codebase and the live deployment
**Last Verified Against Code:** commit `eec84e1` (`main`)
**Live deployment inspected:** `https://riturajlabs.vercel.app` (2026-10-17)

---

## 0. Read this first — change control

This document proposes a change that the existing documentation **explicitly
forbids**. It therefore must go through the repository's own change-control
process before any code is written.

| Existing rule | Where | Conflict |
|---|---|---|
| "Redesigning the public UI" is a **non-goal** | `PRODUCT_REQUIREMENTS.md` §5 | The brief asks for a premium/visual upgrade |
| `src/styles/**` must receive **zero** changes (invariant **D1**) | `DESIGN_SYSTEM.md` §2 | Any visual upgrade edits `src/styles/**` |
| `git diff --stat src/styles` must be **empty** (**N4**) | `PRODUCT_REQUIREMENTS.md` §3.2 | Same |
| `src/styles/**` and `src/data/**` are frozen by a **tripwire test** | `tests/tripwires.test.mjs`, `.github/workflows/ci.yml` | The tripwire will fail on any CSS change |
| Any design change needs a written requirement, before/after visuals, Lighthouse comparison, and an explicit decision that D1–D7 no longer apply | `DESIGN_SYSTEM.md` §7 | This document is that written requirement; the decision is requested in §17 |

**Proposed treatment (requires approval).** A design/UX upgrade is a **separate
track** that intentionally supersedes invariant D1/N4 for the public design.
The clean way to do this in this repository is:

1. Record an ADR (ADR-018 — "Public design upgrade track") in
   `ARCHITECTURE.md`, superseding the design non-goal in
   `PRODUCT_REQUIREMENTS.md` §5.
2. Update `tests/tripwires.test.mjs` and the CI guard so they freeze
   `src/data/**` (still a migration artifact) but **not** `src/styles/**`.
3. Capture a **new visual + Lighthouse baseline** with the redesigned UI.
4. Do all of it on a branch, one phase per commit, each independently
   revertible.

Until that approval exists, no phase below is started.

---

## 1. Executive summary

The application is in **far better shape than a typical redesign brief assumes**.
It is a mature, tested, documented, content-managed static portfolio with a
working AI assistant, CMS, contact pipeline and SEO pipeline. Baseline checks
pass today (see §3.1). The right upgrade is therefore **surgical**, not a
rewrite: fix a handful of genuine correctness/accessibility defects, then apply
a restrained visual modernization that preserves the existing architecture,
routes, content pipeline and SEO contract.

**The three things most worth fixing** (all verified, all cheap):
1. The GitHub section degrades to a broken avatar / `@undefined` when the free
   backend is cold — which is most of the time.
2. `prefers-reduced-motion` is ignored by every Framer Motion animation.
3. Several sections read from legacy/hardcoded sources (`About`, `Blog`) or
   render `undefined` (`Blog.date`, `Certifications.description`).

The visual upgrade is real but should be **layered on top of** those fixes, on a
branch, phase by phase.

---

## 2. Current-state inventory (verified)

### 2.1 Stack (no new framework needed, none proposed)

| Layer | Technology | Evidence |
|---|---|---|
| Frontend | React 19.2 + Vite 8, React Router 7 **admin-only** | `package.json`, `src/admin/AdminApp.jsx:5` |
| Animation | Framer Motion 12 | `package.json` |
| Icons | react-icons 5 + emoji (certifications) | `DESIGN_SYSTEM.md` §1.6 |
| Backend | FastAPI + SQLAlchemy 2 + Alembic, PostgreSQL | `backend/app/**` |
| AI service | FastAPI + ChromaDB + Groq/Gemini | `ai_service/**` |
| Hosting | Vercel (static) + 2 Render services + Neon PG | `vercel.json`, `render.yaml` |
| Styling | 16 hand-written CSS files + CSS custom properties | `src/styles/**` |

### 2.2 Public surface

- One route `/` with 8 in-page sections: `home, about, skills, projects,
  github, certifications, blog, contact` (`src/pages/Home.jsx`).
- 5 prerendered indexable project pages at `/projects/<slug>/`.
- 4 generated discovery files: `sitemap.xml`, `sitemap-images.xml`,
  `robots.txt`, `llms.txt`.
- Floating AI chat widget (lazy-loaded).

### 2.3 Backend API (verified from `backend/app/routes/**`)

| Group | Endpoints |
|---|---|
| Public | `GET /health`, `GET /ready`, `GET /api/content`, `GET /api/github`, `POST /api/contact`, `GET /api/resume` |
| Admin auth | `POST /api/admin/auth/login`, `POST /api/admin/auth/logout`, `GET /api/admin/me` |
| Admin content | CRUD for `projects`, `skill-categories`, `skills`, `certifications`, `profile`; `POST /api/admin/uploads`; `GET/PATCH /api/admin/messages`; `POST /api/admin/publish` |
| Admin bootstrap | `POST /api/admin/bootstrap` (guarded) |

### 2.4 Admin surface (verified from `src/admin/AdminApp.jsx`)

`/admin/login`, `/admin` (Dashboard), `projects`, `projects/new`,
`projects/:id`, `skills`, `certifications`, `profile`, `messages`. Session-based
auth, CSRF, 401 → login redirect. Separate bundle, separate CSS
(`src/admin/admin.css`), no public stylesheet imports.

### 2.5 Content flow (verified)

```text
PostgreSQL → GET /api/content → scripts/build-content.mjs → src/generated/content.js
          → (bundler) → static dist/          [BUILD TIME ONLY]
```

There is **no runtime content fetch**: no `ContentContext`, no `contentService`,
no `useContent()` (`grep` returns none). `src/lib/publicContent.js` adapts the
committed snapshot for components. This is **doc drift** — `ARCHITECTURE.md` §4
(TARGET) describes a runtime `ContentContext` that was never built — but it is
not a defect; the implemented design (ADR-003/004) is build-time only.

### 2.6 Deployment (verified)

- `vercel.json`: explicit rewrites for `/admin*`, `/api/admin*`, `/api/resume`,
  `/api/chat*`, `/api/contact`, `/api/github`, `/health`, `/ready`; strong
  security headers; immutable caching for `/assets` and `/images`.
- `middleware.js`: edge, injects `X-API-Key` + signed client IP for
  `/api/chat/*` only.
- `render.yaml`: `portfolio-api` (FastAPI). `ai_service` deploys separately.
- **Note:** `/api/content` is deliberately **not** rewritten on Vercel (returns
  404 publicly); the build fetches the backend server-to-server. Verified live:
  `GET /api/content` → 404 (expected), `sitemap.xml`/`robots.txt`/`llms.txt` →
  HTTP 200.

---

## 3. Verified working features (do **not** break)

| Feature | Evidence |
|---|---|
| Homepage renders all 8 sections, 5 project cards, no console errors | Playwright against live site |
| Project pages render with canonical + JSON-LD | `curl` 200, `application/ld+json` present |
| SEO head tags, OG, Twitter, JSON-LD Person+WebSite | live `index.html` |
| Contact form → Resend + DB persistence | `backend/app/routes/contact.py`, e2e `contact.spec.js` |
| AI chat SSE, cold-start retry, source chips | `src/lib/chatClient.js`, `e2e/chat.spec.js` |
| CMS CRUD + publish button + resume upload | `src/admin/**`, `backend/app/routes/admin_content.py` |
| Auth: Argon2id, sessions, CSRF, rate limits | `backend/app/security/**`, `backend/tests/**` |
| Build fail-closed content + SEO generation | `scripts/build-content.mjs`, `generate-*.mjs` |
| Bundle isolation (no admin/router in public bundle) | `scripts/assert-admin-bundle.mjs` |
| CI green | latest 4 `main` runs pass (`gh run list`) |

### 3.1 Baseline checks run during discovery (read-only)

| Check | Result |
|---|---|
| `npm run lint` | **clean** |
| `npm test` | **162 passed / 14 files** |
| `npm run test:migration-validation` | **13 passed** |
| `npm run test:ai_service` | **95 passed** |
| Live home + project page, desktop 1440 + mobile 390 | 0 console errors, 0 failed requests, no horizontal overflow, all 8 sections, 5 project cards |
| No image missing `alt` | verified 0 |
| `gh` CLI | authenticated; logs accessible |

---

## 4. Browser evidence (captured)

Full-page screenshots (view outside the repo):

| File | View |
|---|---|
| `/tmp/opencode/live-home-desktop.png` | `/` @ 1440×900 |
| `/tmp/opencode/live-home-mobile.png` | `/` @ 390×844 |
| `/tmp/opencode/live-project-desktop.png` | `/projects/webchat-ai/` @ 1440 |
| `/tmp/opencode/live-project-mobile.png` | `/projects/webchat-ai/` @ 390 |

Computed-style evidence (live, desktop 1440×900, Playwright Chromium 153). **Re-measured in Phase U1** (`docs/upgrade-baselines/U1-before.md` carries the method and full numbers):

| Element | Value |
|---|---|
| Body | bg `rgb(15,23,42)`, text `rgb(248,250,252)`, `Inter, sans-serif`, root 16px |
| `.hero-title` | 76.8px / 800 weight |
| `.section-title` | 56px |
| `.section-tag` | 14.4px / 700, blue `#2563EB` on `rgba(37,99,235,.12)`, pill |
| `.project-card` | bg `rgb(30,41,59)`, radius 24px, **no shadow** |
| `.btn-primary` | blue `#2563EB`, radius 12px, glow shadow |
| Distinct box-shadow values | **9** |
| Interactive targets < 44×44 px | **21** desktop (1440) / **49** mobile (390); 71 / 64 total |
| `prefers-reduced-motion: reduce` | matched, yet **42** elements still carry animated inline transforms/opacity (identical to normal motion → preference ignored) |
| Resources / transfer | 24 requests, ~492 KB (Stage 1 capture; not re-measured in U1) |

**Read:** the design is coherent (slate dark palette, Inter, blue brand,
pill tags, 24px cards) but has accumulated inconsistencies: no single elevation
system (9 distinct shadows), dozens of sub-44px tap targets, and motion that
ignores the user's reduced-motion preference.

---

## 5. Findings by priority

Legend: **[V]** = verified directly in code/live; **[R]** = reported by code
read, worth re-confirming during the phase; **[A]** = assumption.

### P0 — Correctness & accessibility (do first, mostly non-visual)

| # | Finding | Evidence | Impact |
|---|---|---|---|
| P0-1 | GitHub section falls back to a **broken avatar and `@undefined`** when the backend is cold; its error state is unreachable because `getGithubData()` never throws | `src/services/githubService.js:19-24,40-57` `[V]` | Most-visited section looks broken on free tier |
| P0-2 | `prefers-reduced-motion` ignored by **all** Framer Motion animations (only CSS honours it) | live probe: 42 animated elements with reduce on (same as normal motion); `global.css:202` only `[V]` | Accessibility (vestibular); relates to WCAG 2.3.3 (Animation from Interactions) |
| P0-3 | `Loader.jsx` uses classes that exist nowhere (`placeholder-glow`, `placeholder`, `mb-3`, `py-5`) | grep: 0 definitions; `bootstrap-grid-utilities.css` only has `.col-*` `[V]` | Empty Suspense fallback → layout flash for slow/lazy sections |
| P0-4 | `Blog.jsx` reads legacy `src/data/blogs` and renders `blog.date`, which does not exist; `status` is never shown | `Blog.jsx:8,110`; `data/blogs.js` has `status` `[V]` | Blank meta line; bypasses the content pipeline |
| P0-5 | `Certifications.jsx` renders `certificate.description`, always `undefined` (adapter intentionally omits it) | `Certifications.jsx:106`; `publicContent.js:128-139` `[V]` | Empty paragraph |
| P0-6 | `About.jsx` is fully hardcoded and ignores the content pipeline | `About.jsx:14-39,48-88` `[V]` | CMS edits to about/education do not appear |
| P0-7 | `ScrollToTop.jsx` is a no-op mounted as a feature | `ScrollToTop.jsx:6-14`; `App.jsx:29` `[V]` | Dead code; misleads maintainers |
| P0-8 | Hero renders a literal `color="red"` marker and a stray `c` prop; `SocialLinks` gets `showLabels` but expects `showLabel` | `Hero.jsx:76,129`; `SocialLinks.jsx:6` `[V]` | Off-token colour; ignored prop |

### P1 — UX, visual consistency, mobile

| # | Finding | Evidence |
|---|---|---|
| P1-1 | 21 interactive targets below 44×44 px on desktop (49 on 390-px mobile; nav links ~45×20, theme toggle 42×42) | live probe `[V]`; method in `docs/upgrade-baselines/U1-before.md` |
| P1-2 | 9 distinct box-shadows; no single elevation scale; project cards have none | live probe `[V]` |
| P1-3 | Global `user-select: none !important` on all links/buttons | `index.css:45-46`, `global.css:33` `[V]` |
| P1-4 | `#github` has no nav entry, so scroll-spy can set an active id with no highlighted link | `Navbar.jsx:10-19`; live sections `[V]` |
| P1-5 | Navbar mobile menu button lacks `aria-expanded`/`aria-controls`; no `aria-current` on active link | `Navbar.jsx:93-99` `[R]` |
| P1-6 | Blog is 4 disabled "Coming Soon" placeholders with no reading route | `data/blogs.js`; `Blog.jsx:148-161` `[V]` |
| P1-7 | Theme has no pre-paint script and no `prefers-color-scheme` fallback → possible flash; provider value not memoized | `index.html`; `ThemeContext.jsx` `[R]` |
| P1-8 | Contact + Footer hardcode email/LinkedIn/GitHub instead of using the content profile | `Contact.jsx:158-181`; `Footer.jsx` `[R]` |
| P1-9 | Project modal lacks a full focus trap (Tab can leave the dialog) | `ProjectCard.jsx:169-284` `[R]` |
| P1-10 | Global `.btn { width:100% }` under 576px applies to every button incl. modal/ghost | `button.css` `[R]` |

### P2 — Polish, performance, docs, SEO

| # | Finding | Evidence |
|---|---|---|
| P2-1 | Documentation drift: docs pinned to old commits (`a6895e5`), `TESTING.md` says "uncommitted working tree", PRODUCT_REQUIREMENTS still lists "no CI, no tests" though both exist | doc headers `[V]` |
| P2-2 | Code-comment typo `icons.jsxx` | `publicContent.js:22` `[V]` |
| P2-3 | Fonts loaded from Google Fonts (render-blocking request) | `global.css:4` `[R]` |
| P2-4 | Hero stats use `stats.map` inside Framer variants; fine, but no reduced-motion path | `Hero.jsx:87-104` `[R]` |
| P2-5 | `.cache/`, `.vitest/`, `dist/` artifact handling; `.vitest/` not gitignored | `.gitignore` `[V]` |
| P2-6 | Emoji vs react-icons inconsistency on certifications (documented as intentional) | `DESIGN_SYSTEM.md` §1.6 `[V]` |

### Verified working (explicitly *not* regressions)

CI green; build fail-closed; SEO complete; admin isolation enforced; auth/CSRF
present; contact persists; AI assistant resilient after `eec84e1`.

---

## 6. Proposed visual direction

### 6.1 Principle

**Evolve, don't replace.** Keep the identity (dark slate, Inter, blue→violet
brand gradient, pill tags, glassmorphism) and the single-page IA. The upgrade
raises *craft*: a real elevation scale, consistent spacing rhythm, confident
typography, accessible motion, and consistent image treatment. No new framework,
no Tailwind, no CSS-in-JS (the docs already reject those, correctly).

### 6.2 Design tokens (additive, in `variables.css`)

| Token family | Proposal |
|---|---|
| Spacing | `--space-1…8` (4→64px) — replaces ad-hoc rem values |
| Elevation | `--elev-1..3` mapped from the current 9 shadows |
| Radius | keep `--radius-*`; standardize card = `--radius-lg` |
| Motion | `--dur-fast/base/slow`, plus a global reduced-motion strategy |
| Type scale | explicit `--fs-*` steps for eyebrow/section/display |
| Colour | unchanged tokens; remove the two off-token literals |

New tokens only; existing token **names** kept so components keep working.

---

## 7. Page-by-page visual changes

| Surface | Proposed change | Keeps |
|---|---|---|
| Navbar | Add `#github`; active-link `aria-current`; larger hit areas; subtle blur-on-scroll | markup/classes |
| Hero | Tighten type scale, add gradient accent to name, improve portrait treatment/ring, consistent stat cards | content, layout |
| About | Move copy/cards to content pipeline; add timeline visual for "Journey" | structure |
| Skills | Consistent chip sizing, category headers with icon, hover depth | data, icons |
| Projects | Unified elevation, image treatment, featured emphasis, card hover parity with modal | ProjectCard API |
| Project pages | Richer header band, sticky section nav, consistent typography | prerender/SEO contract |
| GitHub | Fix fallback (avatar/name); skeleton that matches final layout; activity/status chip | service contract |
| Certifications | Real description line or remove empty `<p>`; consistent icon treatment | layout |
| Blog | Either real posts (deferred) or a cleaner "writing" block; fix `date`/`status` | route deferred |
| Contact | Source links from profile; consistent inputs; success/error polish | form contract |
| Footer | Restructure into `<nav>`; source links from profile; keep quote | links |
| Chat | Tokenize colours, tidy header/FAB, reduced-motion, SR-safe streaming | SSE client, contract |
| Admin | **Optional** visual alignment only (separate surface; low priority) | isolation rules |

---

## 8. Information architecture & page hierarchy

**Recommendation: keep the single-page structure.** It is the product's stated
constraint (`PRODUCT_REQUIREMENTS.md` §4.1 — recruiter acts in under a minute)
and it is what keeps the site CDN-static.

```
/                         single-page portfolio
├─ #home        Hero
├── #about      About / Journey
├── #skills     Skills
├── #projects   Projects → /projects/<slug>/ (5 prerendered)
├── #github     GitHub stats
├── #certifications
├── #blog       (placeholders — see decision Q3)
└── contact     Contact form
/projects/<slug>/           prerendered, indexed, JSON-LD
/admin/*                    separate SPA (unchanged)
```

No new public route is proposed. Adding a public `/blog` reading route would
contradict `PRODUCT_REQUIREMENTS.md` §5 and is **not** part of this plan unless
the owner asks (§17 Q3).

---

## 9. Design-system & component plan

**New/changed components**

| Item | Change | Risk |
|---|---|---|
| `Button` | optional `size`, ensure consistent focus/hit area | low |
| `SectionTitle` | adopt refined token sizes | low |
| `Loader` | replace undefined classes with a real skeleton; `aria-busy` | low |
| New `Skeleton` primitive | reusable, matches section layouts | low |
| New `Reveal` wrapper | centralizes Framer Motion + `useReducedMotion` | medium |
| `ProjectCard` | unify elevation; keep prop API + modal behaviour | medium |
| `ThemeToggle` | `aria-pressed`, larger target | low |
| `Navbar`/`Footer` | github link, aria, shared link array | low |

**Rule kept:** the public bundle must remain router-free and secret-free
(`assert-admin-bundle.mjs`, `assert:admin-bundle`).

---

## 10. Dependencies, risks, effort, acceptance

### Dependencies / approvals needed

| Item | Why | Approval |
|---|---|---|
| Retire D1/N4 + update tripwire | blocks any CSS work | **required** |
| `@axe-core/playwright` (devDependency) | automated a11y gate | requested |
| Self-host Inter (optional, perf) | removes render-blocking Google Fonts | requested |
| Any real blog content | P1-6 | owner input |

No new runtime framework, database, hosting provider, or production dependency
is proposed.

### Risks

| Risk | Mitigation |
|---|---|
| SEO regression (prerender/discovery) | migration-validation + baseline parity stay in the pipeline; re-baseline once, intentionally |
| Bundle growth | keep the existing `< 15 KB` budget assertion; no new runtime deps |
| Unrevertible mixed diff | one phase per commit, styles isolated, branch per track |
| A11y regressions | axe gate + manual keyboard pass; reduced-motion enforced centrally |
| Content pipeline break (About/Blog moves) | move data first, test, then restyle |

### Effort (rough, single developer)

| Phase | Estimate |
|---|---|
| U1 foundation | 0.5–1 day |
| U2 correctness + a11y | 1–2 days |
| U3 nav/hero/about | 1–2 days |
| U4 skills/projects/pages | 2–3 days |
| U5 github/certs/blog/contact | 1–2 days |
| U6 chat/footer polish | 1 day |
| U7 verification/release | 0.5–1 day |

### Acceptance criteria (track-level)

1. No public URL removed/renamed; exactly 6 HTML docs still emitted.
2. Baseline checks + axe pass; no P0 open.
3. Lighthouse SEO = 100, a11y ≥ 95, perf not below the recorded baseline.
4. Reduced-motion honoured (verified in a real browser).
5. Tripwire intentionally updated for `src/styles/**` only; `src/data/**` still frozen.
6. Homepage + 5 project pages verified on the production URL.

---

## 11. Phased implementation plan

Each phase: scope → acceptance criteria → tests → browser check → doc update.
One commit per phase; no phase merged before the previous is verified.

### Phase U1 — Change control & foundation
- **Scope:** ADR-018 in `ARCHITECTURE.md`; supersede the design non-goal in
  `PRODUCT_REQUIREMENTS.md`; update `tests/tripwires.test.mjs` + CI guard to
  unfreeze `src/styles/**` (keep `src/data/**` frozen); write `DESIGN_SYSTEM.md`
  v3 target; capture new screenshot + Lighthouse baselines.
- **Acceptance:** approvals recorded; tripwire change is deliberate and tested;
  baselines measured and stored under `docs/upgrade-baselines/` (raw reports
  gitignored).
- **Tests:** `npm test`, `npm run test:migration-validation`.

### Phase U2 — Correctness & accessibility (P0, mostly non-visual)
- **Scope:** P0-1…P0-8. Central reduced-motion via a `Reveal` wrapper /
  `MotionConfig reducedMotion="user"`; real `Loader`/skeleton; fix `Blog`,
  `Certifications`, `Hero` literals, `ScrollToTop`; move `About` copy to the
  content pipeline.
- **Acceptance:** reduced-motion verified; no broken avatar in fallback; no
  `undefined` in DOM; axe clean.
- **Tests:** new unit tests for each fix; component tests; Playwright a11y.
- **Independent of visuals** → safe to do first.

### Phase U3 — Navigation, Hero, About
- **Scope:** token foundation; Navbar (github link, aria, hit areas); Hero
  premium pass; About timeline.
- **Acceptance:** responsive 375/390/768/1024/1440; no overflow; keyboard pass.

### Phase U4 — Skills, Projects, Project pages
- **Scope:** skills chips; project card elevation/hover; modal a11y (focus
  trap); project-page sticky nav.
- **Acceptance:** prerender + discovery unchanged in behaviour; parity checks pass.

### Phase U5 — GitHub, Certifications, Blog, Contact
- **Scope:** GitHub fallback + skeleton; certifications; Blog presentation
  (per §17 Q3); contact data wiring.
- **Acceptance:** fallback renders complete profile at cold start.

### Phase U6 — AI assistant & Footer polish
- **Scope:** chat tokens, larger targets, reduced-motion, aria; footer restructure.
- **Acceptance:** chat E2E still passes; no screen-reader streaming chatter regressions.

### Phase U7 — Verification & release readiness
- **Scope:** full suite + axe + Lighthouse; docs update; final diff review.
- **Acceptance:** §10 criteria met; production verified; rollback documented.

---

## 12. Testing & production verification plan

**Per phase**
1. `npm run lint`
2. `npm test`
3. `npm run test:migration-validation` (after `dist/` rebuild)
4. `npm run test:ai_service` (if chat touched)
5. `npm run test:api` (if backend touched)
6. `npx playwright test` (public + chat + contact; admin if touched)
7. axe scan per page (new devDependency)
8. Manual keyboard + reduced-motion pass (`docs/LOCAL_MANUAL_TEST_CHECKLIST.md`)
9. Real-browser check at 375/390/768/1024/1440 + console/network clean

**Final (Stage 5)**
- Confirm production `https://riturajlabs.vercel.app`: `/`, 5 project pages,
  sitemap/robots/llms, contact submit, admin login + edit + rebuild, AI chat.
- Report commit SHA, deployment status, test evidence, remaining risks,
  rollback steps.

---

## 13. Rollback strategy

| Level | Action |
|---|---|
| Phase | `git revert <phase-commit>` on a branch; redeploy |
| Track | abandon the branch; `main` untouched (all work on branch) |
| Content | `src/data/**` stays frozen; DB/content pipeline untouched by UI work |
| SEO | if a check regresses, restore the prior baseline oracle and rebuild |
| Tripwire | revert the U1 tripwire change restores the original freeze |

No migration, no schema change, no new infrastructure → rollback is a revert.

---

## 14. Files / areas likely to change

- `src/styles/**` (tokens, per-section CSS) — **the guarded area**
- `src/components/**`, `src/lib/publicContent.js`, `src/services/githubService.js`
- `src/context/ThemeContext.jsx` (+ pre-paint script in `index.html`)
- `src/data/**` — **read-only** unless About/Blog migration is approved (would
  instead come from the content API)
- `tests/tripwires.test.mjs`, `.github/workflows/ci.yml` (U1 only)
- `docs/**` (ADR-018, PRODUCT_REQUIREMENTS, DESIGN_SYSTEM, TESTING, this doc)
- **Not touched:** backend schema/API, `ai_service` contracts, `vercel.json`
  rewrites, auth, `src/admin/**` (except optional U6 consistency)

---

## 15. Facts vs assumptions

**Verified facts:** all of §2, §3 evidence, P0-1…P0-8, P1-1…P1-4, P1-6, P2-1,
P2-2, P2-5, and every baseline number.

**Assumptions (to confirm in-phase):** P1-5, P1-7, P1-8, P1-9, P1-10, P2-3
(derived from code reading; not all exercised in a browser this session).
Lighthouse numeric baselines were **not** measured this session (no Lighthouse
run); they will be captured in Phase U1 before any visual change.

---

## 16. What this plan deliberately does **not** do

- No framework/library/runtime change; no Tailwind, no SSR.
- No new public route; no public router.
- No backend/schema/API change.
- No redesign of the admin app (optional consistency pass only).
- No analytics beyond the existing Vercel Speed Insights.
- No rewrite of the chat, contact, GitHub or content pipelines' contracts.

---

## 17. Decisions requiring owner approval

**Approved 2026-10-17** (items 1, 2, 6, 7). Items 3, 4, 5 remain **deferred** —
not part of Phase U1.

1. ✅ **Approved** — Retire the "no public UI redesign" non-goal and invariants
   D1–D3/N4, and update the `src/styles/**` tripwire + CI guard. Recorded in
   **ADR-018** (`ARCHITECTURE.md`). `src/data/**` stays frozen.
2. ✅ **Approved** — Visual direction: **evolve the current dark/brand identity**;
   keep Inter, blue/violet accent, pill tags and the single-page layout.
3. ⏳ **Deferred — blog:** keep the placeholders (restyled) / hide the section /
   author real posts (adds a reading route). Decide before Phase U5.
4. ⏸️ **Deferred:** `@axe-core/playwright` devDependency and self-hosting Inter
   are **not** added in U1.
5. ⏸️ **Deferred:** admin restyle — admin is untouched for now.
6. ✅ **Approved:** work on `portfolio-upgrade`, one independently revertible
   commit per phase; no push/merge/deploy without owner approval.
7. ✅ **Approved:** P0 correctness/accessibility first, then visual phases.

---

## 18. Immediate next step

Phase U1 (change control + foundation) is **in progress on `portfolio-upgrade`**.
U1 is documentation + guard only (ADR-018, invariant/requirement updates,
tripwire/CI narrowing to `src/data`, baseline capture). **Phase U2 and later do
not begin until the U1 diff and test results are reviewed and approved.**

---

# END OF PORTFOLIO UPGRADE BLUEPRINT
