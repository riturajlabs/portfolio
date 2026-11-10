# U10.3 - Pydantic Serialization Parity Review

**Status:** READ-ONLY verification complete; one plan correction applied.
**Repository:** `/home/riturajlabs/Projects/portfolio`
**Branch:** `feature/portfolio-u8-work`
**HEAD:** `0ccc7ef0deea9d8710af4b7225b2eb8799e53723`
**Runtime:** Python 3.12, Pydantic `2.13.5`
**Plan reviewed:** `reports/U10_3_DATABASE_API_IMPLEMENTATION_PLAN.md`

No application source, tests, migrations, or dependencies were modified. No database connection was opened, no migration was executed, and no database write was attempted. The only source-derived data used below is the approved U10.2 fixture `_valid_case_study()` from `backend/tests/test_case_study_contract.py` and the real project payload builder `_project_payload()` from `backend/tests/test_admin_content.py`.

## 1. Actual CaseStudy model

Inspected:

- `backend/app/schemas/content.py`
- `backend/tests/test_case_study_contract.py`
- `backend/app/schemas/admin_content.py`
- `backend/app/services/admin_content.py`
- `backend/app/routes/admin_content.py`

### 1.1 Field names

`CaseStudy` declares its fields directly under the canonical names. The multiword fields are already camelCase in the declaration:

```python
schemaVersion: StrictInt = Field(ge=1, le=1)
keyDecisions: list[KeyDecision] = Field(default_factory=list, max_length=10)
```

Every nested model also declares its fields under the canonical names. There is no internal snake_case nested field being exposed through an alias.

### 1.2 Aliases

`CaseStudy` and every nested model use only:

```python
model_config = ConfigDict(extra="forbid")
```

`backend/app/schemas/content.py:43` defines `_STRICT` as `ConfigDict(extra="forbid")`. There is no `alias`, `serialization_alias`, `validation_alias`, `populate_by_name`, or `by_alias` configuration in the model.

Programmatic check:

```text
CaseStudy        {}   # no aliases
Timeline         {}
Team             {}
Problem          {}
ApproachSection  {}
ImageAsset       {}
ArchitectureComponent {}
Architecture     {}
KeyDecision      {}
Challenge        {}
Evidence         {}
Outcome          {}
CaseStudyLink    {}
```

Each entry is the set of fields whose `alias` or `serialization_alias` is non-null. Every set is empty.

### 1.3 What `model_dump()` produces

For the approved fixture, `CaseStudy.model_dump()` produces these top-level keys:

```text
schemaVersion, role, timeline, team, problem, constraints, approach,
architecture, keyDecisions, challenges, outcomes, learnings, gallery, links
```

These are the canonical camelCase keys. No nested key is renamed.

`model_dump()` materializes omitted optional fields. The sparse fixture omits five optional fields on the qualitative outcome; the normalized dump adds:

```text
outcomes[1].metric   = None
outcomes[1].value    = None
outcomes[1].unit     = None
outcomes[1].baseline = None
outcomes[1].direction = None
```

Those are the only differences between the fixture input and `CaseStudy.model_dump()`. This is normalization, not an alias defect, and it matches the canonical shape produced by `src/lib/content.js`'s `canonicalCaseStudy()`.

### 1.4 What `model_dump(by_alias=True)` produces

It produces exactly the same keys and values as `model_dump()` for the approved fixture:

```text
model_dump() == model_dump(by_alias=True)                  True
model_dump() == model_dump(mode="json")                    True
model_dump() == model_dump(mode="json", by_alias=True)     True
model_dump_json() parsed == model_dump()                   True
```

`mode="json"` is currently unnecessary because every case-study field is a JSON primitive, list, object, or `None`. `by_alias=True` is also unnecessary because there are no aliases. `model_dump(mode="json", by_alias=True)` remains a safe explicit choice for a storage boundary because it is equivalent today and remains JSON-safe if a future field is not a primitive.

### 1.5 What `model_validate()` accepts

`CaseStudy.model_validate()` accepts the exact canonical camelCase fixture:

```text
CaseStudy.model_validate(_valid_case_study())  -> valid CaseStudy, schemaVersion == 1
```

It also accepts the normalized output of `CaseStudy.model_dump()`. Unknown keys are rejected at every tested level:

```text
top-level "unexpected"        -> extra_forbidden
timeline.season               -> extra_forbidden
```

The model therefore accepts the canonical camelCase document and rejects unknown nested keys as expected.

## 2. Full round trip

Because U10.3 is not implemented, `ProjectCreateIn`, `ProjectUpdateIn`, and `ProjectOut` do not yet contain `case_study`. To exercise the exact proposed boundary without modifying application files, the verification used temporary subclasses of the real models, adding only the planned field:

```python
class ProjectCreateInCS(ProjectCreateIn):
    case_study: CaseStudy | None = None

class ProjectUpdateInCS(ProjectUpdateIn):
    case_study: CaseStudy | None = None

class ProjectOutCS(ProjectOut):
    case_study: dict | None = None

class PublicProjectCS(Project):
    caseStudy: CaseStudy | None = None
```

These are test harnesses around the real models, not replacement schemas. The case-study contract itself is always the approved `CaseStudy` model and the approved fixture.

### 2.1 Create path

Input: the real `_project_payload("demo")` plus the approved `_valid_case_study()` fixture as `case_study`.

Boundary output:

```text
ProjectCreateInCS.model_validate(payload)
    -> payload.model_dump()["case_study"]
    -> CaseStudy.model_dump() normalized document

outer key:  case_study
nested top-level keys:
    schemaVersion, role, timeline, team, problem, constraints, approach,
    architecture, keyDecisions, challenges, outcomes, learnings, gallery, links
```

The create dump's `case_study` is exactly the normalized `CaseStudy.model_dump()` output. The nested key names are canonical.

### 2.2 JSONB storage representation

The normalized Python dict is the value handed to the JSONB column. Simulating the JSON encode/decode boundary without a database connection:

```text
storage = json.loads(json.dumps(create_payload.model_dump()))

storage["case_study"] keys:
    schemaVersion, role, timeline, team, problem, constraints, approach,
    architecture, keyDecisions, challenges, outcomes, learnings, gallery, links
```

JSON encoding and decoding preserve the object keys. There is no key renaming at this boundary. SQLAlchemy's JSONB type serializes the Python dict with the application's JSON serializer; it does not apply Pydantic aliases.

### 2.3 Public read path

The public reader uses the same `CaseStudy` model:

```text
stored dict
    -> CaseStudy.model_validate(stored["case_study"])
    -> valid CaseStudy
    -> public Project caseStudy field
    -> model_dump(mode="json")
```

Observed public response:

```text
outer key: caseStudy
nested keys:
    schemaVersion, role, timeline, team, problem, constraints, approach,
    architecture, keyDecisions, challenges, outcomes, learnings, gallery, links
```

`public_response["caseStudy"]` equals the stored normalized document. The public read path therefore does not lose or rename nested keys.

### 2.4 Update with a replacement object

Using the real `ProjectUpdateIn` subclass:

```text
payload = {"case_study": replacement_fixture}
changes = payload.model_dump(exclude_unset=True)

result:
{"case_study": {...replacement...}}
```

Important Pydantic behavior: `exclude_unset=True` propagates into the nested `CaseStudy` model. A sparse replacement is therefore dumped sparsely. The verification fixture produced a replacement whose qualitative outcome omitted:

```text
metric, value, unit, baseline, direction
```

This is different from the create path, which uses `payload.model_dump()` without `exclude_unset` and therefore materializes those fields as `null`.

This is a real storage-representation inconsistency if the update value is stored directly. Without correction, the same logical document would be stored normalized on create but sparse on update.

### 2.5 Update with explicit null

```text
payload = {"case_study": null}
changes = payload.model_dump(exclude_unset=True)
result: {"case_study": None}
```

The field is present and explicitly `None`. `ProjectUpdateIn` accepts it because `case_study` is not in `_PROJECT_NON_NULLABLE`, and `_non_empty` sees that at least one field was supplied. The update path can clear the column.

### 2.6 Update with the field omitted

```text
payload = {"title": "Changed"}
changes = payload.model_dump(exclude_unset=True)
result: {"title": "Changed"}
```

`case_study` is absent from `changes`; it is not converted to `None` and the stored column is left unchanged.

## 3. Admin response behavior

### 3.1 `ProjectOut` / detail response

Actual `ProjectOut` at `backend/app/schemas/admin_content.py:157` currently has no `case_study` field. The plan adds:

```python
case_study: dict[str, Any] | None = None
```

With that field populated from `row.case_study`, Pydantic response serialization emits the outer key `case_study`, not `caseStudy`:

```text
ProjectOut outer keys contain: case_study
ProjectOut outer keys contain caseStudy: False
ProjectOut nested keys:
    schemaVersion, role, timeline, team, problem, constraints, approach,
    architecture, keyDecisions, challenges, outcomes, learnings, gallery, links
ProjectOut nested value equals stored value: True
```

Pydantic does not rename keys inside a `dict` field. The outer admin field remains `case_study`; the nested document remains canonical camelCase.

### 3.2 Create/update response

