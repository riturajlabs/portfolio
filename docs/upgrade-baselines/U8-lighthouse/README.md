# U8 Lighthouse Evidence Archive & Production Measurement

**Status:** Local, uncommitted evidence. **These measurements do NOT authorize a release.**
**Created:** 2026-10-21 (session date; see per-run `fetchTime`)
**Branch:** `portfolio-upgrade`
**HEAD:** `f97125db618e289b5f1303bffd585108b884c995`

> This directory holds raw Lighthouse JSON only. It is intentionally **not** committed.
> `docs/PORTFOLIO_UPGRADE.md` and `docs/SECURITY.md` were **not** edited in this phase.

---

## 1. Purpose and scope

Two evidence sets are archived here:

1. **`raw/`** — the six JSON files from the **U8 local-build** measurement
   (served from `dist/` at `http://127.0.0.1:4173/`), reproduced byte-for-byte
   from `/tmp/opencode/lh-u8/` so the source evidence is not lost.
2. **`production/`** — six **new** JSON files from a measurement against **live
   production** `https://riturajlabs.vercel.app/`, run to obtain a measurement
   comparable to the U1 baseline.

The purpose is to (a) preserve evidence, and (b) determine whether the homepage
performance gate can be evaluated with a *comparable* (production) measurement.

---

## 2. U1 baseline methodology and source references

Source: `docs/upgrade-baselines/U1-before.md`.

| Setting | U1 value |
|---|---|
| Tool | Lighthouse **12.8.2** |
| Browser | Chrome for Testing **153.0.8010.12**, headless (`--headless=new --no-sandbox --disable-dev-shm-usage`) |
| OS | Linux x86_64 |
| Node / npm | v24.19.0 / 11.17.0 |
| Target | **live production** `https://riturajlabs.vercel.app` (`U1-before.md` header) |
| Form factor | mobile |
| Throttling | simulated: `rttMs 150`, `throughputKbps 1638.4`, `requestLatencyMs 562.5`, `downloadThroughputKbps 1474.56`, `uploadThroughputKbps 675`, `cpuSlowdownMultiplier 4` |
| Viewport | 360×640, DPR 2 (mobile emulation) |
| Categories | performance, accessibility, best-practices, seo |
| Runs | 3 per page, fresh load, **median** |
| Pages | `/` and `/projects/webchat-ai/` |

**U1 baseline medians** (`U1-before.md` §2.1–2.2):

| Page | Perf | A11y | BP | SEO |
|---|---|---|---|---|
| `/` home | **46** | 96 | 100 | 100 |
| `/projects/webchat-ai/` | **82** | 95 | 100 | 100 |

**U8 acceptance gates** (`docs/PORTFOLIO_UPGRADE.md:358`):
`a11y ≥ 96 home / 95 project` (ideally ≥ 98); `SEO = 100 both`; `perf ≥ U1 median
(46 home / 82 project)`; **"do not claim improvement without before/after numbers."**

**Targets confirmed against the source:** homepage performance target **46**,
project-page performance target **82**. (Verified — they match `:358`.)

---

## 3. Previous U8 local-build results (indicative only)

Source: `raw/*.json` (local build served from `dist/`, `http://127.0.0.1:4173/`).

| Page | Perf (med) | A11y | BP | SEO |
|---|---|---|---|---|
| home | 36 | 100 | 96 | 100 |
| project | 93 | 100 | 100 | 100 |

**Comparability limitation:** these were measured against the **local build**,
not production. `U1-before.md` §5 and `PORTFOLIO_UPGRADE.md:369` both record that
the local build was deliberately not the U1 target. These numbers **must not** be
represented as production results.

---

## 4. New production measurement (Task B)

**Command shape (identical methodology to U1 §1.1 / U8 §8):**

```
CHROME_PATH=<linux cf153 chrome binary> \
lighthouse <URL> --output=json --output-path=<file> \
  --chrome-flags="--headless=new --no-sandbox --disable-dev-shm-usage" \
  --form-factor=mobile \
  --screenEmulation.mobile=true --screenEmulation.width=360 \
  --screenEmulation.height=640 --screenEmulation.deviceScaleFactor=2 \
  --throttling-method=simulate \
  --throttling.rttMs=150 --throttling.throughputKbps=1638.4 \
  --throttling.requestLatencyMs=562.5 --throttling.downloadThroughputKbps=1474.56 \
  --throttling.uploadThroughputKbps=675 --throttling.cpuSlowdownMultiplier=4 \
  --only-categories=performance,accessibility,best-practices,seo
```

**Tool versions used:** Lighthouse 12.8.2; Chrome for Testing 153.0.8010.12;
Node v24.19.0. **Matches U1 exactly.**

