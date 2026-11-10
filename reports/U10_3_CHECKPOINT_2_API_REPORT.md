# U10.3 Checkpoint 2 — Public/Admin API Report

**Status:** Implementation complete. Checkpoint 2 scope only.

**Repository:** `/home/riturajlabs/Projects/portfolio`

**Branch:** `feature/portfolio-u8-work`

**HEAD:** `0ccc7ef0deea9d8710af4b7225b2eb8799e53723`

## 1. Scope Completed

Implemented public `caseStudy` serialization and admin project case-study persistence:

- Every public project now includes `caseStudy`.
- SQL `NULL` becomes `caseStudy: null`.
- A valid stored document is re-validated and returned as normalized camelCase v1.
- An invalid stored document degrades only that project to `null`, emits a structured warning, and does not log document content.
- Admin project create/update/read use outer `case_study` and nested camelCase.
- Admin create/update reject invalid and oversized documents.
- PUT semantics are preserved: omitted preserves, explicit `null` clears, an object fully replaces.
- Admin responses and audit rows carry the normalized document.
- Public ETag and `generated_at` refresh after an admin case-study change.
- Seed extraction now emits `caseStudy: null`, keeping the generated snapshot aligned with the public API.

No frontend rendering, admin UI/editor, AI ingestion/prompt, gallery/upload, generated content, dependency, configuration, or migration change was made.

## 2. Files Changed

### Implementation

| File | Change |
| --- | --- |
| `backend/app/schemas/content.py` | Added optional `Project.caseStudy`; existing `CaseStudy` validator remains the single document contract. |
| `backend/app/schemas/admin_content.py` | Added `ProjectOut.case_study`; added `CaseStudy` fields to create/update schemas. |
| `backend/app/services/content.py` | Selects `Project.case_study`; added `_case_study()` normalization/degradation and structured warning. |
| `backend/app/services/admin_content.py` | Applies approved PUT normalization and persists create/update documents. |
| `backend/app/routes/admin_content.py` | Includes `case_study` in project mutation/detail responses. |
| `backend/app/models/project.py` | Uses `JSONB(none_as_null=True)` so Python `None` persists as SQL `NULL`, not JSON `null`. |
| `scripts/extract-content.mjs` | Emits `caseStudy: null` so the generated seed snapshot matches the public contract. |

### Tests

| File | Change |
| --- | --- |
| `backend/tests/test_content_api.py` | Added null, valid-normalized, invalid-stored degradation, warning, and raw-storage-preservation coverage. |
| `backend/tests/test_admin_content.py` | Added create/update/audit/delete/cache coverage for case-study documents, null clearing, replacement, and size/validation rejection. |
| `backend/tests/test_case_study_contract.py` | Updated the contract test to require `caseStudy` on the public project model. |
| `backend/tests/snapshots/content_payload.json` | Added the intended `caseStudy: null` to each snapshotted project. |

### Report

| File | Change |
| --- | --- |
| `reports/U10_3_CHECKPOINT_2_API_REPORT.md` | This report. |

## 3. Public API Behavior

- `GET /api/content` includes `caseStudy` on every project.
- SQL `NULL` is serialized as `null`.
- A stored document is validated through the shared `CaseStudy` model before being served.
- Valid documents are returned in normalized camelCase v1 form, matching admin output.
- An invalid stored document produces `caseStudy: null` for that project only.
- The degradation warning is `public_case_study_invalid` with slug and validation metadata; document values are not logged.
- Stored JSON is not repaired or rewritten during a read.
- No new public endpoint was added.

## 4. Admin API Behavior

- `POST /api/admin/projects` accepts an optional nested `case_study`.
- Omitted or explicit `null` stores SQL `NULL`.
- A supplied object is fully validated and persisted in normalized camelCase.
- `PUT /api/admin/projects/{id}` preserves an omitted `case_study`, clears it on explicit `null`, and fully replaces it on a supplied object.
- Unknown fields, `{}`, invalid nested values, and documents over 32 KiB normalized canonical size are rejected with `422`.
- Create/update responses expose outer `case_study` with nested camelCase.
- Audit `before`/`after` rows contain the normalized document.
- Deleting a project preserves the stored document.
- A case-study update refreshes the public payload and ETag.
- Admin project lists remain unchanged and omit case-study data.

## 5. Persistence Note

The first focused run exposed a real persistence issue: `JSONB` without `none_as_null=True` bound Python `None` as JSON `null`, which violates `ck_project_case_study_object`. The project column now uses `JSONB(none_as_null=True)`, so absence is always SQL `NULL`, matching the Checkpoint 1 storage contract. No migration change was required.

The extractor initially produced no `caseStudy` key, so the seed/API parity test failed once the public field was added. The extractor now emits `caseStudy: null`; the ignored `.cache/content-snapshot.json` was regenerated locally with `npm run seed:extract`. CI regenerates it from source and does not rely on the local ignored artifact.

## 6. Verification

### Focused API tests

```bash
TEST_DATABASE_URL=... .venv/bin/pytest \
  tests/test_content_api.py \
  tests/test_admin_content.py \
  tests/test_payload_snapshot.py \
  tests/test_case_study_contract.py -q
```

Result: **276 passed**.

### Full backend suite

```bash
TEST_DATABASE_URL=... .venv/bin/pytest -q
```

Result: **755 passed, 1 warning** in 121.64 seconds.

The warning is the pre-existing Starlette deprecation warning in `tests/test_admin_bootstrap.py`.

### Seed extractor tests

```bash
npx vitest run scripts/extract-content.test.mjs
```

Result: **4 passed**.

### Lint and whitespace

```bash
.venv/bin/ruff check app tests
npx eslint scripts/extract-content.mjs
git diff --check
```

Results: Ruff **All checks passed**; ESLint produced no output; whitespace check produced no output.

### Format status

`ruff format --check` still reports pre-existing repository-wide drift, including unchanged lines in the shared files touched here. It was deliberately not autoformatted to avoid unrelated churn. The implementation is lint-clean.

## 7. Test Database Identification and Safety

`TEST_DATABASE_URL` was loaded from the ignored `backend/.env` without printing its value or credentials.

Verified target:

- PostgreSQL 17.11
- Local Unix socket at `/var/run/postgresql`
- Database: `portfolio_test`
- Disposable test database only

The `source backend/.env` parse failure (`&` in a value) was avoided by extracting the value through Python. No test or migration was run against Neon/production `DATABASE_URL`.

## 8. U10.2 Preservation

The approved U10.2 worktree changes remain present and unmodified by this checkpoint:

- `ai_service/services/content_api.py`
- `src/lib/content.js`
- `src/lib/content.test.js`
- `ai_service/tests/test_case_study_contract.py`
- The U10.2 reports

The full backend run exercised the preserved backend contract tests as part of the 755 passing tests.

## 9. Scope Confirmation

- No frontend rendering or admin UI change.
- No admin editor change.
- No AI ingestion, prompt, or AI-service source change.
- No gallery/upload change.
- No generated case-study content was introduced.
- No migration change.
- No dependency or configuration change.
- No commit, stage, push, merge, or deployment.
- No production or shared database write.

## 10. Risks and Notes

- Invalid stored JSON degrades to `null` at read time; this is intentional and data is not repaired automatically.
- The extractor emits `caseStudy: null`; actual case-study content ingestion remains outside Checkpoint 2.
- Repository Ruff format drift is pre-existing and broad.
- `JSONB(none_as_null=True)` is required for this nullable document column to satisfy the database CHECK; this is a model-level behavior change, not a schema migration.

## Recommendation

**CHECKPOINT 2 READY FOR INDEPENDENT AUDIT**
