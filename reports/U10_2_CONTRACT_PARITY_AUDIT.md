# U10.2 Contract Parity Audit

- Date: 2026-11-10
- Repository: `/home/riturajlabs/Projects/portfolio`
- Branch: `feature/portfolio-u8-work`
- HEAD: `0ccc7ef0deea9d8710af4b7225b2eb8799e53723`
- Audit target: the uncommitted U10.2 working tree on top of HEAD
- Mode: read-only audit. No implementation, test, schema, dependency, generated-content, or Git changes were made.
- Output: this report only.
- Result: **NEEDS CORRECTION**

---

## 1. Executive Summary

U10.2 added the backend, AI-service, and frontend case-study validators and contract tests. The focused suites pass: 42 backend tests, 19 AI tests, and 68 frontend tests. Passing tests do not establish contract parity.

The shared 33-case probe set found:

- 21 cases with identical acceptance/rejection behavior.
- 2 cases where backend is intentionally `N/A` because the public backend `Project` has no `caseStudy` field in U10.2.
- 10 cases with real backend/AI versus frontend disagreement, grouped into four root causes.

The four parity defects are:

1. Pydantic numeric/bool coercion: backend/AI accept `true` or numeric strings for integer fields; frontend rejects them.
2. Unicode date digits: backend/AI accept Arabic-Indic digits in `timeline.start`; frontend rejects them.
3. String length counting: backend/AI count Unicode code points; frontend counts UTF-16 code units. A 120-emoji role is accepted by backend/AI and rejected by frontend.
4. 32 KiB size basis: backend/AI measure normalized Pydantic JSON; frontend measures raw incoming JSON. Documents that are under the limit raw but over it normalized are accepted by frontend and rejected by backend/AI.

**Recommendation:** do not approve U10.2 until these four discrepancies are corrected and the shared probes are rerun. No implementation changes were made by this audit.

---

## 2. Scope and Method

### 2.1 Files inspected

- `reports/U10_1_CASE_STUDY_ARCHITECTURE_DESIGN.md`
- `backend/app/schemas/content.py`
- `backend/tests/test_case_study_contract.py`
- `ai_service/services/content_api.py`
- `ai_service/tests/test_case_study_contract.py`
- `src/lib/content.js`
- `src/lib/content.test.js`

### 2.2 Probe harness

The audit used a temporary harness outside the repository:

- `/tmp/opencode/u10_2_audit/build_cases.py`
- `/tmp/opencode/u10_2_audit/cases.json` (33 cases)
- `/tmp/opencode/u10_2_audit/backend_runner.py`
- `/tmp/opencode/u10_2_audit/ai_runner.py`
- `/tmp/opencode/u10_2_audit/frontend_runner.mjs`
- `/tmp/opencode/u10_2_audit/backend_results.json`
- `/tmp/opencode/u10_2_audit/ai_results.json`
- `/tmp/opencode/u10_2_audit/frontend_results.json`

Each runner sends the same logical case through the relevant validator. The frontend runner uses the real `validateContent` path, including the missing-`caseStudy` normalization in `src/lib/content.js:824-826`.

### 2.3 Focused tests run

| Command | Result |
| --- | --- |
| `cd backend && TEST_DATABASE_URL=... .venv/bin/python -m pytest -q tests/test_case_study_contract.py` | 42 passed |
| `cd ai_service && .venv/bin/python -m pytest -q tests/test_case_study_contract.py` | 19 passed |
| `npx vitest run src/lib/content.test.js --reporter=dot` | 68 passed |
| `cd backend && .venv/bin/python -m ruff check app/schemas/content.py tests/test_case_study_contract.py` | passed |
| `cd ai_service && .venv/bin/python -m ruff check services/content_api.py tests/test_case_study_contract.py` | passed |
| `npx eslint src/lib/content.js src/lib/content.test.js` | passed |

The focused backend test file does not use database fixtures; it exercises the Pydantic validators directly. No database migration or database write was performed.

