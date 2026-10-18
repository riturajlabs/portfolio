# U1 Baseline — Public Site (before any visual change)

**Status:** Measured — real runs, no estimates.
**Captured:** 2026-10-17
**Branch:** `portfolio-upgrade`
**Base commit:** `eec84e1` (`main`)
**Target:** live production, `https://riturajlabs.vercel.app`
**Purpose:** the "before" oracle for the public design upgrade (ADR-018,
`PORTFOLIO_UPGRADE.md`). Phase U7 compares against these numbers.

> Raw engine output is **not** committed. Lighthouse JSON was written to
> `/tmp/opencode/lh-home-{1,2,3}.json` and `/tmp/opencode/lh-project-{1,2,3}.json`;
> the computed-style probe script was `/tmp/opencode/measure.cjs`. The numeric
> results are recorded verbatim below.

---

## 1. Method

### 1.1 Lighthouse

| Setting | Value |
|---|---|
| Tool | `npx lighthouse@12` → **Lighthouse 12.8.2** |
| Browser | Chrome for Testing **153.0.8010.12**, headless (`--headless=new --no-sandbox --disable-dev-shm-usage`) |
| OS | Linux x86_64 |
| Node / npm | v24.19.0 / 11.17.0 |
| Form factor | **mobile** (Lighthouse default) |
| Throttling | **simulated**, Lighthouse default mobile: `rttMs 150`, `throughputKbps 1638.4`, `requestLatencyMs 562.5`, `downloadThroughputKbps 1474.56`, `uploadThroughputKbps 675`, `cpuSlowdownMultiplier 4` |
| Categories | performance, accessibility, best-practices, seo |
| Runs | **3 per page**, fresh page load each |
| Pages | `/` and `/projects/webchat-ai/` |

Baseline value per page = **median of the 3 runs**.

### 1.2 Computed-style / tap-target probe

Playwright Chromium (same 153 build), live URL, `waitUntil: "networkidle"` plus a
1500 ms settle, three contexts: desktop 1440×900, desktop 1440×900 with
`reducedMotion: "reduce"`, and mobile 390×844.

* Values read with `getComputedStyle`.
* "Interactive target" = visible (`width>0 && height>0`, `visibility!==hidden`,
  `display!==none`) match for `a, button, [role="button"], input, select,
  textarea, [tabindex]:not([tabindex="-1"])`. A target is "small" when width < 44
  **or** height < 44 px.
* "Animated element" = element whose inline `style` attribute contains
  `transform` or `opacity`.

---

## 2. Lighthouse results

### 2.1 `/` (home)

| Run | Perf | A11y | Best-practices | SEO | FCP | LCP | TBT | CLS | SI | TTI |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 34 | 91 | 96 | 92 | 3.4 s | 5.6 s | 5490 ms | 0.009 | 10.2 s | 18.7 s |
| 2 | 46 | 96 | 100 | 100 | 2.7 s | 6.1 s | 1500 ms | 0.003 | 4.3 s | 6.2 s |
| 3 | 46 | 96 | 100 | 100 | 3.1 s | 4.7 s | 2190 ms | 0.003 | 4.8 s | 6.5 s |
| **Median** | **46** | **96** | **100** | **100** | **3.1 s** | **5.57 s** | **2190 ms** | **0.003** | **4.8 s** | **6.5 s** |

Server response time (median): ~77 ms (root document).

### 2.2 `/projects/webchat-ai/`

| Run | Perf | A11y | Best-practices | SEO | FCP | LCP | TBT | CLS | SI | TTI |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 82 | 95 | 96 | 100 | 0.9 s | 1.7 s | 720 ms | 0 | 2.2 s | 2.0 s |
| 2 | 78 | 95 | 100 | 100 | 1.0 s | 1.7 s | 1000 ms | 0 | 1.5 s | 2.4 s |
| 3 | 88 | 95 | 100 | 100 | 1.0 s | 1.7 s | 450 ms | 0 | 1.7 s | 1.8 s |
| **Median** | **82** | **95** | **100** | **100** | **0.96 s** | **1.69 s** | **721 ms** | **0** | **1.67 s** | **2.0 s** |

