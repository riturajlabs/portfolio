# U10.3 — Database and API Implementation Plan

**Status:** Planning only. No application code, test, migration, schema, configuration, dependency, generated content, database state, or prior report has been modified by U10.3.

**Permitted output:** this file only.

**Repository baseline:** branch `feature/portfolio-u8-work`, HEAD `0ccc7ef0deea9d8710af4b7225b2eb8799e53723` (matches the expected baseline). The worktree contains the approved-but-uncommitted U10.2 validator changes and untracked U10.2 tests/reports; this plan accounts for that state rather than assuming a clean tree.

---

## 1. Executive Summary

**PROPOSED** Implement U10.3 as one nullable PostgreSQL JSONB column on `project`, one additive migration, strict references to the already-approved U10.2 case-study models, and small public/admin API integration changes. Do not create a new endpoint. Do not duplicate or weaken the U10.2 validator.

The implementation has five essential decisions:

1. `project.case_study` is `jsonb NULL`; SQL `NULL` is the only representation of absence.
2. No backfill, no default empty object, no JSONB index, and no `pg_column_size` constraint.
3. `GET /api/content` gains `projects[].caseStudy`, always present and `null` when absent.
4. The admin API gains outer-key `case_study` on create/update/out, while the nested document keeps the canonical camelCase v1 contract.
5. A malformed stored case study degrades to `caseStudy: null` with a structured warning rather than taking down the entire public content endpoint.

**VERIFIED** The repository already has the U10.2 `CaseStudy` Pydantic model and validator, and the frontend/AI mirrors. U10.3 therefore consumes an existing contract instead of introducing a second one.

**Final verdict:** `READY FOR U10.3 IMPLEMENTATION REVIEW`, subject to the open questions in §15.

---

## 2. Scope and Non-Goals

### 2.1 In scope

- Add nullable `project.case_study` JSONB storage.
- Add the migration from the actual current head, `0004_profile_resume_key`.
- Add a database CHECK that permits only `NULL` or a JSON object.
- Connect the approved U10.2 `CaseStudy` model to the public and admin project schemas.
- Select and serialize `caseStudy` from the public `/api/content` assembly.
- Accept, persist, clear, replace, and return `case_study` through the admin project CRUD routes.
- Add backend tests for schema, constraint, migration, public read, admin write, audit, degradation, snapshot, and size.
- Preserve the U10.2 contract exactly.

### 2.2 Out of scope

- Admin editor UI work.
- Public case-study renderer work.
- AI ingestion, sectioning, prompt changes, or knowledge-source changes.
- Content authoring or any WebChat AI case-study content.
- Gallery frontend rendering.
- Frontend source changes beyond the already-approved U10.2 validator.
- A new public project list/detail endpoint.
- A separate case-study table or endpoint.
- A deep-merge update mode.
- Documentation updates (`docs/API.md`, `docs/DATABASE.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md` belong to a later documentation phase).
- Any U10.4 work.
- Database writes, migration execution, deployment, commit, push, or merge during this planning phase.

---

## 3. Verified Current State

### 3.1 Repository and migration chain

- **VERIFIED** Alembic migrations are `0001_initial` → `0002_certification_unique` → `0003_project_image_url` → `0004_profile_resume_key`.
- **VERIFIED** The current latest revision is `0004_profile_resume_key`; its `down_revision` is `0003_project_image_url`.
- **VERIFIED** `0004` establishes the relevant nullable-column convention: add a nullable column, move no data, and perform no backfill.
- **VERIFIED** The new migration should therefore be `0005_project_case_study` with `down_revision = "0004_profile_resume_key"`.
- **VERIFIED** `backend/app/db/migrations.py` derives `expected_head()` from the migration files on disk, so adding `0005` automatically updates the expected head used by tests.

### 3.2 Project model and storage precedent

- **VERIFIED** `backend/app/models/project.py` currently has no `case_study` column and imports `ARRAY` and `UUID`, but not `JSONB`.
- **VERIFIED** `project` already has build-critical CHECK constraints for slug format/length, image path/URL, positive dimensions, status, category length, and SEO lengths.
- **VERIFIED** JSONB is already used for `site_profile.stats`, `site_profile.social`, `site_profile.about`, `site_profile.seo`, and `admin_audit_log.before/after`.
- **VERIFIED** `_dump()` in `backend/app/services/admin_content.py` iterates all table columns, so a new column is automatically included in audit `before`/`after` records.
- **VERIFIED** `ProjectListItem` deliberately omits long bodies. It must not gain `case_study`.

### 3.3 Public API

- **VERIFIED** The public endpoint is only `GET /api/content`; the repository explicitly has no `/api/projects` or `/api/projects/{slug}` route.
- **VERIFIED** `backend/app/services/content.py` selects named columns, never whole ORM rows, and returns projects in a list comprehension.
- **VERIFIED** `backend/app/schemas/content.py` contains the approved `CaseStudy` model and the public `Project` model, but `Project` currently has no `caseStudy` field.
- **VERIFIED** `backend/app/routes/content.py` uses `response_model=Content`, a canonical JSON body, a strong ETag, and cache headers. No route change is required for the new field.
- **VERIFIED** A `ValidationError` anywhere in `Content.model_validate(payload)` currently becomes a `500` and is intentionally fail-closed.