---

## 3. Baseline and Scope Verification

| Check | Evidence | Result |
| --- | --- | --- |
| Branch | `git rev-parse --abbrev-ref HEAD` | `feature/portfolio-u8-work` |
| HEAD | `git rev-parse HEAD` | `0ccc7ef0deea9d8710af4b7225b2eb8799e53723` |
| Working tree | `git status --short` | U10.2 implementation/test changes plus prior U10 reports |
| Whitespace errors | `git diff --check` | clean |
| Dependency changes | `git diff --name-only -- package.json package-lock.json pnpm-lock.yaml yarn.lock` | none |
| Database migration/model changes | `git diff --name-only -- backend/alembic backend/app/models` | none |
| Public API wiring | `git diff --name-only -- backend/app/services backend/app/routes` | none |
| Admin/renderer changes | `git diff --name-only -- src/admin src/components` | none |
| Generated content | `git diff --name-only -- src/generated scripts` | none |
| Commit/push | no Git write commands run | none |

The working tree was not clean at audit start because the U10.2 implementation is uncommitted. The audit therefore targets the working tree, not HEAD alone. HEAD does not contain U10.2.

The public backend `Project` model remains unchanged and has no `caseStudy` field: `backend/app/schemas/content.py:400-427`. This is the intentional U10.2 scope decision, not a parity defect.

---

## 4. Rule-by-Rule Parity Matrix

Legend: **PASS** means the three validators agree on acceptance/rejection for the rule; **FAIL** means they do not.

