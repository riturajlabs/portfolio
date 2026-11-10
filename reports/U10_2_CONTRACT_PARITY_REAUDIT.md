# U10.2 Contract Parity Re-Audit

- Date: 2026-11-10
- Repository: `/home/riturajlabs/Projects/portfolio`
- Branch: `feature/portfolio-u8-work`
- HEAD: `0ccc7ef0deea9d8710af4b7225b2eb8799e53723`
- Audit target: the uncommitted U10.2 working tree on top of HEAD
- Mode: read-only audit. No implementation, test, schema, dependency, generated-content, database, or Git changes were made.
- Output: this report only.
- Result: **NEEDS CORRECTION**

---

## 1. Executive Summary

The four corrections from `reports/U10_2_CONTRACT_PARITY_AUDIT.md` are substantially implemented:

- D1 strict integer fields: backend/AI reject booleans, numeric strings, and fractional floats; frontend rejects the same values. The four integral-float probes remain a documented JavaScript parser limitation.
- D2 ASCII-only timeline digits: backend/AI now use `[0-9]`; Arabic-Indic digits are rejected.
- D3 Unicode code-point string lengths: the frontend uses `Array.from(value).length`; emoji boundary probes now agree.
- D4 normalized canonical 32 KiB basis: frontend canonical JSON matches backend Pydantic JSON for the accepted shared corpus, the optional-blank case, the escape-sensitive case, and the exact 32 KiB boundary.

The shared 45-case probe still has only the four known integral-float disagreements. Those are accepted for U10.2 as a transport/parser limitation because backend-origin Pydantic validation would reject lexical `1.0` before emission.

However, the re-audit found one new contract-parity gap outside the shared probe:

- **D5: Python and JavaScript do not define the same whitespace/trim set.**

Python `str.strip()` and Python `\s` treat `U+001C`–`U+001F` and `U+0085` as whitespace. JavaScript `trim()` and `\s` do not. JavaScript treats `U+FEFF` (BOM) as whitespace; Python does not. This changes acceptance/rejection, normalization, URL validation, and canonical byte counts for payloads containing those characters.

Examples confirmed against the real validators:

| Input | Backend | AI | Frontend |
| --- | --- | --- | --- |
| `role: "\uFEFF"` | ACCEPT | ACCEPT | REJECT — empty document |
| `constraints: ["\uFEFF"]` | ACCEPT | ACCEPT | REJECT — required string blank |
| `role: "\u0085"` | REJECT | REJECT | ACCEPT |
| URL `https://example.com/a\u0085b` | REJECT | REJECT | ACCEPT |
| URL `https://example.com/a\uFEFFb` | ACCEPT | ACCEPT | REJECT |

This is low-likelihood content, but it is a real contract divergence: a backend-origin payload that the backend accepts can fail the frontend build, and a frontend-accepted payload can be rejected by the backend/AI.

**Recommendation: NEEDS CORRECTION.** Define one shared trim/whitespace contract, implement it identically in Python and JavaScript (including URL whitespace checks), add BOM/NEL/control-separator probes, then re-run parity.

---

## 2. Scope and Method

### 2.1 Files inspected

- `reports/U10_1_CASE_STUDY_ARCHITECTURE_DESIGN.md`
- `reports/U10_2_CONTRACT_PARITY_AUDIT.md`
- `reports/U10_2_CONTRACT_PARITY_CORRECTIONS.md`
- `backend/app/schemas/content.py`
- `backend/app/services/content.py`
- `backend/app/routes/content.py`
- `backend/app/schemas/admin_content.py`
- `backend/tests/test_case_study_contract.py`
- `ai_service/services/content_api.py`
- `ai_service/tests/test_case_study_contract.py`
- `src/lib/content.js`
- `src/lib/content.test.js`
- `scripts/build-content.mjs`
- `.cache/content-snapshot.json`

### 2.2 Probe harness

The re-audit reused and extended the temporary harness outside the repository:

- `/tmp/opencode/u10_2_audit/build_cases.py`
- `/tmp/opencode/u10_2_audit/cases.json` (45 cases)
- `/tmp/opencode/u10_2_audit/backend_runner.py`
- `/tmp/opencode/u10_2_audit/ai_runner.py`
- `/tmp/opencode/u10_2_audit/frontend_runner.mjs`
- `/tmp/opencode/u10_2_audit/backend_canonical_compare.py`
- `/tmp/opencode/u10_2_audit/frontend_canonical_compare.mjs`
- `/tmp/opencode/u10_2_audit/boundary_cases.json`
- `/tmp/opencode/u10_2_audit/frontend_boundary_runner.mjs`

The frontend runner exercises the real `validateContent` path, including missing-`caseStudy` normalization. Backend and AI runners exercise the real validators. Case studies are injected into the first project of the cached `/api/content` snapshot.

The 45-case probe is not exhaustive. D5 is a new class of input outside that corpus.

### 2.3 Focused tests run

| Command | Result |
| --- | --- |
| `cd backend && <load .env> .venv/bin/python -m pytest -q tests/test_case_study_contract.py` | 68 passed |
| `cd ai_service && .venv/bin/python -m pytest -q tests/test_case_study_contract.py` | 44 passed |
| `npx vitest run src/lib/content.test.js --reporter=dot` | 74 passed |
| `cd backend && .venv/bin/python -m ruff check app/schemas/content.py tests/test_case_study_contract.py` | passed |
| `cd ai_service && .venv/bin/python -m ruff check services/content_api.py tests/test_case_study_contract.py` | passed |
| `npx eslint src/lib/content.js src/lib/content.test.js` | passed |
| `git diff --check` | clean |

The backend test file does not use database fixtures, but `backend/tests/conftest.py` still requires `TEST_DATABASE_URL` at import time. The test URL was loaded from the existing local `.env` through `python-dotenv` without printing credentials. No migration or database write was performed by this audit.

Full suites were not rerun in this re-audit. The focused contract suites exercise the changed validators and are the relevant evidence for parity.

---

## 3. Baseline and Scope Verification

| Check | Evidence | Result |
| --- | --- | --- |
| Branch | `git rev-parse --abbrev-ref HEAD` | `feature/portfolio-u8-work` |
| HEAD | `git rev-parse HEAD` | `0ccc7ef0deea9d8710af4b7225b2eb8799e53723` |
| Working tree | `git status --short` | U10.2 implementation/test changes plus prior U10 reports |
| Whitespace errors | `git diff --check` | clean |
| Dependency changes | no dependency files modified | none |
| Database migration/model changes | no `backend/alembic` or `backend/app/models` changes | none |
| Public API wiring | no `backend/app/services` or `backend/app/routes` changes | none |
| Admin/renderer changes | no `src/admin` or `src/components` changes | none |
| Generated content | no `src/generated` or `scripts` changes | none |

The public backend `Project` model still has no `caseStudy` field. This is the intentional U10.2 scope decision, not a parity defect. Backend results for `missing_case_study` and `explicit_null` are therefore `N/A`.

`rg` confirmed that `caseStudy`/`case_study` is absent from backend app/routes/services/admin schemas outside the contract tests. No U10.2 backend public wiring exists to audit.

---

## 4. Rule-by-Rule Parity Matrix

