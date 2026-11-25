# U9.4 — Final Integrated Review, Validation & Git Checkpoint

**Status:** REVIEW COMPLETE — awaiting explicit commit approval  
**Repository:** `/home/riturajlabs/Projects/portfolio`  
**Branch:** `feature/portfolio-u8-work`  
**Baseline commit:** `9034d23` (`fix: stabilize chat lifecycle and lazy markdown loading`)  
**HEAD at review time:** `9034d23` (all U9 work is uncommitted in the working tree)  
**Date:** 2026-11-09

---

## 1. Integrated Change Summary

U9 is a three-phase visual/typography pass on top of the U8 baseline, plus a
build-parity comparator extension needed to keep the migration gate honest.

- **U9.1 — Typography foundation.** Inter is now loaded from the document head
  (`index.html`, `admin.html`, and prerendered project documents) instead of a
  render-blocking CSS `@import`. Added weight/line-height/tracking tokens,
  fluid lead/subtitle scales, and moved primary body copy from `--muted` to
  `--text-secondary` for readability.
- **U9.2 — Component consistency.** Added `--radius-card` (20px) and
  `--radius-btn` (12px), normalized card/button/icon geometry, replaced raw
  brand `rgba()`/`white`/`#fff` values with semantic tokens, centralized
  section-header rules in `src/styles/section-header.css`, switched
  `GithubStats` to the shared `SectionTitle`, and replaced position-based
  (`nth-child`) skill-icon colors with technology-keyed `data-skill` selectors.
- **U9.3 — Responsive design & CSS cleanup.** Removed the reduced-root font
  overrides (root stays at the 16px browser default), deleted the duplicate
  Bootstrap Reboot block (resets now owned by `global.css`), made hero/logo/
  headings fluid, added `100svh`, fixed the mobile footer quote alignment,
  reserved hero subtitle space to prevent layout shift, and raised project-page
  back/footer links to 44px touch targets.
- **U9.4 — Integration.** Extended `scripts/verify-parity.mjs` to strip the
  exact sanctioned U9 font-link delta (the same fail-closed mechanism used for
  U3 theme and U5 project-nav deltas), so the SEO/migration parity gate is
  green again without touching the baseline oracle.

No files under `src/data/**` were modified. No U8 chat-lifecycle or admin code
was changed. No dependencies were added or removed (`package.json` unchanged).

---

## 2. Files Changed

### 2.1 Modified (24)

| Area | Files |
|---|---|
| Document head / fonts | `index.html`, `admin.html`, `scripts/prerender/document.jsx` |
| Build parity | `scripts/verify-parity.mjs` |
| CSS entry / tokens | `src/index.css`, `src/styles/variables.css`, `src/styles/global.css` |
| Reset cleanup | `src/styles/bootstrap-grid-utilities.css` |
| Components / layout | `src/styles/button.css`, `src/styles/navbar.css`, `src/styles/footer.css`, `src/styles/hero.css` |
| Sections | `src/styles/about.css`, `src/styles/skills.css`, `src/styles/projects.css`, `src/styles/github.css`, `src/styles/certifications.css`, `src/styles/blogs.css`, `src/styles/contacts.css` |
| Prerendered pages | `src/styles/project-page.css` |
| React components | `src/components/sections/Skills.jsx`, `src/components/sections/GithubStats.jsx` |
| Tests | `src/components/sections/Skills.test.jsx`, `src/components/pages/ProjectPage.test.jsx` |

### 2.2 New (5)

| File | Purpose |
|---|---|
| `src/styles/section-header.css` | Single authoritative owner of `.section-header/.section-tag/.section-title/.section-description` |
| `reports/U9_TYPOGRAPHY_VISUAL_AUDIT.md` | Pre-implementation audit |
| `reports/U9_1_TYPOGRAPHY_IMPLEMENTATION.md` | U9.1 report |
| `reports/U9_2_COMPONENT_CONSISTENCY.md` | U9.2 report |
| `reports/U9_3_RESPONSIVE_IMPLEMENTATION.md` | U9.3 report |
| `reports/U9_FINAL_REVIEW.md` | This report |