Create and update do not return `ProjectOut`. They return `Mutated` (`backend/app/schemas/admin_content.py:623`), whose `entity` field is an untyped `dict`. The service builds it with `_dump(row)` at `backend/app/services/admin_content.py:332` and `backend/app/services/admin_content.py:388`, reading all named row columns.

Observed with the actual `Mutated` model:

```text
outer entity key: case_study
nested keys: canonical camelCase
nested value equals stored value: True
```

The create/update response therefore also preserves the stored nested key names. The admin response behavior is consistent: outer snake_case `case_study`, inner canonical camelCase.

### 3.3 Recovery behavior

`ProjectOut` deliberately exposes the raw stored object. If a row is written outside the admin API with an invalid object, the detail response can expose that raw invalid object for recovery. This does not create internal snake_case keys; the nested model has none. It is the planned recovery behavior, not a serializer transformation.

## 4. Required plan correction

The default `model_dump()` does not produce incorrect nested keys. No alias or `serialization_alias` correction is needed.

There is nevertheless one actual design correction: the update path must normalize a supplied replacement before persisting it. Otherwise `payload.model_dump(exclude_unset=True)` stores a sparse nested document while the create path stores a normalized one.

The plan was updated in:

- §8.2, to specify the single storage representation:
  `case_study.model_dump(mode="json", by_alias=True)`
- §8.2, to add the update-only normalization after
  `changes = payload.model_dump(exclude_unset=True)`
- §8.4, to mark create/update stored objects as normalized
- §10.2 file-impact map, to make `backend/app/services/admin_content.py` the
  update-normalization point rather than “no functional change”
- §10.3, to include the normalization in the implementation sequence
- §11.3, to require create/update storage parity and sparse-update tests

The corrected update representation was verified:

```text
raw update changes are sparse:             True
raw update missing qualitative keys:       metric, value, unit, baseline, direction
normalized update equals create storage:   True
```

For this model, `CaseStudy.model_dump(mode="json", by_alias=True)` is equivalent to `CaseStudy.model_dump()`. The create path already produces that representation through `payload.model_dump()`. The update path must override the explicit `case_study` value after the `exclude_unset` dump.

## 5. Additional consistency checks

### CaseStudy reuse

The plan imports and reuses `CaseStudy` from `app.schemas.content`; it does not redefine the model. The admin schemas should import the same class. The public `Project` schema should add `caseStudy: CaseStudy | None = None` and must not create a second case-study model.

### 32 KiB limit

The limit remains enforced by the existing `CaseStudy._validate_document()` model validator. Verification against the real boundary fixture:

```text
context length 954 -> accepted, model_dump_json() size = 32768 bytes
context length 955 -> rejected:
    "case study must be 32768 bytes or fewer when serialized."
```

The validator measures `self.model_dump_json()`, which includes the normalized default fields. With no aliases, that is the same canonical object shape used at storage and in the public response.

### Omitted versus explicit null

Verified with the real `ProjectUpdateIn` update semantics:

```text
{"case_study": replacement} -> changes contains case_study
{"case_study": null}        -> changes contains case_study: None
{"title": "Changed"}        -> changes has no case_study key
```

The existing `exclude_unset=True` behavior already distinguishes omission from explicit null. The correction only changes the serialization of a supplied object; it does not alter that distinction.

### Public serialization aliases

The public `Project` field must be named `caseStudy` because the public schema declares its fields under canonical names and does not use aliases. The `CaseStudy` model likewise needs no `by_alias=True` at response time. Public serialization emits canonical camelCase keys directly.

### Admin nested snake_case exposure

There are no internal nested snake_case fields in `CaseStudy`. The only multiword fields are already `schemaVersion` and `keyDecisions`. `ProjectOut`'s `case_study` is a raw `dict`; Pydantic does not transform dict keys. A valid stored document therefore remains canonical. An invalid directly-inserted object remains raw by design.

### Existing U10.2 behavior

Focused contract tests were run without the database fixture:

```text
.venv/bin/pytest --noconftest tests/test_case_study_contract.py -q
165 passed in 0.36s
```

The full backend suite was not run because this checkout has no `TEST_DATABASE_URL` and `backend/tests/conftest.py` requires a real PostgreSQL test database. No test or application file was changed by this review.

`git diff --check` passed. Only the new serialization review report was added by this review; the existing U10.3 plan was updated in place. Source and tests remain in their pre-existing worktree state.

## 6. Recommendation

The only serializer defect was the update-path storage inconsistency, and the plan now specifies the normalization point and the exact serialization method. The create path, public reader, admin detail response, and `Mutated` create/update response all round-trip the normalized canonical document.

READY FOR U10.3 IMPLEMENTATION REVIEW
