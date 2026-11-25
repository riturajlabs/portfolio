# U9 — Portfolio Typography & Visual Polish Audit

**Audit Status:** COMPLETE (Read-Only)  
**Target Repository:** `/home/riturajlabs/Projects/portfolio`  
**Branch:** `feature/portfolio-u8-work`  
**Baseline Commit:** `9034d23`  
**Date:** 2026-11-09  

---

## 1. Executive Summary

This read-only audit examines the visual design, typography, layout hierarchy, component consistency, responsiveness, and font performance across the portfolio codebase.

The portfolio is built on a solid architectural foundation: semantic HTML, React 19, Framer Motion, dedicated responsive project pages, and an established token architecture in `src/styles/variables.css`. However, an in-depth code inspection reveals significant typography drift, visual fragmentation, performance bottlenecks in font delivery, and responsive quirks that undermine its polish as a showcase for a Full Stack Developer and AI/ML student.

### Key Audit Findings

1. **Render-Blocking Font Delivery & Missing Preconnects:**
   Font loading relies on an inline CSS `@import url("https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap")` in `src/styles/global.css:4`. This creates a sequential render-blocking network waterfall. Neither `index.html` nor `admin.html` includes `<link rel="preconnect">` or `<link rel="preload">` tags. In addition, weight `300` is requested but never used anywhere in the CSS, while prerendered project pages and the admin UI declare `Inter` in `font-family` without ever loading the font.

2. **Unused Typography Tokens & Arbitrary Hardcoded Sizing:**
   `src/styles/variables.css` declares a modular type scale (`--fs-xs`, `--fs-sm`, `--fs-body`, `--fs-lead`, `--fs-section`, `--fs-display`), yet **not a single stylesheet in the entire codebase consumes these tokens**. Instead, section titles, card headers, and body copy hardcode bespoke `rem` and `clamp()` values across 16 different CSS files (e.g., card headings inconsistently using `1.2rem`, `1.25rem`, `1.35rem`, `1.4rem`, and `1.6rem`).

3. **Subdued Body Readability (Contrast Degradation):**
   `src/styles/global.css:108` declares `p { color: var(--muted); }`. This forces almost all primary descriptive text across the site to render in muted tertiary slate (`#94A3B8` in dark, `#64748B` in light), rather than `--text-secondary` (`#CBD5E1` / `#334155`). This results in a washed-out reading experience and reduced contrast against `--bg` and `--card`.

4. **Component Inconsistency (Buttons, Radii, Shadows, Hardcoded Colors):**
   - **Buttons:** Four divergent radius treatments exist simultaneously: 999px pills (`.resume-btn`, `.github-profile-btn`, `.contact-form button`, `.project-overlay-btn`), 12px squircles (`.btn` in `button.css`), 10px rounded rectangles (`.certificate-card a`, `.blog-card a`), and 50% circles (`.theme-toggle`, `.project-modal-close`, `.back-top`).
   - **Card Radii:** `.about-card` uses `var(--radius)` (16px), whereas cards in Skills, Projects, GitHub, Certifications, and Blog all use `var(--radius-lg)` (24px).
   - **Hardcoded Colors & Shadows:** Component stylesheets contain literal hexes (`#fff`, `#8b5cf6`, `#ef4444`) and raw rgba box-shadows (`rgba(37,99,235,0.25)`), bypassing semantic theme tokens.
   - **Arbitrary Skill Icon Tinting:** `src/styles/skills.css:185-207` hardcodes brand colors onto `nth-child(1..4)` for all categories, erroneously forcing Backend (Node, Express, MongoDB) and AI/ML (Python, PyTorch, LangChain) items to render with React cyan, JS yellow, and HTML orange colors.

5. **Double-Scaling Mobile Typography:**
   `global.css` reduces the root `font-size` to `93.75%` (15px) at `<=991px` and `87.5%` (14px) at `<=576px`. Simultaneously, individual component media queries manually drop their `font-size` (e.g., `.hero-title`, `.section-title`, `.about-card h4`). This causes an unintended compounding "double-shrink", resulting in cramped text on mobile devices.

