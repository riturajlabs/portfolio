# U10.3 Final Combined Precommit Audit

**Audit date:** 2026-11-10
**Repository:** `/home/riturajlabs/Projects/portfolio`
**Branch:** `feature/portfolio-u8-work`
**Baseline HEAD:** `0ccc7ef0deea9d8710af4b7225b2eb8799e53723`
**Scope:** U10.2 case-study contract plus U10.3 database/API checkpoints, as one commit candidate.
**Method:** Read-only inspection and verification. No source, test, migration, snapshot, configuration, or existing report was modified. This audit created only `reports/U10_3_FINAL_PRECOMMIT_AUDIT.md`.

No blocking defect was found.

## 1. Git Baseline and Audit Boundary

- The branch and HEAD match the U10.2/U10.3 implementation baseline.
- No commit, merge, push, deployment, or production migration was performed.
- `git diff --cached --name-status` was empty. Nothing is staged.
- The index was not changed by this audit.
- Before this report, the worktree had 16 modified tracked files and 16 untracked files.
- After this report, the expected worktree is 16 modified tracked files and 17 untracked files.
- Tracked diff: 16 files changed, 3,048 insertions, 15 deletions.
- The untracked files are three implementation/test files and fourteen reports.
- No unexpected tracked, untracked, or ignored file was found.
- Ignored local artifacts remain outside the commit candidate, including:
  - `backend/.env`, `ai_service/.env`, `.env`, `.env.local`
  - `.cache/`, `.prerender/`, `.vercel/`, `.neon`, `.claude/`
  - `.venv/`, `backend/.venv/`, `ai_service/.venv/`, `node_modules/`
  - Python caches, test caches, and `backend/portfolio_backend.egg-info/`
  - `ai_service/chroma_db/` and `ai_service/embedding_cache.sqlite`
  - Temporary audit files under `/tmp/opencode/`
- The test database was the disposable local database, not production:
  - Database: `portfolio_test`
  - Server: PostgreSQL `17.11 (Ubuntu 17.11-1.pgdg24.04+2)`
  - Connection: Unix socket
- The test database URL was read from ignored `backend/.env` without printing credentials.

## 2. Commit-Candidate Manifest

The following 33 paths are the complete proposed commit candidate. They are not staged.

### Tracked modifications (16)

| Path | Purpose |
| --- | --- |
| `ai_service/services/content_api.py` | AI contract mirror for nullable v1 case studies. |
| `backend/app/models/project.py` | Nullable `JSONB(none_as_null=True)` column and object-only CHECK constraint. |
| `backend/app/routes/admin_content.py` | Raw admin `case_study` response mapping. |
| `backend/app/schemas/admin_content.py` | Admin create/update/out case-study schemas. |
| `backend/app/schemas/content.py` | Public `CaseStudy` contract and project field. |
| `backend/app/services/admin_content.py` | Admin normalization, full replacement, and persistence. |
| `backend/app/services/content.py` | Public selection, normalization, per-project degradation, and warning logging. |
| `backend/tests/snapshots/content_payload.json` | Three expected `caseStudy: null` additions. |
| `backend/tests/test_admin_content.py` | Admin create, update, clear, audit, cache, and raw-value coverage. |
| `backend/tests/test_constraints.py` | Database CHECK constraint coverage. |
| `backend/tests/test_content_api.py` | Public API valid, null, invalid, and warning coverage. |
| `backend/tests/test_database_schema.py` | Schema and column contract coverage. |
| `backend/tests/test_migration_rollback.py` | Migration upgrade/downgrade coverage. |
| `scripts/extract-content.mjs` | Emits `caseStudy: null` in extracted project snapshots. |
| `src/lib/content.js` | Frontend canonicalizer and validator parity implementation. |
| `src/lib/content.test.js` | Frontend contract, boundary, and degradation tests. |

### New implementation and test files (3)

| Path | Purpose |
| --- | --- |
| `ai_service/tests/test_case_study_contract.py` | AI contract parity and boundary tests. |
| `backend/alembic/versions/0005_project_case_study.py` | U10.3 migration adding nullable case-study JSONB. |
| `backend/tests/test_case_study_contract.py` | Backend public contract and parity tests. |

### New reports and audit documentation (14)