| U10.1 rule | Backend / AI / Frontend references | Verdict |
| --- | --- | --- |
| `schemaVersion` is required and exactly `1` | `backend/app/schemas/content.py:39,352`; `ai_service/services/content_api.py:40,343`; `src/lib/content.js:1488-1490` | **PASS** for booleans, strings, fractional floats; integral `1.0` remains a JavaScript parser limitation |
| Unknown keys are rejected at every level | `backend/app/schemas/content.py:36`; `ai_service/services/content_api.py:49`; `src/lib/content.js:485-491,1466-1486` | **PASS** |
| Required strings are non-blank and bounded; optional strings are bounded | `backend/app/schemas/content.py:52-78`; `ai_service/services/content_api.py:58-84`; `src/lib/content.js:493-535` | **FAIL** — length counting is fixed, but D5 trim-set mismatch remains |
| Optional empty strings normalize to `null` / `None` | `backend/app/schemas/content.py:64-78`; `ai_service/services/content_api.py:70-84`; `src/lib/content.js:467-471,515-535` | **FAIL** — D5 trim-set mismatch |
| A non-null document must have a substantive field besides `schemaVersion` | `backend/app/schemas/content.py:362-380`; `ai_service/services/content_api.py:360-378`; `src/lib/content.js:1556-1581` | **FAIL** — BOM/NEL-only text can change substantive-field detection because of D5 |
| Array limits and per-item string limits | `backend/app/schemas/content.py:349-369`; `ai_service/services/content_api.py:346-360`; `src/lib/content.js:537-554` | **PASS** for limits and code-point counts; item blankness inherits D5 |
| Timeline accepts `YYYY` or `YYYY-MM`; year-only normalization; reversed ranges rejected | `backend/app/schemas/content.py:46,166-189`; `ai_service/services/content_api.py:52,176-198`; `src/lib/content.js:431,848-905` | **PASS** for ASCII dates; trim blankness inherits D5 |
| Evidence status/source rules; bare URLs are not sources | `backend/app/schemas/content.py:277-296`; `ai_service/services/content_api.py:278-296`; `src/lib/content.js:1148-1187` | **PASS** for standard input; URL whitespace inherits D5 |
| Quantitative outcomes require metric/value/evidence; qualitative outcomes reject quantitative fields | `backend/app/schemas/content.py:298-331`; `ai_service/services/content_api.py:298-330`; `src/lib/content.js:1189-1284` | **PASS** |
| Link/image URLs are absolute `http(s)` or flat local image paths; unsafe schemes/characters rejected | `backend/app/schemas/content.py:41-42,81-97,225-238`; `ai_service/services/content_api.py:53-54,91-101,230-243`; `src/lib/content.js:432-434,556-566,974-1001,1286-1321` | **FAIL** — Python `\s` and JavaScript `\s` differ for U+0085/U+001C–U+001F/U+FEFF |
| Duplicate link URLs are rejected | `backend/app/schemas/content.py:386-391`; `ai_service/services/content_api.py:383-388`; `src/lib/content.js:1310-1318` | **PASS** for acceptance; minor diagnostic difference for repeated invalid URLs |
| Image `width` and `height` are positive integers | `backend/app/schemas/content.py:233-234`; `ai_service/services/content_api.py:232-233`; `src/lib/content.js:473-475,1003-1008` | **PASS** except documented integral-float limitation |
| `team.size` is an integer from 1 to 1000 | `backend/app/schemas/content.py:203`; `ai_service/services/content_api.py:205`; `src/lib/content.js:910-915` | **PASS** except documented integral-float limitation |
| Whole case-study document is at most 32 KiB serialized UTF-8 | `backend/app/schemas/content.py:399-402`; `ai_service/services/content_api.py:390-393`; `src/lib/content.js:1582-1590` | **PASS** for tested corpus and exact boundary; D5 changes canonical bytes for BOM/NEL text |

---

## 5. Shared Probe Results

The 45-case probe produced:

- 39 cases where backend, AI, and frontend agree.
- 2 cases where backend is intentionally `N/A` because the public `Project` has no `caseStudy` field.
- 4 integral-float cases where backend/AI reject and frontend accepts.

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
| `schema_version_true` | REJECT | REJECT | REJECT |
| `schema_version_string` | REJECT | REJECT | REJECT |
| `schema_version_float` | REJECT | REJECT | ACCEPT |
| `schema_version_fractional` | REJECT | REJECT | REJECT |
| `width_string` | REJECT | REJECT | REJECT |
| `width_true` | REJECT | REJECT | REJECT |
| `height_string` | REJECT | REJECT | REJECT |
| `team_size_string` | REJECT | REJECT | REJECT |
| `team_size_true` | REJECT | REJECT | REJECT |
| `width_float` | REJECT | REJECT | ACCEPT |
| `height_float` | REJECT | REJECT | ACCEPT |
| `team_size_float` | REJECT | REJECT | ACCEPT |
| `width_fractional` | REJECT | REJECT | REJECT |
| `height_fractional` | REJECT | REJECT | REJECT |
| `team_size_fractional` | REJECT | REJECT | REJECT |
| `unicode_digit_year` | REJECT | REJECT | REJECT |
| `unicode_digit_month` | REJECT | REJECT | REJECT |
| `emoji_120_role` | ACCEPT | ACCEPT | ACCEPT |
| `emoji_121_role` | REJECT | REJECT | REJECT |
| `emoji_240_constraint` | ACCEPT | ACCEPT | ACCEPT |
| `emoji_241_constraint` | REJECT | REJECT | REJECT |
| `multibyte_raw_under_normalized_under` | ACCEPT | ACCEPT | ACCEPT |
| `multibyte_raw_under_normalized_over` | REJECT | REJECT | REJECT |
| `multibyte_raw_exact_limit` | REJECT | REJECT | REJECT |
| `multibyte_raw_over_limit` | REJECT | REJECT | REJECT |

---

## 6. Canonical JSON and 32 KiB Boundary

The frontend `canonicalCaseStudy` output was compared byte-for-byte with backend `CaseStudy.model_dump_json()` for every backend-accepted shared case and two additional cases.

| Case | Canonical bytes | Frontend/backend identical |
| --- | ---: | --- |
| `valid_v1` | 1914 | Yes |
| `year_only_boundaries` | 1893 | Yes |
| `year_only_end_boundary` | 1896 | Yes |
| `reported_descriptive_source` | 1877 | Yes |
| `unverified_quantitative` | 1816 | Yes |
| `unverified_qualitative` | 1970 | Yes |
| `emoji_120_role` | 2369 | Yes |
| `emoji_240_constraint` | 2840 | Yes |
| `multibyte_raw_under_normalized_under` | 32767 | Yes |
| `blank_case` | 1843 | Yes |
| `escape_case` | 1926 | Yes |

An additional exact-boundary corpus used 12 approach sections, 12 constraints, 12 learnings, a 600-character problem summary, and a variable 953–955-character problem context:

| Variable context length | Canonical bytes | Backend | AI | Frontend |
| ---: | ---: | --- | --- | --- |
| 953 | 32767 | ACCEPT | ACCEPT | ACCEPT |
| 954 | 32768 | ACCEPT | ACCEPT | ACCEPT |
| 955 | 32769 | REJECT | REJECT | REJECT |

The frontend and backend canonical strings were byte-identical at 32767 and 32768 bytes.

This validates D4 for standard whitespace and Unicode content. It does not cover D5 characters; those change the frontend trim basis and therefore the canonical byte count.

---

## 7. Re-Verification of the Four Corrections

### D1. Strict integer fields

**Status: PASS for booleans, numeric strings, and fractional floats.**

Backend/AI use `StrictInt`:

- `schemaVersion: StrictInt = Field(ge=1, le=1)`
- `team.size: StrictInt | None = Field(default=None, ge=1, le=1000)`
- `gallery[].width: StrictInt = Field(gt=0)`
- `gallery[].height: StrictInt = Field(gt=0)`

References:

- `backend/app/schemas/content.py:39,203,233-234,352`
- `ai_service/services/content_api.py:40,205,232-233,343`

Frontend rejects booleans, strings, and fractional numbers with `Number.isInteger`.

Remaining integral-float cases:

| Case | Backend | AI | Frontend |
| --- | --- | --- | --- |
| `schema_version_float` | REJECT | REJECT | ACCEPT |
| `width_float` | REJECT | REJECT | ACCEPT |
| `height_float` | REJECT | REJECT | ACCEPT |
| `team_size_float` | REJECT | REJECT | ACCEPT |

**Classification: accepted U10.2 limitation.** `JSON.parse` normalizes `1.0` to the number `1` before validation, so the frontend cannot distinguish the lexical token. Backend/AI reject it with `StrictInt`. In the backend-origin flow, Pydantic validation rejects lexical `1.0` before emission, and integer serialization emits `1`, not `1.0`. A raw-token parser is a separate scope decision, not a U10.2 correction.

### D2. ASCII-only timeline digits

**Status: PASS.**

Backend/AI now use:

```python
_CASE_STUDY_DATE_RE = re.compile(r"^(?:[0-9]{4}|[0-9]{4}-(?:0[1-9]|1[0-2]))$")
```

References:

- `backend/app/schemas/content.py:46`
- `ai_service/services/content_api.py:52`

`unicode_digit_year` and `unicode_digit_month` are rejected by all three validators. Year-only normalization and reversed-range rejection remain intact.

### D3. Unicode code-point string lengths

**Status: PASS.**

The frontend uses:

```js
function codePointLength(value) {
    return Array.from(value).length;
}
```

References:

- `src/lib/content.js:477-479`
- `src/lib/content.js:503`
- `src/lib/content.js:526`

`emoji_120_role` and `emoji_240_constraint` are accepted; 121/241 are rejected by all three validators.

### D4. Canonical 32 KiB basis

**Status: PASS for the shared corpus and exact boundary.**

The frontend canonicalizes optional text, arrays, nested objects, and defaults before measuring UTF-8 bytes. The limit remains `32 * 1024`.

References:

- `src/lib/content.js:1332-1456`
- `src/lib/content.js:1582-1590`

Canonical JSON was byte-identical for the 11 accepted shared cases plus the exact boundary. The raw-over-normalized 1805/1810 JSON cases now agree because the frontend measures the normalized form.

D5 shows that the canonical basis is still not fully shared for BOM/NEL text.

---

## 8. New Finding: D5 — Trim/Whitespace Set Mismatch

### 8.1 Observed evidence

Python and JavaScript use different definitions of whitespace:

| Code point | Name | Python `strip()` / `\s` | JavaScript `trim()` / `\s` |
| --- | --- | --- | --- |
| U+001C–U+001F | Information separators | Whitespace | Not whitespace |
| U+0085 | Next line (NEL) | Whitespace | Not whitespace |
| U+FEFF | Zero width no-break space (BOM) | Not whitespace | Whitespace |

The full Python-only blank set is `U+001C`, `U+001D`, `U+001E`, `U+001F`, and `U+0085`. The JavaScript-only blank set is `U+FEFF`.

### 8.2 Confirmed failures

These were run through the real backend/AI/frontend validators:

| Probe | Backend | AI | Frontend |
| --- | --- | --- | --- |
| `role: "\uFEFF"` | ACCEPT | ACCEPT | REJECT — no substantive field |
| `constraints: ["\uFEFF"]` | ACCEPT | ACCEPT | REJECT — required string blank |
| `role: "\u0085"` | REJECT | REJECT | ACCEPT |
| `constraints: ["\u0085"]` | REJECT | REJECT | ACCEPT |
| URL `https://example.com/a\u0085b` | REJECT | REJECT | ACCEPT |
| URL `https://example.com/a\uFEFFb` | ACCEPT | ACCEPT | REJECT |

Canonical size also diverges:

| Probe | Backend canonical bytes | Frontend canonical bytes |
| --- | ---: | ---: |
| `role: "\uFEFFSolo\uFEFF"` | 220 | 214 |
| `role: "Solo\u0085"` | 214 | 216 |

### 8.3 Root cause