---

## 2. Current Design System Analysis

### 2.1 Tokens vs Reality
The token architecture in `src/styles/variables.css` contains robust definitions for:
- Surfaces & background: `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--card`, `--glass-bg`
- Brand & accents: `--primary`, `--primary-dark`, `--secondary`, `--accent`, `--brand-gradient`
- Elevation: `--elev-1`, `--elev-2`, `--elev-3`, `--shadow`, `--shadow-lg`, `--shadow-xl`, `--glow-brand-*`
- Radii: `--radius-sm` (10px), `--radius` (16px), `--radius-lg` (24px), `--radius-xl` (32px), `--radius-full` (999px)
- Type scale: `--fs-xs` through `--fs-display`
- Spacing: `--space-1` through `--space-8`

**Gap Analysis:**
- The Spacing scale (`--space-1` to `--space-8`) and Type scale (`--fs-*`) exist purely as dormant declarations.
- There are no tokens for `font-weight` (e.g., `--fw-regular`, `--fw-medium`, `--fw-semibold`, `--fw-bold`, `--fw-extrabold`).
- There are no tokens for `line-height` (e.g., `--lh-tight`, `--lh-base`, `--lh-relaxed`).
- There are no tokens for `letter-spacing` (tracking).

### 2.2 Style File Redundancy & Cascade Conflicts
1. **`src/styles/bootstrap-grid-utilities.css` Reboot Conflict:**
   Imported in `src/main.jsx:9`, this file declares a complete Bootstrap Reboot reset (`body { font-family: system-ui...; color: #212529; background-color: #fff; }`, `h1..h6`, `p`, `a { color: #0d6efd; text-decoration: underline; }`). `src/styles/global.css` then re-declares body resets, font-family, and heading styles. This redundant reset introduces dead code and specificity overhead.
2. **Double Imports of All Component Stylesheets:**
   `src/index.css` imports `@import "./styles/hero.css";`, `@import "./styles/about.css";`, and all other 9 section stylesheets statically. At the same time, individual React components (`Hero.jsx`, `About.jsx`, etc.) independently import their respective CSS files. While Vite deduplicates CSS output in production, this creates unnecessary module graph noise.

---

## 3. Typography Problems with Exact File References

### 3.1 Font Loading & Declarations
- **Render-blocking CSS `@import`:**
  - `src/styles/global.css:4`:
    ```css
    @import url("https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap");
    ```
    *Impact:* The browser halts CSS parsing and first paint until the Google Fonts stylesheet is fetched, parsed, and its font files requested.
- **Missing Resource Hints:**
  - `index.html` (lines 1-335) lacks `<link rel="preconnect" href="https://fonts.googleapis.com">` and `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`.
- **Missing Font in Admin & Prerendered Pages:**
  - `src/admin/admin.css:12`: `--admin-font: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;` is declared, but `admin.html` never loads `Inter`. Admin UI falls back to `Segoe UI` or `system-ui`.
  - `src/styles/project-page.css:25`: Declares `font-family: "Inter", system-ui...`, but prerendered static pages do not import `global.css` and have no font `<link>` tags in their `<head>`.
- **Unused Font Weight 300:**
  - Google Fonts requests weight `300`. A codebase search confirms `font-weight: 300` is **never utilized in any CSS rule**.

### 3.2 Heading Hierarchy & Scale Inconsistency
- **Section Titles:**
  - `src/styles/about.css:31`: `.section-title { font-size: clamp(2.2rem, 5vw, 3.5rem); font-weight: 800; line-height: 1.15; }`
  - `src/styles/hero.css:53`: `.hero-title { font-size: clamp(3rem, 6vw, 4.8rem); line-height: 1.1; font-weight: 800; letter-spacing: -1px; }`
  - `src/styles/project-page.css:128`: `.project-page-title { font-size: 2.6rem; line-height: 1.15; }`
  - Section titles are defined inside `about.css`, forcing all other sections (`Skills`, `Projects`, `Certifications`, `Blog`, `Contact`) to depend on `about.css` for their heading styling.