### 3.4 Admin API

- **VERIFIED** Admin project routes are `GET/POST /api/admin/projects` and `GET/PUT/DELETE /api/admin/projects/{project_id}`.
- **VERIFIED** Admin schemas are `extra="forbid"` and use snake_case outer keys.
- **VERIFIED** `ProjectCreateIn`, `ProjectUpdateIn`, `ProjectOut`, and `ProjectListItem` are in `backend/app/schemas/admin_content.py`.
- **VERIFIED** `ProjectUpdateIn` uses `model_fields_set` and `model_dump(exclude_unset=True)` to distinguish omission from an explicit value.
- **VERIFIED** `_PROJECT_NON_NULLABLE` lists only `NOT NULL` columns. `case_study` must not be added to it, because explicit `null` must clear the field.
- **VERIFIED** `_project_out()` in `backend/app/routes/admin_content.py` builds the full admin response manually from `Project` row attributes.
- **VERIFIED** `create_project()` and `update_project()` already use the generic model-dump/setattr path; no new service method is required.

### 3.5 U10.2 contract baseline

- **VERIFIED** `backend/tests/test_case_study_contract.py`, `ai_service/tests/test_case_study_contract.py`, and `src/lib/content.test.js` are the approved contract tests.
- **VERIFIED** The U10.2 final audit is `APPROVE U10.2` in `reports/U10_2_FINAL_APPROVAL_AUDIT.md`.
- **VERIFIED** U10.2 verifies 167 shared probes: 161 three-way agreements, 2 backend `N/A`, 4 known JS integral-float mismatches, and 0 unexpected mismatches.
- **VERIFIED** D5 is complete at `119/119`, including `96/96` Unicode code-point probes. D4 is `3/3`. Canonical parity is `75/75`.
- **VERIFIED** The approved shared whitespace set is `U+0009–U+000D`, `U+0020`, `U+0085`, `U+00A0`, `U+1680`, `U+2000–U+200A`, `U+2028–U+2029`, `U+202F`, `U+205F`, `U+3000`.
- **VERIFIED** `U+001C–U+001F`, `U+FEFF`, `U+180E`, U+200B are substantive content, not shared whitespace.
- **VERIFIED** URLs reject shared whitespace anywhere and are not trimmed. Optional URL `""` normalizes to `None`; whitespace-only optional URL rejects.
- **VERIFIED** The D4 boundary is `953` → `32767` accept, `954` → `32768` accept, `955` → `32769` reject.
- **VERIFIED** The known JS limitation remains: `schema_version_float`, `width_float`, `height_float`, and `team_size_float` are backend/AI `REJECT`, frontend `ACCEPT`.
- **VERIFIED** The U10.2 final report supersedes the stale `role: "\uFEFF"` row in the earlier D5 report: lone `role: "\uFEFF"` is `ACCEPT`.

U10.3 must not modify any of those decisions or files.

---

## 4. Data Model Decision

### 4.1 Recommended representation

**PROPOSED** Store exactly one case-study document per project:

```sql
project.case_study jsonb NULL
```

Semantics:

| State | Storage | Public result |
| --- | --- | --- |
| No case study | SQL `NULL` | `caseStudy: null` |
| Valid case study | JSON object | Valid camelCase object |
| Empty object | Rejected by the admin boundary | Never emitted |
| Version-only object | Rejected by the admin boundary | Never emitted |
| Invalid object inserted directly | JSON object remains stored | `caseStudy: null` plus warning |
| JSON `null` value | Rejected by the DB CHECK | Not storable through a normal path |

**PROPOSED** No `NOT NULL`, no default `{}`, no `DEFAULT '{}'::jsonb`, and no generated placeholder.

### 4.2 Why JSONB

**VERIFIED** The repository already stores structured profile documents as JSONB. A case study is authored, validated, audited, and rendered as one document. It is read as part of one project row and is not filtered or searched by JSONB operators at this scale.

**PROPOSED** A relational `case_study`/`case_study_section` model would add joins, multiple write paths, and a migration for every field change without a current query need. Revisit only if cross-project outcome analytics become a real requirement.

### 4.3 Index and size decisions

- **PROPOSED** No GIN or expression index. The column is never queried independently.
- **PROPOSED** No `pg_column_size` CHECK. TOAST and `pg_column_size` make it an unstable proxy for the serialized contract; the approved application validator is the authoritative 32 KiB gate.
- **PROPOSED** The 32 KiB normalized canonical limit from U10.2 remains the size control for the public payload, admin audit rows, and AI ingestion.

### 4.4 Audit implications

**INFERRED** `_dump()` automatically includes `case_study` in `before` and `after`. The 32 KiB application cap bounds each audit row. Case-study content is public; no new secret is introduced, but the audit table must still remain admin/operator-only.

---

## 5. Proposed Migration

### 5.1 Revision

**PROPOSED** New file:

`backend/alembic/versions/0005_project_case_study.py`

```python
revision: str = "0005_project_case_study"
down_revision: str | None = "0004_profile_resume_key"
```

This is a correction of any assumption that `0004` is the new migration. **VERIFIED** `0004_profile_resume_key` is already the current head, so `0005` is the next revision.

