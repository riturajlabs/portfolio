# Design System

**Document Status:** Active
**Document Type:** Design System — **as implemented**
**Version:** 2.0 — rewritten from the verified codebase
**Last Verified Against Code:** commit `a6895e5` (`main`)

---

## Purpose

This document **records the design system that exists**. It is an inventory and
a set of conventions to follow when adding to it.

> **This is not a redesign proposal.**
> No token is changed, no component restyled, no stylesheet refactored as part of
> the content migration. `MIGRATION.md` Phase 7 acceptance criterion:
> `git diff --stat src/styles` **must be empty**.
>
> Any change to this system is a separate, explicitly approved task.

---

# 1. CURRENT — Inventory

## 1.1 Structure

16 hand-written CSS files under `src/styles/`, no CSS framework, no preprocessor,
no CSS-in-JS.

| File | Lines | Responsibility |
|---|---|---|
| `variables.css` | 129 | All design tokens (dark + light) |
| `global.css` | 332 | Font import, reset, base elements, typography, utilities |
| `button.css` | 116 | Button variants (imported by `global.css`) |
| `navbar.css` | 251 | Navigation, mobile menu, theme toggle |
| `hero.css` | 287 | Hero section |
| `about.css` | 198 | About section, info cards |
| `skills.css` | 134 | Skill categories and chips |
| `projects.css` | 384 | Project grid, cards, modal |
| `github.css` | 250 | GitHub stats and repo list |
| `certifications.css` | 145 | Certification cards |
| `blogs.css` | 155 | Blog cards |
| `contacts.css` | 335 | Contact form |
| `footer.css` | 290 | Footer |
| `chat.css` | 709 | AI chat widget |
| `project-page.css` | 235 | Prerendered project pages |
| `bootstrap-grid-utilities.css` | 119 | Grid and spacing utilities |

**Import order** — `main.jsx` imports `variables.css` then `global.css`;
`global.css` imports `button.css`. Component stylesheets are imported by their
components. No stylesheet imports another except those three.

**Convention.** One stylesheet per component. Class names are unprefixed
(`.hero-title`, not `.hero__title`). BEM-like, single-level.

## 1.2 Colour

Tailwind-palette values, defined as CSS custom properties in
`src/styles/variables.css`.

### Dark theme (default)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0F172A` | Page background |
| `--surface` | `#111827` | Elevated surface |
| `--card` | `#1E293B` | Card background |
| `--glass-bg` | rgba, translucent | Glassmorphism |
| `--glass-border` | rgba | Glass border |
| `--text` | `#F8FAFC` | Primary text |
| `--text-secondary` | `#CBD5E1` | Body text |
| `--muted` | `#94A3B8` | Tertiary text |
| `--primary` | `#2563EB` | Primary action |
| `--primary-dark` | `#1D4ED8` | Primary hover |
| `--secondary` | `#7C3AED` | Secondary accent |
| `--accent` | `#EC4899` | Tertiary accent |
| `--brand-gradient` | linear-gradient | Hero / brand treatments |
| `--success` | `#22C55E` | |
| `--warning` | `#F59E0B` | |
| `--danger` | `#EF4444` | Error |
| `--info` | `#06B6D4` | |
| `--border` | rgba | Default border |
| `--border-light` | rgba | Subtle border |

### Light theme

Overrides: `--bg #F8FAFC`, `--surface #FFFFFF`, `--card #FFFFFF`,
`--text #0F172A`, `--text-secondary #334155`, `--muted #64748B`,
`--border #E2E8F0`, `--border-light #CBD5E1`.

**Primary/secondary/accent and semantic colours are shared between themes.**

**Rule:** every colour in a component must come from a token. A literal hex in a
component stylesheet is a defect — it will not respond to a theme switch.

## 1.3 Typography

| Property | Value | Source |
|---|---|---|
| Family | `Inter`, sans-serif | `global.css:4` |
| Weights | 300, 400, 500, 600, 700, 800 | Google Fonts `css2` import |
| Base size | `1rem` | `global.css:70` |
| `h1` | `2.5rem` | `global.css:96` |
| `h2` | `2rem` | `global.css:97` |
| `h3` | `1.75rem` | `global.css:98` |
| `h4` | `1.5rem` | |
| `h5` | `1.25rem` | |
| `h6` | `1rem` | |