- **Card Heading Drift:**
  - `src/styles/about.css:176`: `.about-card h4 { font-size: 1.2rem; font-weight: 700; }`
  - `src/styles/skills.css:102`: `.skill-heading h3 { font-size: 1.25rem; font-weight: 700; }`
  - `src/styles/projects.css:186`: `.project-title { font-size: 1.4rem; }`
  - `src/styles/github.css:329`: `.github-card h3 { font-size: 3rem; font-weight: 800; }` and `.github-card h4 { font-size: 1.25rem; }`
  - `src/styles/certifications.css:138`: `.certificate-card h3 { font-size: 1.2rem; line-height: 1.4; }`
  - `src/styles/blogs.css:112`: `.blog-card h3 { font-size: 1.35rem; line-height: 1.4; }`
  - `src/styles/contacts.css:33`: `.contact-info h3 { font-size: 2rem; }`
  *Impact:* Headings at the same hierarchy level vary from 1.2rem to 1.4rem across cards, creating subtle visual dissonance.

### 3.3 Body Copy & Line-Height Discrepancies
- **Global Paragraph Muting:**
  - `src/styles/global.css:108`:
    ```css
    p {
        color: var(--muted);
        font-size: 1rem;
    }
    ```
    *Impact:* Lowers readability across all descriptions (`.hero-description`, `.about-text p`, `.project-description`, `.certificate-card p`).
- **Inconsistent Line Heights:**
  - `global.css:59`: `body { line-height: 1.6; }`
  - `hero.css:76`: `.hero-description { line-height: 1.8; }`
  - `projects.css:192`: `.project-description { line-height: 1.7; }`
  - `certifications.css:162`: `.certificate-card p { line-height: 1.7; }`
  - `github.css:195`: `.github-bio { line-height: 1.6; }`
  - `project-page.css:135`: `.project-page-summary { line-height: 1.75; }` and `p { line-height: 1.8; }`

### 3.4 Inconsistent Letter Spacing (Tracking)
- `src/styles/hero.css:56`: `letter-spacing: -1px;` (px unit on clamp display title)
- `src/styles/about.css:26`: `letter-spacing: 0.5px;` (px unit on uppercase tag)
- `src/styles/projects.css:348`: `letter-spacing: 0.04em;` (em unit on category tag)
- `src/styles/github.css:413`: `letter-spacing: .04em;` (em unit on status chip)
- `src/styles/project-page.css:124`: `letter-spacing: 0.04em;` (em unit)

---

## 4. Responsive Design Problems

### 4.1 Mobile & Tablet Typography Double-Shrink
- `src/styles/global.css:240, 245`:
  ```css
  @media(max-width: 991px) { html { font-size: 93.75%; } } /* 15px root */
  @media(max-width: 576px) { html { font-size: 87.5%; } }   /* 14px root */
  ```
- Combined with component-level overrides:
  - `src/styles/hero.css:262`: `.hero-title { font-size: 2.7rem; }` ($2.7 \times 14\text{px} = 37.8\text{px}$, whereas $2.7 \times 16\text{px} = 43.2\text{px}$).
  - `src/styles/about.css:204`: `.section-title { font-size: 2.3rem; }` ($2.3 \times 14\text{px} = 32.2\text{px}$).
  - `src/styles/contacts.css:539`: `.contact-info h3 { font-size: 1.6rem; }` ($1.6 \times 14\text{px} = 22.4\text{px}$).
  *Recommendation:* Rely on fluid viewport units via `clamp()` anchored to a stable `1rem = 16px` root, rather than throttling root font sizes and layering individual rem overrides.

### 4.2 Hero Layout on Small Devices
- `src/styles/hero.css:187`:
  ```css
  .hero-visual {
      animation: heroFloat 6s ease-in-out infinite;
  }
  ```
  `@keyframes heroFloat` is **never declared anywhere** in the codebase.