### 5.2 Upgrade

**PROPOSED**

```python
from sqlalchemy.dialects import postgresql


def upgrade() -> None:
    op.add_column(
        "project",
        sa.Column("case_study", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.create_check_constraint(
        op.f("ck_project_case_study_object"),
        "project",
        "case_study IS NULL OR jsonb_typeof(case_study) = 'object'",
    )
```

### 5.3 Downgrade

**PROPOSED**

```python
def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_project_case_study_object"),
        "project",
        type_="check",
    )
    op.drop_column("project", "case_study")
```

**PROPOSED** The downgrade drops the column and all case-study data. That is acceptable only with an explicit backup/export step; do not downgrade a production database casually.

### 5.4 Migration properties

- Adds one nullable column; no table rewrite is required for that operation on PostgreSQL.
- Adds one CHECK. At the current five-row scale, a normal validated constraint is fine. A large deployment could add it `NOT VALID` and validate separately.
- No data movement and no backfill.
- No index.
- No change to `long_description`, `highlights`, `image`, or any existing constraint.
- The migration must run before the backend code that selects or writes `case_study`.

### 5.5 Why the CHECK does not reject `{}` at the database

**PROPOSED** The database CHECK enforces the storage type only: `NULL` or a JSON object. It deliberately does not attempt to reproduce the full v1 contract in SQL. `{}` and `{"schemaVersion": 1}` are rejected at the admin API boundary by the approved `CaseStudy` model. If such a document is inserted directly outside the application, the public read path degrades it to `null` and logs a warning.

This preserves the U10.1 design boundary: object-type CHECK in the database, full structural contract in the application. Adding `case_study <> '{}'::jsonb` would be a new design decision; it is listed as an open question in §15.

---

## 6. ORM and Database Constraints

### 6.1 `backend/app/models/project.py`

**PROPOSED** Add imports:

```python
from typing import Any

from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
```

Add the column after `long_description` or `tech_stack`, keeping the model readable:

```python
case_study: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
```

`mapped_column(JSONB)` is nullable by inference from `dict[...] | None`. State it explicitly only if it improves clarity; the existing model relies on the type annotation for nullability.

Add to `__table_args__`:

```python
CheckConstraint(
    "case_study IS NULL OR jsonb_typeof(case_study) = 'object'",
    name="case_study_object",
),
```

**VERIFIED** The naming convention in `backend/app/db/base.py` turns `name="case_study_object"` into `ck_project_case_study_object`.

### 6.2 Constraint invariants

- SQL `NULL` allowed.
- JSON object allowed.
- JSON array rejected.
- JSON string, number, boolean, and JSON `null` rejected by `jsonb_typeof`.
- No structural validation at the database layer beyond object type.
- No default value.
- No additional index.

---

## 7. Public API Integration

### 7.1 Endpoint

**VERIFIED** There is no separate public project endpoint. U10.3 adds the field only to the existing `GET /api/content` response.

### 7.2 Public schema

**PROPOSED** In `backend/app/schemas/content.py`, add one field to `Project`:

```python
caseStudy: CaseStudy | None = None
```

The `CaseStudy` model already exists and is already exported by U10.2. Do not redefine it, rename it, or copy its validators into another module.

The public contract after migration:

```json
{
  "slug": "example-project",
  "title": "Example Project",
  "description": "...",
  "longDescription": "...",
  "highlights": ["..."],
  "caseStudy": null
}
```

**PROPOSED** `caseStudy` is always present after U10.3. It is `null` when the column is `NULL` or when stored data cannot be validated.

### 7.3 Public assembly

**PROPOSED** In `backend/app/services/content.py`:

1. Add `Project.case_study` to the named-column select in `_published_projects()`.
2. Add a per-project helper that validates the raw JSONB value with the approved `CaseStudy` model.
3. Attach `"caseStudy": ...` to every project dictionary in `load_content()`.
4. Never include a `case_study` key in the public project dictionary.
5. Keep `long_description` and `_highlights()` exactly as they are.

Suggested helper:

```python
def _case_study(slug: str, raw: dict[str, Any] | None) -> CaseStudy | None:
    if raw is None:
        return None
    try:
        return CaseStudy.model_validate(raw)
    except ValidationError as exc:
        log_event(
            logger,
            logging.WARNING,
            "public_case_study_invalid",
            slug=slug,
            error=type(exc).__name__,
            errors=exc.error_count(),
        )
        return None
```

Then include:

```python
"caseStudy": _case_study(row.slug, row.case_study),
```

**PROPOSED** `Content.model_validate(payload)` remains the final shape gate. Because the helper has already validated each case study, a malformed optional case study no longer reaches the global `ValidationError` path. Other malformed public data still fails closed as it does today.

### 7.4 Public response behavior

| Stored value | Public behavior |
| --- | --- |
| `NULL` | `caseStudy: null` |
| Valid v1 object | Valid camelCase object |
| Unsupported version | `caseStudy: null`; warning `public_case_study_invalid` |
| Unknown nested key | `caseStudy: null`; warning |
| Empty object | `caseStudy: null`; warning |
| Invalid nested field | `caseStudy: null`; warning |
| JSON array/scalar | Prevented by CHECK; if bypassed, `null`; warning |