**Fluid scaling** via media queries on the root: `html { font-size: 93.75% }`
below 1200 px, `87.5%` below 768 px (`global.css:240,245`). Heading sizes scale
with the root.

**Rule:** never hardcode a font size. Set it relative to the root and let the
media queries handle responsiveness.

## 1.4 Spacing

**No spacing scale token exists.** Components use `rem` values directly:
`4rem`, `2.5rem`, `1rem`, `0.6rem`, `0.5rem` (`hero.css:16,114,43,95`).

**Convention:** rem values, `0.5rem` increments for tight spacing, `1rem`
increments for layout gaps, `2.5rem`–`4rem` for section separation.

**Rule:** never `px` for spacing. `px` is acceptable only for `border-width` and
`max-width` on fixed-format elements.

## 1.5 Radii

| Token | Value |
|---|---|
| `--radius-sm` | `10px` |
| `--radius` | `16px` |
| `--radius-lg` | `24px` |
| `--radius-xl` | `32px` |
| `--radius-full` | `999px` |

Cards use `--radius-lg`; buttons and chips use `--radius-full`.

## 1.6 Shadows

| Token | Use |
|---|---|
| `--shadow` | Cards at rest |
| `--shadow-lg` | Hover |
| `--shadow-xl` | Modals |
| `--shadow-primary` | Primary-coloured glow (hero CTA) |

Both themes define all four.

## 1.7 Motion

| Token | Value |
|---|---|
| `--transition-fast` | `.2s ease` |
| `--transition` | `.3s ease` |
| `--transition-slow` | `.45s ease` |

**Additionally:** `framer-motion` drives scroll reveals, card hovers, the mobile
menu, modal transitions and the chat widget.

**Rule:** `prefers-reduced-motion: reduce` must disable transforms and
transitions. It is already honoured in the components — every new animation must
honour it too.

## 1.8 Layout

| Token | Value | Use |
|---|---|---|
| `--container-width` | `1200px` | Content max width |
| `--z-navbar` | `1000` | |
| `--z-dropdown` | `1100` | |
| `--z-modal` | `1200` | |

Grid and spacing helpers live in `bootstrap-grid-utilities.css`.

## 1.9 Theming

| Aspect | Implementation |
|---|---|
| Provider | `src/context/ThemeContext.jsx` |
| Hook | `src/hooks/useTheme.js` |
| Toggle | `ThemeToggle` in the navbar |
| Persistence | `localStorage` |
| Initial value | `prefers-color-scheme` when no stored value |
| Applied via | a class or `data-` attribute on a root element, which selects the token block |

**Rules**

* Never hardcode a theme check in a component — always `useTheme()`.
* A new colour used in both themes needs entries in **both** token blocks.
* The toggle must be reachable by keyboard and announce its state via `aria-pressed`.

## 1.10 Icons

Two systems, both in use:

| System | Used for | Source |
|---|---|---|
| `react-icons` | Skills, social links, about cards | `react-icons` |
| Emoji | Certifications | `certificates.js` — `🌐`, `🐍`, `🤖` |

**The mismatch is real and intentional for now.** Emoji on certification cards,
`react-icons` elsewhere. Consolidating would change the visual output, so it is
out of scope for the migration (`PRODUCT_REQUIREMENTS.md` §8).

**For the admin UI, icons are stored as `icon_key` strings** and mapped through a
fixed frontend registry (`ARCHITECTURE.md` ADR-008). An unknown key must fail
loudly, never render blank.

---

# 2. TARGET — Design Constraints

The migration must preserve the design exactly.

| ID | Constraint | Verified by |
|---|---|---|
| **D1** | `src/styles/**` receives **zero** changes | `git diff --stat src/styles` empty |
| **D2** | No new token, no removed token, no changed value | `git diff` empty |
| **D3** | No component renders different markup | Baseline DOM diff |
| **D4** | No new colour outside the token system | Code review |
| **D5** | Rendered homepage text is identical | Baseline diff |
| **D6** | Lighthouse Accessibility does not regress | Lighthouse |
| **D7** | `prefers-reduced-motion` continues to work | Playwright |

**D1 is mechanical and enforceable.** If a migration PR shows a non-empty
`git diff --stat src/styles`, the migration has done something it promised not to
do.

---

# 3. Conventions When Extending

Applies to the admin UI and to any future public addition. Existing code is the
reference, not this document.

