// Project editor — create and edit. The slug is not authored here: the backend
// derives it from the title on create and treats it as the project's permanent
// URL (ADR-016), so this screen shows a read-only permalink instead of a slug
// field. Image dimensions are read from the file in the browser and filled in,
// falling back to manual entry only when detection fails. The canonical URL
// preview reflects the generated /projects/<slug>/ page.

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ApiError, fieldErrorMap, get, post, put, uploadImage } from "../api/client.js";
import CaseStudyEditor from "../components/case-study/CaseStudyEditor.jsx";
import { Field, Form } from "../components/Form.jsx";
import ImagePicker from "../components/ImagePicker.jsx";
import { useToast } from "../components/Toast.jsx";
import {
  CASE_STUDY_FIELD,
  buildCaseStudyPayload,
  canonicalCaseStudyPath,
  caseStudyFieldErrors,
  initCaseStudyDraft,
  isCaseStudyErrorPath,
  pruneCaseStudyDocument,
  timelineOrderingIsInvalid,
} from "../lib/caseStudy.js";
import {
  slugPreview,
  validateImagePath,
  validateImageDimensions,
  validateUrl,
} from "../lib/validators.js";

const TIMELINE_START = `${CASE_STUDY_FIELD}.timeline.start`;
const TIMELINE_END = `${CASE_STUDY_FIELD}.timeline.end`;

function hasCaseStudyErrors(errors) {
  return Object.keys(errors || {}).some((path) =>
    isCaseStudyErrorPath(path),
  );
}

function normalizeServerErrors(errors) {
  return Object.fromEntries(
    Object.entries(errors || {}).map(([path, message]) => [
      isCaseStudyErrorPath(path) ? canonicalCaseStudyPath(path) : path,
      message,
    ]),
  );
}

function sourceMapFor(paths, source) {
  return Object.fromEntries(paths.map((path) => [path, source]));
}

function withoutErrorPaths(sources, targets) {
  const next = {};
  for (const [path, source] of Object.entries(sources)) {
    if (
      targets.some(
        (target) => path === target || path.startsWith(`${target}.`),
      )
    ) {
      continue;
    }
    next[path] = source;
  }
  return next;
}

function caseStudyErrorSourceFor(errors, sources) {
  const paths = Object.keys(errors || {}).filter(isCaseStudyErrorPath);
  if (paths.length === 0) return null;
  const hasClient = paths.some((path) => sources[path] === "client");
  const hasServer = paths.some((path) => sources[path] === "server");
  if (hasClient && hasServer) return "mixed";
  return hasServer ? "server" : "client";
}

const EMPTY = {
  title: "",
  slug: "",
  short_description: "",
  long_description: "",
  image: "",
  image_width: "",
  image_height: "",
  image_alt: "",
  category: null,
  tech_stack: [],
  status: "published",
  featured: false,
  indexable: true,
  display_order: 0,
  live_url: "",
  github_url: "",
  seo_title: "",
  seo_description: "",
};