The warning must contain only the project slug, exception type, and error count. Do not log raw case-study content, URLs, evidence text, or the full validation payload.

### 7.5 Public cache and metadata

- **VERIFIED** `Project.updated_at` already feeds `meta.generated_at`.
- **PROPOSED** Saving `case_study` must update `project.updated_at`, which changes `meta.generated_at` and therefore the canonical body and ETag.
- **PROPOSED** `meta.version` remains `1`; `caseStudy.schemaVersion` is the document version.
- **PROPOSED** Cache headers remain unchanged.
- **PROPOSED** No new public route or response variant.

### 7.6 Public compatibility

- New backend emits `caseStudy` always after migration.
- Old clients tolerate the extra project key.
- New frontend/AI clients already tolerate a missing key and normalize it to `null`.
- Stored invalid data degrades per project, not whole-payload failure.
- `longDescription` and `highlights` remain semantically unchanged.

---

## 8. Admin API Integration

### 8.1 Admin schemas

**PROPOSED** In `backend/app/schemas/admin_content.py`:

Add the imports:

```python
from typing import Any

from app.schemas.content import CaseStudy
```

Add to `ProjectOut`:

```python
case_study: dict[str, Any] | None = None
```

`ProjectOut` intentionally exposes the raw stored object so the admin can recover a row that fails validation. It is not a second write contract.

Add to `ProjectCreateIn` and `ProjectUpdateIn`:

```python
case_study: CaseStudy | None = None
```

Do not add `case_study` to `ProjectListItem`.

Do not add `case_study` to `_PROJECT_NON_NULLABLE`.

### 8.2 Admin service

**VERIFIED** `create_project()` calls `payload.model_dump()` and constructs `Project(**data)`. A nested `CaseStudy` is serialized to a Python dict, which the JSONB column accepts.

**VERIFIED (serialization parity)** `CaseStudy` and every nested model declare fields under their canonical names and configure no Pydantic aliases (`alias` and `serialization_alias` are both `None`). For the approved fixture, `model_dump()`, `model_dump(by_alias=True)`, `model_dump(mode="json")`, and `model_dump(mode="json", by_alias=True)` produce the same values and keys. The normalized document materializes absent optional fields as `null` (for example, the qualitative outcome gains `metric: null`, `value: null`, `unit: null`, `baseline: null`, and `direction: null`). This is the same normalized shape the frontend canonicalizer produces and the public reader accepts.

**VERIFIED (critical update difference)** `update_project()` calls `payload.model_dump(exclude_unset=True)`. Pydantic propagates `exclude_unset=True` into nested models, so a sparse replacement is dumped sparsely rather than normalized. Storing that result directly would make create and update use different representations for the same input.

**PROPOSED (required correction)** Use one storage representation for an explicitly supplied case study:

```python
case_study.model_dump(mode="json", by_alias=True)
```

For this model that is value-equivalent to `case_study.model_dump()`, and it remains JSON-safe if the model gains non-primitive fields later. The create path already produces this representation through `payload.model_dump()`. In `update_project()`, after `changes = payload.model_dump(exclude_unset=True)`, normalize only when the field was supplied:

```python
if "case_study" in changes:
    changes["case_study"] = (
        payload.case_study.model_dump(mode="json", by_alias=True)
        if payload.case_study is not None
        else None
    )
```

Omitted `case_study` remains absent from `changes`; explicit `null` remains `None`; an object is normalized and replaces the whole document. No deep merge is permitted.

**VERIFIED** `CaseStudy.model_validate()` accepts both the sparse replacement and the normalized storage document, and public serialization normalizes either to the same camelCase response. The normalization above prevents the admin create/update storage representations from diverging.

### 8.3 Admin route

**PROPOSED** In `_project_out()` add:

```python
case_study=row.case_study,
```

No change to `_project_list_item()`, list response, route signatures, auth, CSRF, concurrency, or audit behavior.

### 8.4 Admin semantics

| Operation | Request | Persisted result | Admin response |
| --- | --- | --- | --- |
| Create, omitted | no `case_study` | `NULL` | `case_study: null` |
| Create, explicit null | `"case_study": null` | `NULL` | `case_study: null` |
| Create, valid object | `"case_study": {...}` | Object | Normalized raw object |
| Create, `{}` | `"case_study": {}` | Rejected `422` | No row |
| Create, version only | `"case_study": {"schemaVersion": 1}` | Rejected `422` | No row |
| Update, omitted | field absent | Unchanged | Existing raw object |
| Update, explicit null | `"case_study": null` | `NULL` | `case_study: null` |
| Update, valid object | replacement object | Whole object replaced, normalized | New normalized raw object |
| Update, invalid object | any invalid shape | Rejected `422` | Existing row unchanged |
| Read | `GET /projects/{id}` | Raw object or `NULL` | Raw object or `null` |
| List | `GET /projects` | Unchanged | No `case_study` key |

### 8.5 Error behavior

**PROPOSED** Reuse the existing `422 VALIDATION_ERROR` envelope. Nested paths should be preserved, for example:

- `case_study.schemaVersion`
- `case_study.outcomes[0].evidence.source`
- `case_study.gallery[0].src`

