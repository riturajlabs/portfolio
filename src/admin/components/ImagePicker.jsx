// ImagePicker — the project cover image. It accepts either an uploaded image
// (stored in object storage; the field then holds the object's public URL) or the
// in-repo `/images/projects/*.webp` path the build has always used, and renders a
// live preview only when the value matches one of those, so the owner sees
// exactly what the public build will choke on before they save.
//
// The upload itself is the parent's job (`onUpload`): this component owns only the
// file input, its in-flight state and its error message. The parent applies the
// returned `{ image, image_width, image_height }` to the form.

import { useRef, useState } from "react";

import { Field } from "./Form.jsx";
import { validateImagePath } from "../lib/validators.js";

export default function ImagePicker({
  id,
  label,
  value,
  onChange,
  onBlur,
  onUpload,
  error,
  required,
  uploadFileLabel = "Upload image file",
  previewVariant = "contained",
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [retryFile, setRetryFile] = useState(null);
  const [touched, setTouched] = useState(false);
  const fileInput = useRef(null);
  const uploadSequence = useRef(0);

  const validationError = touched ? validateImagePath(value) : null;
  const fieldError = error || validationError;
  const localError = [...new Set([fieldError, uploadError].filter(Boolean))].join(
    " ",
  );
  const showError = Boolean(localError);

  function handleBlur() {
    setTouched(true);
    if (onBlur) onBlur(value || "");
  }

  function invalidateUpload() {
    uploadSequence.current += 1;
    setUploading(false);
    setRetryFile(null);
  }

  async function runUpload(file) {
    const sequence = ++uploadSequence.current;
    setUploading(true);
    setUploadError(null);
    setRetryFile(file);
    try {
      await onUpload(file);
      if (sequence !== uploadSequence.current) return;
      setUploadError(null);
      setRetryFile(null);
    } catch (err) {
      if (sequence !== uploadSequence.current) return;
      setUploadError(err && err.message ? err.message : "Upload failed.");
    } finally {
      if (sequence === uploadSequence.current) setUploading(false);
    }
  }

  function handleFile(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file || !onUpload) return;
    runUpload(file);
  }

  function clearValue() {
    invalidateUpload();
    setUploadError(null);
    setTouched(false);
    onChange("");
  }

  return (
    <Field
      label={label || "Image"}
      htmlFor={id}
      hint={
        <>
          Upload an image (stored in object storage) or paste a path like
          /images/projects/your-project.webp
          {previewVariant === "cover"
            ? " The preview shows the project card crop; a wide landscape image is predictable."
            : ""}
        </>
      }
      error={localError}
      required={required}
    >
      {(fieldId, linked) => (
        <>
          {onUpload ? (
            <div className="admin-image-upload">
              <input
                ref={fileInput}
                id={`${fieldId}-file`}
                className="admin-input admin-input--file"
                type="file"
                accept="image/webp,image/png,image/jpeg,image/gif"
                aria-label={uploadFileLabel}
                aria-invalid={uploadError ? "true" : undefined}
                aria-describedby={uploadError ? linked.errorId : undefined}
                aria-busy={uploading}
                onChange={handleFile}
                disabled={uploading}
              />
              {uploading ? (
                <span className="admin-image-upload-status" role="status">
                  Uploading…
                </span>
              ) : null}
              {uploadError && retryFile ? (
                <button
                  type="button"
                  className="admin-btn admin-btn--secondary admin-btn--sm"
                  onClick={() => runUpload(retryFile)}
                >
                  Retry upload
                </button>
              ) : null}
              {value ? (
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost admin-btn--sm"
                  onClick={clearValue}
                >
                  Clear image
                </button>
              ) : null}
            </div>
          ) : null}

          <input
            id={fieldId}
            className="admin-input"
            type="text"
            value={value || ""}
            onChange={(event) => {
              invalidateUpload();
              setUploadError(null);
              onChange(event.target.value);
            }}
            onBlur={handleBlur}
            aria-invalid={showError ? "true" : undefined}
            aria-describedby={showError ? linked.errorId : linked.hintId}
            autoComplete="off"
            spellCheck="false"
            placeholder="https://… or /images/projects/your-project.webp"
          />

          {!showError && value ? (
            <div
              className={`admin-image-picker-preview ${
                previewVariant === "cover"
                  ? "admin-image-picker-preview--cover"
                  : ""
              }`}
            >
              <img src={value} alt="" />
            </div>
          ) : null}
        </>
      )}
    </Field>
  );
}
