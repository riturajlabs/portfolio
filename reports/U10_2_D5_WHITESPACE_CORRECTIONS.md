# U10.2 D5 Whitespace Corrections

- Date: 2026-11-10
- Repository: `/home/riturajlabs/Projects/portfolio`
- Branch: `feature/portfolio-u8-work`
- HEAD: `0ccc7ef0deea9d8710af4b7225b2eb8799e53723`
- Corrections target: D5 whitespace/trim parity plus repository D4 exact-32 KiB tests
- Mode: implementation and focused verification
- Output: this report only after implementation and tests
- Result: **READY FOR FINAL RE-AUDIT**

---

## 1. Executive Summary

D5 is corrected. Backend, AI, and frontend now share one explicit whitespace contract instead of relying on Python `strip()`/`\s` or JavaScript `trim()`/`\s`.

The shared contract is Unicode `White_Space`:

```text
U+0009-U+000D, U+0020, U+0085, U+00A0, U+1680,
U+2000-U+200A, U+2028-U+2029, U+202F, U+205F, U+3000
```

Under this contract:

- `U+001C-U+001F`, `U+FEFF`, `U+180E`, and `U+200B` are **content**, not whitespace.
- Text trims only the shared whitespace set.
- Whitespace-only required text is blank and rejects.
- Whitespace-only optional text normalizes to `null` / `None`.
- URLs reject agreed whitespace anywhere; URLs are not silently trimmed.
- An optional URL equal to the empty string normalizes to `null` / `None`; a whitespace-only optional URL still rejects.
- Canonical JSON uses the same shared trim set, so the 32 KiB measurement basis matches.

The D4 exact boundary is now covered in all three contract suites:

| Context length | Canonical UTF-8 bytes | Expected result |
| ---: | ---: | --- |
| 953 | 32767 | ACCEPT |
| 954 | 32768 | ACCEPT |
| 955 | 32769 | REJECT |

Focused verification passes:

- Backend: 165 passed.
- AI: 141 passed.
- Frontend: 171 passed.
- Backend/AI `ruff check`: passed.
- Frontend `eslint`: passed.
- `git diff --check`: clean.

The extended shared probe now has 167 cases:

- 161 cases agree across backend, AI, and frontend.
- 2 cases are backend `N/A` because the public `Project` still has no `caseStudy` field.
- 4 cases remain the documented JavaScript integral-float limitation.
- All 96 D5 code-point probes agree.
- All 3 D4 boundary probes agree.
- All 75 common accepted canonical outputs are byte-identical.

No new parity mismatch was found outside the accepted integral-float limitation.

**Recommendation: READY FOR FINAL RE-AUDIT.** Stop before U10.3.

---

## 2. Scope

This correction implements only:

- D5 from `reports/U10_2_CONTRACT_PARITY_REAUDIT.md`.
- The D4 exact-boundary coverage gap from the same report.

The following were not changed:

- `src/data/**`
- dependencies or lockfiles
- database models or migrations
- public backend routes/services
- admin UI or renderers
- AI ingestion or generated content
- prior audit reports
- Git history

The public backend `Project` model still does not expose `caseStudy`. That remains the intentional U10.2 scope decision.

---

## 3. Shared Contract

### 3.1 Whitespace

The contract uses the Unicode `White_Space` property:

| Code point(s) | Name / role |
| --- | --- |
| `U+0009-U+000D` | Tab, line feed, vertical tab, form feed, carriage return |
| `U+0020` | Space |
| `U+0085` | Next line (NEL) |
| `U+00A0` | No-break space |
| `U+1680` | Ogham space mark |
| `U+2000-U+200A` | En quad through hair space |
| `U+2028-U+2029` | Line separator, paragraph separator |
| `U+202F` | Narrow no-break space |
| `U+205F` | Medium mathematical space |
| `U+3000` | Ideographic space |

### 3.2 Non-whitespace content

These code points are deliberately **not** whitespace:

- `U+001C-U+001F` information separators
- `U+FEFF` zero width no-break space / BOM
- `U+180E` Mongolian vowel separator
- `U+200B` zero width space

They are retained in text, count as substantive content, and are allowed in URLs unless another URL rule rejects them.

### 3.3 Normalization rules

