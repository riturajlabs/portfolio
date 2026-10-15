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
  onUpload,
  error,
  required,
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const fileInput = useRef(null);

  const validationError = validateImagePath(value);
  const localError = error || uploadError || validationError;
  const showError = Boolean(localError);

  async function handleFile(event) {
    const file = event.target.files && event.target.files[0];
    // Reset immediately so choosing the same file again still fires `change`.
    event.target.value = "";
    if (!file || !onUpload) return;
    setUploading(true);
    setUploadError(null);
    try {
      await onUpload(file);
    } catch (err) {
      setUploadError(err && err.message ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Field
      label={label || "Image"}
      htmlFor={id}
      hint="Upload an image (stored in object storage) or paste a path like /images/projects/your-project.webp"
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
                aria-label="Upload image file"
                onChange={handleFile}
                disabled={uploading}
              />
              {uploading ? <span className="admin-image-upload-status">Uploading…</span> : null}
            </div>
          ) : null}

          <input
            id={fieldId}
            className="admin-input"
            type="text"
            value={value || ""}
            onChange={(event) => {
              setUploadError(null);
              onChange(event.target.value);
            }}
            aria-invalid={showError}
            aria-describedby={showError ? linked.errorId : linked.hintId}
            autoComplete="off"
            spellCheck="false"
            placeholder="https://… or /images/projects/your-project.webp"
          />

          {!showError && value ? (
            <div className="admin-image-picker-preview">
              <img src={value} alt="" />
            </div>
          ) : null}
        </>
      )}
    </Field>
  );
}