- `src/styles/hero.css:66`: `.hero-subtitle` has a hardcoded `min-height: 60px;` (and `min-height: 48px;` at `<=576px`) to accommodate `react-type-animation`. If screen sizes drop below 380px, multi-line wrapping causes content shifts below the subtitle.
- `src/styles/hero.css:278`: `.hero-buttons { width: 100%; flex-direction: column; }` applies only at `<=576px`. Between 577px and 768px, two large action buttons can awkwardly wrap or squish against each other when centered.

### 4.3 Footer Asymmetric Mobile Padding & Misalignment
- `src/styles/footer.css:281-285`:
  ```css
  @media(max-width: 576px) {
      .footer-quote {
          text-align: center;
          padding: 0 3rem 0 0;
      }
  }
  ```
  *Impact:* Text is centered, but given `3rem` right padding with `0` left padding, visibly skewing the quote off-center.
- In addition, on desktop `.footer-quote` has `border-left: 3px solid var(--primary);`. On mobile, this left border remains active while text is centered, creating an awkward floating border.

---

## 5. Visual Consistency Issues

### 5.1 Button Styling Fragmentation
The codebase contains four distinct button design languages:
1. **Pill Buttons (`border-radius: 999px` / `var(--radius-full)`):**
   - `.resume-btn` (`src/styles/navbar.css:122`)
   - `.github-profile-btn` (`src/styles/github.css:442`)
   - `.contact-form button` (`src/styles/contacts.css:460`)
   - `.project-overlay-btn` (`src/styles/projects.css:160`)
2. **Squircle Buttons (`border-radius: 12px`):**
   - `.btn` (`src/styles/button.css:13`) used in Hero and Projects.
3. **Rounded Rectangles (`border-radius: var(--radius-sm)` / 10px):**
   - `.certificate-card a` (`src/styles/certifications.css:192`)
   - `.blog-card a` (`src/styles/blogs.css:198`)
   - `.blog-coming-btn` (`src/styles/blogs.css:290`)
4. **Circle Controls (`border-radius: 50%`):**
   - `.theme-toggle` (`navbar.css:96`)
   - `.project-modal-close` (`projects.css:300`)
   - `.back-top` (`footer.css:226`)

*Impact:* A visitor sees squircle buttons in the hero, pill buttons in the navbar, rounded rectangle buttons in certifications/blog, and pill buttons in the contact form.

### 5.2 Card Border Radius Inconsistency
- `src/styles/about.css:136`: `.about-card { border-radius: var(--radius); }` (16px)
- `src/styles/skills.css:48`: `.skill-card { border-radius: var(--radius-lg); }` (24px)
- `src/styles/projects.css:44`: `.project-card { border-radius: var(--radius-lg); }` (24px)
- `src/styles/github.css:158, 280`: `.github-profile`, `.github-card { border-radius: var(--radius-lg); }` (24px)
- `src/styles/certifications.css:46`: `.certificate-card { border-radius: var(--radius-lg); }` (24px)
- `src/styles/blogs.css:46`: `.blog-card { border-radius: var(--radius-lg); }` (24px)
- `src/styles/contacts.css:322`: `.contact-form { border-radius: var(--radius-lg); }` (24px)

*Impact:* `.about-card` is visibly sharper (16px) than all other cards across the site (24px).

### 5.3 Card Icon Container Inconsistencies
- `.about-icon` (`about.css:161`): `width: 54px; height: 54px; border-radius: 14px;` (hardcoded 14px)
- `.skill-category-icon` (`skills.css:88`): `width: 50px; height: 50px; border-radius: var(--radius);` (16px)
- `.certificate-icon` (`certifications.css:108`): `width: 60px; height: 60px; border-radius: 18px;` (hardcoded 18px)
- `.contact-icon` (`contacts.css:248`): `width: 50px; height: 50px; border-radius: 15px;` (hardcoded 15px)
- `.footer-icons a` (`footer.css:168`): `width: 45px; height: 45px; border-radius: 12px;` (hardcoded 12px)