| U10.1 rule | Design reference | Backend / AI / Frontend references | Verdict |
| --- | --- | --- | --- |
| `schemaVersion` is required and exactly `1` | `reports/U10_1_CASE_STUDY_ARCHITECTURE_DESIGN.md:362`, `:373` | `backend/app/schemas/content.py:345`; `ai_service/services/content_api.py:342`; `src/lib/content.js:1356` | **FAIL** — Pydantic accepts `true` as `1`; frontend rejects. See D1. |
| Unknown keys are rejected at every level | `reports/U10_1_CASE_STUDY_ARCHITECTURE_DESIGN.md:361`, `:531` | `backend/app/schemas/content.py:36`, `:341`; `ai_service/services/content_api.py:49`, `:338`; `src/lib/content.js:483`, `:1335-1353` | **PASS** |
| Required strings are non-blank and bounded; optional strings are bounded | `reports/U10_1_CASE_STUDY_ARCHITECTURE_DESIGN.md:355-356`, `:369-387` | `backend/app/schemas/content.py:50-71`; `ai_service/services/content_api.py:62-83`; `src/lib/content.js:492-527` | **FAIL** — max-length counting differs for non-BMP characters. See D3. |
| Optional empty strings normalize to `null` / `None` | `reports/U10_1_CASE_STUDY_ARCHITECTURE_DESIGN.md:355`, `:531` | `backend/app/schemas/content.py:55-59`, `:66-70`; `ai_service/services/content_api.py:67-71`, `:78-82`; `src/lib/content.js:468-470`, `:520-522` | **PASS** |
| A non-null document must have a substantive field besides `schemaVersion` | `reports/U10_1_CASE_STUDY_ARCHITECTURE_DESIGN.md:360`, `:388` | `backend/app/schemas/content.py:362-380`; `ai_service/services/content_api.py:360-378`; `src/lib/content.js:1433-1455` | **PASS** |
| Array limits and per-item string limits | `reports/U10_1_CASE_STUDY_ARCHITECTURE_DESIGN.md:375-386`, `:415-425`, `:432-484` | `backend/app/schemas/content.py:349-359`; `ai_service/services/content_api.py:346-356`; `src/lib/content.js:533-566`, `:1383-1427` | **PASS** for limits; item string length still inherits D3. |
| Timeline accepts `YYYY` or `YYYY-MM`; year-only normalization; reversed ranges rejected | `reports/U10_1_CASE_STUDY_ARCHITECTURE_DESIGN.md:390-413` | `backend/app/schemas/content.py:39`, `:93-99`, `:166-189`; `ai_service/services/content_api.py:51`, `:105-111`, `:176-198`; `src/lib/content.js:431`, `:836-883` | **FAIL** — Python `\d` accepts Unicode digits; frontend `\d` is ASCII. See D2. |
| Evidence status/source rules; bare URLs are not sources | `reports/U10_1_CASE_STUDY_ARCHITECTURE_DESIGN.md:510-526` | `backend/app/schemas/content.py:40`, `:277-296`; `ai_service/services/content_api.py:52`, `:278-296`; `src/lib/content.js:1148-1187` | **PASS** |
| Quantitative outcomes require metric/value/evidence; qualitative outcomes reject quantitative fields | `reports/U10_1_CASE_STUDY_ARCHITECTURE_DESIGN.md:466-483` | `backend/app/schemas/content.py:298-331`; `ai_service/services/content_api.py:298-330`; `src/lib/content.js:1189-1284` | **PASS** |
| Link/image URLs are absolute `http(s)` or flat local image paths; unsafe schemes/characters rejected | `reports/U10_1_CASE_STUDY_ARCHITECTURE_DESIGN.md:486-498`, `:502`, `:516` | `backend/app/schemas/content.py:41-42`, `:73-89`, `:225-238`; `ai_service/services/content_api.py:53-54`, `:85-101`, `:230-243`; `src/lib/content.js:432-433`, `:974-1001`, `:1286-1321` | **PASS** |
| Duplicate link URLs are rejected | `reports/U10_1_CASE_STUDY_ARCHITECTURE_DESIGN.md:504` | `backend/app/schemas/content.py:386-391`; `ai_service/services/content_api.py:383-388`; `src/lib/content.js:1310-1318` | **PASS** for acceptance; minor diagnostic difference for repeated invalid URLs. |
| Image `width` and `height` are positive integers | `reports/U10_1_CASE_STUDY_ARCHITECTURE_DESIGN.md:491-492` | `backend/app/schemas/content.py:226-227`; `ai_service/services/content_api.py:231-232`; `src/lib/content.js:473-475`, `:1003-1008` | **FAIL** — Pydantic accepts numeric strings and `true`; frontend rejects. See D1. |
| `team.size` is an integer from 1 to 1000 | `reports/U10_1_CASE_STUDY_ARCHITECTURE_DESIGN.md:415-423` | `backend/app/schemas/content.py:196`; `ai_service/services/content_api.py:204`; `src/lib/content.js:910-915` | **FAIL** — Pydantic accepts numeric strings and `true`; frontend rejects. See D1. |
| Whole case-study document is at most 32 KiB serialized UTF-8 | `reports/U10_1_CASE_STUDY_ARCHITECTURE_DESIGN.md:530` | `backend/app/schemas/content.py:392-396`; `ai_service/services/content_api.py:389-393`; `src/lib/content.js:1360-1365` | **FAIL** — backend/AI use normalized Pydantic JSON; frontend uses raw JSON. See D4. |

---

## 5. Shared Edge-Case Results

The harness ran 33 cases. `N/A` means the backend public `Project` has no `caseStudy` field in U10.2.

