# Content Mapping — `src/data/*.js` → PostgreSQL

Phase 6 (`MIGRATION.md` §Phase 6). This document is the source-to-database
mapping required by the phase: every field of every `src/data/*.js` module (plus
the `About.jsx` constants and `src/config/seo.js`) classified as **MAPPED**,
**DERIVED**, **TRANSFORMED**, **EXCLUDED** or **OMITTED**, with the authority for
each decision.

**Read order used when writing this document:** the actual backend
implementation (`app/schemas/*`, `app/services/content.py`,
`app/models/*`, `alembic/versions/0001_initial.py`) first, then `DATABASE.md`
§5/§11/§14, `API.md` §5.1, `MIGRATION.md` §Phase 6. Where docs and code
disagreed, the code won and the disagreement is recorded in §9.

**Classification vocabulary**

| Class | Meaning |
|---|---|
| MAPPED | Source field → a real column, key preserved or renamed as shown |
| DERIVED | No source field and no column; computed deterministically at a documented step |
| TRANSFORMED | Source value changes representation on the way in (documented rule) |
| EXCLUDED | Source field exists but has no consumer — deliberately not migrated |
| OMITTED | Source field has content but **no column exists** — migration of that field stops here and is reported |
| DEFERRED | Belongs to a later phase; stays in `src/data` untouched |

---

## 1. Source inventory

| Source | Role in migration |
|---|---|
| `src/data/profile.js` | → `site_profile` columns (partially) |
| `src/data/projects.js` | → `project` (5 rows) |
| `src/data/skills.js` | → `skill_category` (4) + `skill` (16) |
| `src/data/certificates.js` | → `certification` (3) |
| `src/components/sections/About.jsx` constants | → `site_profile.about` jsonb (the only place they exist) |
| `src/config/seo.js` | → `site_profile.seo` jsonb (split rules, §5 below) |
| `src/data/socials.js` | **not migrated** — derived presentation module |
| `src/data/blogs.js` | **not migrated** — no `blog_post` entity (`DATABASE.md` §9) |
| `src/lib/projectPages.js` `PROJECT_IMAGE_DIMENSIONS` | cross-check input, not content |
| `knowledge_base.json` | **never read by any seed step** (§8) |

## 2. `profile.js` → `site_profile`

### 2.1 MAPPED (direct)

| Source | Column | Notes |
|---|---|---|
| `name` | `name` | |
| `title` | `title` | |
| `greeting` | `greeting` | |
| `roles` | `roles` `text[]` | order preserved |
| `availableForInternship` | `available_for_internship` | camelCase → snake_case, admin contract |
| `internshipText` | `internship_text` | |
| `description` | `description` | hero paragraph |
| `location` | `location` | |
| `resume` | `resume` | extractor asserts `=== "/Ritu_Raj_Full_Stack_Developer_Resume.pdf"` and that `public/` contains the file |
| `stats[] {label,value}` | `stats` jsonb | pass-through, same shape as payload `Stat` |
| `social {github,linkedin,email}` | `social` jsonb | exactly the payload `Social` shape |

### 2.2 EXCLUDED (dead data, `API.md` §5.1.3)

| Source | Why not migrated |
|---|---|
| `profile.seo` | Dead: `grep -rn "profile\.seo" src/ scripts/` has no consumer. The `site_profile.seo` column is filled from `src/config/seo.js` instead (§5). The extractor asserts the emitted profile contains **no** `seo` key so it cannot silently return. |
| `profile.techStack` | Dead: every `techStack` consumer reads `project.techStack`. Same assertion. |
| `profile.profileImage` | Vite asset import resolved by the bundler (`Hero.jsx:145`); there is no string to store. Stays a code import. No column exists (`DATABASE.md` §5.1.1). |

### 2.3 Not a source field

`education` — no entity, no UI beyond the About "Education" card, which migrates
as an ordinary `about.cards[]` entry (§4). No `education` table may exist
(`DATABASE.md` §1.3, forbidden-table test).

## 3. `projects.js` → `project` (5 rows)

Natural key: `slug` (unique, immutable once published).

