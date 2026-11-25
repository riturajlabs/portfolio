import { Field } from "../Form.jsx";
import {
  caseStudyDomId,
  caseStudyError,
  caseStudyInvalid,
  plainObject,
} from "./caseStudyFields.js";

const STATUS_OPTIONS = [
  ["", "Choose a status"],
  ["verified", "Verified"],
  ["reported", "Reported"],
  ["unverified", "Unverified"],
];

const DIRECTION_OPTIONS = [
  ["", "No direction"],
  ["higher", "Higher is better"],
  ["lower", "Lower is better"],
  ["neutral", "Neutral"],
];

export default function OutcomeFields({
  outcome,
  index,
  errors,
  onFieldChange,
  onKindChange,
  onAddEvidence,
  onRemoveEvidence,
  onBlur,
}) {
  const item = outcome ?? {};
  const evidence = plainObject(item.evidence) ? item.evidence : null;
  const showEvidence = Boolean(evidence) || item.kind === "quantitative";
  const basePath = `outcomes.${index}`;

  function updateField(field, nextValue) {
    onFieldChange(["outcomes", index, field], nextValue);
  }

  function updateEvidenceField(field, nextValue) {
    onFieldChange(["outcomes", index, "evidence", field], nextValue);
  }

  function error(path) {
    return caseStudyError(errors, `${basePath}.${path}`);
  }

  return (
    <>
      <Field
        label={`Outcome ${index + 1} kind`}
        htmlFor={caseStudyDomId(`${basePath}.kind`)}
        hint="Quantitative outcomes require a metric, value, and evidence. Switching to qualitative clears metric, value, unit, baseline, and direction."
        required
        error={error("kind")}
      >
        {(fieldId, linked) => (
          <select
            id={fieldId}
            className="admin-input"
            value={item.kind ?? ""}
            onChange={(event) => onKindChange(event.target.value)}
            onBlur={() => onBlur?.(`${basePath}.kind`)}
            aria-invalid={caseStudyInvalid(error("kind"))}
            aria-describedby={linked.errorId || linked.hintId}
          >
            <option value="">Choose a type</option>
            <option value="quantitative">Quantitative</option>
            <option value="qualitative">Qualitative</option>
          </select>
        )}
      </Field>

      <Field
        label={`Outcome ${index + 1} statement`}
        htmlFor={caseStudyDomId(`${basePath}.statement`)}
        required
        error={error("statement")}
      >
        {(fieldId, linked) => (
          <textarea
            id={fieldId}
            className="admin-textarea"
            value={item.statement ?? ""}
            onChange={(event) => updateField("statement", event.target.value)}
            onBlur={() => onBlur?.(`${basePath}.statement`)}
            aria-invalid={caseStudyInvalid(error("statement"))}
            aria-describedby={linked.errorId}
          />
        )}
      </Field>

      {item.kind === "quantitative" ? (
        <div className="case-study-grid case-study-grid--two">
          <Field
            label={`Outcome ${index + 1} metric`}
            htmlFor={caseStudyDomId(`${basePath}.metric`)}
            required
            error={error("metric")}
          >
            {(fieldId, linked) => (
              <input
                id={fieldId}
                className="admin-input"
                value={item.metric ?? ""}
                onChange={(event) =>
                  updateField("metric", event.target.value)
                }
                onBlur={() => onBlur?.(`${basePath}.metric`)}
                aria-invalid={caseStudyInvalid(error("metric"))}
                aria-describedby={linked.errorId}
              />
            )}
          </Field>

          <Field
            label={`Outcome ${index + 1} value`}
            htmlFor={caseStudyDomId(`${basePath}.value`)}
            required
            error={error("value")}
          >
            {(fieldId, linked) => (
              <input
                id={fieldId}
                className="admin-input"
                value={item.value ?? ""}
                onChange={(event) => updateField("value", event.target.value)}
                onBlur={() => onBlur?.(`${basePath}.value`)}
                aria-invalid={caseStudyInvalid(error("value"))}
                aria-describedby={linked.errorId}
              />
            )}
          </Field>

          <Field
            label={`Outcome ${index + 1} unit`}
            htmlFor={caseStudyDomId(`${basePath}.unit`)}
            error={error("unit")}
          >
            {(fieldId, linked) => (
              <input
                id={fieldId}
                className="admin-input"
                value={item.unit ?? ""}
                onChange={(event) => updateField("unit", event.target.value)}
                onBlur={() => onBlur?.(`${basePath}.unit`)}
                aria-invalid={caseStudyInvalid(error("unit"))}
                aria-describedby={linked.errorId}
              />
            )}
          </Field>

          <Field
            label={`Outcome ${index + 1} baseline`}
            htmlFor={caseStudyDomId(`${basePath}.baseline`)}
            error={error("baseline")}
          >
            {(fieldId, linked) => (
              <input
                id={fieldId}
                className="admin-input"
                value={item.baseline ?? ""}
                onChange={(event) =>
                  updateField("baseline", event.target.value)
                }
                onBlur={() => onBlur?.(`${basePath}.baseline`)}
                aria-invalid={caseStudyInvalid(error("baseline"))}
                aria-describedby={linked.errorId}
              />
            )}
          </Field>

          <Field
            label={`Outcome ${index + 1} direction`}
            htmlFor={caseStudyDomId(`${basePath}.direction`)}
            error={error("direction")}
          >
            {(fieldId, linked) => (
              <select
                id={fieldId}
                className="admin-input"
                value={item.direction ?? ""}
                onChange={(event) =>
                  updateField("direction", event.target.value || null)
                }
                onBlur={() => onBlur?.(`${basePath}.direction`)}
                aria-invalid={caseStudyInvalid(error("direction"))}
                aria-describedby={linked.errorId}
              >
                {DIRECTION_OPTIONS.map(([value, label]) => (
                  <option key={value || "blank"} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      ) : null}

      {showEvidence ? (
        <fieldset
          id={caseStudyDomId(`${basePath}.evidence`)}
          tabIndex={-1}
          aria-describedby={
            error("evidence") ? caseStudyDomId(`${basePath}.evidence.error`) : undefined
          }
          className="admin-fieldset case-study-subsection"
        >
          <legend>Outcome {index + 1} evidence</legend>
          <p className="admin-field-hint case-study-section-description">
            Verified means you inspected the artifact. It is author-attested,
            not independently verified. Source is required for verified and
            reported evidence.
          </p>

          {error("evidence") ? (
            <p
              id={caseStudyDomId(`${basePath}.evidence.error`)}
              className="admin-field-error"
              role="alert"
            >
              {error("evidence")}
            </p>
          ) : null}

          {item.kind === "qualitative" && evidence ? (
            <button
              type="button"
              className="admin-btn admin-btn--danger admin-btn--sm"
              aria-label={`Remove outcome ${index + 1} evidence`}
              onClick={() => onRemoveEvidence(index)}
            >
              Remove evidence
            </button>
          ) : null}

          <div className="case-study-grid case-study-grid--two">
            <Field
              label={`Outcome ${index + 1} evidence status`}
              htmlFor={caseStudyDomId(`${basePath}.evidence.status`)}
              required
              error={error("evidence.status")}
            >
              {(fieldId, linked) => (
                <select
                  id={fieldId}
                  className="admin-input"
                  value={evidence?.status ?? ""}
                  onChange={(event) =>
                    updateEvidenceField("status", event.target.value)
                  }
                  onBlur={() => onBlur?.(`${basePath}.evidence.status`)}
                  aria-invalid={caseStudyInvalid(error("evidence.status"))}
                  aria-describedby={linked.errorId}
                >
                  {STATUS_OPTIONS.map(([value, label]) => (
                    <option key={value || "blank"} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <Field
              label={`Outcome ${index + 1} evidence URL`}
              htmlFor={caseStudyDomId(`${basePath}.evidence.url`)}
              hint="Optional absolute http(s) URL."
              error={error("evidence.url")}
            >
              {(fieldId, linked) => (
                <input
                  id={fieldId}
                  className="admin-input"
                  value={evidence?.url ?? ""}
                  onChange={(event) =>
                    updateEvidenceField("url", event.target.value)
                  }
                  onBlur={() => onBlur?.(`${basePath}.evidence.url`)}
                  aria-invalid={caseStudyInvalid(error("evidence.url"))}
                  aria-describedby={linked.errorId || linked.hintId}
                />
              )}
            </Field>
          </div>

          <Field
            label={`Outcome ${index + 1} evidence source`}
            htmlFor={caseStudyDomId(`${basePath}.evidence.source`)}
            hint="Describe the artifact, not just a URL. Required for verified and reported evidence."
            error={error("evidence.source")}
          >
            {(fieldId, linked) => (
              <textarea
                id={fieldId}
                className="admin-textarea"
                value={evidence?.source ?? ""}
                onChange={(event) =>
                  updateEvidenceField("source", event.target.value)
                }
                onBlur={() => onBlur?.(`${basePath}.evidence.source`)}
                aria-invalid={caseStudyInvalid(error("evidence.source"))}
                aria-describedby={linked.errorId || linked.hintId}
              />
            )}
          </Field>

          <Field
            label={`Outcome ${index + 1} evidence note`}
            htmlFor={caseStudyDomId(`${basePath}.evidence.note`)}
            error={error("evidence.note")}
          >
            {(fieldId, linked) => (
              <textarea
                id={fieldId}
                className="admin-textarea"
                value={evidence?.note ?? ""}
                onChange={(event) =>
                  updateEvidenceField("note", event.target.value)
                }
                onBlur={() => onBlur?.(`${basePath}.evidence.note`)}
                aria-invalid={caseStudyInvalid(error("evidence.note"))}
                aria-describedby={linked.errorId}
              />
            )}
          </Field>
        </fieldset>
      ) : (
        <button
          type="button"
          id={caseStudyDomId(`${basePath}.evidence.add`)}
          className="admin-btn admin-btn--secondary admin-btn--sm"
          aria-label={`Add evidence for outcome ${index + 1}`}
          onClick={() => onAddEvidence(index)}
        >
          Add evidence
        </button>
      )}
    </>
  );
}
