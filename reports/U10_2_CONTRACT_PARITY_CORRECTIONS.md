# U10.2 Contract Parity Corrections

Date: 2026-11-10

Branch: `feature/portfolio-u8-work`

HEAD: `0ccc7ef0deea9d8710af4b7225b2eb8799e53723`

Status: Corrections implemented. Not approved. Pending re-audit.

## Scope

Implemented the four corrections from `reports/U10_2_CONTRACT_PARITY_AUDIT.md`:

- D1: strict integer fields in backend/AI and strict frontend integer checks.
- D2: ASCII-only timeline digits in backend/AI.
- D3: Unicode code-point string lengths in the frontend.
- D4: normalized canonical JSON as the 32 KiB measurement basis in the frontend.

The approved architecture and the audit report were not modified. No dependencies, migrations, database models, public API routes, admin flows, renderers, AI ingestion paths, generated content, or Git state were changed.

## Corrections Implemented

### D1: Strict Integer Fields

Backend and AI now use Pydantic `StrictInt` for every integer contract field:

- `schemaVersion: StrictInt = Field(ge=1, le=1)`
- `team.size: StrictInt | None = Field(default=None, ge=1, le=1000)`
- `gallery[].width: StrictInt = Field(gt=0)`
- `gallery[].height: StrictInt = Field(gt=0)`

Locations:

- `backend/app/schemas/content.py:39`, `:203`, `:233-234`, `:352`
- `ai_service/services/content_api.py:40`, `:205`, `:232-233`, `:343`

The frontend already rejects booleans, numeric strings, and fractional floats with `Number.isInteger`. It cannot reject the lexical form `1.0` after `JSON.parse` because JavaScript normalizes that token to the number `1` before validation. This limitation is documented below and covered by a regression test.

### D2: ASCII-Only Timeline Digits

Backend and AI timeline validation now uses ASCII `[0-9]` instead of Unicode `\d`:

```python
_CASE_STUDY_DATE_RE = re.compile(r"^(?:[0-9]{4}|[0-9]{4}-(?:0[1-9]|1[0-2]))$")
```

Locations:

- `backend/app/schemas/content.py:46`
- `ai_service/services/content_api.py:52`

Existing normalization and reversed-range behavior is unchanged: `2025` as an end date normalizes to December, and `start > end` remains rejected.

### D3: Unicode Code-Point String Lengths

The frontend now measures trimmed string lengths with code points:

```js
function codePointLength(value) {
    return Array.from(value).length;
}
```

`checkRequiredString` and `checkOptionalString` use this helper. The change applies to every bounded text field and array item string because both helpers are the shared length gates. Existing limits are unchanged.

Locations:

- `src/lib/content.js:477-479`
- `src/lib/content.js:503`
- `src/lib/content.js:526`

### D4: Canonical 32 KiB Measurement

The frontend now measures a normalized canonical case-study representation instead of the raw incoming object:

- `canonicalOptionalText` trims optional text and converts blank values to `null`.
- `canonicalRequiredText` trims required text.
- `canonicalImage` and `canonicalCaseStudy` reproduce the normalized backend shape and defaults.
- The size check runs only after case-study validation has produced no problems.
- The measured value is `utf8ByteLength(JSON.stringify(canonicalCaseStudy(caseStudy)))`.
- The limit remains exactly `32 * 1024` bytes.

Locations:

- `src/lib/content.js:1332-1456`
- `src/lib/content.js:1581-1590`

Canonical output was compared against Pydantic `model_dump_json()` for every accepted shared-probe case study. The JSON was byte-identical for all nine accepted case-study cases, including omitted arrays, null nested objects, emoji text, and multibyte approach bodies. A separate optional-blank normalization case (`role`, `problem.context`, and `team.note` set to whitespace) also matched exactly at 1843 bytes. A separate escape-sensitive case containing U+2028, U+2029, quotes, backslashes, tabs, and newlines also matched byte-for-byte.

Example canonical byte counts:

| Case | Frontend canonical bytes | Backend canonical bytes | Match |
| --- | ---: | ---: | --- |
| `valid_v1` | 1914 | 1914 | Yes |
| `emoji_120_role` | 2369 | 2369 | Yes |
| `emoji_240_constraint` | 2840 | 2840 | Yes |
| `multibyte_raw_under_normalized_under` (1800) | 32767 | 32767 | Yes |
| `multibyte_raw_under_normalized_over` (1805) | 32857 | 32857 | Yes |

## Regression Coverage Added

Backend (`backend/tests/test_case_study_contract.py`):

- `schemaVersion` rejects `true`, `false`, `1.0`, `1.5`, and `"1"`.
- Timeline rejects Arabic-Indic digits in year and month forms.
- `team.size` rejects `"1"`, `true`, `false`, `1.0`, and `1.5`.
- Image dimensions reject `"1600"`, `true`, `false`, `1600.0`, and `1600.5`.
- Emoji boundaries: 120 code points accepted, 121 rejected; 240-item constraint accepted, 241 rejected.
- Canonical multibyte boundaries: body length 1800 accepted; 1805 and 1810 rejected while raw JSON remains under 32 KiB.