**URLs measured (verified by HTTP 200 and `finalUrl`):**

| Run | URL | `finalUrl` | `fetchTime` (UTC) |
|---|---|---|---|
| production/home-1 | `https://riturajlabs.vercel.app/` | `https://riturajlabs.vercel.app/` | 2026-10-21T03:12:22.603Z |
| production/home-2 | same | same | 2026-10-21T03:14:22.582Z |
| production/home-3 | same | same | 2026-10-21T03:15:21.984Z |
| production/project-1 | `…/projects/webchat-ai/` | `…/projects/webchat-ai/` | 2026-10-21T03:17:14.595Z |
| production/project-2 | same | same | 2026-10-21T03:17:50.704Z |
| production/project-3 | same | same | 2026-10-21T03:18:17.682Z |

All six runs report `configSettings.formFactor = mobile`,
`throttlingMethod = simulate`, the exact U1 throttling object, and
`screenEmulation = {mobile:true,width:360,height:640,deviceScaleFactor:2}`.

### 4.1 Production individual results

**Homepage `/`**

| Run | Perf | A11y | BP | SEO | FCP | LCP | TBT | CLS | SI |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 38 | 91 | 96 | 92 | 3299.8 | 4813.8 | 7310.3 | 0.01454 | 9493.5 |
| 2 | 44 | 100 | 96 | 100 | 3545.6 | 4683.9 | 3622.5 | 0.00003 | 4525.7 |
| 3 | 36 | 91 | 96 | 92 | 3527.3 | 6130.9 | 3235.5 | 0.00909 | 6312.7 |
| **Median** | **38** | **91** | **96** | **92** | **3527.3** | **4813.8** | **3622.5** | **0.00909** | **6312.7** |

**Project `/projects/webchat-ai/`**

| Run | Perf | A11y | BP | SEO | FCP | LCP | TBT | CLS | SI |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 72 | 95 | 96 | 100 | 1352.9 | 1697.9 | 1332.5 | 0 | 4526.7 |
| 2 | 76 | 95 | 100 | 100 | 1252.4 | 1663.4 | 1106.5 | 0 | 2391.5 |
| 3 | 78 | 95 | 96 | 100 | 1356.5 | 1393.5 | 950.5 | 0 | 2284.7 |
| **Median** | **76** | **95** | **96** | **100** | **1352.9** | **1663.4** | **1106.5** | **0** | **2391.5** |

### 4.2 Production vs U1 baseline vs U8 local build

| Page | Metric | U1 (prod) | New (prod) | U8 (local) |
|---|---|---|---|---|
| home | Perf | 46 | **38** | 36 |
| home | A11y | 96 | **91** | 100 |
| home | BP | 100 | **96** | 96 |
| home | SEO | 100 | **92** | 100 |
| project | Perf | 82 | **76** | 93 |
| project | A11y | 95 | **95** | 100 |
| project | BP | 100 | **96** | 100 |
| project | SEO | 100 | **100** | 100 |

---

## 5. Gate-by-gate evaluation

Gates are `PORTFOLIO_UPGRADE.md:358`, evaluated against **production** medians.

| Gate | Target | Production median | Status |
|---|---|---|---|
| Home a11y ≥ 96 | 96 | 91 | **FAIL** (prod) |
| Project a11y ≥ 95 | 95 | 95 | PASS |
| Home SEO = 100 | 100 | 92 | **FAIL** (prod) |
| Project SEO = 100 | 100 | 100 | PASS |
| Home perf ≥ 46 | 46 | 38 | **GATE NOT MET** (prod) |
| Project perf ≥ 82 | 82 | 76 | **FAIL** (prod) |

> Applying the gates literally to *today's production* yields failures on
> home a11y, home SEO, home perf and project perf. **However**, see §6: today's
> production is **not the upgraded build**.

For the **upgrade itself**, the only directly measured evidence remains the
**local build**: home perf **36 < 46** (`GATE NOT MET`), project perf **93 ≥ 82**
(met), a11y 100/100 (met), SEO 100/100 (met).

---

## 6. Comparability analysis — the central finding

**Live production `https://riturajlabs.vercel.app/` is still serving the
pre-upgrade build**, not the `portfolio-upgrade` work:

- Production HTML references bundle **`assets/main-Bf0HhMVH.js`**; the branch
  build references **`assets/main-Bj4AosCf.js`** (different bundles).
- Production's homepage still has `<img class="github-avatar" loading="lazy">`
  **with no `alt`** — the branch adds `alt={…}` (`src/components/sections/GithubStats.jsx:192`).
  This drives the prod `image-alt` failure (a11y + SEO).