### 2.3 Diffstat

```
24 files changed, 422 insertions(+), 389 deletions(-)
```

`git diff --check`: clean (no whitespace errors). Branch verified as
`feature/portfolio-u8-work`.

### 2.4 Untouched / excluded

- `src/data/**` — no changes.
- Chat lifecycle (`src/components/common/ChatAssistant*.jsx`, `src/lib/chatClient*`,
  `src/styles/chat.css`) — no changes.
- `package.json` / lockfile — no dependency changes.
- Backend, generated content snapshot, and baseline oracle — no changes.

---

## 3. Code Review Findings

### 3.1 Confirmed correct

- **Typography tokens:** weights (400–800), line heights, tracking, and fluid
  scales are defined once in `variables.css` and consumed consistently.
- **Font loading:** exactly one Inter stylesheet per document; the CSS
  `@import` was removed; `preconnect` + `display=swap` used; no fragile
  hardcoded font preload. No duplicate font request in `dist/`.
- **Weights:** only 400/500/600/700/800 are requested and only those are used
  across public and admin CSS (no 300/900 left).
- **Theme colors:** new tokens (`--on-primary`, `--text-secondary`,
  `--primary-soft`, `--hover-overlay`, `--glow-*`, `--radius-*`) resolve in both
  dark (`:root`) and light (`[data-theme="light"]`) blocks. No raw `white`,
  `#fff`, `green`, or brand `rgba(37,99,235,…)` remain in the public styles.
- **Radii:** content cards consistently `--radius-card` (20px); action buttons
  consistently `--radius-btn` (12px); intentional exceptions (project modal,
  media frame, pills/avatars) preserved.
- **Skill icons:** keyed by a stable technology slug written to `data-skill`;
  unknown technologies fall back to `var(--primary)`; light-theme legibility
  overrides provided. `src/data`/CMS contract untouched.
- **SectionTitle accessibility:** shared component renders a real `<h2>` plus a
  decorative tag `<span>`; all seven sections use it; rules have one owner and
  no section stylesheet re-declares them.
- **Mobile typography:** fluid clamps replace compounding root shrink + component
  overrides; verified 16px root at every tested width.
- **Hero:** `100svh` with `100vh` fallback; subtitle space reservation; CTAs share
  a row at 577–768px and stack below 576px; centered visual; no overflow.
- **Footer:** mobile quote alignment fixed (padding/border/max-width/margin).
- **Bootstrap reset removal:** `global.css` owns `box-sizing`, body, heading,
  paragraph, link, button, image, and SVG resets; no missing reset found.
- **CSS import order:** `variables → global → section-header → button → layout →
  sections`; all `@import`s precede rules.
- **Admin:** Inter preconnects/stylesheet added; admin weights (500–800) are all
  loaded; admin remains a separate bundle entry.
- **Prerendered project pages:** include the same font links and the
  `variables.css` token bundle; all tokens they reference are present in the
  built `entry-*.css`.
- **Cascade:** removing section-header rules from `about.css` introduced no
  conflict; no other stylesheet redefines those selectors.

### 3.2 Observations / non-blocking

1. **Pre-existing duplicate `button.css` import.** `global.css` imports
   `button.css` and `index.css` imports it again. This predates U9 and is
   harmless (same file, browser dedupes), but could be cleaned up later.
2. **Light-theme danger text contrast.** `.contact-status-error` and
   `.contact-field-error` use `var(--danger)` = `#EF4444` on the light
   background, which is **3.60:1** (below AA 4.5:1 for normal text). This is a
   pre-existing value (baseline used the same literal), not a U9 regression.
   Recommend a future `--danger-text` token (e.g. `#B91C1C`) in the light block.
3. **`[data-theme="dark"]` LangChain override** relies on the bootstrap setting
   the attribute. The no-JS project pages do not render skills, so this has no
   effect there.
4. **No trailing newline** in `hero.css`/`footer.css`/`skills.css` — identical to
   baseline, cosmetic only.

### 3.3 Contrast spot-check (WCAG AA, normal text)