Server response time (median): ~54 ms (root document).

### 2.3 Failing accessibility audits observed

| Page / run | Audit | Title |
|---|---|---|
| home run 1 | `color-contrast` | Background and foreground colors do not have a sufficient contrast ratio |
| home run 1 | `image-alt` | Image elements do not have `[alt]` attributes |
| home run 2 | `color-contrast` | (same) |
| home run 2 | `label-content-name-mismatch` | Elements with visible text labels do not have matching accessible names |
| project run 1 | `color-contrast` | (same) |

`image-alt` on the home page is consistent with finding **P0-1** (the GitHub
avatar renders without `alt` in the cold-start fallback). `color-contrast` is
consistent with the P1 contrast work. These are pre-change failures, not
regressions.

---

## 3. Computed-style results (live, desktop 1440×900)

| Property | Measured value |
|---|---|
| Body background | `rgb(15, 23, 42)` |
| Body colour | `rgb(248, 250, 252)` |
| Body font | `Inter, sans-serif` |
| Root font size | `16px` |
| `.hero-title` | `76.8px`, weight `800` |
| `.section-title` | `56px` |
| `.project-card` | `border-radius: 24px`, `box-shadow: none` |
| Distinct `box-shadow` values on the page | **9** |

The 9 distinct shadows (verbatim):

```
rgba(37, 99, 235, 0.25) 0px 4px 14px 0px
rgba(34, 197, 94, 0.282) 0px 0px 0px 4.77053px
rgba(37, 99, 235, 0.3) 0px 6px 18px 0px
rgba(0, 0, 0, 0.1) 0px 15px 35px 0px
rgba(37, 99, 235, 0.3) 0px 4px 15px 0px
rgba(37, 99, 235, 0.35) 0px 10px 25px 0px
rgba(2, 6, 23, 0.18) 0px 10px 30px 0px
rgba(37, 99, 235, 0.337) 0px 5px 16.8529px 0px
rgba(239, 68, 68, 0) 0px 0px 0px 5.98027px
```

## 4. Tap targets and motion

| Metric | Desktop 1440×900 | Mobile 390×844 |
|---|---|---|
| Interactive targets (visible) | 71 | 64 |
| Targets < 44×44 px | **21** | **49** |

Example small targets (desktop): `.logo` 89×38, nav links 45×20 / 46×20 / 40×20
/ 62×20, `.theme-toggle` 42×42, `.contact-copy-btn` 38×38, inputs 34×53.

Motion:

| Setting | Elements with inline `transform`/`opacity` |
|---|---|
| `no-preference` | **42** |
| `reduce` | **42** |

The count is identical under `prefers-reduced-motion: reduce`, i.e. the
preference has **no effect** — finding **P0-2**, now measured.

---

## 5. Notes, variance and incomplete checks

* **Performance on `/` is noisy** (34–46). The page loads statically but on the
  free tier with cold backend calls; compare **medians**, not single runs. Treat
  `perf ≥ 46`, `a11y ≥ 96`, `SEO = 100` as the home baseline to hold.
* **Home SEO = 92 on run 1 only** (100 on runs 2–3) — treated as transient.
  Investigate if it recurs.
* **Home a11y = 91 on run 1** (`image-alt`), 96 on runs 2–3 (`color-contrast`,
  `label-content-name-mismatch`) — both are real, both are P0/P1 items above.
* **Not measured:** desktop Lighthouse preset, Firefox/Safari, real-device
  testing, web-vitals field data, and a local `vite preview` build. If a desktop
  baseline is wanted, capture it the same way (`--preset=desktop`) before U2.
* Lighthouse raw JSON and the probe script live under `/tmp/opencode/` and are
  intentionally not committed.