| Source | Column | Class |
|---|---|---|
| `slug` | `slug` | MAPPED — validated `^[a-z0-9]+(?:-[a-z0-9]+)*$`, ≤80 (`admin_content.validate_slug` + DB CHECKs) |
| `title` | `title` | MAPPED |
| `description` | `short_description` | MAPPED, **key renamed** (payload key stays `description`, `DATABASE.md` §11.2) |
| `highlights[]` | `long_description` | **DERIVED encoding** — stored as `"- bullet"` lines joined with `\n`; the payload has no column for bullets (`§11.3`), so `services/content.py::_highlights()` re-derives them on read. Round-trip is exact: derive(store(x)) == x. Nothing else goes into `long_description` (no long prose exists in the source). |
| *(no source)* | `long_description` payload key `longDescription` | see above; `ProjectPage.jsx`/`ProjectCard.jsx` render only `highlights`, never `longDescription` |
| `image` | `image` | MAPPED — must equal `/images/projects/<slug>.webp` (DB CHECK + build contract) |
| *(WebP header)* | `image_width`, `image_height` | **read from the real file headers** in `scripts/extract-content.mjs`, then **cross-checked against `PROJECT_IMAGE_DIMENSIONS`** — mismatch fails the extract (acceptance). Never copied from the constants map. |
| `imageAlt` | `image_alt` | MAPPED |
| `category` | `category` | MAPPED |
| `techStack[]` | `tech_stack` `text[]` | MAPPED, order preserved |
| `featured` | `featured` | MAPPED |
| `indexable` | `indexable` | MAPPED |
| `live` | `live_url` | MAPPED, key renamed |
| `github` | `github_url` | MAPPED, key renamed |
| `seoTitle` | `seo_title` | MAPPED, ≤70 (DB CHECK) |
| `seoDescription` | `seo_description` | MAPPED, ≤185 (DB CHECK) |
| *(array position)* | `display_order` | DERIVED — 0..4 in source order |
| *(no source)* | `status` | DERIVED — always `published` (all 5 are live today) |
| `id` | — | EXCLUDED — no public consumer, projects identified by slug (`API.md` §5.1.3) |
| `publishedAt` | — | EXCLUDED — `null` in all 5 rows, no consumer anywhere |
| `updatedAt` | — | **DEFERRED** — `null` in all 5 rows today; consumed only by `scripts/seo/discovery.mjs` for sitemap `lastmod`, which reads `src/data/projects.js` directly (the public build is unchanged in Phase 6). No column and no payload key exist. With every value `null` no data is lost; Phase 7 must resolve the build's `updatedAt` read when discovery switches to the API. |

## 4. `About.jsx` constants → `site_profile.about` jsonb

`About.jsx` is the only place this content exists (`DATABASE.md` §5.1.4). The
extractor loads the component through Vite's SSR module loader and walks the
element tree, so the values are exactly the strings React renders (JSX
whitespace collapsing included) — no regex against source text.

| Source | `about` key | Class |
|---|---|---|
| `<SectionTitle tag=...>` | `tag` | MAPPED |
| `<SectionTitle title=...>` | `title` | MAPPED |
| `<SectionTitle description=...>` | `description` | MAPPED |
| `<h3>My Journey</h3>` | `heading` | MAPPED |
| the two `<p>` blocks (`:75-88`) | `paragraphs[0..1]` | MAPPED (JSX text nodes, order preserved) |
| `aboutCards[] {icon,title,description}` (`:14-39`) | `cards[] {icon_key,title,description}` | MAPPED with `icon` → `icon_key` (component reference cannot serialise — ADR-008) |

Count assertions (acceptance): exactly **6 text fields** (tag, title,
description, heading + 2 paragraphs) and **4 cards**.

## 5. `src/config/seo.js` → `site_profile.seo` jsonb

Split per `DATABASE.md` §5.1.3: the person's values → DB; the domain's values →
stay in `seo.js`.