- Production's `.hero-greeting` renders raw `#2563eb` (contrast 3.45, insufficient)
  — the branch repaints it via `--link` (`src/styles/hero.css:28`), a U4/U5 fix.
- Production emits `errors-in-console` on all 6 runs (BP 96 cap).

Therefore:

- **New production results ARE comparable to the U1 baseline** (same URL, same
  pre-upgrade build lineage, identical settings). Against U1, production has
  *regressed slightly* (home perf 46→38, project perf 82→76, a11y 96→91) — this
  reflects run-to-run/third-party variance on an unchanged build and is **not**
  attributable to the upgrade.
- **New production results are NOT comparable to the `portfolio-upgrade` work**,
  because production does not contain that work. The production run **cannot**
  answer "does the upgrade meet the homepage ≥ 46 gate?".

**Consequence:** a *production* measurement of the upgraded code is impossible
until the branch is deployed — and deploying is explicitly out of scope/unauthorized here.

---

## 7. Raw file list and SHA-256 checksums

### Archived local-build evidence (`raw/`)

| File | Bytes | SHA-256 |
|---|---|---|
| home-1.json | 636569 | `742058793479903485356463a6587464302ac71b92f7a8707861ff30f8577f39` |
| home-2.json | 643389 | `99148471357795dbd3fd6fddfdcdae6edc9a9ec91785dcc3566bfa8e8b141648` |
| home-3.json | 635127 | `9d77f8aa372462da34b98ebe27bdbfad2d0205e4c167097aa32b8819216202f4` |
| project-1.json | 627053 | `f68a356518c54ebe90a00a0de822907e617a5bab0174a1786423d451f73855e2` |
| project-2.json | 643573 | `7c8414e56abdd05722597151c9f0a431124ae3fbe101ba4ffec36a21e12d51d4` |
| project-3.json | 651355 | `08dc76f3addb843b64d31328f326df29279889aa7ad0795c3d38d6898be39a8b` |

All six verified **byte-for-byte identical** (`cmp`) to the preserved originals
in `/tmp/opencode/lh-u8/`.

### New production evidence (`production/`)

| File | Bytes | SHA-256 |
|---|---|---|
| home-1.json | 772382 | `41bead89eb6d5b577227684464036fb0aaa5ee80506cb02b55f31b9076b87668` |
| home-2.json | 391789 | `6870367cd4759b03b2d18a96334b6f537ccfdaeb12f5a9a037532e89b6593c29` |
| home-3.json | 615604 | `02f2839b49e573135fc67fb2a36db98875acdbdd43d47159c74c82282ba48fa6` |
| project-1.json | 550602 | `f86adb4e35c2cc72b5387c7b99b2f5d567a843734d949391654d2fb5369483db` |
| project-2.json | 623629 | `d533408081a3187ccb5a89eaa32e07d4fde410aa534420cfb8b868b5d8d6133c` |
| project-3.json | 630858 | `07a68b53dadb6450fbbe688b1bd4c8bba891c112b98ec11811cdb105714f6f16` |

---

## 8. Deviations, failures and limitations

- **Production ≠ upgraded build (blocking comparability).** See §6. This is the
  decisive limitation: the gate question is about the upgrade, but production
  serves the old build.
- **Third-party variance.** Home TBT ranged 3235–7310 ms; a11y/SEO dropped from
  100 to 91/92 on two of three production home runs (`image-alt`, `color-contrast`).
  These reflect the pre-upgrade content plus network/third-party timing, not the bill.
- **`errors-in-console`** caps Best Practices at 96 on every production run.
- **Desktop preset not measured** (documented U1 gap; unchanged).
- **No deployment occurred**, so an *upgraded* production measurement is not
  available and was not fabricated.
- Raw evidence for this phase is local and uncommitted.

---

## 9. Stale documentation identified (follow-up only — not edited here)

- `docs/PORTFOLIO_UPGRADE.md:369` states "Lighthouse not re-run this session." —
  now stale: Lighthouse **was** re-run (Stage 2 local, Stage 4 production).
- `docs/PORTFOLIO_UPGRADE.md:369` states "no local Postgres → backend pytest +
  full build/e2e not run here." — the U8 sessions **did** run build, e2e, and
  backend tests against a local Postgres on `:55432`.
- No committed U8 release-readiness report exists (`find docs -iname '*u8*'` empty).

---

## 10. Explicit disclaimer

**These measurements do not authorize a release.** They are raw evidence and
analysis only. No commit, push, merge, deploy, or production-config change was
performed. The homepage performance gate is **not** approved or exempted; it
remains the user's decision.