| Case | Backend | AI | Frontend |
| --- | --- | --- | --- |
| `missing_case_study` | N/A | ACCEPT | ACCEPT |
| `explicit_null` | N/A | ACCEPT | ACCEPT |
| `valid_v1` | ACCEPT | ACCEPT | ACCEPT |
| `unsupported_schema_version` | REJECT | REJECT | REJECT |
| `unknown_nested_key` | REJECT | REJECT | REJECT |
| `invalid_month` | REJECT | REJECT | REJECT |
| `reversed_timeline` | REJECT | REJECT | REJECT |
| `year_only_boundaries` | ACCEPT | ACCEPT | ACCEPT |
| `year_only_end_boundary` | ACCEPT | ACCEPT | ACCEPT |
| `missing_quantitative_evidence` | REJECT | REJECT | REJECT |
| `verified_bare_url_source` | REJECT | REJECT | REJECT |
| `reported_descriptive_source` | ACCEPT | ACCEPT | ACCEPT |
| `unverified_quantitative` | ACCEPT | ACCEPT | ACCEPT |
| `unverified_qualitative` | ACCEPT | ACCEPT | ACCEPT |
| `unsafe_javascript_link` | REJECT | REJECT | REJECT |
| `unsafe_data_image` | REJECT | REJECT | REJECT |
| `nested_local_gallery` | REJECT | REJECT | REJECT |
| `duplicate_links` | REJECT | REJECT | REJECT |
| `zero_width` | REJECT | REJECT | REJECT |
| `negative_height` | REJECT | REJECT | REJECT |
| `schema_version_true` | ACCEPT | ACCEPT | REJECT |
| `schema_version_string` | REJECT | REJECT | REJECT |
| `width_string` | ACCEPT | ACCEPT | REJECT |
| `width_true` | ACCEPT | ACCEPT | REJECT |
| `height_string` | ACCEPT | ACCEPT | REJECT |
| `team_size_string` | ACCEPT | ACCEPT | REJECT |
| `team_size_true` | ACCEPT | ACCEPT | REJECT |
| `unicode_digit_year` | ACCEPT | ACCEPT | REJECT |
| `emoji_120_role` | ACCEPT | ACCEPT | REJECT |
| `multibyte_raw_under_normalized_under` | ACCEPT | ACCEPT | ACCEPT |
| `multibyte_raw_under_normalized_over` | REJECT | REJECT | ACCEPT |
| `multibyte_raw_exact_limit` | REJECT | REJECT | ACCEPT |
| `multibyte_raw_over_limit` | REJECT | REJECT | REJECT |

The `missing_case_study` and `explicit_null` backend `N/A` results are intentional U10.2 scope, not parity failures.

---

## 6. Discrepancies

### D1. Pydantic accepts non-integer values for integer fields

**Observed evidence**

| Probe | Input | Backend | AI | Frontend |
| --- | --- | --- | --- | --- |
| `schema_version_true` | `schemaVersion: true` | ACCEPT | ACCEPT | REJECT |
| `width_string` | `gallery[0].width: "1600"` | ACCEPT | ACCEPT | REJECT |
| `width_true` | `gallery[0].width: true` | ACCEPT | ACCEPT | REJECT |
| `height_string` | `gallery[0].height: "900"` | ACCEPT | ACCEPT | REJECT |
| `team_size_string` | `team.size: "1"` | ACCEPT | ACCEPT | REJECT |
| `team_size_true` | `team.size: true` | ACCEPT | ACCEPT | REJECT |

**Root cause**

- Backend/AI use `ConfigDict(extra="forbid")` only: `backend/app/schemas/content.py:36`, `ai_service/services/content_api.py:49`.
- `schemaVersion` is `Literal[1]`: `backend/app/schemas/content.py:345`, `ai_service/services/content_api.py:342`. Pydantic accepts `True` because `bool` is an `int` subclass.
- `width` and `height` are `int = Field(gt=0)`: `backend/app/schemas/content.py:226-227`, `ai_service/services/content_api.py:231-232`. Pydantic coerces numeric strings and booleans by default.
- `team.size` is `int | None = Field(ge=1, le=1000)`: `backend/app/schemas/content.py:196`, `ai_service/services/content_api.py:204`. Same coercion.
- Frontend uses strict checks: `caseStudy.schemaVersion !== 1` at `src/lib/content.js:1356`; `Number.isInteger` in `positiveInteger` at `src/lib/content.js:473-475`; integer check for `team.size` at `src/lib/content.js:910-915`.

**Expected by U10.1**

`schemaVersion` is an integer exactly `1`; `team.size`, `width`, and `height` are integers. JSON `true` and `"1600"` are not integers.