- Required and optional text trim only the shared whitespace set.
- Required text that becomes empty after trimming rejects.
- Optional text that becomes empty after trimming becomes `None` / `null`.
- Required URLs reject any shared whitespace in any position.
- Optional URLs reject any shared whitespace in any position.
- Only an optional URL equal to `""` normalizes to `None` / `null`.
- Canonical JSON trims using the same set before measuring UTF-8 bytes.

---

## 4. Implementation

### 4.1 Backend

File: `backend/app/schemas/content.py`

| Area | Implementation | Reference |
| --- | --- | --- |
| Shared whitespace set | `_CASE_STUDY_WHITESPACE` | `backend/app/schemas/content.py:47` |
| Regex character class | `_CASE_STUDY_WHITESPACE_CLASS` | `backend/app/schemas/content.py:60` |
| Shared search regex | `_CASE_STUDY_WHITESPACE_RE` | `backend/app/schemas/content.py:72` |
| Trim helper | `_trim_text()` uses `strip(_CASE_STUDY_WHITESPACE)` | `backend/app/schemas/content.py:85` |
| Required/optional text | `_required_text`, `_optional_text` use `_trim_text()` | `backend/app/schemas/content.py:89` |
| URL validation | `_required_http_url`, `_optional_http_url` | `backend/app/schemas/content.py:117` |
| Image source validation | `_image_src()` plus `_ImageSrc` | `backend/app/schemas/content.py:131` |
| Image field | `ImageAsset.src: _ImageSrc` | `backend/app/schemas/content.py:276` |
| Bare URL source rejection | `_BARE_URL_RE` uses the explicit class | `backend/app/schemas/content.py:331` |
| Substantive document check | Uses normalized fields | `backend/app/schemas/content.py:424` |

The previous image-source model validator was removed. Image source validation now uses a field-level annotated validator, matching the URL helpers and avoiding a second interpretation of whitespace.

### 4.2 AI service

File: `ai_service/services/content_api.py`

The AI implementation mirrors the backend exactly:

| Area | Reference |
| --- | --- |
| Shared whitespace set | `ai_service/services/content_api.py:53` |
| Regex character class | `ai_service/services/content_api.py:66` |
| Shared search regex | `ai_service/services/content_api.py:78` |
| Trim helper | `ai_service/services/content_api.py:91` |
| Required/optional text | `ai_service/services/content_api.py:95` |
| URL helpers | `ai_service/services/content_api.py:123` |
| Image source validation | `ai_service/services/content_api.py:137` |
| Image field | `ai_service/services/content_api.py:275` |
| Bare URL source rejection | `ai_service/services/content_api.py:325` |
| Substantive document check | `ai_service/services/content_api.py:415` |

### 4.3 Frontend

File: `src/lib/content.js`

| Area | Implementation | Reference |
| --- | --- | --- |
| Shared whitespace set | `CASE_STUDY_WHITESPACE` | `src/lib/content.js:433` |
| Regex character class | `CASE_STUDY_WHITESPACE_CLASS` | `src/lib/content.js:438` |
| Shared search regex | `caseStudyWhitespace` | `src/lib/content.js:441` |
| Strict URL regex | `strictHttpUrl` | `src/lib/content.js:445` |
| Bare URL regex | `bareHttpUrl` | `src/lib/content.js:449` |
| Trim helper | `trimCaseStudyText()` walks code units with the Set | `src/lib/content.js:485` |
| Whitespace detector | `hasCaseStudyWhitespace()` | `src/lib/content.js:497` |
| Required/optional text | Use `trimCaseStudyText()` | `src/lib/content.js:537` |
| Optional URL | `checkOptionalHttpUrl()` | `src/lib/content.js:596` |
| Image source | Uses strict URL plus flat image path | `src/lib/content.js:1035` |
| Link URL | Uses strict URL plus whitespace check | `src/lib/content.js:1358` |
| Canonical text | `trimCaseStudyText()` | `src/lib/content.js:1379` |
| Canonical case study | `canonicalCaseStudy()` | `src/lib/content.js:1392` |
| Substantive document check | Uses normalized fields | `src/lib/content.js:1618` |
| Size measurement | Canonical UTF-8 bytes against `32 * 1024` | `src/lib/content.js:1624` |

The JavaScript trim loop is intentional. `String.prototype.trim()` and JavaScript `\s` do not follow the shared contract.