No new status code and no new top-level error code are required. The existing Pydantic-to-API error mapping must be verified for nested field locations.

### 8.6 Audit behavior

- Exactly one audit row per create/update/delete, as today.
- `before`/`after` include `case_study` automatically.
- Clearing with `null` records the previous object and `null`.
- Replacing records the old object and the new object.
- Soft delete must not clear `case_study`.
- Audit rows must never contain credentials or session tokens; case-study content is public content.

---

## 9. Error Handling and Safe Degradation

### 9.1 Admin write boundary

**PROPOSED** The admin boundary is strict: invalid, unknown, oversized, unsupported-version, empty, or structurally incomplete case studies are `422`. They are never written to the database.

### 9.2 Public read boundary

**PROPOSED** The public read boundary is deliberately narrower and safer:

- A missing column value is `null`.
- A valid document is emitted.
- A malformed optional case study is logged and emitted as `null` for that project.
- The rest of the content payload continues to serve.
- A malformed required profile or other collection still follows the existing fail-closed behavior.

This is a deliberate exception for one optional document, not a general weakening of public contract enforcement.

### 9.3 Why not let the public endpoint `500`

**PROPOSED** A single bad optional case study should not take down the homepage, all project pages, the build, and the AI ingestion path. The admin write gate is strict, so stored invalid data is an operational defect, not an expected input. The warning log makes it visible and the admin raw read path makes it recoverable.

### 9.4 Logging

**PROPOSED** Emit one warning per invalid project:

```text
event=public_case_study_invalid
slug=<project slug>
error=ValidationError
errors=<count>
```

Do not log document bodies, text fields, evidence URLs, or raw JSONB.

---

## 10. Exact Expected File Changes

### 10.1 File impact map

| File | Change | Notes |
| --- | --- | --- |
| `backend/app/models/project.py` | Import `Any` and `JSONB`; add nullable `case_study` mapped column; add object-type CHECK. | Keep all existing constraints unchanged. |
| `backend/alembic/versions/0005_project_case_study.py` | New migration adding the column and CHECK. | `down_revision = "0004_profile_resume_key"`; no backfill. |
| `backend/app/schemas/content.py` | Add `caseStudy: CaseStudy \| None = None` to `Project`. | Do not redefine the approved `CaseStudy` model. |
| `backend/app/services/content.py` | Select `Project.case_study`; validate per project; attach `caseStudy`; degrade invalid data to `null` with warning. | Import `ValidationError` and `CaseStudy`; no route change. |
| `backend/app/schemas/admin_content.py` | Import `Any` and `CaseStudy`; add `case_study` to `ProjectCreateIn`, `ProjectUpdateIn`, and `ProjectOut`. | Do not add to `ProjectListItem` or `_PROJECT_NON_NULLABLE`. |
| `backend/app/routes/admin_content.py` | Add `case_study=row.case_study` to `_project_out()`. | No new route, auth change, or concurrency change. |
| `backend/app/services/admin_content.py` | Normalize an explicitly supplied `case_study` on update with `CaseStudy.model_dump(mode="json", by_alias=True)`; create already normalizes through `payload.model_dump()`. | No deep merge. Omitted stays absent; explicit `null` stays `null`. |
| `backend/tests/test_database_schema.py` | Add `("case_study", "jsonb", True)` to the `project` expected columns. | The test compares exact column/type/nullability sets. |
| `backend/tests/test_constraints.py` | Add direct SQL tests for `NULL`, object, array, scalar, and JSON `null`. | The CHECK is the claim under test, not Pydantic. |
| `backend/tests/test_migration_rollback.py` | Add a `0005` upgrade/downgrade round-trip test in an isolated test database. | Downgrade is destructive by design; never run it against shared data. |
| `backend/tests/test_content_api.py` | Add public tests for key presence, null, valid object, invalid stored data, no snake_case leak, ETag/generated-at change, and size. | Extend `_insert_project` to bind JSONB safely. |
| `backend/tests/snapshots/content_payload.json` | Regenerate and review the expected snapshot. | Each project gains `"caseStudy": null` in the U10.3 snapshot dataset. |
| `backend/tests/test_admin_content.py` | Add create/update/clear/replace/empty/invalid/list/raw/audit tests. | Reuse existing auth, CSRF, and audit helpers. |
| `backend/tests/test_payload_snapshot.py` | No structural code change expected; regenerate through the snapshot test. | Snapshot diff must be only the intended `caseStudy` additions. |

### 10.2 Files explicitly not changed in U10.3

- `ai_service/services/content_api.py`: U10.2 already added the validator; do not modify it again.
- `ai_service/tests/test_case_study_contract.py`: approved U10.2 test; preserve.
- `src/lib/content.js`: U10.2 already added `caseStudy` validation and missing-to-null normalization; preserve.
- `src/lib/content.test.js`: approved U10.2 tests; preserve.
- `backend/tests/test_case_study_contract.py`: approved U10.2 tests; preserve.
- `src/data/**`: frozen.
- `ai_service/knowledge_base.json`: rollback-only; do not import or edit.
- `docs/**`: documentation phase, not U10.3.
- `src/components/**`: public renderer is U10.5.
- Admin editor files: U10.4.