| Pair | Dark | Light |
|---|---|---|
| text on bg | 17.06:1 PASS | 17.06:1 PASS |
| text-secondary on bg | 12.02:1 PASS | 9.90:1 PASS |
| text-secondary on card | 9.85:1 PASS | 10.35:1 PASS |
| muted on bg | 6.96:1 PASS | 4.55:1 PASS |
| link on primary-soft | 6.31:1 PASS | 5.59:1 PASS |
| on-primary on primary | 5.17:1 PASS | 5.17:1 PASS |
| success-text on bg | 7.83:1 PASS | 6.81:1 PASS |
| danger on bg | 4.74:1 PASS | **3.60:1 FAIL (pre-existing)** |

---

## 4. SEO Parity Investigation

### 4.1 The failure

`scripts/verify-parity.mjs` compared the current `dist/` against the Phase-0
oracle in `.cache/baseline/`. U9.1 moved Inter from a CSS `@import` to three
document-head `<link>` elements, so `index.html` and the five project pages
reported `DIFFERS` even though no SEO/content value changed.

### 4.2 Root cause and fix

The comparator already strips two sanctioned authorable deltas:

- U3: the pre-paint theme-bootstrap script + `theme-color` meta pair.
- U5: the project-page sticky section nav + four anchor ids.

The integration extends the same mechanism with a U9 rule that strips **exactly**
the three anchored font links and their documentation comments from **both**
sides, then compares the remainder byte-for-byte. It is fail-closed: if the font
URL, weight list, or link shape changes, the anchors stop matching and the page
reports `DIFFERS` again. The baseline oracle was **not** modified.

### 4.3 Independent verification

Applying all sanctioned strips (U3 theme delta, U5 nav/ids, U9 font delta,
bundler asset block) to the normalized baseline and current output produced
**byte-identical** authorable content for the shell and project pages.

The only non-content asset-set change is:

```
removed: /assets/rolldown-runtime-HASH.js   (merged into main)
added:   (none)
```

This is a bundler chunk-graph change, explicitly allowed as `ASSETS-VARY`.

### 4.4 SEO tag parity (explicit)

Title, description, keywords, author, robots, canonical, Open Graph, Twitter,
and JSON-LD were extracted and compared for the shell and all five project
pages:

```
index.html: ALL SEO TAGS IDENTICAL
projects/webchat-ai/index.html: ALL SEO TAGS IDENTICAL
projects/orbit-ai/index.html: ALL SEO TAGS IDENTICAL
projects/stayora/index.html: ALL SEO TAGS IDENTICAL
projects/zerodha-clone/index.html: ALL SEO TAGS IDENTICAL
projects/scientific-calculator/index.html: ALL SEO TAGS IDENTICAL
```

(`theme-color` was excluded from that comparison because U3 intentionally
replaced the single tag with a `prefers-color-scheme` pair; that delta is
already sanctioned and stripped by the comparator.)

### 4.5 Negative controls (fail-closed proof)

| Mutation to `dist/index.html` | Result |
|---|---|
| Prefix `<title>` with `NEGATIVE-CONTROL` | `DIFFERS`, exit 1 |
| Change font URL weights `400;…;800` → `300;…;800` | `DIFFERS`, exit 1 |
| Restore original | `0 differ(s)`, parity holds |

### 4.6 Final parity result

```
4 identical, 6 assets-vary (allowed), 0 differ(s).
[parity] done — parity holds.
```

`tests/seo-parity.test.mjs` (static `index.html` ↔ CMS `seo` payload):
**11/11 passed**.

---

## 5. Full Test Results

| Command | Result |
|---|---|
| `npm run lint` | **PASS** — 0 errors, 0 warnings |
| `npm test` (default parallel) | 287 passed, 4 skipped, **1 timeout failure + 1 suite timeout** under full-suite load |
| `npm test` (`--no-file-parallelism`) | **PASS — 35 files, 292 tests** |
| `npx vitest run src/App.test.jsx` (isolated) | **11/11 pass** (failed only under parallel load) |
| `npx vitest run scripts/extract-content.test.mjs` (isolated) | **4/4 pass** (Vite SSR boot exceeded 120s only under parallel load) |
| `npx vitest run tests/seo-parity.test.mjs` | **11/11 pass** |
| `npm run test:migration-validation` | **14/14 pass** |
| Playwright e2e (full suite) | 37 passed, 2 transient `ERR_NETWORK_CHANGED` failures |
| Playwright e2e (re-run of the 2 failing specs) | **12/12 pass** |