### 5.4 Hardcoded Non-Token Colors & Shadows
- `src/styles/navbar.css:124, 185`: `color: #fff;` and `color: #fff !important;` instead of `var(--on-primary)`.
- `src/styles/navbar.css:151`: `.menu-btn:hover { background: rgba(128, 128, 128, 0.1); }` instead of `var(--hover-overlay)`.
- `src/styles/certifications.css:194`: `color: white;` instead of `var(--on-primary)`.
- `src/styles/blogs.css:200`: `color: white;` instead of `var(--on-primary)`.
- `src/styles/contacts.css:462`: `color: white;` instead of `var(--on-primary)`.
- `src/styles/footer.css:207`: `.heart-icon { color: #ef4444; }` instead of `var(--danger)`.
- `src/styles/hero.css:197`: `.hero-image-frame { background: linear-gradient(135deg, var(--primary), #8b5cf6); }` (`#8b5cf6` is a non-token violet).
- `src/styles/contacts.css:424`: `.contact-form input:focus { box-shadow: 0 0 0 4px rgba(37,99,235,.12); }` instead of using `--focus-ring`.

### 5.5 Inverted Skill Category Color Override
- `src/styles/skills.css:185-207`:
  ```css
  .skill-item:nth-child(1) .skill-icon { color:#61DAFB; } /* React Cyan */
  .skill-item:nth-child(2) .skill-icon { color:#F7DF1E; } /* JS Yellow */
  .skill-item:nth-child(3) .skill-icon { color:#E34F26; } /* HTML Orange */
  .skill-item:nth-child(4) .skill-icon { color:#7952B3; } /* Bootstrap Purple */
  ```
  This arbitrary `nth-child` targeting overrides brand colors across every category card, forcing unrelated technologies (e.g., Python, MongoDB, PyTorch) into front-end web colors.

---

## 6. Performance Implications

1. **Font Render Blocking:**
   - Loading `Inter` via `@import url(...)` in `global.css` incurs 2 extra round-trips (CSS download -> Google Fonts CSS fetch -> Font WOFF2 fetch).
   - Moving the font declaration to `<link rel="preload">` and `<link rel="preconnect">` in `index.html` (or self-hosting modern WOFF2 variable subsets) will improve First Contentful Paint (FCP) and Largest Contentful Paint (LCP) by ~120-250ms on mobile connections.
2. **Dropping Weight 300:**
   - Reducing requested weights from `300;400;500;600;700;800` to `400;500;600;700;800` saves an unnecessary font file download on browsers that do not receive variable font payloads.
3. **Dead Keyframe Animation:**
   - Removing the orphaned `animation: heroFloat` reference in `hero.css` avoids continuous browser animation composite tracking on a non-existent keyframe.
4. **CSS Deduplication:**
   - Consolidating `bootstrap-grid-utilities.css` and removing duplicate `@import` statements in `index.css` streamlines bundle parsing.

---

## 7. Prioritized Recommendations

### Priority 0 (P0) — Critical Typography & Polish Fixes
- **P0.1: Optimize Font Loading Strategy:**
  - Remove `@import url("https://fonts.googleapis.com/...")` from `src/styles/global.css`.
  - Add `<link rel="preconnect" href="https://fonts.googleapis.com">` and `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` to `index.html`.
  - Remove unused weight `300` from the font request query (`wght@400;500;600;700;800`).
  - Add appropriate font loading in `admin.html` and project pages to eliminate fallback rendering.
- **P0.2: Fix Body Text Readability & Contrast:**
  - Update `global.css:108` and component body rules to use `color: var(--text-secondary);` rather than `var(--muted)`. Reserve `var(--muted)` for dates, captions, and secondary tags.