### 10.3 Exact recommended implementation sequence

1. Confirm the U10.2 validator work is present and unchanged; confirm the worktree state before editing.
2. Add `case_study` to `backend/app/models/project.py` and create `0005_project_case_study.py`.
3. Update `backend/tests/test_database_schema.py` and `backend/tests/test_constraints.py`.
4. Add the navigation migration round-trip test in `backend/tests/test_migration_rollback.py`.
5. Add `caseStudy` to the public `Project` schema and public assembly, including safe degradation.
6. Add `case_study` to the admin create/update/out schemas, normalize an explicitly supplied update replacement in the admin service, and add `_project_out()`.
7. Extend backend public/admin tests and the JSONB-safe project insert helper.
8. Regenerate and review `backend/tests/snapshots/content_payload.json`.
9. Run focused backend tests, then the full backend suite.
10. Run backend lint/format checks and inspect the complete diff for scope creep.

No AI, frontend, admin UI, renderer, or documentation changes are part of this sequence.

---

## 11. Test Plan

### 11.1 Database and migration

| Test | Assertion |
| --- | --- |
| Schema | `project.case_study` exists, is `jsonb`, and is nullable. |
| Schema head | `alembic_version` equals `expected_head()` after `0005` is added. |
| Constraint: null | A direct insert with `NULL` succeeds. |
| Constraint: object | A direct insert of a JSON object succeeds. |
| Constraint: array | A direct insert of `[]` fails with `IntegrityError`. |
| Constraint: scalar | Direct inserts of a string, number, boolean, or JSON `null` fail. |
| Constraint name | The failed constraint is `ck_project_case_study_object`. |
| Migration upgrade | A fresh database upgrades to head with the column and CHECK. |
| Migration downgrade | Downgrading to `0004` removes the column and CHECK. |
| Migration re-upgrade | Re-upgrading succeeds after downgrade. |
| Existing rows | Existing project rows remain valid with `case_study = NULL`. |

### 11.2 Public API

| Test | Assertion |
| --- | --- |
| Key presence | Every public project has `caseStudy`. |
| Null | A project with `NULL` returns `caseStudy: null`; the key is not absent. |
| Valid document | A valid stored v1 document is returned with camelCase keys and nested data. |
| No raw key | Public projects never expose `case_study`. |
| Unsupported version | A stored object with `schemaVersion: 2` returns `caseStudy: null` and logs a warning. |
| Unknown nested key | A stored object with an unknown nested key returns `caseStudy: null` and logs a warning. |
| Empty object | A stored `{}` returns `caseStudy: null` and logs a warning. |
| Other projects survive | One invalid case study does not remove other projects or fail the response. |
| Required content still fails closed | A malformed profile or other required public data still follows the existing error behavior. |
| ETag | Saving a case study changes `project.updated_at`, `meta.generated_at`, and the ETag. |
| Size | Existing gzip budget still passes; a representative full case study stays within the agreed budget. |
| Snapshot | The committed snapshot matches the new response with `caseStudy: null`. |

**PROPOSED** Extend the test insert helper so `case_study` is bound as JSON text and cast explicitly, for example `CAST(:case_study AS jsonb)`. Do not pass a raw Python dict to an untyped text bind.

### 11.3 Admin API

| Test | Assertion |
| --- | --- |
| Create omitted | Succeeds; stored value is `NULL`; response has `case_study: null`. |
| Create explicit null | Succeeds; stored value is `NULL`. |
| Create valid object | Succeeds; response and subsequent GET return the stored object. |
| Create `{}` | `422 VALIDATION_ERROR`. |
| Create version-only | `422`. |
| Update omitted | Existing case study is unchanged. |
| Update explicit null | Clears the column; public read returns `null`. |
| Update valid object | Replaces the whole document; no deep merge. |
| Update sparse object | Stored `case_study` is normalized, not the sparse request; it matches the create representation for the same document. |
| Create/update storage parity | The same valid object stores the same nested canonical document through either path. |
| Update response | `Mutated.entity.case_study` has canonical nested keys; no snake_case nested key appears. |
| Update invalid object | `422`; stored row is unchanged. |
| Unknown nested key | `422` with a path beginning `case_study`. |
| Unsupported version | `422`. |
| Oversized document | `422`. |
| Duplicate links | `422`. |
| Bad evidence source | `422`. |
| Bad image source | `422`. |
| List response | `GET /api/admin/projects` does not contain `case_study`. |
| Detail response | `GET /api/admin/projects/{id}` returns raw `case_study`, including an invalid stored object for recovery. |
| Audit create | Exactly one create audit row; `after.case_study` is present. |
| Audit update | Exactly one update audit row; `before`/`after` show the change. |
| Audit clear | `after.case_study` is null. |
| Delete | Soft delete preserves `case_study`. |
| Concurrency | Existing `If-Unmodified-Since` behavior still returns `409 STALE_WRITE`. |
| Slug rules | Existing immutable-published-slug and `SLUG_TAKEN` behavior are unchanged. |

### 11.4 Contract regression

**PROPOSED** Run the approved U10.2 suites without changing their expectations:

- `backend/tests/test_case_study_contract.py`
- `ai_service/tests/test_case_study_contract.py`
- `src/lib/content.test.js`

