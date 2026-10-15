# Testing Strategy

**Document Status:** Active — **Phase 8 suite verified 2026-10-06 (§3.1, §3.2, §5, §7.1, §7.5, §10): 395 backend tests (22 new in Phase 8: contact API + GitHub proxy) plus 63 vitest tests including the extract/compare script tests and the content-loader cutover suite.**
**Document Type:** Quality and Verification Strategy
**Version:** 2.5 — Phase 8 contact/GitHub write path tests added and verified (395 backend + 63 vitest tests)
**Last Verified Against Code:** uncommitted working tree (`backend/tests/`, `scripts/*.test.mjs`)

---

## Reading Convention

| Label | Meaning |
|---|---|
| **CURRENT** | Exists today. |
| **TARGET** | Required before the migration phase that needs it. |
| **MIGRATION** | When the test is added. |

---

# 1. CURRENT Test Coverage

```text
There are no automated tests.
```

Verified exhaustively:

| Checked | Result |
|---|---|
| `tests/`, `__tests__/`, `e2e/`, `spec/` | Do not exist |
| `*.test.*` / `*.spec.*` files | Zero |
| `jest.config.*`, `vitest.config.*`, `playwright.config.*` | Do not exist |
| `test` script in `package.json` | **Absent** |
| `.github/workflows/` | **Does not exist** |
| Test runner in `devDependencies` | **None** |
| Python test deps in `ai_service/requirements.txt` | **None** |

**What exists instead — and it is genuinely valuable:**

| Existing check | What it protects | Where |
|---|---|---|
| `npm run lint` | Code quality, unused vars, hook rules, `prop-types` correctness | `eslint.config.js` |
| `npm run build` | Compile + prerender + generate all 5 project pages + 4 discovery files | `package.json` |
| Project-page schema + image assertions | Project data validity, real WebP dimensions | `scripts/generate-project-pages.mjs` |
| Discovery-file assertions | Sitemap / robots / `llms.txt` consistency | `scripts/generate-seo-discovery.mjs` |
| `pnpm lint` / `lint:ai_service` | Python service linting | `ai_service` |

**The honest position:** the build pipeline *is* the test suite for content
integrity. It has already caught real problems — for example, a hardcoded
`PROJECT_IMAGE_DIMENSIONS` map that throws for an unknown slug, and a
`generate-project-pages.mjs` requirement that `image === /images/projects/<slug>.webp`.

**Any prior claim of a test suite, coverage percentage, CI pipeline or passing
test count was incorrect.**

---

# 2. What Must Be Tested — and Why

The migration's primary risk is **not** new features. It is that a change to the
data layer silently alters five indexable URLs, the sitemap, the JSON-LD, or the
rendered homepage. Every test below exists to protect one of those.

| Risk | Test type | Priority |
|---|---|---|
| Build output loses a project page | Build assertion | **P0** |
| Discovery files drift | Build assertion | **P0** |
| Public API shape changes | Contract snapshot | **P0** |
| DB seed differs from the JS source | Field-by-field diff | **P0** |
| Admin route unprotected | Route-iteration auth test | **P0** |
| Admin session forgeable | API security test | **P0** |
| Frontend fails with the API down | Fallback test | **P1** |
| Contact message lost on Resend failure | API integration test | **P1** |
| Chat contract broken by the re-point | SSE comparison test | **P1** |
| Performance regression | Lighthouse budget | **P1** |
| Component regression | Component tests | **P2** |

---

# 3. TARGET — Test Stack

| Layer | Tool | Why this tool |
|---|---|---|
| Unit / component | **Vitest** + React Testing Library | Shares the Vite config; no second build pipeline |
| DOM environment | **jsdom** | Standard for React component tests |
| API / backend | **pytest** + `httpx.AsyncClient` + `pytest-asyncio` | Already a Python service; pytest is the default |
| Test database | **Real PostgreSQL** in Docker | SQLite would not enforce the same CHECKs, indexes, `jsonb` or `citext`. Testing against a different database validates nothing |
| End-to-end | **Playwright** (Chromium only to start) | Covers the one route, the admin app, and the forms |
| CI | **GitHub Actions** | Already implied by a Vercel deploy-from-`main` |
| Load | **`hey`** | One line; a full k6 setup is not warranted |

**New dependencies**

```jsonc
// devDependencies
"vitest": "^3", "@vitest/coverage-v8": "^3",
"@testing-library/react": "^16", "@testing-library/jest-dom": "^6",
"@testing-library/user-event": "^14", "jsdom": "^26",
"@playwright/test": "^1"
```

**Deliberately excluded:** Jest (a second bundler config), Cypress (heavier than
needed for 7 URLs), Enzyme (deprecated, does not support React 19), a coverage
gate on the admin UI, a load-testing platform, mutation testing.

## 3.1 Scripts

```jsonc
"test":                    "vitest run --exclude tests/migration-validation.test.mjs",
"test:watch":              "vitest --exclude tests/migration-validation.test.mjs",
"test:migration-validation":"vitest run tests/migration-validation.test.mjs",
"test:api":                "cd backend && TEST_DATABASE_URL=\"...\" python3 -m pytest -q",
"test:e2e":                "playwright test",
"test:e2e:ui":             "playwright test --ui",
"lint":                    "eslint .",
"lint:ai_service":         "cd ai_service && ruff check .",
"test:ai_service":         "cd ai_service && pytest -q",
// Seed pipeline — implemented in Phase 6 (all three exist in package.json):
"seed:extract":            "node scripts/extract-content.mjs",
"seed:load":               "cd backend && python -m db.seed",
"seed:verify":             "node scripts/compare-content.mjs",
```

The `test:api` script defaults `TEST_DATABASE_URL` to
`postgresql://$(whoami)@/portfolio_test?host=127.0.0.1` (TCP trust-peer); any
value of `TEST_DATABASE_URL` overrides it, which is how CI supplies the
service-container URL.

---