**Correction required, not applied**

Use strict Pydantic integer types or explicit type checks for `schemaVersion`, `team.size`, `width`, and `height`, then add the six probes above to backend and AI tests. Frontend behavior is already strict.

---

### D2. Python date regex accepts Unicode digits

**Observed evidence**

| Probe | Input | Backend | AI | Frontend |
| --- | --- | --- | --- | --- |
| `unicode_digit_year` | `timeline.start: "٢٠٢٥"` | ACCEPT | ACCEPT | REJECT |

**Root cause**

- Backend/AI use `re.compile(r"^(?:\d{4}|\d{4}-(?:0[1-9]|1[0-2]))$")`: `backend/app/schemas/content.py:39`, `ai_service/services/content_api.py:51`. Python's `\d` matches Unicode decimal digits by default.
- Frontend uses `/^(?:\d{4}|\d{4}-(?:0[1-9]|1[0-2]))$/`: `src/lib/content.js:431`. JavaScript `\d` is ASCII-only.

**Expected by U10.1**

`timeline.start` and `timeline.end` use the `YYYY` or `YYYY-MM` shape with ASCII digits; invalid months are rejected. Backend/AI accepting Arabic-Indic digits is not parity with frontend.

**Correction required, not applied**

Replace Python `\d` with `[0-9]` or compile with `re.ASCII`, then add the Unicode-digit probe to backend and AI tests.

---

### D3. String length counting differs for non-BMP characters

**Observed evidence**

| Probe | Input | Backend | AI | Frontend |
| --- | --- | --- | --- | --- |
| `emoji_120_role` | `role` is 120 emoji characters | ACCEPT | ACCEPT | REJECT |

**Root cause**

- Backend/AI use Python `len(value)` in `_required_text` / `_optional_text`: `backend/app/schemas/content.py:50-71`, `ai_service/services/content_api.py:62-83`. Python counts Unicode code points; 120 emoji are 120.
- Frontend uses JavaScript string `.length`: `src/lib/content.js:499-527`. JavaScript counts UTF-16 code units; 120 emoji are 240.
- The same divergence applies to every max-length text field, including `role`, `alt`, `caption`, `summary`, `body`, `note`, and array item strings.

**Expected by U10.1**

Bounded text fields use character counts. The contract does not define UTF-16 code units, and the three implementations must agree.

**Correction required, not applied**

Choose one character-counting definition and apply it everywhere. Code-point counting is the simplest cross-language definition; frontend can use `Array.from(value.trim()).length`. Add at least one astral-character boundary probe for a max-length field.

---

### D4. 32 KiB size limit uses different serialization bases

**Observed evidence**

The multibyte probes use six approach sections with CJK body text. All raw JSON is valid under the 32 KiB limit in the first three rows.

| Probe | Raw UTF-8 bytes | Normalized Pydantic bytes | Backend | AI | Frontend |
| --- | ---: | ---: | --- | --- | --- |
| `multibyte_raw_under_normalized_under` (6 × 1800 CJK) | 32,588 | 32,767 | ACCEPT | ACCEPT | ACCEPT |
| `multibyte_raw_under_normalized_over` (6 × 1805 CJK) | 32,678 | 32,857 | REJECT | REJECT | ACCEPT |
| `multibyte_raw_exact_limit` (6 × 1810 CJK) | 32,768 | 32,947 | REJECT | REJECT | ACCEPT |
| `multibyte_raw_over_limit` | 32,948 | over | REJECT | REJECT | REJECT |

**Root cause**

- Backend/AI measure `len(self.model_dump_json().encode("utf-8"))`: `backend/app/schemas/content.py:392-396`, `ai_service/services/content_api.py:389-393`. This is the normalized Pydantic dump, including defaults and normalized fields.
- Frontend measures `utf8ByteLength(JSON.stringify(caseStudy))`: `src/lib/content.js:1360-1365`. This is the raw incoming object before validation normalization.
- The normalized dump can be larger than the raw input because defaults and normalized fields are serialized.