The two full-suite unit timeouts and the two e2e failures were load/network
flakes: both unit suites and both e2e specs pass cleanly in isolation/re-run.
No test failure is attributable to U9.

---

## 6. Build Results

All stages were run individually and then as the complete pipeline.

| Stage | Result |
|---|---|
| `npm run build:spa` | **PASS** — 760 modules, all chunks emitted |
| `npm run assert:admin-bundle` | **PASS** — 11 public chunks / 3 HTML entries; admin separate (5 chunks) |
| `npx vite build --config vite.prerender.config.js` | **PASS** — SSR entry + hashed CSS emitted |
| `npm run prerender` (project pages) | **PASS** — 5 pages (`webchat-ai`, `orbit-ai`, `stayora`, `zerodha-clone`, `scientific-calculator`) |
| `npm run discovery` | **PASS** — `sitemap.xml` (7 URLs), `sitemap-images.xml` (6 pages/6 images), `robots.txt`, `llms.txt` |
| `node scripts/verify-parity.mjs` | **PASS** — 4 identical, 6 assets-vary, 0 differ |
| `npm run build` (full, with content API) | **PASS** — all stages completed |

**Backend note:** the default local PostgreSQL socket (`/var/run/postgresql`)
was not running and the content API on `:8001` was not up. A disposable
`portfolio_e2e` database was provisioned on the available Docker Postgres
(`127.0.0.1:5433`) via `e2e/start-backend.mjs`, which exposed
`/api/content` (5 projects, 16 skills). The full `npm run build` then completed
end-to-end with `CONTENT_API_URL` pointed at that API. The regenerated
`src/generated/content.js` differed only in the recorded source URL and
`generated_at` timestamp; it was restored to the committed snapshot, so no
content change is included in this checkpoint.

---

## 7. Browser Verification

### 7.1 Standalone Playwright sweep (built `dist/`, no backend required)

Homepage at **320, 375, 390, 576, 577, 768, 1024, 1280, 1440 px**, both themes:

- Correct `data-theme` applied.
- No horizontal overflow (`scrollWidth − clientWidth ≤ 0`) at any width/theme.
- Nav, hero title, 5 project cards, and footer visible.
- `Tab` moves focus off `<body>`.
- No same-origin request failures or console/page errors.

Project detail pages (all 5) at 390/dark and 1440/light: title visible, no
overflow, no console errors.

Admin shell at 390/dark and 1440/light: renders, no overflow (admin API is not
part of this surface check).

Chat at 390/dark and 1440/light:

- FAB opens the dialog.
- Header close closes it.
- FAB reopens it.
- A question streams the mocked full SSE answer.
- `react-markdown` and `remark-gfm` chunks are requested only after the first
  answer (lazy-loading confirmed).

Result: **all checks passed**. The single transient `ERR_NETWORK_CHANGED`
console entry seen once at 375/light was clean on 3/3 immediate re-runs.

### 7.2 Repository e2e suite (with disposable backend)

- `e2e/public.spec.js` — homepage hero/nav/sections/footer, resume, 5 project
  pages: pass.
- `e2e/a11y.spec.js` — dark + light axe scans, 5 project pages, overflow at
  390/768/1024/1440: pass (no critical/serious violations; one moderate `region`
  advisory, pre-existing).
- `e2e/chat.spec.js` — SSE answer + sources + model: pass on re-run.
- `e2e/contact.spec.js` — validation + persisted submission: pass.
- `e2e/admin.spec.js` — auth redirect, login, CRUD, provider guard, resume
  upload: pass.
- `e2e/sweep.spec.js` — homepage both themes at 390/768/1024/1440 + project
  pages, console/network/overflow: pass.

---

## 8. Remaining Risks

1. **Light-theme danger text** is 3.60:1 (pre-existing, not U9). Recommend a
   `--danger-text` token in a follow-up.
