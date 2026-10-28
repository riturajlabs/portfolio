# U8 Stage 5 — Local Performance Investigation (Read-Only)

**Status:** Investigation only. **No remediation implemented. No release gate waived or reinterpreted.**
**Created:** 2026-10-21
**Branch:** `portfolio-upgrade` · **HEAD:** `f97125db618e289b5f1303bffd585108b884c995`
**Uncommitted local artifact.** Application code, tests, config, and archived evidence were **not** modified.

---

## 1. Baseline and build identity

| Item | Value |
|---|---|
| Branch | `portfolio-upgrade` |
| HEAD | `f97125db618e289b5f1303bffd585108b884c995` |
| Working tree | 3 untracked paths only (`docs/upgrade-baselines/U8-lighthouse/`, `e2e/sweep.spec.js`, `tests/seo-parity.test.mjs`); 0 tracked changes, 0 staged |
| Served build | `dist/` on `http://127.0.0.1:4173` (via `e2e/serve.mjs`) |
| Entry bundle | `assets/main-Bj4AosCf.js` — SHA-256 `20031fbd92fb18465d45d8e435775684faecd65460949e31cb7d2e6b3f8e5b52` |
| Entry CSS | `assets/main-Hs5-7b6Q.css` — SHA-256 `ce633faf0043d9e4b3cd0330fd7e026cb7729b15d83b5041e5b304d37580ad4d` |
| React chunk | `assets/react-CQmq40kp.js` (184,000 B) — `e50a06c13097d7aa8726e3733e1d9e9b7f2a1ff934fde8cf3ffddd5f40736502` |
| Motion chunk | `assets/motion-6LcmtSq0.js` (125,286 B) — `b53e573b318b05d38b1bfc62f9a7032ee29cea87f554b4727db3fff4594a836c` |
| Markdown chunk | `assets/markdown-Di8C7Us8.js` (154,619 B) — loaded on homepage |
| Project-page CSS | `assets/entry-ku271_YJ.css` (only 8,437 B; project HTML loads **no** JS module) |

The served homepage/project HTML reference `main-Bj4AosCf.js` (branch build), **not** the
production bundle `main-Bf0HhMVH.js` and not stale assets. Build identity confirmed.

---

## 2. Exit-gate thresholds (unchanged, quoted)

From `docs/PORTFOLIO_UPGRADE.md:358`: `perf ≥ U1 median (46 home / 82 project)`;
`a11y ≥ 96 home / 95 project`; `SEO = 100 both`; "do not claim improvement without
before/after numbers." U1 baseline (`U1-before.md` §2): home Perf 46, project Perf 82.

---

## 3. Evidence from the archived homepage runs (`raw/`)

All three archived homepage runs load **13 JS files** and show the same shape:

| Audit | home-1 (34) | home-2 (49) | home-3 (36) |
|---|---|---|---|
| Total Blocking Time | 2653 ms | 632 ms | 2180 ms |
| Main-thread work | 13,364 ms | 7,815 ms | 11,195 ms |
| Bootup time | 4,331 ms | 1,425 ms | 3,162 ms |
| Long tasks | 20 | 20 | 20 |
| Unused JavaScript | 253 KiB | 253 KiB | 253 KiB |
| Unused CSS | 35 KiB | 35 KiB | 35 KiB |
| LCP | 7941 ms | 7589 ms | 8481 ms |
| Speed Index | 5323 ms | 4364 ms | 4652 ms |
| CLS | 0.003 | 0.003 | 0.003 |
| Max potential FID | 1360 ms | 351 ms | 820 ms |

**Script attribution (observed):** bootup/long tasks are dominated by
`react-CQmq40kp.js` (scripting 3,637 / 1,008 / 2,498 ms) and
`motion-6LcmtSq0.js` (525 / 303 / 498 ms). `main-Bj4AosCf.js` scripting is trivial
(36 / 22 / 28 ms).

**Unused JavaScript (identical every run):**
- `markdown-Di8C7Us8.js` — **127,247 / 154,611 B wasted (~82%)**
- `motion-6LcmtSq0.js` — 69,466 / 125,286 B wasted (~55%)
- `react-CQmq40kp.js` — 62,521 / 184,000 B wasted (~34%)

**Homepage network requests (29):** `Document`, `main` (61 KB), `preload-helper`,
`icons` (52 KB), `react` (184 KB), `motion` (125 KB), `main.css` (61 KB),
`site.webmanifest`, Google-Fonts CSS, **`markdown` (154 KB)**, `Projects` (6 KB),
`Projects.css`, `ChatAssistant` (19 KB), `ChatAssistant.css` (12 KB),
`rittu-*.webp` image (183 KB), Inter woff2 (48 KB), `script.js`,
`GithubStats` (5 KB), `Certifications` (1.4 KB), `Blog` (2.5 KB), `Contact` (6.6 KB),
and their CSS files, plus 4 favicon requests.