**Expected by U10.1**

The whole case-study document has one 32 KiB serialized UTF-8 limit. The design does not permit backend/AI and frontend to enforce different serializations.

**Correction required, not applied**

Define one canonical serialization for the limit and use it in all three validators. If the normalized document is canonical, frontend must normalize before measuring or measure an equivalent canonical form. If raw input is canonical, backend/AI need an equivalent raw-input check. Add the three boundary probes above to all three test suites.

---

## 7. Test Coverage Gaps

The focused suites pass because they do not cover the discrepant inputs.

| Area | Existing coverage | Missing coverage |
| --- | --- | --- |
| `schemaVersion` | Missing and `2` / `"1"` rejected: `backend/tests/test_case_study_contract.py:145`; `ai_service/tests/test_case_study_contract.py:168-181`; `src/lib/content.test.js:742-752` | `true`, `1.0`, and other non-strict values |
| Numeric fields | Non-positive dimensions only: `backend/tests/test_case_study_contract.py:304-306`; `ai_service/tests/test_case_study_contract.py:245`; `src/lib/content.test.js:865-870`; oversized team only: `backend/tests/test_case_study_contract.py:202-209` | Numeric strings and booleans for `width`, `height`, and `team.size` |
| Timeline | ASCII invalid months/days and reversed ranges: `backend/tests/test_case_study_contract.py:184-199`; `ai_service/tests/test_case_study_contract.py:185-192`; `src/lib/content.test.js:762-788` | Unicode decimal digits |
| String lengths | Normal ASCII values and blank normalization | Astral/non-BMP boundary values such as emoji |
| 32 KiB limit | One clearly over-limit document: `backend/tests/test_case_study_contract.py:326-341`; `ai_service/tests/test_case_study_contract.py:257`; `src/lib/content.test.js:887-900` | Near-boundary multibyte documents where raw and normalized sizes differ |

---

## 8. Intentional Scope Differences

These are not parity failures:

- Backend public `Project` has no `caseStudy` field in U10.2: `backend/app/schemas/content.py:400-427`. The backend contract is exposed through the standalone `CaseStudy` model only.
- AI `Project.caseStudy` is optional: `ai_service/services/content_api.py:418`.
- AI ingestion excludes `caseStudy` from project summaries: `ai_service/services/content_api.py:621`.
- Frontend normalizes missing `caseStudy` to `null`: `src/lib/content.js:824-826`.

---

## 9. Read-Only Scope Verification

The audit made no repository changes. The only new repository file is this report. The audit harness and result files are in `/tmp/opencode/u10_2_audit/`, outside the repository.

Observed working-tree scope:

```text
 M ai_service/services/content_api.py
 M backend/app/schemas/content.py
 M src/lib/content.js
 M src/lib/content.test.js
?? ai_service/tests/test_case_study_contract.py
?? backend/tests/test_case_study_contract.py
?? reports/U10_1_CASE_STUDY_ARCHITECTURE_DESIGN.md
?? reports/U10_PROJECT_CASE_STUDY_AUDIT.md
```

The two existing reports are prior U10 artifacts and were not modified. No dependency, migration, public API wiring, admin, renderer, or generated-content file is changed. `git diff --check` is clean. No commit, push, merge, or deployment was performed.

---

## 10. Final Recommendation

**NEEDS CORRECTION**

U10.2 is not contract-parity complete. The four discrepancies above produce observable acceptance/rejection differences across the three validators:

- Strict integer types for `schemaVersion`, `team.size`, `width`, and `height`.
- ASCII-only date digits.
- One character-counting definition for bounded strings.
- One canonical serialization basis for the 32 KiB limit.

After corrections, rerun the 33-case shared probe set and the focused contract suites. Do not approve or proceed to a later U10 phase until the probe set has no non-intentional disagreements. No implementation changes were made by this audit.