- Backend/AI trim with Python `str.strip()` and use Python regex `\s`:
  - `backend/app/schemas/content.py:52-78,81-97`
  - `ai_service/services/content_api.py:58-84,91-101`
- Frontend trims with JavaScript `String.prototype.trim()` and uses JavaScript regex `\s`:
  - `src/lib/content.js:432-434,467-471,493-535`
- The design says strings are trimmed and optional blanks normalize to `null`, but does not define the trim set:
  - `reports/U10_1_CASE_STUDY_ARCHITECTURE_DESIGN.md:355-356`

### 8.4 Impact

- Required strings: backend/AI reject BOM-only strings that the frontend accepts, and frontend rejects NEL/control-separator-only strings that backend/AI accept.
- Optional strings: blank normalization differs, changing the substantive-field check.
- URLs: Python `\s` rejects NEL/control separators; JavaScript `\s` accepts them. JavaScript `\s` rejects BOM; Python accepts it.
- Canonical 32 KiB basis: frontend and backend trim different text before serializing, so byte counts differ.
- Backend-origin risk: a future backend/admin payload containing a BOM-only required string can be accepted by Pydantic and then fail the frontend build. This is not reachable in the current U10.2 public API because `caseStudy` is not exposed, but it is a real contract gap for the approved future wiring.

### 8.5 Correction required

Do not treat D5 as an accepted limitation without an explicit contract decision. Choose and document one trim/URL-whitespace set, then make Python and JavaScript identical. For example, define an explicit character class, use it for required/optional text and URL checks, and add probes for:

- U+FEFF at the start/end of required and optional text.
- U+FEFF inside a URL.
- U+0085 and U+001C–U+001F in required/optional text and URLs.
- A canonical size boundary case where the divergent characters change the byte count.

The fix should not change the existing limits, canonical key order, or standard whitespace behavior.

---

## 9. Test Coverage Gaps

| Area | Existing coverage | Missing coverage |
| --- | --- | --- |
| D1 strict integers | Backend/AI/frontend tests cover booleans, strings, fractional floats, and integral floats | None for D1 acceptance; raw-token lexical validation is separate scope |
| D2 ASCII dates | Arabic-Indic year and month cases exist in all three suites | None |
| D3 code points | Emoji 120/121 and 240/241 cases exist in all three suites | None |
| D4 canonical size | 1800/1805/1810 multibyte cases exist; re-audit added exact 32767/32768/32769 boundary outside the repo | Committed exact-boundary test is still absent |
| D5 trim set | Not covered | BOM, NEL, and U+001C–U+001F text and URL probes, including canonical bytes |

---

## 10. Working Tree at Report Creation

```text
 M ai_service/services/content_api.py
 M backend/app/schemas/content.py
 M src/lib/content.js
 M src/lib/content.test.js
?? ai_service/tests/test_case_study_contract.py
?? backend/tests/test_case_study_contract.py
?? reports/U10_1_CASE_STUDY_ARCHITECTURE_DESIGN.md
?? reports/U10_2_CONTRACT_PARITY_AUDIT.md
?? reports/U10_2_CONTRACT_PARITY_CORRECTIONS.md
?? reports/U10_2_CONTRACT_PARITY_REAUDIT.md
?? reports/U10_PROJECT_CASE_STUDY_AUDIT.md
```

This report was the only repository file created by the re-audit. No implementation, test, schema, dependency, generated-content, database, or Git state was changed.

---

## 11. Recommendation

**NEEDS CORRECTION.**

D1–D4 are implemented and independently verified for the shared corpus. The four integral-float disagreements are accepted as a U10.2 JavaScript parser limitation because backend-origin validation prevents lexical `1.0` from reaching the frontend.

D5 is a new, real contract-parity gap. The three validators do not share one trim/whitespace definition, so required/optional text, URL validation, substantive-field detection, and canonical byte counts can disagree for BOM, NEL, and information-separator characters. Align the whitespace contract in all three implementations, add the missing probes, and re-run this audit before starting U10.3.