export default function ProjectEditor() {
  const { id } = useParams();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();

  const [form, setForm] = useState(EMPTY);
  const [caseStudyDraft, setCaseStudyDraft] = useState(() =>
    initCaseStudyDraft(null),
  );
  const [fieldErrors, setFieldErrors] = useState({});
  const [errorSources, setErrorSources] = useState({});
  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [techText, setTechText] = useState("");
  const [dimensionsDetected, setDimensionsDetected] = useState(false);
  const caseStudyErrorSummaryRef = useRef(null);
  const focusCaseStudyErrorsRef = useRef(false);

  useEffect(() => {
    if (!focusCaseStudyErrorsRef.current) return;
    focusCaseStudyErrorsRef.current = false;
    caseStudyErrorSummaryRef.current?.focus();
  }, [fieldErrors]);

  const caseStudyErrorSource = caseStudyErrorSourceFor(
    fieldErrors,
    errorSources,
  );

  const patch = useCallback((changes) => {
    setForm((current) => ({ ...current, ...changes }));
  }, []);

  function clearFieldError(field) {
    setFieldErrors((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, field)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setErrorSources((current) => withoutErrorPaths(current, [field]));
  }

  const updateCaseStudyDraft = useCallback((updater) => {
    setCaseStudyDraft((current) =>
      typeof updater === "function" ? updater(current) : updater,
    );
  }, []);

  const clearCaseStudyError = useCallback((path) => {
    if (
      !path ||
      (path !== CASE_STUDY_FIELD &&
        !path.startsWith(`${CASE_STUDY_FIELD}.`))
    ) {
      return;
    }
    setErrorSources((current) => withoutErrorPaths(current, [path]));
    setFieldErrors((current) => {
      let changed = false;
      const next = {};
      for (const [key, message] of Object.entries(current)) {
        if (key === path || key.startsWith(`${path}.`)) {
          changed = true;
        } else {
          next[key] = message;
        }
      }
      return changed ? next : current;
    });
  }, []);

  const validateCaseStudyField = useCallback(
    (path) => {
      const prepared = pruneCaseStudyDocument(caseStudyDraft.value ?? {});
      const problems = caseStudyFieldErrors(prepared);
      const targets =
        path === TIMELINE_START || path === TIMELINE_END
          ? [TIMELINE_START, TIMELINE_END]
          : [path];
      const orderingInvalid = timelineOrderingIsInvalid(caseStudyDraft.value);
      const clientPaths = new Set();
      for (const [key] of Object.entries(problems)) {
        if (key === CASE_STUDY_FIELD) continue;
        if (
          orderingInvalid &&
          (key === TIMELINE_START || key === TIMELINE_END)
        ) {
          clientPaths.add(TIMELINE_START);
          clientPaths.add(TIMELINE_END);
        } else if (
          targets.some(
            (target) => key === target || target.startsWith(`${key}.`),
          )
        ) {
          clientPaths.add(key);
        }
      }
      setErrorSources((current) => {
        const next = withoutErrorPaths(current, targets);
        for (const clientPath of clientPaths) next[clientPath] = "client";
        return next;
      });
      setFieldErrors((current) => {
        const next = { ...current };
        for (const key of Object.keys(next)) {
          if (
            targets.some(
              (target) => key === target || key.startsWith(`${target}.`),
            )
          ) {
            delete next[key];
          }
        }
        for (const [key, message] of Object.entries(problems)) {
          if (key === CASE_STUDY_FIELD) continue;
          if (
            orderingInvalid &&
            (key === TIMELINE_START || key === TIMELINE_END)
          ) {
            next[TIMELINE_START] = message;
            next[TIMELINE_END] = message;
          } else if (
            targets.some(
              (target) => key === target || target.startsWith(`${key}.`),
            )
          ) {
            next[key] = message;
          }
        }
        return next;
      });
    },
    [caseStudyDraft.value],
  );

  // The owner should not have to measure the image. When a valid path is typed
  // or pasted, read the file's intrinsic size in the browser and fill in the
  // width/height the build asserts on. If the file is missing, detection fails
  // and the fields stay editable so the owner can still correct them by hand.
  // Detection runs from the change handler (not an effect) so the asynchronous
  // callback owns the state update.
  function handleImageChange(value) {
    patch({ image: value });
    if (validateImagePath(value)) {
      setDimensionsDetected(false);
      return;
    }
    clearFieldError("image");
    const probe = new Image();
    probe.onload = () => {
      patch({ image_width: probe.naturalWidth, image_height: probe.naturalHeight });
      setDimensionsDetected(true);
    };
    probe.onerror = () => setDimensionsDetected(false);
    probe.src = value;
  }

  function handleImageBlur(value) {
    const message = validateImagePath(value);
    if (message) {
      setFieldErrors((current) => ({ ...current, image: message }));
      setErrorSources((current) => ({ ...current, image: "client" }));
      return;
    }
    clearFieldError("image");
  }

  // Upload is a separate call from the save: the object is stored first, and the
  // server-measured dimensions are written into the form. The row (create or
  // update) is still persisted by the single save path at the bottom, so this
  // stays one screen and one write.
  async function requestImageUpload(file) {
    try {
      return await uploadImage(file);
    } catch (err) {
      // Surface the server's field-level reason (size, unsupported type) rather
      // than the generic "Request validation failed." envelope message.
      if (err instanceof ApiError) {
        const mapped = fieldErrorMap(err);
        const first = Object.values(mapped)[0];
        throw new Error(first || err.message, { cause: err });
      }
      throw err;
    }
  }

  async function handleUpload(file) {
    const result = await requestImageUpload(file);
    patch({
      image: result.image,
      image_width: result.image_width,
      image_height: result.image_height,
    });
    setDimensionsDetected(true);
    toast.success("Image uploaded.");
  }

  async function handleCaseStudyUpload(file) {
    const result = await requestImageUpload(file);
    toast.success("Image uploaded.");
    return result;
  }

  const refresh = useCallback(async () => {
    const detail = await get(`/projects/${id}`);
    setFieldErrors({});
    setErrorSources({});
    setForm({
      ...EMPTY,
      ...detail,
      title: detail.title || "",
      slug: detail.slug || "",
      short_description: detail.short_description || "",
      long_description: detail.long_description || "",
      image: detail.image || "",
      image_alt: detail.image_alt || "",
      image_width: detail.image_width ?? "",
      image_height: detail.image_height ?? "",
      display_order: detail.display_order ?? 0,
      live_url: detail.live_url || "",
      github_url: detail.github_url || "",
      seo_title: detail.seo_title || "",
      seo_description: detail.seo_description || "",
      category: detail.category || null,
      updated_at: detail.updated_at || null,
    });
    setCaseStudyDraft(initCaseStudyDraft(detail.case_study ?? null));
    setTechText((detail.tech_stack || []).join(", "));
  }, [id]);

  useEffect(() => {
    if (!isEditing) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag flips once the project GET resolves (asynchronous)
    setLoading(true);
    refresh()
      .catch((err) => {
        if (alive) toast.error(err.message);
        if (err instanceof ApiError && err.status === 404) navigate("/projects", { replace: true });
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function parseTechStack(text) {
    return text
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function validate() {
    const errors = {};
    errors.title = form.title.trim() ? null : "Title is required.";
    errors.short_description = form.short_description.trim()
      ? null
      : "Short description is required.";
    errors.image_width = form.image_width === "" ? "Required." : validateImageDimensions(form.image_width);
    errors.image_height = form.image_height === "" ? "Required." : validateImageDimensions(form.image_height);
    errors.image_alt = form.image_alt.trim() ? null : "Alt text is required.";
    errors.seo_title = form.seo_title.trim() ? null : "SEO title is required (the build validates it).";
    errors.seo_description = form.seo_description.trim()
      ? null
      : "SEO description is required (the build validates it).";
    errors.live_url = validateUrl(form.live_url);
    errors.github_url = validateUrl(form.github_url);
    return Object.fromEntries(Object.entries(errors).filter(([, message]) => message));
  }

  async function onSubmit() {
    const projectErrors = validate();
    const caseStudyPayload = buildCaseStudyPayload({
      draft: caseStudyDraft,
      isEditing,
    });
    const errors = {
      ...projectErrors,
      ...caseStudyPayload.errors,
    };
    focusCaseStudyErrorsRef.current = hasCaseStudyErrors(caseStudyPayload.errors);
    setErrorSources(sourceMapFor(Object.keys(errors), "client"));
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const body = {
      title: form.title.trim(),
      short_description: form.short_description.trim(),
      long_description: form.long_description.trim() || null,
      image: form.image.trim(),
      image_width: Number(form.image_width),
      image_height: Number(form.image_height),
      image_alt: form.image_alt.trim(),
      category: form.category && form.category.trim() ? form.category.trim() : null,
      tech_stack: form.tech_stack,
      status: form.status,
      featured: form.featured,
      indexable: form.indexable,
      display_order: Number(form.display_order) || 0,
      live_url: form.live_url.trim() || null,
      github_url: form.github_url.trim() || null,
      seo_title: form.seo_title.trim(),
      seo_description: form.seo_description.trim(),
    };
    if (caseStudyPayload.include) {
      body.case_study = caseStudyPayload.value;
    }

    setSaving(true);
    try {
      if (isEditing) {
        // Optimistic concurrency: the server 409s if the row changed since the
        // version we loaded, so an overwrite of another session's edit is
        // impossible. The header is derived from the server's `updated_at`.
        const header = form.updated_at
          ? { ifUnmodifiedSince: new Date(form.updated_at).toUTCString() }
          : {};
        await put(`/projects/${id}`, body, header);
        toast.success("Project saved.");
      } else {
        await post("/projects", body);
        toast.success("Project created.");
      }
      navigate("/projects");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "STALE_WRITE") {
          toast.warn("This project was changed elsewhere. Review and save again.");
        } else {
          const mapped = normalizeServerErrors(fieldErrorMap(err));
          if (Object.keys(mapped).length > 0) {
            focusCaseStudyErrorsRef.current = hasCaseStudyErrors(mapped);
            setErrorSources(sourceMapFor(Object.keys(mapped), "server"));
            setFieldErrors(mapped);
          } else toast.error(err.message);
        }
      } else {
        toast.error(err.message);
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="admin-loading">Loading project…</div>;
  }

  const permalinkSlug = isEditing ? form.slug : slugPreview(form.title);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const permalink = `${origin}/projects/${permalinkSlug || "…"}/`;

  return (
    <div>
      <p>
        <a href="/admin/projects">← Back to projects</a>
      </p>

      <Form onSubmit={onSubmit}>
        <section className="admin-card">
          <h2>Basics</h2>

          <Field label="Title" required error={fieldErrors.title}>
            {(fieldId, linked) => (
              <input
                id={fieldId}
                className="admin-input"
                value={form.title}
                onChange={(event) => patch({ title: event.target.value })}
                aria-invalid={Boolean(fieldErrors.title)}
                aria-describedby={linked.errorId}
              />
            )}
          </Field>

          <Field
            label="Permalink"
            hint={
              isEditing
                ? "The project's permanent URL. It is generated once and does not change when the title is edited."
                : "Generated from the title when you save. The server keeps it unique."
            }
          >
            {(fieldId, linked) => (
              <input
                id={fieldId}
                className="admin-input admin-input--readonly"
                value={permalink}
                readOnly
                aria-describedby={linked.hintId}
                onFocus={(event) => event.target.select()}
              />
            )}
          </Field>

          <Field label="Short description" required error={fieldErrors.short_description}>
            {(fieldId, linked) => (
              <textarea
                id={fieldId}
                className="admin-textarea"
                value={form.short_description}
                onChange={(event) => patch({ short_description: event.target.value })}
                aria-invalid={Boolean(fieldErrors.short_description)}
                aria-describedby={linked.errorId}
              />
            )}
          </Field>

          <Field label="Long description">
            {(fieldId) => (
              <textarea
                id={fieldId}
                className="admin-textarea"
                value={form.long_description}
                onChange={(event) => patch({ long_description: event.target.value })}
              />
            )}
          </Field>

          <Field label="Category">
            {(fieldId) => (
              <input
                id={fieldId}
                className="admin-input"
                value={form.category || ""}
                onChange={(event) => patch({ category: event.target.value })}
                placeholder="e.g. Web App"
              />
            )}
          </Field>

          <Field
            label="Tech stack"
            hint="Comma-separated list, e.g. React, FastAPI, PostgreSQL"
          >
            {(fieldId) => (
              <input
                id={fieldId}
                className="admin-input"
                value={techText}
                onChange={(event) => {
                  setTechText(event.target.value);
                  patch({ tech_stack: parseTechStack(event.target.value) });
                }}
              />
            )}
          </Field>
        </section>

        <CaseStudyEditor
          draft={caseStudyDraft}
          onChange={updateCaseStudyDraft}
          errors={fieldErrors}
          errorSource={caseStudyErrorSource}
          errorSummaryRef={caseStudyErrorSummaryRef}
          onBlurPath={validateCaseStudyField}
          onClearPath={clearCaseStudyError}
          onUploadImage={handleCaseStudyUpload}
        />

        <section className="admin-card">
          <h2>Image</h2>

          <ImagePicker
            id="project-image"
            label="Image path"
            value={form.image}
            onChange={handleImageChange}
            onBlur={handleImageBlur}
            onUpload={handleUpload}
            error={fieldErrors.image}
            required
          />

          <Field label="Image alt text" required error={fieldErrors.image_alt}>
            {(fieldId, linked) => (
              <input
                id={fieldId}
                className="admin-input"
                value={form.image_alt}
                onChange={(event) => patch({ image_alt: event.target.value })}
                aria-invalid={Boolean(fieldErrors.image_alt)}
                aria-describedby={linked.errorId}
              />
            )}
          </Field>

          <p>
            {dimensionsDetected
              ? "Image size detected from the file. It is filled in for you."
              : "Enter the image's pixel size if it could not be detected automatically."}
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 1rem" }}>
            <Field label="Image width (px)" required error={fieldErrors.image_width}>
              {(fieldId, linked) => (
                <input
                  id={fieldId}
                  className="admin-input"
                  type="number"
                  min="1"
                  step="1"
                  value={form.image_width}
                  readOnly={dimensionsDetected}
                  onChange={(event) => patch({ image_width: event.target.value })}
                  aria-invalid={Boolean(fieldErrors.image_width)}
                  aria-describedby={linked.errorId}
                />
              )}
            </Field>
            <Field label="Image height (px)" required error={fieldErrors.image_height}>
              {(fieldId, linked) => (
                <input
                  id={fieldId}
                  className="admin-input"
                  type="number"
                  min="1"
                  step="1"
                  value={form.image_height}
                  readOnly={dimensionsDetected}
                  onChange={(event) => patch({ image_height: event.target.value })}
                  aria-invalid={Boolean(fieldErrors.image_height)}
                  aria-describedby={linked.errorId}
                />
              )}
            </Field>
          </div>
        </section>

        <section className="admin-card">
          <h2>Links</h2>

          <Field
            label="Live URL"
            hint={<><code>https://…</code> or <code>http://…</code></>}
            error={fieldErrors.live_url}
          >
            {(fieldId, linked) => (
              <input
                id={fieldId}
                className="admin-input"
                value={form.live_url}
                onChange={(event) => patch({ live_url: event.target.value })}
                aria-invalid={Boolean(fieldErrors.live_url)}
                aria-describedby={linked.errorId || linked.hintId}
                placeholder="https://"
                autoComplete="off"
                spellCheck="false"
              />
            )}
          </Field>

          <Field label="GitHub URL" hint={<><code>https://github.com/…</code></>} error={fieldErrors.github_url}>
            {(fieldId, linked) => (
              <input
                id={fieldId}
                className="admin-input"
                value={form.github_url}
                onChange={(event) => patch({ github_url: event.target.value })}
                aria-invalid={Boolean(fieldErrors.github_url)}
                aria-describedby={linked.errorId || linked.hintId}
                placeholder="https://github.com/"
                autoComplete="off"
                spellCheck="false"
              />
            )}
          </Field>
        </section>

        <section className="admin-card">
          <h2>Visibility & order</h2>
          <p>
            Two independent controls: <strong>status</strong> puts the project on the
            site; <strong>indexable</strong> puts it in the sitemap and generated pages.
            No draft or archive state exists (ADR-016).
          </p>

          <Field label="Status">
            {(fieldId) => (
              <select
                id={fieldId}
                className="admin-select"
                value={form.status}
                onChange={(event) => patch({ status: event.target.value })}
              >
                <option value="published">published</option>
                <option value="hidden">hidden</option>
              </select>
            )}
          </Field>

          <div className="admin-checkbox">
            <input
              id="project-indexable"
              type="checkbox"
              checked={form.indexable}
              onChange={(event) => patch({ indexable: event.target.checked })}
            />
            <label htmlFor="project-indexable">Indexable (included in sitemap)</label>
          </div>

          <div className="admin-checkbox">
            <input
              id="project-featured"
              type="checkbox"
              checked={form.featured}
              onChange={(event) => patch({ featured: event.target.checked })}
            />
            <label htmlFor="project-featured">Featured</label>
          </div>

          <Field label="Display order">
            {(fieldId) => (
              <input
                id={fieldId}
                className="admin-input"
                type="number"
                step="1"
                value={form.display_order}
                onChange={(event) => patch({ display_order: event.target.value })}
              />
            )}
          </Field>
        </section>

        <section className="admin-card">
          <h2>Search engine</h2>
          <p>These fields are validated at build time; both are required.</p>

          <Field label="SEO title" required error={fieldErrors.seo_title}>
            {(fieldId, linked) => (
              <input
                id={fieldId}
                className="admin-input"
                value={form.seo_title}
                onChange={(event) => patch({ seo_title: event.target.value })}
                aria-invalid={Boolean(fieldErrors.seo_title)}
                aria-describedby={linked.errorId}
              />
            )}
          </Field>

          <Field label="SEO description" required error={fieldErrors.seo_description}>
            {(fieldId, linked) => (
              <textarea
                id={fieldId}
                className="admin-textarea"
                value={form.seo_description}
                onChange={(event) => patch({ seo_description: event.target.value })}
                aria-invalid={Boolean(fieldErrors.seo_description)}
                aria-describedby={linked.errorId}
              />
            )}
          </Field>
        </section>

        <div className="admin-toolbar">
          <button type="submit" className="admin-btn" disabled={saving}>
            {saving ? "Saving…" : isEditing ? "Save changes" : "Create project"}
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--secondary"
            onClick={() => navigate("/projects")}
          >
            Cancel
          </button>
        </div>
      </Form>
    </div>
  );
}