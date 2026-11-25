import { Field } from "../Form.jsx";
import ImagePicker from "../ImagePicker.jsx";
import {
  caseStudyDomId,
  caseStudyError,
  caseStudyInvalid,
} from "./caseStudyFields.js";

function numberValue(value) {
  return value === null || value === undefined ? "" : value;
}

export default function ImageAssetField({
  label,
  path,
  value,
  errors,
  onFieldChange,
  onUpload,
  onBlur,
  dimensionsLocked = false,
  uploadFileLabel,
}) {
  const asset = value ?? {};
  const basePath = path.join(".");
  const sourceId = `${caseStudyDomId(basePath)}-src`;
  const dimensionsHint = dimensionsLocked
    ? "Measured by the server after upload."
    : undefined;

  function updateField(field, nextValue) {
    onFieldChange([...path, field], nextValue);
  }

  function updateNumberField(field, rawValue) {
    updateField(field, rawValue === "" ? "" : Number(rawValue));
  }

  return (
    <>
      <ImagePicker
        id={sourceId}
        label={`${label} source`}
        value={asset.src ?? ""}
        onChange={(nextValue) => updateField("src", nextValue)}
        onBlur={() => onBlur?.(`${basePath}.src`)}
        onUpload={onUpload}
        uploadFileLabel={uploadFileLabel}
        error={caseStudyError(errors, `${basePath}.src`)}
        required
      />

      <div className="case-study-grid case-study-grid--two">
        <Field
          label={`${label} alt text`}
          htmlFor={caseStudyDomId(`${basePath}.alt`)}
          required
          error={caseStudyError(errors, `${basePath}.alt`)}
        >
          {(fieldId, linked) => (
            <input
              id={fieldId}
              className="admin-input"
              value={asset.alt ?? ""}
              onChange={(event) => updateField("alt", event.target.value)}
              onBlur={() => onBlur?.(`${basePath}.alt`)}
              aria-invalid={caseStudyInvalid(
                caseStudyError(errors, `${basePath}.alt`),
              )}
              aria-describedby={linked.errorId}
            />
          )}
        </Field>

        <Field
          label={`${label} caption`}
          htmlFor={caseStudyDomId(`${basePath}.caption`)}
          error={caseStudyError(errors, `${basePath}.caption`)}
        >
          {(fieldId, linked) => (
            <input
              id={fieldId}
              className="admin-input"
              value={asset.caption ?? ""}
              onChange={(event) => updateField("caption", event.target.value)}
              onBlur={() => onBlur?.(`${basePath}.caption`)}
              aria-invalid={caseStudyInvalid(
                caseStudyError(errors, `${basePath}.caption`),
              )}
              aria-describedby={linked.errorId}
            />
          )}
        </Field>

        <Field
          label={`${label} width`}
          htmlFor={caseStudyDomId(`${basePath}.width`)}
          hint={dimensionsHint}
          required
          error={caseStudyError(errors, `${basePath}.width`)}
        >
          {(fieldId, linked) => (
            <input
              id={fieldId}
              className="admin-input"
              type="number"
              min="1"
              step="1"
              readOnly={dimensionsLocked}
              value={numberValue(asset.width)}
              onChange={(event) =>
                updateNumberField("width", event.target.value)
              }
              onBlur={() => onBlur?.(`${basePath}.width`)}
              aria-invalid={caseStudyInvalid(
                caseStudyError(errors, `${basePath}.width`),
              )}
              aria-describedby={linked.errorId || linked.hintId}
            />
          )}
        </Field>

        <Field
          label={`${label} height`}
          htmlFor={caseStudyDomId(`${basePath}.height`)}
          hint={dimensionsHint}
          required
          error={caseStudyError(errors, `${basePath}.height`)}
        >
          {(fieldId, linked) => (
            <input
              id={fieldId}
              className="admin-input"
              type="number"
              min="1"
              step="1"
              readOnly={dimensionsLocked}
              value={numberValue(asset.height)}
              onChange={(event) =>
                updateNumberField("height", event.target.value)
              }
              onBlur={() => onBlur?.(`${basePath}.height`)}
              aria-invalid={caseStudyInvalid(
                caseStudyError(errors, `${basePath}.height`),
              )}
              aria-describedby={linked.errorId || linked.hintId}
            />
          )}
        </Field>
      </div>
    </>
  );
}