2. **Test-suite resource pressure:** the full parallel `npm test` can time out
   on this host (App + extract-content suites). Serial execution is green. CI
   should either use serial/limited workers or raise the relevant timeouts.
3. **External font dependency:** Inter is fetched from Google Fonts with
   `display=swap`; an offline/blocked network falls back to `sans-serif` by
   design. No self-hosted fallback.
4. **`color-mix()`** is used for status tints; supported by the verified
   Chromium targets, but not by very old browsers.
5. **Parity comparator scope:** the U9 strip is intentionally narrow and
   fail-closed; any future change to the font URL/weight list will correctly
   turn the gate red again and require a deliberate decision.
6. **Transient e2e network flake:** `ERR_NETWORK_CHANGED` appeared once in a
   full run and did not reproduce. Consider retries in CI (already enabled for
   CI).

---

## 9. Backend Limitations

- The default local PostgreSQL unix socket and the `:8001` content API were not
  running at the start of this review.
- A disposable `portfolio_e2e` database was created on the available Docker
  Postgres (`127.0.0.1:5433`) to run the e2e suite and to provide
  `/api/content` for the full production build. The backend was stopped after
  validation; no e2e ports remain listening.
- The full `npm run build` therefore **was** validated, not just the partial
  stages. The regenerated content snapshot was restored because only its
  source-URL comment and `generated_at` timestamp changed.

---

## 10. Merge Readiness Recommendation

**Ready to commit after explicit approval.** All code review, parity, unit,
migration, build, accessibility, and browser checks pass. The only observed
failures were reproducible environmental flakes (parallel-load timeouts and one
transient network change), all of which pass on isolated/repeated runs.

No blockers. No unrelated files are present in the change set.

---

## 11. Proposed Commit (not staged)

### 11.1 Exact files to stage

Modified:

```
admin.html
index.html
scripts/prerender/document.jsx
scripts/verify-parity.mjs
src/components/pages/ProjectPage.test.jsx
src/components/sections/GithubStats.jsx
src/components/sections/Skills.jsx
src/components/sections/Skills.test.jsx
src/index.css
src/styles/about.css
src/styles/blogs.css
src/styles/bootstrap-grid-utilities.css
src/styles/button.css
src/styles/certifications.css
src/styles/contacts.css
src/styles/footer.css
src/styles/github.css
src/styles/global.css
src/styles/hero.css
src/styles/navbar.css
src/styles/project-page.css
src/styles/projects.css
src/styles/skills.css
src/styles/variables.css
```

New:

```
src/styles/section-header.css
reports/U9_TYPOGRAPHY_VISUAL_AUDIT.md
reports/U9_1_TYPOGRAPHY_IMPLEMENTATION.md
reports/U9_2_COMPONENT_CONSISTENCY.md
reports/U9_3_RESPONSIVE_IMPLEMENTATION.md
reports/U9_FINAL_REVIEW.md
```

### 11.2 Proposed commit message

```
feat: polish portfolio typography and responsive design

U9.1: load Inter from the document head (index/admin/prerendered),
add weight/line-height/tracking tokens, fluid lead/subtitle scales,
and improve body-copy contrast with --text-secondary.

U9.2: add --radius-card/--radius-btn, normalize card/button/icon
geometry, replace raw brand colors with semantic tokens, centralize
section-header styles, use shared SectionTitle in GithubStats, and
key skill-icon colors by technology instead of list position.

U9.3: keep the root at the browser default, remove the duplicate
Bootstrap Reboot block, make hero/logo/headings fluid, add 100svh,
fix mobile footer alignment, reserve hero subtitle space, and raise
project-page links to 44px touch targets.

U9.4: extend verify-parity to strip the exact sanctioned font-link
delta (fail-closed, baseline unchanged) so SEO/migration parity is
green.
```

### 11.3 Confirmations

- U9.1, U9.2, and U9.3 changes are all included in the staged set above.
- `src/data/**`, chat lifecycle files, backend, and dependencies are excluded.
- No commit, push, merge, or deploy has been performed; awaiting approval.