- **P0.3: Unify Section Headers & Typography Hierarchy:**
  - Move `.section-header`, `.section-tag`, `.section-title`, `.section-description` out of `about.css` and into `global.css` (or a dedicated `section-header.css`) so all sections share a single authoritative styling source.
  - Refactor `GithubStats.jsx` to use the shared `<SectionTitle />` component instead of hand-crafted duplicate markup.
- **P0.4: Fix Arbitrary Skill Item Colors:**
  - Remove `src/styles/skills.css:185-207` (`.skill-item:nth-child(...)`). Let skill icons use the category's primary brand color or resolved icon registry tone.

### Priority 1 (P1) — Visual & Component Consistency
- **P1.1: Standardize Button Geometry & Radii:**
  - Align on a consistent button appearance across the application. If pill styling is preferred for a modern AI/Full-Stack feel, apply `var(--radius-full)` consistently across `.btn`, `.resume-btn`, `.github-profile-btn`, and `.contact-form button`. If squircle is preferred, apply `var(--radius-sm)` (10px or 12px) uniformly.
  - Replace all hardcoded button colors (`color: #fff`, `color: white`) with `color: var(--on-primary);`.
  - Replace raw rgba box shadows on buttons with `--glow-brand`, `--glow-brand-hover`, or `--shadow-primary`.
- **P1.2: Standardize Card Geometry & Icon Containers:**
  - Update `.about-card` in `about.css` to use `border-radius: var(--radius-lg);` (24px), matching all other cards on the site.
  - Standardize icon container dimensions and radii across About, Skills, Certifications, Contact, and Footer (e.g., standardizing on 50px width/height and `var(--radius)` / 16px radius).
- **P1.3: Eliminate Hardcoded Non-Token Colors:**
  - Replace `#8b5cf6` in `hero.css:197` with `var(--secondary)`.
  - Replace `#ef4444` in `footer.css:207` with `var(--danger)`.
  - Replace `rgba(128,128,128,0.1)` in `navbar.css:151` with `var(--hover-overlay)`.
  - Replace hardcoded blue box-shadow in `contacts.css:424` with `var(--focus-ring)`.

### Priority 2 (P2) — Responsive & Layout Refinements
- **P2.1: Clean Up Double-Scaling Mobile Typography:**
  - Establish a clean, responsive clamp scale in `variables.css` (e.g., using `--fs-display`, `--fs-section`, `--fs-lead`, `--fs-body`, `--fs-sm`) and consume it across section headers and card titles.
  - Remove the ad-hoc component-level mobile font size overrides that conflict with the root `87.5%` scale.
- **P2.2: Fix Mobile Footer Alignment:**
  - Correct `src/styles/footer.css:281-285` by removing the asymmetric `padding: 0 3rem 0 0;` and removing `border-left` on mobile when text is centered.
- **P2.3: Remove Dead CSS & Cleanup Conflicts:**
  - Remove dead `animation: heroFloat` from `src/styles/hero.css:187`.
  - Remove the redundant Reboot block from `src/styles/bootstrap-grid-utilities.css`.

---

## 8. Proposed Implementation Plan for U9

### Phase 1: Foundation & Typography Infrastructure
1. Move Google Fonts loading from `global.css` `@import` to optimized `<link rel="preconnect">` and `<link rel="stylesheet">` in `index.html` (with weights 400..800).
2. Establish and wire up standard typography tokens in `variables.css`:
   - `--fw-normal: 400; --fw-medium: 500; --fw-semibold: 600; --fw-bold: 700; --fw-extrabold: 800;`
   - `--lh-tight: 1.15; --lh-snug: 1.3; --lh-base: 1.6; --lh-relaxed: 1.75;`
   - `--tracking-tight: -0.02em; --tracking-normal: 0; --tracking-wide: 0.04em;`
3. Migrate `global.css:108` from `p { color: var(--muted); }` to `p { color: var(--text-secondary); }`.