AI (`ai_service/tests/test_case_study_contract.py`):

- `schemaVersion` rejects `true`, `false`, `1.0`, and `1.5`.
- Timeline rejects Arabic-Indic digits.
- `team.size` rejects `"1"`, `true`, `false`, `1.0`, and `1.5`.
- Image dimensions reject `"1600"`, `true`, `false`, `1600.0`, and `1600.5`.
- Emoji boundaries: 120/240 accepted; 121/241 rejected.
- Canonical multibyte boundaries: 1800 accepted; 1805 and 1810 rejected.

Frontend (`src/lib/content.test.js`):

- `schemaVersion` rejects `true`, `false`, `"1"`, and `1.5`.
- Documents the JavaScript integral-float limitation with `schemaVersion = 1.0`.
- Timeline rejects Arabic-Indic digits.
- Gallery dimensions and `team.size` reject strings, booleans, and fractional floats.
- Emoji boundaries: 120/240 accepted; 121/241 rejected.
- Canonical multibyte boundaries: 1800 accepted; 1805 and 1810 rejected.

## Shared Probe Results

Harness: `/tmp/opencode/u10_2_audit/`

Before corrections, the audit harness had 33 cases and 10 disagreements across the four root causes.

After corrections, the harness has 45 cases:

- 39 cases: backend, AI, and frontend all agree.
- 2 cases: backend is not applicable because the project has no case study (`missing_case_study`, `explicit_null`); AI and frontend both accept.
- 4 cases: the documented JavaScript integral-float limitation.

Remaining mismatches:

| Case | Backend | AI | Frontend | Classification |
| --- | --- | --- | --- | --- |
| `schema_version_float` | Reject | Reject | Accept | JS normalizes `1.0` to `1` before validation |
| `width_float` | Reject | Reject | Accept | JS normalizes `1600.0` to `1600` before validation |
| `height_float` | Reject | Reject | Accept | JS normalizes `900.0` to `900` before validation |
| `team_size_float` | Reject | Reject | Accept | JS normalizes `1.0` to `1` before validation |

All requested non-float regression cases now agree:

- `schema_version_true`, `schema_version_string`, `schema_version_fractional`: reject.
- `width_string`, `width_true`, `width_fractional`: reject.
- `height_string`, `height_true`, `height_fractional`: reject.
- `team_size_string`, `team_size_true`, `team_size_fractional`: reject.
- `unicode_digit_year`, `unicode_digit_month`: reject.
- `emoji_120_role`, `emoji_240_constraint`: accept.
- `emoji_121_role`, `emoji_241_constraint`: reject.
- Multibyte 1800: accept; 1805, 1810, and 1820: reject.

## Remaining Discrepancy

The four integral-float cases are a JavaScript number-model limitation, not a validator-logic gap.

`JSON.parse` produces the number `1` for both `1` and `1.0`; `Number.isInteger(1.0)` is `true`. The frontend validator receives an already-parsed value and has no access to the original number token. Rejecting the lexical form `1.0` would require raw JSON token validation before parsing or a transport/parser change. That is outside the approved correction scope and would affect more than the four integer fields.

Backend/AI correctly reject `1.0` because Python preserves the distinction between `int` and `float`.

If the re-audit requires zero lexical-form disagreement, a separate scope decision is required for raw JSON validation. This correction pass does not add that parser.

## Verification

Focused contract tests:

```text
backend:   68 passed
ai_service: 44 passed
frontend:   74 passed
```

Full suites:

```text
npm test:               320 passed (35 files)
npm run test:api:       625 passed
npm run test:ai_service: 148 passed
```

Lint and whitespace:

```text
backend ruff check .:                         pass
ai_service focused ruff check:                pass
npm run lint:                                 pass
git diff --check:                             pass
```

The full frontend suite was initially run concurrently with the full API suite and failed/timed out under CPU contention; it passed when rerun alone. The full API suite also passed when rerun alone.

## Compliance

- `reports/U10_2_CONTRACT_PARITY_AUDIT.md` was not modified.
- `reports/U10_1_CASE_STUDY_ARCHITECTURE_DESIGN.md` was not modified.
- `src/data/**` was not modified.
- No dependencies were added or removed.
- No migrations or database model changes were made.
- No public API, admin, renderer, or AI ingestion wiring was changed.
- No generated content was changed.
- No commit, push, merge, or deploy was performed.

Working tree at report creation:

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
?? reports/U10_PROJECT_CASE_STUDY_AUDIT.md
```

## Recommendation

READY FOR RE-AUDIT.

All in-scope validator corrections are implemented and verified. The only remaining shared-probe disagreements are the four documented JavaScript integral-float cases, which cannot be corrected inside the frontend validator without raw JSON lexical validation. The re-audit should accept or reject that limitation explicitly.