**Project page (contrast):** `project-2` performs **0 JS requests** — fully
prerendered static HTML with one 8.4 KB stylesheet → Perf 94, bootup small.

**Observed vs hypothesis note:** the *observation* is that react/motion scripting
and ~253 KB unused JS (mostly markdown) dominate the homepage's blocked time. The
*cause* of the markdown chunk being present on a page with no markdown is mapped in §4.

---

## 4. Read-only source mapping

- `src/App.jsx:13` — `ChatAssistant` is `React.lazy`, but it is rendered
  **unconditionally** inside `<Suspense>` (`:43-47`), so its chunk is fetched on load.
- `src/components/common/ChatAssistant.jsx:25` — `react-markdown` is itself lazily
  imported *within* ChatAssistant. Yet `markdown-Di8C7Us8.js` appears in the homepage
  request list (§3), i.e. it is fetched during initial load.
- `src/pages/Home.jsx:13-31` — `Projects`, `GithubStats`, `Certifications`, `Blog`,
  `Contact` are each `React.lazy`, but **all five render inside one `<Suspense>`
  that mounts immediately** (`:50-62`). `react.lazy` here only code-splits; it does
  **not** defer the network fetch or execution to viewport/scroll. `whileInView`
  (seen across `src/components/sections/*.jsx`) drives **animation**, not mounting.
- Net effect: the homepage eagerly downloads and hydrates react + motion + icons +
  all section chunks + markdown. The project page does not hydrate these at all.

---

## 5. Controlled fresh local measurement (Step 4)

Same method as the archived local runs and U1 §1.1: Lighthouse 12.8.2,
Chrome for Testing 153.0.8010.12, mobile, simulated throttling
(rtt 150 / throughput 1638.4 / latency 562.5 / down 1474.56 / up 675 / cpu×4),
360×640 DPR2, categories perf/a11y/bp/seo, 3 runs/page, median. Settings verified
**byte-identical** to the archived runs. Saved to `step5-local/` (no overwrite).

| Page | Run | Perf | A11y | BP | SEO | FCP | LCP | TBT | CLS | SI | MTW | Bootup |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| home | 1 | 26 | 100 | 96 | 100 | 6254 | 10074 | 6860 | 0.00764 | 10819 | 26224 | 8782 |
| home | 2 | 29 | 100 | 96 | 100 | 5443 | 9364 | 5608 | 0.00719 | 7459 | 25136 | 6942 |
| home | 3 | 33 | 100 | 96 | 100 | 5064 | 8106 | 3078 | 0.00319 | 5103 | 14820 | 4274 |
| **home median** | | **29** | **100** | **96** | **100** | 5443 | 9364 | 5608 | 0.00719 | 7459 | 25136 | 6942 |
| proj | 1 | 73 | 100 | 100 | 100 | 1025 | 3125 | 868 | 0 | 1920 | 2627 | 153 |
| proj | 2 | 81 | 100 | 100 | 100 | 993 | 3140 | 492 | 0 | 1925 | 2064 | 145 |
| proj | 3 | 80 | 100 | 100 | 100 | 1178 | 3194 | 515 | 0 | 2115 | 2430 | 146 |
| **proj median** | | **80** | **100** | **100** | **100** | 1025 | 3140 | 515 | 0 | 1925 | 2430 | 146 |

### Comparability verdict: **NOT COMPARABLE (in outcome)**
Settings are identical, but the fresh medians (home **29**, project **80**) differ
materially from the archived local medians (home **36**, project **93**). Same
build, same method ⇒ the difference is **host-load variance**, not a code change.
Therefore Step 4 results are **NOT COMPARABLE** to the archived numbers and are
reported as a variance signal only. No improvement is claimed.

**Key variance signal:** three consecutive runs of the *same* homepage build span
Perf 26→33, TBT 3078→6860 ms, main-thread work 14.8s→26.2s. The homepage is a
systematically heavy case whose score is **highly sensitive to CPU contention**.

---

## 6. Ranked likely bottlenecks (hypotheses, with confidence)

| # | Hypothesis | Evidence | Confidence | Unverified |
|---|---|---|---|---|
| H1 | **Eager hydration/code of many chunks on the homepage** amplifies main-thread work & TBT (react + motion + 5 sections + ChatAssistant fetched at load). | 13 JS requests; bootup dominated by react/motion; all lazy sections mount inside one always-rendered `<Suspense>` (`Home.jsx:50-62`); project page (0 JS) scores 80–94. | **High** | Exact ms attributable to each component vs. the shared react/motion runtime. |
| H2 | **`markdown` (154 KB, ~127 KB unused) is fetched on the homepage** though no markdown is rendered above the fold. | `markdown-Di8C7Us8.js` present in homepage `network-requests`; 127,247 B flagged unused on all 6 homepage runs. | **High** (fetched) / Medium (why) | The precise trigger that pulls the markdown chunk (ChatAssistant module graph vs. a static import) — needs a bundle/trace check. |
| H3 | **Unused CSS (~35 KB)** and **two large fonts + a 183 KB hero webp** add to render/critical path. | inventory: `main.css` 61 KB (35 KB unused), Inter woff2 48 KB, `rittu-*.webp` 183 KB. | Medium | Impact is likely secondary to JS given low CLS and modest FCP relative to TBT. |
| H4 | **`react`/`motion` chunk sizes** (184 KB / 125 KB, with 34% / 55% unused) are the dominant script payloads. | bootup-time & long-tasks attribution; transfer sizes. | High (sizes) / Medium (reducible) | Whether tree-shaking/minification can reduce them without behavior change. |
| H5 | **Scores are CPU-contention sensitive**, so a single median is unstable. | Archived (TBT 632–2653) and fresh (3078–6860) spreads on identical builds. | **High** | A stable measurement methodology (e.g., more runs, quieter host) to reduce noise. |