U10.3 must consume the contract, not reinterpret it.

### 11.5 Commands

**VERIFIED** The repository provides the relevant commands:

```bash
cd backend && python -m pytest
cd backend && python -m pytest tests/test_database_schema.py tests/test_constraints.py tests/test_migration_rollback.py
cd backend && python -m pytest tests/test_content_api.py tests/test_payload_snapshot.py tests/test_admin_content.py
cd backend && python -m ruff check .
cd backend && python -m ruff format --check .
```

Run the focused suites first, then the full backend suite. Do not run migrations or tests against shared production data.

---

## 12. Deployment and Rollout

### 12.1 Preconditions

**PROPOSED**

1. U10.2 AI and frontend validator changes are committed and deployable.
2. The target database is on `0004_profile_resume_key`.
3. A backup or snapshot exists before applying `0005`; the downgrade is destructive.
4. The public payload budget and snapshot diff have been reviewed.
5. The admin API client is ready to tolerate the added `case_study` response field; existing clients that ignore unknown fields remain safe.
6. No AI ingestion can encounter a public response with `caseStudy` before the AI validator accepts absent, `null`, and valid documents.

### 12.2 Required deployment order

1. **AI service first:** deploy the U10.2 validator that accepts absent, `null`, and valid `caseStudy`. This is mandatory because the AI contract is strict and fails ingestion on unknown project keys.
2. **Frontend validator second:** deploy the U10.2 frontend validation/normalization. It remains compatible with an old backend that omits the key.
3. **Database migration:** apply `0005` before deploying the backend code that reads or writes `case_study`.
4. **Backend:** deploy the model, public emission, admin support, degradation logic, and tests.
5. **Snapshot/build:** regenerate `src/generated/content.js` through the normal build; verify `caseStudy: null` for existing projects and no unintended page changes.
6. **Admin authoring:** only after the above, create or edit a case study and publish/re-ingest.
7. **Verification:** check public response, ETag, admin GET/PUT, audit row, AI `/ready`, build, sitemap, and payload size.

### 12.3 Compatibility matrix

| Database | Backend | Frontend | AI | Safe? | Reason |
| --- | --- | --- | --- | --- | --- |
| `0004` | old | old | old | Yes | Baseline. |
| `0004` | old | new | new | Yes | New clients normalize the missing key. |
| `0004` | new | any | any | No | Backend expects the `case_study` column. |
| `0005` | new | new | new | Yes | Canonical state. |
| `0005` | new | old | new | Yes | Old frontend ignores the extra project key. |
| `0005` | new | any | old | No | Old AI rejects the unknown `caseStudy` key. |
| `0005` | old | new | new | Yes | Old backend omits the key; new clients tolerate absence. |

### 12.4 Rollback

**PROPOSED**

- Roll back the backend first. It stops emitting `caseStudy`; the new frontend and AI tolerate absence.
- Keep the `0005` column during a code rollback. The old backend ignores it and the data is preserved.
- Do not downgrade to `0004` while the new backend is still running.
- `alembic downgrade 0004` drops the column and all case-study data. Export the JSONB values first if the content matters.
- If an invalid stored case study is causing trouble, use the admin raw read path to repair it. Do not add an automatic rewrite.
- Do not backfill from `long_description`, `short_description`, `ai_service/knowledge_base.json`, or generated content.

### 12.5 Rollback triggers

**PROPOSED** Consider rollback or a hotfix if:

- AI ingestion rejects the new public payload.
- The public `/api/content` endpoint fails because of the new field.
- The build fails on the new snapshot.
- A valid save cannot be read back through the admin API.
- A clear operation does not clear the column.
- The public payload exceeds the agreed size budget.
- ETag or `meta.generated_at` stops tracking case-study updates.
- Existing project pages change unexpectedly when `caseStudy` is `null`.

---

## 13. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Backend emits `caseStudy` before the AI validator is deployed | Medium if releases are uncoordinated | High: ingestion/`ready` failure | Deploy AI first; U10.2 already accepts absent/null/valid. |
| A client is strict about unknown project keys | Low | Medium: build or ingestion failure | Frontend ignores extra keys; AI is the only strict consumer and is deployed first. |
| Stored invalid case study crashes all public content | Low after strict admin validation | High | Per-project validation degradation to `null`; warning log; admin raw recovery. |
| Degradation hides a real defect | Medium | Medium | Warning event with slug and error count; admin detail returns raw stored object; tests pin the behavior. |
| Empty object becomes a second meaning of absence | Medium | Medium: ambiguous content model | Admin rejects `{}` and version-only objects; SQL `NULL` is the only absence. |
| Database CHECK is mistaken for full contract validation | Low | Medium: false confidence | Document the boundary clearly; tests exercise application validation separately. |
| Migration downgrade loses authored content | Low | High: data loss | Backup before migration; keep the column during code rollback; export before downgrade. |
| Public payload grows beyond budget | Medium | Medium: slower build/cache | 32 KiB per-document cap; existing gzip budget; representative size test. |
| Audit rows become large | Low | Low: storage/read cost | 32 KiB cap; audit table is admin-only. |
| Deep merge accidentally retained removed fields | Low | Medium: stale content | Whole-document replacement; explicit replacement test. |
| Explicit `null` accidentally treated as “unchanged” | Medium | High: cannot clear a case study | `case_study` excluded from `_PROJECT_NON_NULLABLE`; explicit update test. |
| Snapshot churn without review | Medium | Medium: contract drift | Regenerate and review the exact `caseStudy` diff only. |
| U10.2 uncommitted work is mixed with U10.3 changes | Medium | Medium: review confusion | Commit or stage U10.2 separately before U10.3 implementation review; inspect the diff by file. |
| `long_description` is repurposed for case-study prose | Low | Medium: breaks `highlights` | Keep the boundary; no migration of description text. |
| Docs drift from behavior | Medium | Medium | Defer documentation updates to the documentation phase, but record the behavior in this plan and tests now. |

