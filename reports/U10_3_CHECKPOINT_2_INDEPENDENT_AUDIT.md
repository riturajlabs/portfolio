# U10.3 Checkpoint 2 — Independent Audit

**Status:** Independent audit complete.

**Repository:** `/home/riturajlabs/Projects/portfolio`

**Branch:** `feature/portfolio-u8-work`

**HEAD:** `0ccc7ef0deea9d8710af4b7225b2eb8799e53723`

**Audit scope:** U10.3 Checkpoint 2 only — public `caseStudy` serialization and admin project case-study persistence.

**Audit mode:** Read-only. No source, test, migration, snapshot, script, configuration, or schema change was made. No stage, commit, push, merge, deploy, or production/shared database write was performed.

## 1. Verdict Summary

No blocking defect was found. The public and admin case-study contracts match the approved plan, the database behavior matches Checkpoint 1, invalid stored data degrades safely, admin writes normalize consistently, and the extractor now preserves seed/API parity.

The only findings are non-blocking test-coverage observations and the known pre-existing repository-wide Ruff format drift. They do not change the contract or require a correction to this checkpoint.

## 2. Worktree and Baseline

The audit began and ended with:

- Branch: `feature/portfolio-u8-work`
- HEAD: `0ccc7ef0deea9d8710af4b7225b2eb8799e53723`
- Staged files: none
- Modified tracked files: 16 expected U10.2/U10.3 files
- Untracked files: 15 expected U10.2/U10.3 reports, tests, and migration files

No unexpected source, dependency, configuration, or generated-data change was present. The only file added by this audit is this report.

`backend/alembic/versions/0005_project_case_study.py` is still the Checkpoint 1 migration:

```text
sha256: 7abb47746290b0132ab093263846c44920ed281c1cd87e2b2fe05c4967d00acd
revision: 0005_project_case_study
down_revision: 0004_profile_resume_key
```

## 3. Files Inspected

### Contract and design

- `reports/U10_3_CHECKPOINT_2_API_REPORT.md`
- `reports/U10_3_DATABASE_API_IMPLEMENTATION_PLAN.md`
- `reports/U10_3_SERIALIZATION_PARITY_REVIEW.md`
- `reports/U10_3_CHECKPOINT_1_DATABASE_REPORT.md`
- `reports/U10_3_CHECKPOINT_1_INDEPENDENT_AUDIT.md`
- `reports/U10_2_FINAL_APPROVAL_AUDIT.md`

### Implementation

- `backend/app/models/project.py`
- `backend/alembic/versions/0005_project_case_study.py`
- `backend/app/schemas/content.py`
- `backend/app/schemas/admin_content.py`
- `backend/app/services/content.py`
- `backend/app/services/admin_content.py`
- `backend/app/routes/admin_content.py`
- `backend/app/routes/content.py`
- `scripts/extract-content.mjs`
- `ai_service/services/content_api.py`
- `src/lib/content.js`

### Tests and fixtures

- `backend/tests/test_content_api.py`
- `backend/tests/test_admin_content.py`
- `backend/tests/test_case_study_contract.py`
- `backend/tests/test_constraints.py`
- `backend/tests/test_database_schema.py`
- `backend/tests/test_migration_rollback.py`
- `backend/tests/test_payload_snapshot.py`
- `backend/tests/snapshots/content_payload.json`
- `ai_service/tests/test_case_study_contract.py`
- `src/lib/content.test.js`
- `scripts/extract-content.test.mjs`

## 4. Commands and Results

The test database URL was loaded from ignored `backend/.env` through Python and was never printed. No Neon, production, or shared database was used.

| Command | Result |
| --- | --- |
| `git branch --show-current && git rev-parse HEAD && git diff --cached --name-only` | Expected branch and HEAD; no staged files |
| Focused API suite: `pytest tests/test_content_api.py tests/test_admin_content.py tests/test_payload_snapshot.py tests/test_case_study_contract.py -q` | **276 passed** |
| Full backend suite: `pytest -q` | **755 passed, 1 warning** in 261.27s |
| Backend contract file only: `pytest tests/test_case_study_contract.py -q` | **165 passed** |
| AI contract tests: `pytest tests/test_case_study_contract.py -q` from `ai_service` | **141 passed** |
| Frontend contract tests: `npx vitest run src/lib/content.test.js` | **171 passed** |
| Extractor tests: `npx vitest run scripts/extract-content.test.mjs` | **4 passed** |
| `ruff check` on changed backend implementation and test files | **All checks passed** |
| `npx eslint scripts/extract-content.mjs` | No output |
| `git diff --check` | No output |
| `alembic check` against the disposable test database | **No new upgrade operations detected** |
| Temporary extractor regeneration to `/tmp/opencode/u103-cp2-audit-snapshot.json` | 5 projects; all 5 have `caseStudy: null`; one distinct project key set; 19,799 bytes |