## 3.2 Backend Test Suite — IMPLEMENTED 2026-10-04

`backend/tests/` exists and runs against a **real PostgreSQL instance**. SQLite is
not an option: `citext`, `jsonb`, `text[]`, UUID defaults, CHECK constraints and
`ON DELETE CASCADE` either do not exist or behave differently there, so a passing
SQLite suite would prove nothing about the target database.

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

export TEST_DATABASE_URL="postgresql://user@localhost:5432/portfolio_test"
python -m pytest -q          # 445 tests
python -m ruff check .
```

`TEST_DATABASE_URL` alone is enough — the fixtures point application settings at
the test database before `app.main` is imported. `PGHOST`/`PGUSER`/`PGPASSWORD`/
`PGDATABASE` are used when `TEST_DATABASE_URL` is unset, which is how CI supplies
service-container credentials without a password in the repository. With neither,
collection fails with instructions. Nothing is skipped: an unconfigured database
is a failure, not a green run.

| File | Tests | Asserts |
|---|---|---|
| `test_database_schema.py` | 21 | Exactly 9 tables; no §15 table; every column/type/nullability; PKs are `gen_random_uuid()`; every named index; `citext` installed; 20 `timestamptz` columns; exactly 3 FKs with exact delete rules; no seeded rows |
| `test_constraints.py` | 94 | Every CHECK in `DATABASE.md` §13 with a **failing** case, plus one accepted case per enum and per default shape |
| `test_relationships.py` | 9 | Cascade on category delete, `SET NULL` on admin delete, and that a soft-hidden project is not deleted |
| `test_health.py` | 4 | `/health` returns 200 with the database unreachable; unknown route 404; no route listing in the body |
| `test_readiness.py` | 8 | 200 when head is applied; 503 when unreachable, unmigrated, stale, or missing tables |
| `test_content_api.py` | 45 | Key set, strict `extra="forbid"`, visibility filters, total ordering, `sameAs` and `highlights` derivation, `generated_at` semantics, ETag/304/Cache-Control, payload budget, 404/503/500 paths, read-only transaction enforcement |
| `test_payload_snapshot.py` | 2 | Whole payload matches the committed `.snap`; a seeded state is byte- and ETag-stable |
| `test_cors.py` | 28 | Default allow-list, parsing and normalisation, malformed-origin rejection at startup, wildcard refused in production **and** staging, allowed/denied/look-alike origins, preflight, credentials never enabled, `ETag` exposed, real app carries the middleware |
| `test_rate_limit.py` | 30 | 300/min boundary, per-client buckets, window rollover and anchor, `Retry-After` correctness, sweep, thread-safety under concurrency, `X-Forwarded-For` not trusted, 429 body/headers, `/health` + `/ready` never throttled |
| `test_client_ip.py` | 24 | Socket peer used unless `TRUSTED_PROXY_HEADER` is set; `CF-Connecting-IP` honoured only when declared; spoofed `X-Forwarded-For` never trusted; malformed/absent header falls back to the peer; comma/bracket/`IPv4:port` normalisation; a header the edge does not overwrite is refused at startup; admin-login and contact resolve through one canonical function; endpoint buckets per trusted header |
| `test_seed.py` | 13 | Snapshot validation rejects content with no column or no entity; counts 5/4/16/3/1 asserted through `GET /api/content`; three-run idempotency with byte-identical timestamps; whole-transaction rollback on a mid-seed CHECK failure; orphans reported, never deleted; operational tables untouched; stored dimensions vs real WebP headers; payload deep-equals snapshot; preflight refuses an unmigrated database |
| `test_contact_api.py` | 12 | Successful submit stores a row (`status='unread'`, `delivery_status='sent'`) and sends; derived-vs-provided subject; UA truncated; `source_ip_hash` carried; Resend failure → `502` with row kept `failed`; missing key → `502` config body; DB outage → `503` no row; honeypot → `200` no row no send; `422` for bad email/message/name/subject/extras; `429` + `Retry-After` after 5/min; limiter reset between tests |
| `test_github_api.py` | 10 | `{profile,repositories,cached}` shape; second call within 300 s is cached (no upstream); 502/429/403/404 upstream mappings; unknown user → `404 {"detail":"GitHub user not found."}` + `Cache-Control: no-store`; passthrough of GitHub's own error bodies; `GITHUB_TOKEN` sent as `Authorization: Bearer` only; auth header dropped for anonymous |
| `test_phase10_gaps.py` | 6 | Every mutating admin route from OpenAPI rejects a missing **and** a wrong CSRF token with 403 (login exempt, `API.md` §6.3); `PUT /skills` and `PUT /skill-categories` persist fields for the round-trip + audit trail; unknown uuid → 404 / `not-a-uuid` → 422 on admin reads; create-project round-trips `status` and `indexable` through `GET /api/content`; admin read budget accepts exactly 600 `/api/admin/me` calls then rejects the 601st with 429 + `Retry-After` while a mutation still succeeds |

**Test-database isolation.** The session fixture drops and recreates the `public`
schema, then builds it by running `alembic upgrade head` in a subprocess. Running
the real CLI means the documented commands are exercised on every run rather than
assumed — and `alembic/env.py` deliberately takes its URL from application
settings, which an in-process `alembic.command` call cannot supply. Two throwaway
databases, `portfolio_test_unmigrated` and `portfolio_test_pristine`, cover states
the main test database cannot hold: never-migrated, and freshly migrated with
nothing written to it. Every test truncates all 9 tables first, so test order
cannot affect the result.

**Constraint tests use raw SQL, not the models.** The claim under test is that the
*database* refuses a write. A Pydantic or ORM layer that rejected the value first
would leave the suite green while the CHECK was missing.

---

# 4. Phase 0 — Baseline Capture (do this before writing any code)

The migration is verified by **comparison against today**. Capture this first —
**before the post-Phase-7 code is ever built** (the baseline must be the
pre-migration output). It is already captured: `.cache/baseline/` exists
(2026-10-06).

```bash
npm ci
npm run build
node scripts/capture-baseline.mjs      # writes .cache/baseline/ (refuses to overwrite without --force)
```

`.cache/baseline/` must contain:

| File | Captured from |
|---|---|
| `home.html` | `dist/index.html` |
| `project-<slug>.html` × 5 | `dist/projects/<slug>/index.html` |
| `sitemap.xml`, `sitemap-images.xml`, `robots.txt`, `llms.txt` | `dist/` |
| `seo.json` | title/description/canonical/OG/Twitter per URL |
| `bundle-sizes.json` | gzipped sizes of each chunk |
| `content-api.json` | live `GET /api/content` payload (the build-time input) |

`content-api.json` makes `.cache/baseline/` self-contained: the Phase 7 build
reads the same endpoint, so parity is proven against the exact data that
produced the baseline. `.cache/` is gitignored; re-capture with `--force` when
a pre-cutover build is needed again.

**The baseline is the regression oracle.** Without it, "nothing broke" is an
opinion.

**`llms.txt` carries no generation timestamp** (the generator emits none), so
discovery comparison is byte-exact. In general, baseline comparisons normalise
**only** genuinely nondeterministic values — build timestamps and hashed asset
filenames (`main-<hash>.js` → `main-HASH.js`). See
`scripts/verify-parity.mjs`, which wraps the post-build check:

```bash
npm run build && node scripts/verify-parity.mjs   # Part of the §6 verification list
```

`verify-parity.mjs` compares `dist/` against `.cache/baseline/` byte-for-byte
(after asset-name normalisation) and reports `identical` / `assets-vary`
(allowed: bundler-owned hashed refs and chunk-graph juggling only) / `DIFFERS`
(must be classified — intentional, unintentional, or source-API-contract —
before shipping).

---

# 5. Unit Tests (TARGET)

## 5.1 `src/lib/projectPages.js` — highest value

This module is the single authority for project-page SEO. It is pure, so it is
cheap to test exhaustively.

| Test | Assertion |
|---|---|
| `getProjectUrl` | `/projects/<slug>/` for every slug |
| `getProjectUrl` with `baseUrl` | Absolute URL correctly composed |
| `indexableProjects` | Only `indexable: true` rows returned |
| `indexableProjects` | Order preserved |
| `indexableProjects` | Empty input → `[]`, not a throw |
| `relatedProjects` | Excludes the current slug |
| `relatedProjects` | Falls back to all projects when no related category exists |
| `applicationCategory` | Maps each current category correctly |
| `buildProjectMetadata` | `title` ≤ 70 chars, `description` ≤ 185 chars |
| `buildProjectMetadata` | Canonical exactly matches `getProjectUrl` |
| `buildProjectMetadata` | OG/Twitter image uses the project image + dimensions |
| `buildProjectStructuredData` | `@type === 'CreativeWork'` |
| `buildProjectStructuredData` | Valid JSON-LD, parseable |
| `buildProjectStructuredData` | `url` matches the canonical |
| `buildProjectStructuredData` | `dateModified` present and ISO-8601 |
| `PROJECT_IMAGE_DIMENSIONS` | Has an entry for **every** project slug |
| `PROJECT_IMAGE_DIMENSIONS` | Each entry matches the real WebP header bytes |

**The last two are the ones that protect production.** A new project without a
dimensions entry throws at build time.

## 5.2 Build scripts

| Test | Assertion |
|---|---|
| `discover.mjs` builds | Valid XML/TXT for 0, 1 and 5 projects |
| `discover.mjs` with 0 projects | Throws (an empty sitemap is a silent SEO catastrophe) |
| `discover.mjs` with a duplicate slug | Throws |
| `discover.mjs` with a missing SEO title | Throws |
| `compare-content.mjs` | Reports zero differences for the seed snapshot | **done 2026-10-06** — `scripts/compare-content.test.mjs` + live `npm run seed:verify` (§10 check 20) |
| `compare-content.mjs` | Reports and exits non-zero on a seeded difference | **done 2026-10-06** — tampered field named in the table, exit 1; API down/missing entity → exit 2 |
| `extract-content.mjs` | Deterministic: two runs produce identical bytes | **done 2026-10-06** — `scripts/extract-content.test.mjs` writes two snapshots and compares them byte-for-byte |

## 5.3 Frontend utilities

| Module | Test |
|---|---|
| `emailService` | Payload shape sent to `/api/contact` |
| `emailService` | Uses `${VITE_BACKEND_URL}/api/contact` in dev and same-origin in production |
| `emailService` | `422` surfaces a readable message |
| `githubService` | Success shape maps correctly |
| `githubService` | Failure returns the **fallback**, not a throw |
| `useScrollSpy` | Correct section is active on scroll |

## 5.4 Content loader (`src/lib/content.js`) + build-time cutover

| Test | Assertion |
|---|---|
| `resolveContentUrl` | Defaults to the local dev backend; honours `CONTENT_API_URL`; ignores blank |
| `contentTimeoutSeconds` | Defaults to 10; parses the env; rejects non-numeric/non-positive |
| `fetchContent` success | Returns the validated payload; `GET` + `accept: application/json` + an abort signal |
| `fetchContent` HTTP 503/404 | Fails closed with `Content API build fetch failed: / GET <url> / HTTP <status> / <detail>` + the terminal sentence |
| `fetchContent` invalid JSON | Fails closed |
| `fetchContent` network error | Fails closed, original cause surfaced |
| `fetchContent` timeout | Fails closed via the bounded AbortController |
| `fetchContent` validation | 0 projects / missing profile → fails closed |
| `validateContent` | Accepts the committed snapshot reshaped to wire format |
| `validateContent` | Rejects unknown top-level key (`_migration` extra=forbid), missing key, 0 projects, non-positive dimension, bad status, malformed URL, duplicate slug, missing `profile.name`, bad `seo.robots`, bad `sameAs`, bad `generated_at` |
| No-fallback guards | `content.js`, `projectPages.js`, `publicContent.js`, `generated/content.js`, `build-content.mjs`, `prerender/entry.jsx` never import `src/data`; `content.js` reads only `CONTENT_API_URL`/`CONTENT_API_TIMEOUT`, never `DATABASE_URL`/`ADMIN_TOKEN`/`VITE_*` |

The "valid payload" fixture is the committed snapshot itself, so the suite also
fails if anyone hand-edits `src/generated/content.js` into a shape the API
schema would reject.

---

# 6. Component Tests (TARGET)

React Testing Library. **Query by role and accessible name, never by CSS class
or test id** — that way the tests also assert accessibility.

| Component | Assertions |
|---|---|
| `Hero` | Name, title, resume link href, social links |
| `Navbar` | All 7 anchors resolve to existing section ids |
| `Navbar` | Mobile menu opens/closes; `aria-expanded` correct |
| `Skills` | Renders every visible category with its skills |
| `Projects` | Renders every published project card |
| `Projects` | Each card links to `/projects/<slug>/` |
| `ProjectCard` | `propTypes` satisfied; image has `alt` |
| `Certifications` | All certifications render |
| `Blog` | All posts render; `readTime` displayed |
| `Contact` | All 5 fields; client-side validation; honeypot hidden from AT |
| `Footer` | Social links; resume link |
| `SEO` | Title/description applied via Helmet |
| `ContentContext` (new) | `loading` → `ready` → `error` transitions |
| `Projects` with API down | Falls back to the snapshot, renders content, logs one warning |

**Explicitly not unit-tested:** framer-motion animations, theme transitions.
Asserting animation internals produces brittle tests that break on any
refactor and catch nothing user-visible.

---

# 7. API Tests (§7.1 implemented; the rest remain TARGET)

**Rule: every endpoint in `API.md` §4.1 must have a row here. An untested
endpoint is not finished.**

Real PostgreSQL in Docker. No mocks of the database.

## 7.1 Public content — IMPLEMENTED 2026-10-04 (Phase 3)

Rows marked **done** are implemented in `backend/tests/test_content_api.py` and
`backend/tests/test_payload_snapshot.py`. Rows formerly marked **Phase 6** —
the real content counts — landed in `backend/tests/test_seed.py` (2026-10-06):
they seed the actual snapshot into the test database and assert through
`GET /api/content`.

| Test | Assertion | Status |
|---|---|---|
| `GET /api/content` 200 | Payload **key set exactly matches** `src/data/*.js` key sets | **done** — plus `extra="forbid"` on every model |
| `GET /api/content` | 5 published projects | **done (Phase 6)** — `test_seed_writes_expected_counts` |
| `GET /api/content` | 4 skill categories, 16 skills | **done (Phase 6)** — same test; categories derived from nested `skills[].category` |
| `GET /api/content` | 3 certifications, `profile.social` with 3 entries, `about` with 4 cards + 2 paragraphs | **done (Phase 6)** — same test; dead keys and `certifications[].description` asserted absent |
| `GET /api/content` | **No** `education`, `blog_posts` or `social_links` keys (`API.md` §5.1.3) | **done** |
| `GET /api/content` | `ETag` present; `Cache-Control` correct | **done** |
| `GET /api/content` with `If-None-Match` | `304`, empty body | **done** — bare tag, `*`, and weak `W/` forms |
| `GET /api/content` twice | Same `ETag` | **done** |
| Edit one project, refetch | `ETag` **changed** | **done** |
| **Snapshot test** | Serialized payload matches the committed `.snap` file | **done** — `backend/tests/snapshots/content_payload.json`, standard library only, no plugin dependency |
| Project with `status='hidden'` | Excluded from the response | **done** — filtered in SQL, so the row is never read |
| Project with `indexable=false` | **Still in the response** (it is a homepage project), but absent from the built sitemap | **done** for the API half; the sitemap half is Phase 8 build verification |
| `GET /api/content` | ≤ 60 KB gzipped | **done** — 1 365 B gzipped at 5 projects × 8 bullets |

**There are no `GET /api/projects` or `GET /api/projects/{slug}` tests** — those
endpoints were removed in Phase 1.5 (`API.md` §4.1). If a test references them, the
test is stale.

**The snapshot test is the single most important test in the migration.** A field
rename in a Pydantic model becomes a CI failure instead of a silently missing
`seoTitle` in production — which would fail the build generator anyway, but at
2 a.m. instead of at 2 p.m.

## 7.2 Admin authentication — IMPLEMENTED 2026-10-04 (Phase 4)

| Test | Assertion | Status |
|---|---|---|
| Login, valid credentials | 200 + `HttpOnly` + `Secure` + `SameSite=Strict` + `Path=/` | **done** |
| Login, wrong password | 401 | **done** |
| Login, unknown email | 401, **byte-identical body** | **done** |
| Login, disabled account | 401, **byte-identical body** | **done** |
| Login timing | Unknown-user and wrong-password responses within the same order of magnitude | **done** |
| Login, rate limit | 429 after 10 / 15 min per IP | **done** |
| Login, per-email lockout | 429 after 5 failures / 15 min | **done** |
| `GET /api/admin/me` with a valid session | 200 + user | **done** |
| `GET /api/admin/me` without a cookie | 401 | **done** |
| `GET /api/admin/me` with a tampered token | 401 | **done** |
| `GET /api/admin/me` with a revoked token | 401 **immediately** | **done** |
| `GET /api/admin/me` with an expired token | 401 | **done** |
| Logout | Session row `revoked_at` set; subsequent request 401 | **done** |
| Password storage | Column contains an Argon2id PHC string, never the plaintext | **done** |
| Token storage | Column contains a hash, never the raw token | **done** |

## 7.3 Authorization — IMPLEMENTED 2026-10-04 (Phase 4)

```python
# Iterate EVERY admin route. A single unprotected route is a breach.
for route in admin_routes:
    r = await client.request(route.method, route.path)
    assert r.status_code == 401, f"{route.method} {route.path} is unprotected"
```

| Test | Assertion |
|---|---|
| **All admin routes** | `401` without a session |
| Admin route with `X-API-Key` only | `401` — the shared key must not grant admin access |
| Mutation without `X-CSRF-Token` | `403` |
| Mutation with a wrong CSRF token | `403` |
| Mutation with a valid token | Succeeds |
| Admin cookie sent to `/api/chat` | **Not forwarded** |

**Verified by enumeration, not by a list someone maintains.** This is the
difference between "the admin is protected" and "every admin endpoint is
protected".

## 7.4 Admin CRUD

| Test | Assertion |
|---|---|
| Create project with valid data | 201 + persisted entity |
| Create project with an invalid slug | 422 |
| Create project with `image = /images/projects/../../etc/passwd` | 422 **and** rejected by the DB CHECK |
| Create project with `image_width = 0` | 422 |
| Create project with `image_width = -5` | 422 |
| Create project without `seoTitle` | 422 |
| Create project with an unknown field | 422 (`extra="forbid"`) |
| Create project with a duplicate slug | 409 |
| Update project, partial payload | Only supplied fields change |
| Update a **published** project's slug | `409 SLUG_IMMUTABLE` — no redirect, no URL change |
| Update a `hidden` project's slug | Allowed (it was never public) |
| Delete project | Soft: `status='hidden'` **and** `indexable=false`; row survives; gone from sitemap |
| Delete a skill whose category has other skills | Skill gone, category **survives** |
| Delete a skill category | Cascade deletes its skills; **the DELETE is refused if the category has skills unless `?cascade=true`** |
| Set `display_order` via ordinary `PUT` | Persisted; no reorder endpoint exists |
| Unknown `icon_key` | 422 |
| Concurrent edit with a stale `updated_at` | `409 STALE_WRITE` |
| Every mutation | An `admin_audit_log` row exists with the correct actor and entity, in the same transaction |
| Audit row contents | Never contains a password or a session token |

## 7.5 Contact and GitHub

| Test | Assertion |
|---|---|
| Valid submission | 200 + row `delivery_status='sent'` |
| Resend unavailable | `502` + **row exists** with `delivery_status='failed'` |
| Honeypot filled | 200 + **no row**, no send |
| Too long | 422 |
| Invalid email | 422 |
| Rate limit | 429 + `Retry-After` |
| Raw IP stored | **Not stored** — `source_ip_hash` is a hash, not an IP |
| `GET /api/github` | Same `{profile, repositories, cached}` shape as `ai_service` |
| `GET /api/github` upstream 403 | 429 |
| `GET /api/github` upstream 404 | 404 |
| `GET /api/github` network error | 502 |
| `GET /api/github` twice | Second call `cached: true` |

## 7.6 Operational

| Test | Assertion |
|---|---|
| `/health` | 200 with no database running |
| `/ready` no database | 503 |
| `/ready` unmigrated database | 503 |
| `/ready` healthy | 200 |
| Unknown route | 404, no route listing |
| Malformed JSON body | 422, no stack trace |
| Any `500` | Body contains no traceback, path, or SQL |
| `ALLOWED_ORIGINS="*"` in production | Startup **refuses** |

---

# 8. AI Service Tests (TARGET)

| Test | Assertion |
|---|---|
| Knowledge source = `api` | Index built from `GET /api/content` (default); `file` selects `knowledge_base.json` |
| Content API unreachable | **Fail-closed**: `ContentAPIError` → `/ready` `503`, no silent snapshot fallback (`MIGRATION.md` Phase 9) |
| Content API unreachable with `KNOWLEDGE_SOURCE=file` | Index built from `knowledge_base.json`; `/ready` `200` |
| New project in the DB | Assistant answers correctly after a reindex, no redeploy |
| **All 5 projects** | Assistant can answer about each — **including Zerodha Clone**, which it cannot today |
| `/ready` during ingestion | 503 |
| `/ready` after ingestion | 200 |
| Chat without `X-API-Key` | 401/403 |
| Chat rate limit | 429 after 10/min |
| SSE stream | Events in order: `meta` → `sources` → `token`* → `done` |
| SSE on provider error | `error` event, then clean termination |
| SSE on provider timeout | Stream closes; the client recovers |
| Session continuity | Same `sessionId` retains context |
| Groq down | Falls back to Gemini |
| Both down | Graceful error, no 500 leak |
| Prompt injection ("ignore instructions") | Does not reveal system prompt or keys |

**Current status.** The cases above that can run without a live backend or SDK
keys are covered by `ai_service/tests/`: `test_content_api.py` (fetch fail-closed +
strict schema + semantic validation), `test_ingestion.py` (idempotency, stale
removal, changed-content replacement, api↔file convergence, answerability over a
fake embedding function), `test_parity.py` (honest `PARITY: FAIL` on the legacy
delta), `test_chat_sse_protocol.py` (SSE ordering, cache-hit, error paths with
stubbed SDK modules), `test_client_ip.py` (signed edge client-IP resolver and
rate-limit buckets), `test_rate_limit.py` (the configured chat limit is enforced
on `/chat` and `/chat/stream`, a non-positive value is refused at import),
`test_security.py` (a rejected `X-API-Key` logs the resolved client IP, never the
caller-supplied `x-forwarded-for`). **60 passed.** The live cases (real API reachability, both
providers down, production `/ready`) still require the running stack — Phase 12.

**The knowledge-base parity test is the point of Phase 9.** Today's assistant
cannot answer about `zerodha-clone` because `knowledge_base.json` has 4 projects
and the canonical API has 5; the re-point fixes that. Parity tool:
`cd ai_service && python -m services.parity --content <GET /api/content payload|url> --legacy knowledge_base.json`.

---

# 9. End-to-End Tests — IMPLEMENTED 2026-10-09

Playwright, Chromium only. **7 public URLs + the admin app.**

## 9.1 Public site

| Test | Assertions |
|---|---|
| `/` loads | Hero, About, Skills, Projects, GithubStats, Certifications, Blog, Contact render |
| `/` sections | All 7 anchors scroll to an existing section id |
| Navbar anchor click | Target section receives focus |
| Project card click | Navigates to `/projects/<slug>/` |
| **All 5 project pages** | 200; title, description, canonical, JSON-LD present |
| Project page JSON-LD | Parses; `@type` correct; `url` matches the canonical |
| Resume link | 200, `Content-Type: application/pdf` |
| Contact form | Valid submission succeeds; visible confirmation |
| Contact validation | Empty/invalid inputs blocked client-side |
| Chat widget | Opens; sends a message; receives a streamed token |
| Chat error state | Shows a message, page still functional |
| GitHub stats | Render, or the designed fallback |
| Theme toggle | Theme switches; persists across reload |
| Mobile viewport | No horizontal scroll at 375 px |
| `prefers-reduced-motion` | Animations disabled |
| 404 page | Custom 404 renders |
| **`/admin` not linked** | No link to `/admin` from the public UI |

## 9.2 Admin

| Test | Assertions |
|---|---|
| `/admin` unauthenticated | Redirects to `/admin/login` |
| Direct URL to `/api/admin/projects` in the browser | 401 — **not** merely "no UI shown" |
| Login with wrong password | Error shown; no session cookie |
| Login success | Redirects to the dashboard |
| Create a project | Appears in the list |
| Edit a project | Change persists after reload |
| Reorder projects (drag → `PUT display_order`) | Order persists after reload |
| Toggle `indexable` off | Project leaves the built sitemap after a rebuild |
| Toggle `status='hidden'` | Project leaves the site after a rebuild |
| **Rebuild site** button | Calls the deploy hook; reports success or failure |
| Invalid slug | Inline validation error; nothing saved |
| Published slug edit | Blocked client-side **and** server-side (`409`) |
| Messages inbox | Lists a submitted contact message |
| Logout | Session invalid; `/admin` redirects again |
| Public bundle | Does **not** contain admin code and does **not** contain `react-router-dom` — asserted automatically on every build by `scripts/assert-admin-bundle.mjs` (reads `dist/.vite/manifest.json`, scans every chunk the public entry loads for admin/router markers) |

---

## 9.3 Implemented Scope (Phase 10) — 14 tests, Chromium

`npm run test:e2e` runs Playwright against a **rebuildable `dist/`** (CI builds it
in the same job; locally it must exist from `npm run build`), with three
Playwright-managed web servers:

| Server | Port | Role |
|---|---|---|
| `e2e/serve.mjs` | 4173 | Static `dist/` + same-origin `/api/*` proxy → :8901, `/admin` → `admin.html`, `/projects/<slug>/` → generated page, `/_vercel/*` stubbed |
| `e2e/start-backend.mjs` | 8901 | Throwaway `portfolio_e2e` DB (drop schema → alembic → seed → admin bootstrap) + real uvicorn |
| `e2e/mock-resend.mjs` | 8902 | Resend stub, so contact stays offline |

The built public bundle calls `http://localhost:8000` for chat/contact/github
(dev `.env` `VITE_BACKEND_URL`); `e2e/intercept.mjs` sandboxes every one of those
requests in the browser so nothing ever reaches a real AI/Resend/GitHub service
(canned SSE for `/chat` + `/chat/stream`, relay to :8901 for `/api/contact`,
`{}` for github, `fail()` for anything unexpected).

**Actually automated:**

- Homepage renders; all **7 nav anchors** exist and each named section is present.
- All **5 project pages** render their `h1`, title, canonical link (and metadata).
- Resume link returns `application/pdf` (no origin leak check — not automated).
- Contact client validation rejects a bad email; a valid submission persists and
  appears in the admin inbox via a real session + message read.
- Chat FAB opens the dialog, a question streams the canned full SSE answer with
  source chip and model name; no console errors benchmarked.
- Admin: unauthenticated redirect; wrong password rejected; correct login opens
  the dashboard; create → edit → hide a scratch project → sign-out the session
  returns 401 server-side; provider guard asserts every editor label exists.
- Admin login exercises the **real CSRF-bounded flow** — `POST /auth/login`
  without a token, session cookie set, `/me` + token refresh, then mutations.

**Not yet automated** (TARGET, see tables above): theme toggle persistence,
mobile 375 px, `prefers-reduced-motion`, custom 404, admin drag-reorder,
indexable/hidden rebuild effects, Rebuild-site deploy hook, running the suite on
WebKit and Firefox.

## 9.4 Phase 11 additions — resume upload (15 tests)

A fourth Playwright-managed server backs resume uploads end to end:

| Server | Port | Role |
|---|---|---|
| `e2e/mock-s3.mjs` | 8903 | S3-compatible store (path-style PUT/GET/DELETE). Requires an `Authorization` header, so an unsigned GET of an object is refused with `403` — the private-bucket contract the resume depends on |

`e2e/start-backend.mjs` points `AWS_*`/`S3_RESUME_BUCKET` at it (fake credentials,
real signing). The new test signs in, expands the collapsed **Basics** section of
the profile editor, uploads `public/Ritu_Raj_Full_Stack_Developer_Resume.pdf`,
asserts the toast and that the field becomes `/api/resume`, then fetches
`/api/resume` and checks `200`, `application/pdf`, `Content-Disposition`,
byte-length fidelity, an `ETag` → `304` revalidation, and that the object cannot
be fetched without a signature. It **skips visibly** when no content snapshot
seeded a profile row.

The backend unit suite adds `test_admin_resume.py` (**21 tests**: the
`%PDF-` sniff, upload success/audit/replace-cleanup, every `422` variant, `503`,
`401`/`403`, and the public read's bytes/`304`/`404`/`503`/`429` paths).

---

# 10. Migration Validation Tests — IMPLEMENTED 2026-10-09

**Run at the end of every phase.** These are the acceptance criteria as
executable checks. Phases 1–6 must not change the site at all.

| # | Check | Pass condition |
|---|---|---|
| 1 | `ls dist/projects/*/index.html \| wc -l` | Exactly `5` |
| 2 | `ls dist/*.html dist/projects/*/index.html \| wc -l` | Unchanged from baseline |
| 3 | `diff` `sitemap.xml` vs baseline | Identical, or differs only in `lastmod` |
| 4 | `diff` `sitemap-images.xml` vs baseline | Identical, or `lastmod` only |
| 5 | `diff` `robots.txt` vs baseline | Identical |
| 6 | `diff` `llms.txt` vs baseline | Identical (byte-exact — `llms.txt` carries no timestamp) |
| 7 | `seo.json` vs baseline | Identical for all 6 URLs |
| 8 | JSON-LD per project page | Parses; same `@type`, `name`, `url` |
| 9 | Rendered homepage DOM vs baseline | Same section structure and text |
| 10 | `git diff --stat src/styles` | **Empty** |
| 11 | `git diff -- src/data` | **Empty** through Phase 7 |
| 12 | Public bundle gzipped | ≤ baseline + 15 KB |
| 13 | `npm run lint` | Clean |
| 14 | Build with the API stopped | **Fails**, exit 1, with the fail-closed message (verified) |
| 15 | Build with the API returning 0 projects | **Fails** (`validateContent`, unit-verified) |
| 16 | Build with a wrong `image_width` | **Fails** (`validateContent` + backend `test_seed` WebP cross-check) |
| 17 | Built site served statically, API stopped | All pages work — no runtime API dependency (verified) |
| 18 | Dev server, API stopped | `npm run dev` fails closed before Vite starts; there is **no** fallback snapshot (supersedes the pre-Phase-7 plan) |
| 19 | `npm test` + backend pytest | ≥ 30 frontend (116 current) and **445 backend**; `seed:verify` reports 0 diffs |
| 19 | `/api/chat` before and after Phase 8/9 | Identical SSE behaviour |
| 20 | `seed:verify` | Zero differences |

**Checks 10 and 11 are the tripwires.** A non-empty diff on `src/styles` or
`src/data` means the migration changed something it promised not to change.

**Phase 6 run (2026-10-06):** checks 1, 10, 11, 13 and 20 pass — `dist/projects/`
holds exactly 5 HTML files, `git diff --stat src/styles src/data` is empty,
`npm run lint` is clean, and `npm run seed:verify` reports zero differences
against the seeded `portfolio_dev`. Checks 2–9 and 12 compare against the
Phase 0 baseline (`.cache/baseline/`, capture pending) and checks 14–19
exercise the Phase 7/8 build switch, which Phase 6 deliberately does not
perform.

**Phase 8 run (2026-10-06):** checks 10, 11, 13, 19 and 20 pass again — lint
clean, 63 vitest + 395 pytest, `seed:verify` zero differences against
`portfolio_dev`, `git diff --stat src/styles src/data` empty, and
`assert-admin-bundle` confirms the admin stays its own entry. Chat SSE
comparison is explicitly deferred to Phase 10: nothing on the chat path changed
in Phase 8 (the `vercel.json` chat rewrite, the three vite chat proxies, and the
`ai_service` chat routes are untouched, and no `backend/` route registers
`/chat*`).

**Phase 9 run (2026-10-07):** checks 10, 11, 13 and 19 pass — `git diff --stat
src/styles src/data` empty (`vercel.json` carries only the pre-existing Phase 8
rewrites), `eslint .` clean, 63 vitest, and `ruff check .` clean in
`ai_service/` (4 findings fixed: 2 pre-existing unused imports, 2 unused
locals from the Phase 9 refactor). The AI suite is green offline: **35 passed**
(`npm run test:ai_service`). `python -m services.parity` on the DB snapshot
reports `PARITY: FAIL` with 81 legacy-only facts — **the expected honest
verdict** (`MIGRATION.md` Phase 9). The production build ran green end-to-end
against a local snapshot server (`CONTENT_API_URL` override): vite,
`assert-admin-bundle`, 5 prerendered project pages incl. `zerodha-clone`, and
all 4 discovery files. **Blocked until PostgreSQL is up:** checks 20
(`seed:verify`), backend pytest, and the live-API build/chat comparisons —
`npm run build` against the real `GET /api/content` and the §8 live cases.

**Phase 10 run (2026-10-09):** all executed checks pass. `npm run build` ran
against the running content API (fail-open offline builds are gone), so checks
1, 2, 5, 6, 8, 9 and 12 re-verified against the Phase 8-era baselines in
`.cache/baseline/`; lint clean; **116 vitest**, **401 backend pytest**,
**12 migration-validation** (see `tests/migration-validation.test.mjs`),
**35 `ai_service` tests**, and **14 Playwright e2e** across the
Phase 9/10 build. *(These are the counts as of that run; the suites have since
grown — see the current figures in the "Running" sections above.)* Checks 10/11
tripwires empty on `git diff -- src/data
src/styles`. Baseline-dependent checks (2–9, 12, 15–17) skip visibly in CI,
where `.cache/baseline/` cannot exist, and are re-run before any Phase 11
release outside CI. Two real production bugs surfaced and were fixed by the
e2e suite (see `MIGRATION.md` Phase 10): the admin login CSRF deadlock and the
`long_description = null` editor crash; the admin bundle in `dist/` was rebuilt
as a result.

---

# 11. Performance Testing (TARGET)

## 11.1 Bundle budget

Enforced in CI against `.cache/baseline/bundle-sizes.json`:

| Budget | Limit |
|---|---|
| Initial route JS (gzipped) | ≤ 250 KB |
| **Growth from this migration** | **< 15 KB gzipped** |
| CSS (gzipped) | ≤ 60 KB |
| Admin bundle | Separate entry — not in the public budget |
| Individual chunk | ≤ 120 KB gzipped |

## 11.2 Lighthouse

| Metric | Target |
|---|---|
| Performance (mobile) | ≥ 90, **and no regression vs baseline** |
| Accessibility | ≥ 95 |
| Best Practices | ≥ 90 |
| SEO | 100 |

**The SEO score of 100 is a regression alarm.** It is achievable today; any
change that drops it means a canonical, a meta tag or a structured-data node was
damaged.

## 11.3 Load

```bash
hey -n 2000 -c 20 https://<backend>/api/content
```

| Endpoint | p95 target |
|---|---|
| `GET /api/content` | < 100 ms |
| `POST /api/admin/auth/login` | < 500 ms (Argon2id) |

**Rationale for the scale.** A portfolio's realistic peak is a recruiter, a
recruiter's colleague and a bot. 2000 requests at concurrency 20 is already far
beyond any plausible traffic. A load-testing platform is not warranted.

---

# 12. Manual Verification Checklists

## 12.1 Pre-deploy (CURRENT)

- [ ] `npm ci`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `ls dist/projects/*/index.html | wc -l` == 5
- [ ] 4 discovery files present and well-formed
- [ ] `git status` clean
- [ ] No `.env` staged
- [ ] No secret in the diff

## 12.2 Post-deploy smoke test (TARGET)

Run against the **preview** URL before promoting.

**Content**
- [ ] `/` renders every section
- [ ] All 7 anchors work
- [ ] 5 project cards; each links to a live page
- [ ] Each project page has correct title, description, canonical, OG, Twitter, JSON-LD
- [ ] Skills show 4 categories / 16 skills
- [ ] 3 certifications, 4 blog entries, 3 social links
- [ ] Resume downloads as a PDF

**APIs**
- [ ] `GET /api/content` 200, ≤ 60 KB gzipped
- [ ] `GET /api/github` 200
- [ ] `POST /api/contact` succeeds
- [ ] `POST /api/chat/stream` streams
- [ ] `GET /api/admin/me` without a session → 401

**SEO and assets**
- [ ] `sitemap.xml`, `sitemap-images.xml`, `robots.txt`, `llms.txt` all 200
- [ ] `security.txt`, `humans.txt`, `site.webmanifest` 200
- [ ] All favicons and Apple touch icon 200
- [ ] Google and Bing verification files 200
- [ ] Security headers present

**Admin**
- [ ] `/admin/login` loads
- [ ] Login works
- [ ] A project edit persists and appears after a rebuild
- [ ] Logout invalidates the session

---

# 13. CI Pipeline (TARGET)

```yaml
name: CI
on:
  pull_request: { branches: [main] }
  push: { branches: [main] }

jobs:
  frontend:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm audit --audit-level=high
      - run: npm run test
      - run: npm run build
      - run: npm run test:coverage

  migration-validation:
    needs: frontend
    services:
      postgres: { image: postgres:16, env: { POSTGRES_PASSWORD: postgres } }
    steps:
      - run: npm run build
      - run: npm run test:migration-validation   # §10

  api:
    services:
      postgres: { image: postgres:16, env: { POSTGRES_PASSWORD: postgres } }
    steps:
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: pip install -r ai_service/requirements.txt
      - run: pip install -r backend/requirements.txt
      - run: pip-audit -r ai_service/requirements.txt
      - run: pip-audit -r backend/requirements.txt
      - run: npm run test:api
      - run: npm run test:ai_service

  e2e:
    needs: [frontend, api]
    steps:
      - run: npx playwright install --with-deps chromium
      - run: npm run build
      - run: npm run test:e2e
```

**CI blocks the merge.** A Vercel preview still deploys for manual inspection —
CI and preview serve different purposes.

**Also enforced in CI**

- [ ] No `VITE_*` variable matching `/SECRET|TOKEN|KEY|PASSWORD/i`
- [ ] No secret string in the diff
- [ ] `git diff --stat src/styles` empty
- [ ] `git diff -- src/data` empty (through Phase 7)
- [ ] Public bundle within budget

---

# 14. Coverage

| Target | Threshold | Rationale |
|---|---|---|
| `src/lib/projectPages.js` | 95% | Pure, small, and the SEO authority. Highest value per line |
| `src/services/*` | 90% | Error paths are what matter |
| `src/context/ContentContext.jsx` | 90% | The new failure surface |
| `scripts/**` | 80% | The validators are the guard |
| API routes | 90% | Auth and validation branches |
| Components | 70% | Assert behaviour, not markup |
| Admin UI | 60% | CRUD via Playwright covers the paths |
| `ai_service` | 70% | Retrieval + provider fallback |

**Not 100%.** Chasing it produces tests that assert implementation details.
Coverage is a floor for the modules where a silent regression is expensive.

---

# 15. Known Gaps

| # | Gap | Impact | Remediation |
|---|---|---|---|
| 1 | No tests at all today | Regressions found manually | Phase 10 |
| 2 | No CI | A broken build can reach `main` | Phase 10 |
| 3 | No coverage reporting | Unknown blind spots | Phase 10 |
| 4 | No visual regression testing | A styling change is invisible to tests | Not required — check 10 catches `src/styles` diffs |
| 5 | No load testing | Unknown capacity | §11.3 (one command) |
| 6 | No accessibility audit automation | A11y regressions found manually | `@axe-core/playwright` in Phase 10 |
| 7 | No multi-browser E2E | Chromium-only blind spot | Acceptable; the site uses no browser-specific APIs |
| 8 | No mutation testing | Test quality unverified | Not warranted at this scale |
| 9 | `ai_service` has no tests | Chat regressions found manually | Phase 10 |
| 10 | ChromaDB is ephemeral | `/ready` 503s on cold start | Persistent `CHROMA_DB_PATH` |

---

# END OF TESTING