### Phase 2: Component & Section Polish
1. Move `.section-header`, `.section-tag`, `.section-title`, `.section-description` to `global.css`.
2. Refactor `GithubStats.jsx` to use `<SectionTitle />`.
3. Standardize button radii and card radii (`var(--radius-lg)` across all cards).
4. Remove arbitrary skill icon colors in `skills.css`.
5. Replace hardcoded hex/rgba values with design tokens in `navbar.css`, `hero.css`, `certifications.css`, `blogs.css`, `contacts.css`, and `footer.css`.

### Phase 3: Responsive & Cleanup Verification
1. Fix mobile footer quote alignment and border.
2. Remove dead animation reference in `hero.css`.
3. Clean up the duplicate reset in `bootstrap-grid-utilities.css`.
4. Validate visual presentation across 375px, 768px, 1024px, and 1440px viewports.

---

## 9. Files Likely to Change in U9

| Area | File Path | Scope of Planned Change |
|---|---|---|
| HTML Entry | `index.html` | Add preconnect & preload/stylesheet for Google Fonts; drop unused weight 300 |
| Admin HTML | `admin.html` | Add Inter font link so admin typography renders as designed |
| Global Tokens | `src/styles/variables.css` | Add font-weight, tracking, and line-height tokens; refine type scale |
| Global Base | `src/styles/global.css` | Remove CSS `@import`; update base paragraph color to `--text-secondary`; house shared `.section-*` classes |
| Grid Utilities | `src/styles/bootstrap-grid-utilities.css` | Remove redundant Reboot element reset |
| Buttons | `src/styles/button.css` | Unify button radius with design system convention; ensure tokenized colors |
| Navigation | `src/styles/navbar.css` | Replace hardcoded `#fff` and gray rgba with tokens |
| Hero | `src/styles/hero.css` | Remove dead animation; replace `#8b5cf6` with `var(--secondary)` |
| About | `src/styles/about.css` | Standardize card radius to `var(--radius-lg)`; move general section header styles to global |
| Skills | `src/styles/skills.css` | Remove arbitrary `nth-child(1..4)` color overrides |
| Projects | `src/styles/projects.css` | Adopt typography tokens for titles/descriptions; standardize modal metric typography |
| GitHub | `src/styles/github.css` | Tokenize button colors and shadows |
| Certifications | `src/styles/certifications.css` | Standardize button radius and tokenized text colors |
| Blog | `src/styles/blogs.css` | Standardize button radius and tokenized text colors |
| Contact | `src/styles/contacts.css` | Tokenize submit button and focus ring shadows |
| Footer | `src/styles/footer.css` | Fix mobile quote padding/border; replace `#ef4444` with `var(--danger)` |
| GitHub Section | `src/components/sections/GithubStats.jsx` | Use `<SectionTitle />` component |

---

## 10. Risks and Regression Tests Required

### 10.1 Identified Risks
1. **SEO Baseline Parity (`tests/seo-parity.test.mjs`):**
   `index.html` changes (such as adding font preconnect links in `<head>`) must not modify any existing metadata tags (`<title>`, `<meta data-rh="true">`, `<link rel="canonical">`, `<script type="application/ld+json">`).
2. **Visual Parity Gate (`scripts/verify-parity.mjs`):**
   The repository includes automated baseline parity checks. Modifying markup or class names on public sections can trigger parity warnings that require review.
3. **Accessibility (Lighthouse / axe-core):**
   Color adjustments (especially text contrast) must strictly meet WCAG AA standards (4.5:1 for normal text, 3:1 for large text) across **both** dark and light themes.

### 10.2 Regression Tests Required
- `npm run lint` — 0 errors, 0 warnings.
- `npm test` — all unit suites must pass (specifically `App.test.jsx`, `ChatAssistant.lifecycle.test.jsx`, `tests/seo-parity.test.mjs`, `tests/u8-regression.test.mjs`, `src/lib/theme.test.js`).
- `npm run assert:admin-bundle` — admin bundle isolation remains intact.
- `npm run build:spa` — production bundle builds without errors.
- Visual inspection across mobile (375px, 390px), tablet (768px), and desktop (1024px, 1440px) viewports in both dark and light modes.