The full-suite warning is the pre-existing Starlette `HTTP_422_UNPROCESSABLE_ENTITY` deprecation warning in `tests/test_admin_bootstrap.py`.

## 5. Public API Audit

### Required behavior

`GET /api/content` now selects `Project.case_study` (`backend/app/services/content.py:313`), validates it through the shared `CaseStudy` model, and attaches `caseStudy` to every project (`backend/app/services/content.py:186`). The public model declares `caseStudy: CaseStudy | None = None` (`backend/app/schemas/content.py:462`).

The response behavior is correct:

- SQL `NULL` becomes `caseStudy: null`, and the key is never absent.
- A valid stored v1 document becomes normalized camelCase.
- Public output never exposes `case_study`.
- `{}`, unsupported versions, unknown nested keys, and invalid nested fields degrade only that project to `null`.
- Other projects remain in the response.
- Stored invalid JSON is not repaired or rewritten.

`_case_study()` catches only `pydantic.ValidationError` (`backend/app/services/content.py:104-118`). It does not swallow database failures or other programming errors. The warning `public_case_study_invalid` contains only:

- `slug`
- `error` (`ValidationError`)
- `errors` (validation error count)

No document body, URL, evidence text, or raw JSONB is logged. This matches the plan and is covered by the sentinel-based test at `backend/tests/test_content_api.py:545`.

The snapshot diff is limited to three intended `"caseStudy": null` additions in `backend/tests/snapshots/content_payload.json`. The committed snapshot and deterministic-bytes tests pass. The existing gzip budget test also passes at `backend/tests/test_content_api.py:1087`.

### Public result

**PASS.** The public contract is implemented without a new route, without a response variant, and without changing `longDescription` or `highlights`.

## 6. Admin API Audit

### Schemas and service

- `ProjectOut` exposes raw `case_study: dict[str, Any] | None` for recovery (`backend/app/schemas/admin_content.py:171`).
- `ProjectCreateIn` and `ProjectUpdateIn` accept `CaseStudy | None` (`backend/app/schemas/admin_content.py:208,270`).
- `ProjectListItem` remains unchanged and does not gain `case_study`.
- Create uses `payload.model_dump()` and stores the normalized nested document.
- Update dumps with `exclude_unset=True`, then replaces an explicitly supplied object with `model_dump(mode="json", by_alias=True)` (`backend/app/services/admin_content.py:347-349`).
- Omitted update preserves the stored document; explicit `null` clears it; an object fully replaces it with no deep merge.
- The admin route returns `case_study=row.case_study` (`backend/app/routes/admin_content.py:187`).

The update normalization is the required correction from the approved plan. A sparse replacement is normalized before storage, so create and update use one storage representation. The implementation checks `isinstance(payload.case_study, CaseStudy)`, which correctly leaves an explicit `null` as `None` and leaves an omitted field absent from `changes`.

### Verified behavior

- Create omitted and create explicit `null` store SQL `NULL` and return `case_study: null`.
- Create valid object returns the normalized document.
- Create `{}`, version-only, unsupported-version, unknown-key, and oversized documents return `422 VALIDATION_ERROR`.
- Update omitted preserves the document.
- Update explicit `null` clears it and public output becomes `null`.
- Update valid object replaces the whole document and normalizes omitted nested fields.
- Update invalid input returns `422` and preserves the row.
- Admin create/update audit rows include `case_study`.
- Soft delete preserves `case_study`.
- Admin list omits `case_study`.
- Admin detail returns the raw stored value.
- Public payload and ETag refresh after a case-study update.
- Existing auth, CSRF, slug, concurrency, and audit behavior remains green in the full suite.

Tests covering these paths include `backend/tests/test_admin_content.py:335-618`.

### Admin result

**PASS.** Admin semantics and normalization match the approved plan.

## 7. Database and JSONB Audit

### Checkpoint 1 preservation

The migration still adds one nullable `jsonb` column and one CHECK:

```text
project.case_study jsonb NULL
CHECK (case_study IS NULL OR jsonb_typeof(case_study) = 'object')
```

The migration revision, down revision, column definition, constraint name, and downgrade are unchanged. `alembic check` reports no new upgrade operations.

The Checkpoint 1 ORM model used `mapped_column(JSONB)`. Checkpoint 2 changed only the model binding to `JSONB(none_as_null=True)` (`backend/app/models/project.py:53`). This is required so a Python `None` becomes SQL `NULL` rather than JSON `null`; JSON `null` would violate `ck_project_case_study_object`. It does not alter the migration, schema, or another JSONB column.

### Independent runtime probe

A rolled-back transaction against the disposable test database verified:

| Stored value | Result |
| --- | --- |
| Python `None` through the ORM | `case_study IS NULL = true`, `jsonb_typeof = null` |
| Valid Python dict | `case_study IS NULL = false`, `jsonb_typeof = object` |
| Raw JSON `null` | Rejected by `ck_project_case_study_object` |
| Raw JSON `[]` | Rejected by `ck_project_case_study_object` |
| Raw JSON `"x"` | Rejected by `ck_project_case_study_object` |
| Raw JSON `1` | Rejected by `ck_project_case_study_object` |
| Raw JSON `true` | Rejected by `ck_project_case_study_object` |

The transaction was rolled back. No test database rows were left behind.

### Database result

**PASS.** Storage semantics, constraints, migration state, and ORM metadata are consistent.

## 8. Extractor and Seed Parity Audit

`scripts/extract-content.mjs` adds `caseStudy` to `PROJECT_KEYS` (`scripts/extract-content.mjs:60`) and emits `caseStudy: null` for each project (`scripts/extract-content.mjs:494`).

An independent extraction to a temporary file produced:

```text
projects: 5
caseStudy values: [null, null, null, null, null]
projects with caseStudy key: 5
distinct project key sets: 1
bytes: 19799
```

No source file under `src/data` currently contains `caseStudy` or `case_study`, so hardcoding `null` at extraction time is consistent with the current seed data and the checkpoint’s decision not to ingest actual case-study content yet. The ignored `.cache/content-snapshot.json` is not a tracked source artifact; CI regenerates it.

### Extractor result

**PASS.**

## 9. Regression and Scope Audit

- The Checkpoint 1 head is still `0005_project_case_study`.
- The Checkpoint 1 migration and constraint were not modified.
- U10.2 backend, AI, and frontend contract tests all pass unchanged: **165**, **141**, and **171** tests respectively.
- No frontend rendering, admin UI/editor, AI ingestion, prompt, gallery/upload, or generated content was added.
- No dependency, configuration, or `src/data` file was changed.
- No production or shared database was touched.
- No commit, stage, push, merge, or deployment was performed.

Repository-wide Ruff format drift remains pre-existing and was not autoformatted. Lint checks on the changed files pass.

## 10. Findings

### Blocking findings

None.

### Non-blocking observations

1. **Admin raw-invalid recovery test gap.** The proposed test-plan row for reading a deliberately invalid stored object through admin detail has no dedicated test. The behavior is nevertheless correct by inspection: `ProjectOut.case_study` is an unvalidated `dict[str, Any] | None`, and `_project_out()` passes `row.case_study` directly. A future test would close the coverage gap without changing behavior.

2. **Some proposed admin edge-case tests are covered by the shared validator suite.** The admin tests exercise representative invalid and oversized create cases, while duplicate links, bad evidence sources, bad image sources, and update-time oversized documents are enforced by the same shared `CaseStudy` model and are covered in the contract suite. No bypass was found.

3. **No dedicated audit-clear assertion.** The update-to-`null` endpoint test and the create/update audit-row test together cover the relevant paths, but there is no single test asserting an update audit row whose `after.case_study` is `null`. This is a coverage observation only; the audit dump is generic and includes the column automatically.

4. **Pre-existing Ruff format drift.** The repository still has broad format drift outside this checkpoint’s meaningful changes. It was not autoformatted to avoid unrelated churn.

### Unverified or out of scope

- Production deployment and migration execution against any shared environment.
- Admin UI rendering/editing of case-study content.
- AI ingestion, prompt construction, and vector indexing of case-study content.
- Actual browser rendering and build output for real case-study documents.

## 11. Final Verdict

CHECKPOINT 2 APPROVED