| Path | Purpose |
| --- | --- |
| `reports/U10_1_CASE_STUDY_ARCHITECTURE_DESIGN.md` | Architecture and contract design. |
| `reports/U10_2_CONTRACT_PARITY_AUDIT.md` | Initial parity audit. |
| `reports/U10_2_CONTRACT_PARITY_CORRECTIONS.md` | Applied parity corrections. |
| `reports/U10_2_CONTRACT_PARITY_REAUDIT.md` | Parity re-audit. |
| `reports/U10_2_D5_WHITESPACE_CORRECTIONS.md` | Whitespace correction record. |
| `reports/U10_2_FINAL_APPROVAL_AUDIT.md` | Final U10.2 approval evidence. |
| `reports/U10_3_CHECKPOINT_1_DATABASE_REPORT.md` | Checkpoint 1 implementation report. |
| `reports/U10_3_CHECKPOINT_1_INDEPENDENT_AUDIT.md` | Checkpoint 1 approval audit. |
| `reports/U10_3_CHECKPOINT_2_API_REPORT.md` | Checkpoint 2 implementation report. |
| `reports/U10_3_CHECKPOINT_2_INDEPENDENT_AUDIT.md` | Checkpoint 2 approval audit. |
| `reports/U10_3_DATABASE_API_IMPLEMENTATION_PLAN.md` | Database/API implementation plan. |
| `reports/U10_3_SERIALIZATION_PARITY_REVIEW.md` | Serialization parity review. |
| `reports/U10_PROJECT_CASE_STUDY_AUDIT.md` | Project-level case-study audit. |
| `reports/U10_3_FINAL_PRECOMMIT_AUDIT.md` | This final combined precommit audit. |

No dependency, lockfile, environment-example, authentication, CORS, middleware, rate-limit, security-header, or `src/data` file is part of the candidate.

## 3. Cross-Layer Contract Consistency

The approved U10.2 parity baseline remains the contract reference:

- 167 shared probes.
- 161 three-way agreements.
- 2 backend N/A cases before U10.3, because the public backend project did not yet expose `caseStudy`.
- 4 accepted JavaScript integral-float cases, documented as an intentional language-boundary tolerance.
- 75 common accepted canonical outputs byte-identical.

U10.3 closes the prior public-backend gap:

- Every public project now includes `caseStudy`, including serialized `null`.
- Missing and explicit-null fields normalize identically to `null`.
- Valid stored v1 documents normalize to camelCase in the public response.
- Invalid stored documents degrade only the affected project to `null`.
- Admin create/update outputs normalized camelCase documents.
- Admin `ProjectOut` returns the stored raw value, preserving unexpected data for operator visibility.
- `ProjectListItem` remains unchanged and omits `caseStudy`.

The three contract implementations preserve the approved rules:

- Exactly `schemaVersion: 1`.
- Unknown keys rejected at every case-study level.
- Unknown project-level keys tolerated.
- CamelCase field names across backend, AI, and frontend.
- ASCII four-digit years and `YYYY-MM` dates.
- Strict integers, including rejection of booleans, numeric strings, and fractional values where the contract requires integers.
- Whitespace-only text rejected; leading/trailing whitespace stripped.
- Empty strings, empty arrays, and empty documents rejected according to their field rules.
- URL, gallery, link, outcome, evidence, and uniqueness constraints preserved.
- 32 KiB canonical document cap enforced in all three layers.
- Nullable nested values remain nullable where specified.
- No deep merge on admin update; an object fully replaces the previous document.

The AI layer deliberately excludes case study content from RAG project summaries. This is the approved U10.3 scope: validate and store the contract without changing AI ingestion content.

The extractor change is limited to adding `caseStudy: null` before the SEO keys. The snapshot diff contains exactly three added null fields.

## 4. Database and API Integration

The migration remains unchanged from the approved checkpoints:

- Revision: `0005_project_case_study`
- Down revision: `0004_profile_resume_key`
- SHA-256: `7abb47746290b0132ab093263846c44920ed281c1cd87e2b2fe05c4967d00acd`
- The test database `alembic_version` is `0005_project_case_study`.

The current JSONB probe, run in a rolled-back transaction against the test database, confirmed:

- Python `None` persists as SQL `NULL`.
- A dictionary persists as JSONB `object`.
- JSON `null` is rejected by `ck_project_case_study_object`.
- JSON arrays, strings, numbers, and booleans are rejected by the same constraint.

Public behavior is correct:

- SQL `NULL` and stored JSON `null` cannot be confused; the constraint prevents JSON `null`.
- Public `caseStudy` is always present.
- Invalid stored documents return `null` for that project only.
- The public warning contains the slug, error type, and error count, not the raw document.
- Public loading does not rewrite invalid stored data.
- Other projects and the rest of the content payload remain available.

Admin behavior is correct:

- Create omitted → `null`.
- Create explicit null → `null`.
- Create object → normalized stored object.
- Update omitted → preserve.
- Update explicit null → clear.
- Update object → full replacement.
- Invalid and oversized documents → `422`.
- Audit rows include the new column through the existing column-dump path and remain bounded by the 32 KiB application cap.
- Public ETag changes after a case-study mutation, as covered by the passing full suite.