---

## 5. Behavior Verification

These are the D5 cases that previously diverged. All now agree.

| Probe | Backend | AI | Frontend | Contract result |
| --- | --- | --- | --- | --- |
| `role: "\uFEFF"` | REJECT | REJECT | REJECT | BOM is content, but the document has no substantive field |
| `role: "\u0085"` | REJECT | REJECT | REJECT | NEL is whitespace; the role is blank |
| `constraints: ["\uFEFF"]` | ACCEPT | ACCEPT | ACCEPT | BOM is retained content |
| `constraints: ["\u0085"]` | REJECT | REJECT | REJECT | NEL trims to blank; required text rejects |
| URL `https://example.com/a\u0085b` | REJECT | REJECT | REJECT | NEL is whitespace inside a URL |
| URL `https://example.com/a\uFEFFb` | ACCEPT | ACCEPT | ACCEPT | BOM is not whitespace and is allowed in this URL |
| `links[0].url: "\uFEFF"`-only | REJECT | REJECT | REJECT | Not an absolute `http(s)` URL |
| Optional URL `""` | ACCEPT as `None` | ACCEPT as `None` | ACCEPT as `null` | Empty optional URL normalizes |
| Optional URL `"\u0085"` | REJECT | REJECT | REJECT | Whitespace-only optional URL rejects |
| Canonical `role: "\uFEFFSolo\uFEFF"` | 1892 bytes | 1892 bytes | 1892 bytes | BOM retained |
| Canonical `role: "Solo\u0085"` | 1891 bytes | 1891 bytes | 1891 bytes | NEL trimmed |
| Canonical size wrapper `U+0020` at 954 context | ACCEPT at 32768 | ACCEPT at 32768 | ACCEPT at 32768 | Space trims |
| Canonical size wrapper `U+FEFF` at 954 context | REJECT above 32768 | REJECT above 32768 | REJECT above 32768 | BOM is retained and increases the canonical size |

The full code-point matrix covers 32 characters times 3 probes:

- 25 shared whitespace characters in `role`, `constraints`, and URL positions.
- 7 non-whitespace characters in `role`, `constraints`, and URL positions.

All 96 cases agree.

---

## 6. Canonical JSON and D4 Boundary

The shared probe now includes the exact size boundary:

```text
12 approach sections, 12 constraints, 12 learnings,
600-character problem summary, variable problem context
```

| Context length | Backend canonical bytes | Frontend canonical bytes | Backend | AI | Frontend |
| ---: | ---: | ---: | --- | --- | --- |
| 953 | 32767 | 32767 | ACCEPT | ACCEPT | ACCEPT |
| 954 | 32768 | 32768 | ACCEPT | ACCEPT | ACCEPT |
| 955 | 32769 | 32769 | REJECT | REJECT | REJECT |

Frontend and backend canonical strings are byte-identical at 953 and 954.

The canonical comparison set contains 75 common accepted cases. All 75 are byte-identical. This includes:

- The original accepted shared corpus.
- D1-D3 accepted probes.
- D5 accepted probes, including BOM and information-separator content.
- D4 boundary cases 953 and 954.

No canonical mismatch remains for the shared accepted corpus.

---

## 7. Regression Coverage Added

### Backend

File: `backend/tests/test_case_study_contract.py`

Added coverage for:

- All 25 shared whitespace code points trimmed from optional and required text.
- All 25 whitespace-only required strings rejected.
- All 25 whitespace-only optional strings normalized away.
- All 7 non-whitespace code points retained as content.
- All 25 shared whitespace code points rejected in leading, middle, and trailing URL positions for optional URLs, image sources, and links.
- All 7 non-whitespace code points allowed in URLs.
- Optional URL `""` normalized to `None`; optional whitespace-only URL rejected.
- Exact 32 KiB boundary at 953, 954, and 955 via normalized canonical JSON.
- Canonical size wrapper behavior: shared whitespace trims, non-whitespace content counts.

### AI service

File: `ai_service/tests/test_case_study_contract.py`

The AI suite mirrors the backend D5 and D4 coverage through the real `validate_content_payload` path, including the `canonical_payload` fixture.

### Frontend

File: `src/lib/content.test.js`

Added coverage for:

- All 25 shared whitespace code points trimmed from text.
- A trailing shared whitespace character does not consume the 120-code-point role limit.
- All 25 whitespace-only required strings rejected.
- All 7 non-whitespace code points retained and counted as content.
- All 25 shared whitespace code points rejected in leading, middle, and trailing URL positions.
- All 7 non-whitespace code points allowed in URLs.
- Optional URL `""` accepted as `null`; whitespace-only optional URL rejected.
- Exact 32 KiB boundary at 953, 954, and 955.
- Canonical size wrapper behavior: shared whitespace trims, non-whitespace content counts.

---

## 8. Verification Commands and Results

### Focused tests

| Command | Result |
| --- | --- |
| `cd backend && <load .env> .venv/bin/python -m pytest tests/test_case_study_contract.py -q` | 165 passed |
| `cd ai_service && PYTHONPATH=. .venv/bin/python -m pytest tests/test_case_study_contract.py -q` | 141 passed |
| `npx vitest run src/lib/content.test.js --reporter=dot` | 171 passed |

The backend test file still imports `backend/tests/conftest.py`, which requires `TEST_DATABASE_URL`. The existing local `.env` was loaded through `python-dotenv`; no credentials were printed. No migration or database write was performed.

### Lints and whitespace

| Command | Result |
| --- | --- |
| `cd backend && .venv/bin/python -m ruff check app/schemas/content.py tests/test_case_study_contract.py` | passed |
| `cd ai_service && .venv/bin/python -m ruff check services/content_api.py tests/test_case_study_contract.py` | passed |
| `npx eslint src/lib/content.js src/lib/content.test.js` | passed |
| `git diff --check` | clean |

`ruff check` is the Python lint gate used by CI. A supplementary `ruff format --check` would reformat both implementation files; it is not part of the repository CI gate, and no formatting-only rewrite was applied.

### Shared probe

Harness: `/tmp/opencode/u10_2_audit/`

| Category | Count |
| --- | ---: |
| Total cases | 167 |
| All three validators agree | 161 |
| Backend `N/A` because public `Project` has no `caseStudy` | 2 |
| Known JavaScript integral-float limitation | 4 |
| New D5/D4 mismatches | 0 |
| D5 code-point probes agreeing | 96 / 96 |
| D4 boundary probes agreeing | 3 / 3 |
| Common accepted canonical outputs identical | 75 / 75 |

The only remaining mismatches are unchanged and documented:

| Case | Backend | AI | Frontend | Classification |
| --- | --- | --- | --- | --- |
| `schema_version_float` | REJECT | REJECT | ACCEPT | `JSON.parse` normalizes `1.0` to `1` |
| `width_float` | REJECT | REJECT | ACCEPT | `JSON.parse` normalizes `1600.0` to `1600` |
| `height_float` | REJECT | REJECT | ACCEPT | `JSON.parse` normalizes `900.0` to `900` |
| `team_size_float` | REJECT | REJECT | ACCEPT | `JSON.parse` normalizes `1.0` to `1` |

---

## 9. Scope Verification

| Check | Evidence | Result |
| --- | --- | --- |
| Branch | `git rev-parse --abbrev-ref HEAD` | `feature/portfolio-u8-work` |
| HEAD | `git rev-parse HEAD` | `0ccc7ef0deea9d8710af4b7225b2eb8799e53723` |
| Dependencies | no dependency or lockfile changes | none |
| Database | no model or migration changes | none |
| Public API | no route/service wiring for `caseStudy` | none |
| Admin/renderers | no admin or renderer changes | none |
| Generated content | no `src/data`, `src/generated`, or scripts changes | none |
| Prior reports | not modified | confirmed |
| Commits | no commits created | confirmed |

The public backend `Project` still has no `caseStudy` field. Backend probe results for `missing_case_study` and `explicit_null` remain intentionally `N/A`.

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

This report was added after the snapshot above. No implementation, schema, dependency, database, generated-content, public-API, admin, renderer, or Git state was changed while writing it.

---

## 11. Recommendation

**READY FOR FINAL RE-AUDIT.**

D5 is implemented and verified across backend, AI, and frontend. The D4 exact 32 KiB boundary is now covered by focused tests in all three suites. The shared probe has no mismatch outside the already accepted JavaScript integral-float limitation.

Stop here. Do not start U10.3 until the final re-audit approves this correction.