| `seo.js` key | Destination | Class |
|---|---|---|
| `siteName`, `title`, `description`, `keywords`, `author`, `image`, `imageAlt`, `twitterCard`, `twitterSite`, `locale`, `type` | `seo.*` jsonb keys (same names) | MAPPED |
| `person` (all sub-keys) | `seo.person` jsonb | MAPPED |
| `robots` (string `"index,follow,…"`) | `seo.robots` = `{"index": bool, "follow": bool}` | **TRANSFORMED** — the contract (`API.md` §5.1.2, `schemas/content.Robots`) is a two-boolean object; the extractor parses the directive string (`index`/`noindex`, `follow`/`nofollow` token presence). The extended directives (`max-image-preview` etc.) remain only in `seo.js`, where the static/Helmet meta tags read them. This resolves the "robots string vs object" conflict flagged in `API.md` §5.1.3a: one source string, two faithful projections. |
| `sameAs` | **not stored** — payload `seo.sameAs` is derived from `profile.social` at assembly (`services/content.py::_same_as`) | DERIVED (asserted equal to `seo.js sameAs` at extract time so the two cannot drift silently) |
| `url` | **not stored** | EXCLUDED — deployment property, stays in `seo.js` (§5.1.3) |
| `verification` | **not stored** | EXCLUDED — same |

Note: `src/data/profile.js` also has a `seo` block with different values — it is
dead (§2.2) and is **not** the source for this column.

## 6. `skills.js` → `skill_category` + `skill`

Natural keys: category `(name,)`, skill `(category_id, name)`.

| Source | Column | Class |
|---|---|---|
| `title` (category) | `skill_category.name` | MAPPED, ≤60 (schema) |
| `icon` (category) | `skill_category.icon_key` | MAPPED via registry (§7) |
| array position (category) | `skill_category.display_order` | DERIVED 0..3 |
| `name` (skill) | `skill.name` | MAPPED, ≤60 (DB CHECK) |
| `icon` (skill) | `skill.icon_key` | MAPPED via registry (§7) |
| array position (skill) | `skill.display_order` | DERIVED 0..3 within category |
| *(no source)* | `is_visible` | DERIVED — `true` (everything is visible today) |

Payload shape note: the API emits skills **flat with the category nested on each
skill** (`schemas/content.Skill`), matching how `Skills.jsx` groups them; the
extractor performs the flatten so the snapshot is payload-shaped.

## 7. Icon mapping rule

Icons are code, not data (ADR-008). The extractor never reads `icon.name` off a
guess: it imports `src/components/iconKeys.js` (pure data, the closed
vocabulary) plus `react-icons/fa` and `react-icons/si`, builds
`key → component`, and matches every source icon by **identity**
(`Object.is`). A component that is not in the registry aborts extraction — that
is the "invalid source icon → stop and report" rule as an executable check.

- About cards: `FaGraduationCap`, `FaCode`, `FaBrain`, `FaRocket`
- Categories: `FaReact`, `FaNodeJs`, `FaPython`, `FaDatabase`
- Skills: the 15 keys in `backend/app/registry.py::SKILL_ICON_KEYS`
- Union = the 18 keys of `ICON_KEYS` (backend/frontend parity test in
  `tests/test_admin_content.py` keeps them in sync)

## 8. Not migrated — and why

| Item | Class | Authority |
|---|---|---|
| `certificates[].description` | **OMITTED — reported** | `certification` has no description column (`DATABASE.md` §5.5) and the public contract has no key (`schemas/content.Certification`). The source strings are real content rendered today by `Certifications.jsx:106`. **This specific field's migration stops here**: the 3 certification rows seed their mappable fields; the descriptions are reported as unmapped. Resolving it (new column, or dropping the sentence from the component when the site switches) is a decision for a later phase — no column is invented now. |
| `certificates[].credential` (URL) | MAPPED → `credential_url` | rename; `credential_id` and `issued_on` have no source → `NULL` |
| `certificates[].icon` | MAPPED → `icon` | emoji string, stored as-is |
| `blogs.js` (4 placeholders) | DEFERRED | no `blog_post` table/entity/route (`DATABASE.md` §9); "Coming Soon" placeholders, 0 rows seeded |
| `socials.js` | EXCLUDED | derived presentation module: URLs come from `profile.social` (already mapped); `label`/`icon` are component-level design, not content. The three URLs migrate inside `social` jsonb. |
| `profile.techStack`, `profile.seo` | EXCLUDED | dead data, §2.2 |
| `projects[].publishedAt` | EXCLUDED | null, no consumer |
| `projects[].updatedAt` | DEFERRED | null today; build-script consumer only, §3 |
| `knowledge_base.json` | NEVER READ | the extract/load/verify pipeline reads only `src/data/*.js`, `About.jsx`, `seo.js`, and the WebP files. Asserted by the no-CGPA/semester/graduation-year string scan in the extractor (acceptance: no such facts enter public content) |
| Operational tables (`contact_message`, `admin_user`, `admin_session`, `admin_audit_log`) | NEVER TOUCHED | `seed.py` imports only the five content models; a test asserts operational row counts are unchanged after a seed run |
| Forbidden tables (`project_technology`, `project_category`, `social_link`, `education`, `about_card`, `blog_post`, `redirect`, `media_asset`) | NEVER EXIST | existing `tests/conftest.py::FORBIDDEN_TABLES` assertion; the seed creates no tables |

