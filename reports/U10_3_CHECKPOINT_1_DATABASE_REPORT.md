# U10.3 Checkpoint 1 — Database Foundation Report

**Status:** Implementation complete. Checkpoint 1 scope only.

**Repository:** `/home/riturajlabs/Projects/portfolio`

**Branch:** `feature/portfolio-u8-work`

**HEAD:** `0ccc7ef0deea9d8710af4b7225b2eb8799e53723`

## 1. Scope Completed

Implemented the nullable `project.case_study` JSONB storage foundation:

- Added the nullable `case_study` mapped column to the project ORM model.
- Added the database CHECK that permits only SQL `NULL` or a JSON object.
- Added Alembic migration `0005_project_case_study`.
- Added schema, direct-SQL constraint, and migration round-trip tests.
- Preserved every pre-existing project column, CHECK, index, and foreign key.

No public API, admin API, Pydantic schema, service, route, frontend, AI service, renderer, editor, documentation, dependency, configuration, or database-state change was made.

## 2. Files Changed

### Implementation

| File | Change |
| --- | --- |
| `backend/app/models/project.py` | Imported `Any` and `JSONB`; added nullable `case_study`; added named `case_study_object` CHECK. |
| `backend/alembic/versions/0005_project_case_study.py` | New migration. Revision `0005_project_case_study`; down revision `0004_profile_resume_key`. |

### Tests

| File | Change |
| --- | --- |
| `backend/tests/test_database_schema.py` | Added `case_study` to expected columns; added exact project CHECK-name set; added expected-head, no-default, and no-index assertions. |
| `backend/tests/test_constraints.py` | Added direct-SQL tests for SQL `NULL`, a JSON object, array, string, number, boolean, and JSON `null`; invalid cases assert the named constraint. |
| `backend/tests/test_migration_rollback.py` | Added isolated `0004` → `0005` upgrade, existing-row preservation, valid-object storage, downgrade, and re-upgrade coverage. |

### Report

| File | Change |
| --- | --- |
| `reports/U10_3_CHECKPOINT_1_DATABASE_REPORT.md` | This report. |

## 3. Database Shape

### Column

- Name: `case_study`
- Type: `jsonb`
- Nullable: yes
- Default: none
- Backfill: none
- Index: none

SQL `NULL` is the only representation of "no case study". There is no `{}` default.

### Constraint

- Name: `ck_project_case_study_object`
- Definition: `CHECK (case_study IS NULL OR jsonb_typeof(case_study) = 'object')`

The constraint is storage-type validation only. The full v1 document contract remains an application concern for a later checkpoint.

### Migration

- `revision = "0005_project_case_study"`
- `down_revision = "0004_profile_resume_key"`
- Upgrade: add nullable column, then CHECK.
- Downgrade: drop CHECK, then column.
- Downgrade is destructive and permanently deletes stored case-study data; this is documented in the migration.

## 4. Test Database Identification and Safety

`TEST_DATABASE_URL` was loaded from the ignored `backend/.env` without printing its value or credentials.

Verified target:

- PostgreSQL 17.11
- Local Unix socket at `/var/run/postgresql`
- Database: `portfolio_test`
- No password
- `conftest.py` drops and recreates the `public` schema for the test run

This is the disposable test database. No migration or test was run against the Neon/production `DATABASE_URL`. The only explicit `DATABASE_URL` override was for `alembic check`, and it pointed at the same local `portfolio_test` database.

## 5. Verification

### Targeted database tests

```bash
TEST_DATABASE_URL=... .venv/bin/python -m pytest \
  tests/test_database_schema.py \
  tests/test_constraints.py \
  tests/test_migration_rollback.py -q
```

Result: **140 passed**.

### Full backend suite

```bash
TEST_DATABASE_URL=... .venv/bin/python -m pytest -q
```

Result: **733 passed, 1 warning** in 76.87 seconds.

The warning is a pre-existing Starlette deprecation warning in `tests/test_admin_bootstrap.py`; it is unrelated to this checkpoint.

### Alembic model/schema drift check

```bash
DATABASE_URL=<portfolio_test> .venv/bin/python -m alembic check
```

Result: **No new upgrade operations detected.**