| Concern | Convention |
|---|---|
| Colour | Always a token. Never a literal hex |
| Dark and light | A colour used publicly needs both token blocks |
| Font size | Relative; never `px` |
| Spacing | `rem`, `0.5rem` increments |
| Radius | A `--radius-*` token |
| Shadow | A `--shadow-*` token |
| Transition | A `--transition-*` token |
| Animation | `framer-motion`; honour `prefers-reduced-motion` |
| Class naming | Lowercase, hyphenated, single-level: `.project-card` |
| Layout width | `--container-width` |
| z-index | Add a `--z-*` token; never a bare `z-index: 99999` |
| Accessibility | Semantic HTML; `aria-label` on icon-only controls; visible focus |
| Icons | `react-icons`, or emoji where emoji is already used |
| Theming | `useTheme()`, never a direct `localStorage` read |
| Mobile | Test at 375 px; no horizontal scroll |

---

# 4. Admin UI — Design Boundary

The admin dashboard is a **separate application surface**, not an extension of
the public design system.

| Rule | Rationale |
|---|---|
| Separate Vite entry and bundle | The public bundle must not grow (ADR-010) |
| Admin styles live under `src/admin/`, never in `src/styles/` | **D1** — zero changes to public styles |
| The admin entry must not import any `src/styles/*.css` | Prevents a public stylesheet from being pulled into the admin bundle |
| The admin entry may use the token *values* via its own local file | Reuse is fine; coupling is not |
| The admin entry must not import any public component | An admin bug must not be able to affect the public site |
| Dense tables and forms, not marketing sections | Different job: operating a CMS |
| Dark and light both supported | Consistency of expectation |
| `prefers-reduced-motion` honoured | Same rule as the public site |

**Practical consequence.** The admin UI will look related to the public site in
spirit — same accent colour, same Inter — without sharing a stylesheet. Sharing
the file would make `src/styles/variables.css` a dependency of both entries and
turn any public token change into an admin regression.

---

# 5. Accessibility Baseline

Already implemented. Must not regress.

| Concern | Current implementation |
|---|---|
| Skip-to-content | Navbar provides a skip link |
| Landmarks | `<header>`, `<main>`, `<footer>`, `<section id>` per section |
| Section labelling | Every section has an `id` used by nav anchors and `aria-labelledby` |
| Focus | Visible focus styles in `global.css` |
| Colour contrast | Dark and light palettes meet AA for body text |
| Form labels | Every input has a `<label>` |
| Honeypot | `contact-website` is visually hidden and `aria-hidden` |
| Icons | `react-icons` and emoji are decorative here — wrapped so they are not announced |
| Modals | Focus trap + Escape to close |
| Mobile menu | `aria-expanded`, `aria-controls` |
| Reduced motion | Honoured by `global.css` and framer-motion |
| Touch targets | ≥ 44 px on mobile |

**Verification (TARGET):** `@axe-core/playwright` in the E2E suite, plus the
manual keyboard pass in `TESTING.md` §12.2. The admin UI must meet the same bar —
an inaccessible CMS is an unusable CMS for its single user.

---

# 6. Rejected Redesign Proposals

Listed so they are not re-proposed inside the migration.

| Proposal | Rejected because |
|---|---|
| Migrate to Tailwind | The system works. A rewrite changes every rendered pixel and would violate D1–D3 |
| Redesign the layout | No requirement asks for it |
| Replace Inter | No accessibility or performance benefit |
| Add a spacing scale | Touching `variables.css` for every component violates D1 |
| Consolidate emoji and `react-icons` | Changes visual output |
| Introduce dark/light/auto plus more themes | Two themes are supported; more is unrequested scope |
| Add micro-interactions | Increases bundle and Lighthouse risk for no requirement |
| Rebuild the chat widget design | Not part of a content migration |
| Standardize all class names to BEM | Mechanical churn across 16 files, zero user-visible benefit |
| Make the admin UI share `src/styles/` | Violates D1 and couples two entries |

---

# 7. Design Change Policy

Any change to this system requires:

1. A written requirement in `PRODUCT_REQUIREMENTS.md`.
2. A visual before/after record.
3. A Lighthouse Accessibility and Performance comparison.
4. Confirmation that D1–D7 still hold, or an explicit decision that they no
   longer apply.
5. An updated `MIGRATION.md` if it touches a migration phase.

**A design change is never bundled into a data migration.** Bundling makes the
migration unrevertible and makes the diff unreviewable.

---

# END OF DESIGN SYSTEM