## 9. Decisions on doc/code conflicts found during inspection

| Conflict | Resolution |
|---|---|
| `DATABASE.md` §14 revision table plans `0002_seed_reference` / `0003_seed_content` alembic **data** revisions; §14.1 and `MIGRATION.md` §Phase 6 specify `backend/db/seed.py` + `npm run seed:load` | **seed.py wins.** A snapshot-first, idempotent upsert tool cannot be an alembic revision (alembic data rows are one-shot inserts and would hardcode a second copy of the content). `0001_initial` itself says "There is no seed data here: content seeding is Phase 6". §14's table is corrected in the Phase 6 docs pass. |
| `API.md` §5.1.3a: "`seo.robots` stored as a string in `seo.js`, contract wants an object — Phase 6 must reconcile" | Reconciled as §5 TRANSFORMED: the string stays the single source in `seo.js`; the DB stores the contract's `{index, follow}` parsed from it. |
| `API.md` §5.1.3a: "`certificates.js` carries `credential` and `description` — Phase 6 must reconcile" | `credential` → `credential_url` (it is a URL, used as `href`). `description` → OMITTED, reported (§8); no column may be invented. |
| `API.md` §5.1.3 says `projects[].updated_at` has "no public consumer" while `scripts/seo/discovery.mjs` reads `updatedAt` from `src/data` | Not a payload key; a build-script read of the JS source that stays untouched through Phase 6. Recorded as DEFERRED (§3). |
| API sample payload shows `locale: "en_IN"`, `nationality: "Indian"`; sources hold `"en_US"` / `"India"` | Sources win — content is never rewritten to match an illustrative sample. |

## 10. Row counts (acceptance)

| Table | Rows | Natural key used for idempotent upsert |
|---|---|---|
| `site_profile` | 1 | `singleton` |
| `project` | 5 | `slug` |
| `skill_category` | 4 | `name` |
| `skill` | 16 | `(category_id, name)` |
| `certification` | 3 | `(title, issuer)` |
| `blog_post` | 0 | — (no table) |
| `education` / `social_link` / … | 0 | — (no table) |

Idempotency rule: a row is written **only if a field actually differs** from
what is stored; an unchanged rerun issues no `UPDATE`, so `created_at` /
`updated_at` stay byte-identical across runs (`MIGRATION.md` §Phase 6:
"running twice produces identical rows").

## 11. Pipeline

```bash
npm run seed:extract   # src/data/*.js + About.jsx + seo.js + real WebP headers
                       # → .cache/content-snapshot.json (deterministic bytes)
npm run seed:load      # cd backend && python -m db.seed
                       # validate ALL → single transaction → upsert → report
npm run seed:verify    # GET /api/content vs snapshot, field-by-field, exit 1 on diff
```

- **extract** fails loudly on: slug/URL/image pattern violations, missing image
  files, WebP header vs `PROJECT_IMAGE_DIMENSIONS` mismatch, icon not in
  registry, dead keys reappearing in output, count mismatches, resume value
  drift, `knowledge_base`-style fact strings (CGPA/semester/graduation year).
- **load** fails loudly on: pydantic validation errors (response models, which
  are the payload contract), `extra="forbid"` (a stray `certifications[].description`
  in the snapshot would be rejected here too), missing alembic head, unreachable
  database — always rolling back the whole transaction.
- **verify** fails loudly on any field difference in either direction
  (snapshot-only or API-only), including extra/missing entities.