### Ruff lint

```bash
.venv/bin/python -m ruff check \
  app/models/project.py \
  alembic/versions/0005_project_case_study.py \
  tests/test_database_schema.py \
  tests/test_constraints.py \
  tests/test_migration_rollback.py
```

Result: **All checks passed.**

### Format status

The new migration and migration test are format-clean:

```bash
.venv/bin/python -m ruff format --check \
  alembic/versions/0005_project_case_study.py \
  tests/test_migration_rollback.py
```

Result: **2 files already formatted.**

Repository format drift is pre-existing and broad: `ruff format --check .` reports **78 files would be reformatted**, and the three older shared test/model files flagged individually are flagged only on lines that predate this checkpoint. They were deliberately not autoformatted to avoid unrelated churn. No new code was identified as unformatted.

### Whitespace

```bash
git diff --check
```

Result: no output.

## 6. Evidence for Required Behavior

- `case_study` exists as nullable `jsonb`.
- `case_study` has no default and no index.
- `ck_project_case_study_object` exists with the object-type definition.
- SQL `NULL` is accepted.
- JSON object is accepted and survives a round trip.
- JSON array, string, number, boolean, and JSON `null` are rejected.
- Invalid writes fail with `ck_project_case_study_object`.
- The exact set of project CHECK constraints is unchanged except for the added CHECK.
- Existing project rows survive the `0005` upgrade with `case_study = NULL` (no backfill).
- Upgrade, downgrade, and re-upgrade all succeed.
- Downgrade removes both the constraint and column.
- `alembic check` reports no model/migration drift.
- The full backend suite passes.

## 7. U10.2 Preservation

The approved U10.2 worktree changes and tests remain present and were not modified by this checkpoint:

- `ai_service/services/content_api.py`
- `backend/app/schemas/content.py`
- `src/lib/content.js`
- `src/lib/content.test.js`
- `ai_service/tests/test_case_study_contract.py`
- `backend/tests/test_case_study_contract.py`
- The U10.2 reports

The broad backend run exercised the preserved backend contract tests as part of the 733 passing tests.

## 8. Scope Confirmation

Checkpoint 1 stays within the approved file set:

- No public content schema/service/route change.
- No admin schema/service/route change.
- No frontend or AI service source change.
- No snapshot change.
- No generated content change.
- No dependency or configuration change.
- No commit, stage, push, merge, or deployment.
- No migration applied to a shared or production database.

## 9. Risks and Notes

- Downgrading `0005` destroys stored case-study data. A backup/export is required before any deliberate production downgrade.
- The database accepts any JSON object, including `{}`; the application validator must enforce the full v1 document at the admin boundary in a later checkpoint.
- The repository has substantial pre-existing `ruff format` drift. This checkpoint did not reformat unrelated or pre-existing code.

## 10. Final Worktree Status

```text
 M ai_service/services/content_api.py
 M backend/app/models/project.py
 M backend/app/schemas/content.py
 M backend/tests/test_constraints.py
 M backend/tests/test_database_schema.py
 M backend/tests/test_migration_rollback.py
 M src/lib/content.js
 M src/lib/content.test.js
?? ai_service/tests/test_case_study_contract.py
?? backend/alembic/versions/0005_project_case_study.py
?? backend/tests/test_case_study_contract.py
?? reports/U10_1_CASE_STUDY_ARCHITECTURE_DESIGN.md
?? reports/U10_2_CONTRACT_PARITY_AUDIT.md
?? reports/U10_2_CONTRACT_PARITY_CORRECTIONS.md
?? reports/U10_2_CONTRACT_PARITY_REAUDIT.md
?? reports/U10_2_D5_WHITESPACE_CORRECTIONS.md
?? reports/U10_2_FINAL_APPROVAL_AUDIT.md
?? reports/U10_3_CHECKPOINT_1_DATABASE_REPORT.md
?? reports/U10_3_DATABASE_API_IMPLEMENTATION_PLAN.md
?? reports/U10_3_SERIALIZATION_PARITY_REVIEW.md
?? reports/U10_PROJECT_CASE_STUDY_AUDIT.md
```

## Recommendation

**CHECKPOINT 1 APPROVED FOR REVIEW**