**Confirmed findings:** the homepage loads 13 JS chunks including markdown and does
not hydrate-defer its sections; the project page loads 0 JS. **Hypotheses:** the
*relative* contribution of each chunk and the exact markdown trigger.

---

## 7. Proposed remediations (NOT implemented — proposals only)

Each is a *proposal requiring approval*; none was applied. Estimates are indicative.

| Ref | Proposal | Est. impact | Trade-off | Validation |
|---|---|---|---|---|
| P1 | Gate `ChatAssistant` behind a user action / idle callback (only mount after interaction or `requestIdleCallback`), so react-markdown's chunk never loads on first paint. | Large (removes 154 KB markdown fetch + hydration from load) | Chat button may need a tiny always-present trigger component. | 3× local Lighthouse + confirm markdown absent from `network-requests`; chat still works. |
| P2 | Defer the below-the-fold sections (`Projects`, `GithubStats`, `Certifications`, `Blog`, `Contact`) to viewport/idle mount (IntersectionObserver or `LazyMotion`/dynamic import on scroll) instead of an always-mounted `<Suspense>`. | Medium–Large (cut initial JS execution) | More code; risk of layout shift/CLS if not sized; needs care with anchors/deep links. | 3× local Lighthouse; CLS stays ≈0; anchors still resolve. |
| P3 | Confirm/eliminate any static path pulling `react-markdown` into the homepage initial graph (e.g. a shared util re-export). | Large if found | None if it's a stray import. | Inspect bundle graph; markdown absent from initial requests. |
| P4 | Audit `icons` (52 KB) and `motion` (125 KB) for tree-shaking / selective imports. | Small–Medium | Possible refactor across components. | Bundle diff + Lighthouse. |
| P5 | Adopt a quieter measurement protocol (e.g., more runs, median-of-5, or isolate CPU) to stabilize the gate reading. | Measurement quality | Time cost. | Re-run archived vs fresh and compare spread. |

**Suggested order:** P3 (cheap, may be decisive) → P1 → P2 → P4. P5 should accompany
any re-measurement used for the final gate decision.

---

## 8. Limitations and non-claims

- Fresh Step-4 results are **NOT COMPARABLE** to the archived medians (host-load
  variance); they do not establish or refute a regression.
- No bundle-graph tooling was run; the markdown trigger (H2/P3) is **not yet
  root-caused**.
- No remediation has been implemented.
- **No release gate was waived, exempted, or reinterpreted.** The homepage target
  remains **46**; the local homepage median remains below it on all evidence to date
  (archived 36, fresh 29; best single run 33).
- Measurement environment was shared/loaded; CPU throttling is simulated (÷4), so
  real-device behavior is unverified.

---

## 9. Evidence paths and checksums (this stage)

New files (all local, uncommitted): `step5-local/{home-1,home-2,home-3,project-1,project-2,project-3}.json`

| File | SHA-256 |
|---|---|
| step5-local/home-1.json | `b558d1d93b6a5748a603418847173b8f47668fb4981c9100a9a87c930ee597c8` |
| step5-local/home-2.json | `bc35a27e7c72e3402a40ac3d1095f1557c4ac8224475e29ab582ed85b6773ee7` |
| step5-local/home-3.json | `ca953a64c98a5860a42ee204e13569bb8f696cc486972d1184c3788cfcd15f00` |
| step5-local/project-1.json | `b4859e73cd6521f247996abbf214bb3801003e078897c4e89e17cc7fe0689e0d` |
| step5-local/project-2.json | `fb542ffb775d44d4233f205da80a37ba0aa5877fbbc1f98542030960f5345501` |
| step5-local/project-3.json | `606ca04bb14d9e2091f9cd449505d400766469b59b00dd6b4e1696385e642214` |

**Archived evidence preserved and verified unchanged** — `raw/*.json` checksums still
match `docs/upgrade-baselines/U8-lighthouse/README.md` §7 (e.g. home-1
`742058793479903485356463a6587464302ac71b92f7a8707861ff30f8577f39`). No archived
file was overwritten or deleted.