---

## 14. Acceptance Criteria

### 14.1 Database

- [ ] `project.case_study` exists as nullable `jsonb`.
- [ ] `ck_project_case_study_object` exists and permits only `NULL` or a JSON object.
- [ ] Existing rows remain valid without a backfill.
- [ ] Upgrade to `0005` and downgrade to `0004` work in an isolated test database.
- [ ] No new table or index is created.

### 14.2 Public API

- [ ] Every public project includes `caseStudy`.
- [ ] A `NULL` column produces `caseStudy: null`, not an absent key.
- [ ] A valid document is returned with the approved camelCase contract.
- [ ] Public output never exposes `case_study`.
- [ ] Invalid stored case-study data produces `caseStudy: null` and a warning without failing the whole endpoint.
- [ ] Saving a case study changes `updated_at`, `meta.generated_at`, and the ETag.
- [ ] The payload snapshot is updated intentionally and reviewed.
- [ ] The payload remains within the agreed gzip budget.

### 14.3 Admin API

- [ ] Create omitted stores `NULL`.
- [ ] Create explicit `null` stores `NULL`.
- [ ] Create valid object stores and returns it.
- [ ] Create `{}` and version-only objects return `422`.
- [ ] Update omitted preserves the value.
- [ ] Update explicit `null` clears the value.
- [ ] Update object replaces the whole document with no deep merge.
- [ ] Invalid nested input returns `422` with a `case_study` field path.
- [ ] `ProjectListItem` does not gain `case_study`.
- [ ] `ProjectOut` returns raw `case_study` for recovery.
- [ ] Every mutation writes exactly one audit row including `case_study`.
- [ ] Soft delete preserves `case_study`.
- [ ] Existing auth, CSRF, slug, concurrency, and audit rules are unchanged.

### 14.4 Contract and scope

- [ ] U10.2 validator tests still pass unchanged.
- [ ] No public renderer, admin editor, AI ingestion, prompt, or content authoring is added.
- [ ] No frontend/AI source changes are made in U10.3 beyond the already-approved U10.2 work.
- [ ] No generated content or `src/data/**` file is modified.
- [ ] No commit, push, merge, deploy, or U10.4 work is performed.

---

## 15. Open Questions for Review

**PROPOSED** These require an explicit owner or reviewer decision before or during implementation:

1. **Public degradation policy:** confirm that one malformed optional case study should degrade to `caseStudy: null` with a warning rather than causing a `500`. This plan recommends degradation, consistent with U10.1.
2. **Empty-object enforcement layer:** confirm the database CHECK should enforce object type only, with the admin API rejecting `{}`. If the owner wants `{}` rejected by the database as well, add `case_study <> '{}'::jsonb` to the CHECK and update the constraint tests.
3. **U10.2 release state:** confirm the U10.2 AI and frontend validator changes will be committed and deployed before the backend emits `caseStudy`.
4. **Snapshot review:** confirm the exact `caseStudy: null` additions to `content_payload.json` are acceptable and that no other snapshot changes are bundled.
5. **Size budget:** confirm the existing gzip budget plus a representative full case-study test is sufficient; no new numeric budget is proposed here.
6. **Documentation timing:** confirm API/database documentation stays in the later documentation phase rather than being changed in U10.3.

---

## 16. Final Recommended Implementation Shape

```text
PostgreSQL
  project.case_study jsonb NULL
  CHECK (case_study IS NULL OR jsonb_typeof(case_study) = 'object')
        |
        v
Public /api/content
  projects[].caseStudy: CaseStudy | null
  invalid stored document -> null + warning
        |
        +-- Admin API
              ProjectCreateIn / ProjectUpdateIn: case_study: CaseStudy | null
              ProjectOut: case_study: raw dict | null
              ProjectListItem: unchanged
              omitted = unchanged
              null = clear
              object = whole-document replace
              {} / version-only / invalid = 422
```

**PROPOSED** The implementation should be small: one model column, one migration, two schema additions, one public assembly helper, one admin route field, and focused tests. The U10.2 contract does the heavy validation work already.

---

## 17. Final Recommendation

**PROPOSED** The plan is implementation-ready with no design correction required, subject to the six review decisions in §15. The recommended implementation order is U10.2 release readiness, model/migration, database tests, public assembly, admin integration, focused tests, snapshot review, full backend regression, and scope verification.

READY FOR U10.3 IMPLEMENTATION REVIEW