The raw admin mapping probe passed:

```text
_project_out() preserved: {'schemaVersion': 2, 'unexpected': 'preserved'}
```

This confirms invalid stored data is not silently rewritten on the admin side.

## 5. Security and Compatibility Review

- No credential, API key, token, password, private key, signed URL, or production connection string appears in the candidate diff.
- Report matches for words such as `secret` and `password` are policy prose or redacted `TEST_DATABASE_URL=...` placeholders.
- Case-study content is public by design and remains bounded by the 32 KiB cap.
- Public warning logging does not include the invalid document payload.
- Admin raw responses expose stored content only to the authenticated admin surface; no auth behavior changed.
- No changes to authentication, authorization, CSRF, CORS, middleware, rate limiting, security headers, session handling, or deployment configuration.
- No dependency or lockfile change.
- No new external service, browser API, or storage behavior.
- No production data was read, modified, migrated, or deleted.
- The migration is additive, nullable, and reversible; rollback tests pass.
- Older payloads without `caseStudy` remain valid in all layers.
- The frontend and AI tolerate missing or null `caseStudy` identically.
- No UI rendering change relies on the new field in this checkpoint.

## 6. Verification Evidence

All implementation files were unchanged after verification. The only file created after verification is this report.

| Check | Result |
| --- | --- |
| Full backend suite | **755 passed**, 1 pre-existing Starlette 422 deprecation warning, 259.44s |
| AI case-study contract suite | **141 passed** |
| Frontend content contract suite | **171 passed** |
| Extractor suite, isolated | **4 passed**, 44.29s |
| Frontend + extractor in one concurrent Vitest run | Frontend passed; extractor suite timed out under load, then passed in isolation |
| Full repository ESLint (`npm run lint`) | Passed, no output |
| Backend Ruff (`ruff check app tests`) | Passed |
| AI Ruff on changed files | Passed |
| AI Ruff across `ai_service` | One pre-existing `I001` in unchanged `tests/test_cors.py:20` |
| `git diff --check` | Clean |
| `alembic check` on test database | No new upgrade operations detected |
| `alembic heads` | `0005_project_case_study (head)` |
| Test database version | `0005_project_case_study` |
| Staged files | None |
| JSONB null/distinctness probe | Passed: SQL `NULL` distinct from JSON object; invalid scalar/array values rejected |
| Admin raw-value probe | Passed: unexpected stored keys preserved |
| Temporary extractor output | 5 projects, all `caseStudy: null`, one distinct key set, 19,799 bytes |

The combined Vitest run reported:

```text
Hook timed out in 120000ms
scripts/extract-content.test.mjs:45
```

The same extractor file passed all four tests when run alone. The timeout occurred while the full backend suite was consuming machine resources. This is treated as a resource-contention issue, not a functional regression.

The AI-wide Ruff failure is present in the unchanged HEAD version of `ai_service/tests/test_cors.py` and is unrelated to this commit candidate. Ruff passes on every changed AI file.

## 7. Non-Blocking Observations and Residual Risks

These items do not block the commit:

1. The extractor contract test is slow and can exceed its hook timeout when run concurrently with the full backend suite. It passes in isolation.
2. The AI service has a pre-existing repository-wide Ruff `I001` in `ai_service/tests/test_cors.py:20`. The file is unchanged and the changed AI files pass.
3. There is no dedicated automated test for admin raw-invalid recovery; an independent rolled-back probe confirmed the current mapping preserves unexpected keys.
4. Some admin edge cases rely on the shared case-study validator tests rather than separate endpoint tests.
5. There is no dedicated assertion for an audit row being cleared; existing audit coverage and the full suite pass.
6. The earlier D5 report contains a superseded `role: "\uFEFF"` row. The U10.2 final approval audit documents the corrected behavior.
7. The nullable-column comment in `backend/app/schemas/admin_content.py` does not list the new `case_study` column. This is documentation drift, not behavior.
8. The extractor emits `caseStudy: null` and does not ingest future case-study data from `src/data`. Actual case-study content ingestion remains outside U10.3.
9. No browser E2E or production build was run because U10.3 changed no UI rendering and the relevant contract suites pass.

## 8. Commit Recommendation

- Use one commit for the complete U10.2 + U10.3 candidate.
- Stage exactly the 33 paths in the manifest above.
- Do not stage ignored local artifacts.
- Recommended commit message:

```text
feat: add project case study contract and API
```

No file was staged or committed by this audit.

READY FOR COMMIT APPROVAL
