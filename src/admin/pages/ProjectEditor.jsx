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
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { Field, Form } from "../components/Form.jsx";
import ImagePicker from "../components/ImagePicker.jsx";
import ProjectErrorSummary from "../components/ProjectErrorSummary.jsx";
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

function projectSectionForPath(path) {
  const key = String(path).split(".")[0];
  if (["image", "image_alt", "image_width", "image_height"].includes(key)) {
    return "project-media";
  }
  if (["seo_title", "seo_description"].includes(key)) return "project-seo";
  if (["status", "indexable", "featured", "display_order"].includes(key)) {
    return "project-publishing";
  }
  if (["live_url", "github_url", "long_description"].includes(key)) {
    return "project-content";
  }
  return "project-identity";
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
  const [loadedProjectId, setLoadedProjectId] = useState(null);
  const [loaded, setLoaded] = useState(!isEditing);
  const [loadError, setLoadError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [techText, setTechText] = useState("");
  const [dimensionsDetected, setDimensionsDetected] = useState(false);
  const caseStudyErrorSummaryRef = useRef(null);
  const projectErrorSummaryRef = useRef(null);
  const focusCaseStudyErrorsRef = useRef(false);
  const focusProjectErrorsRef = useRef(false);
  const savingRef = useRef(false);
  const imageUploadVersion = useRef(0);
  const imagePathVersion = useRef(0);

  useEffect(() => {
    if (focusProjectErrorsRef.current) {
      focusProjectErrorsRef.current = false;
      projectErrorSummaryRef.current?.focus();
      return;
    }
    if (!focusCaseStudyErrorsRef.current) return;
    focusCaseStudyErrorsRef.current = false;
    caseStudyErrorSummaryRef.current?.focus();
  }, [fieldErrors]);

  useEffect(() => {
    if (!dirty) return undefined;
    function warnBeforeUnload(event) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty]);

  const caseStudyErrorSource = caseStudyErrorSourceFor(
    fieldErrors,
    errorSources,
  );

  const patch = useCallback((changes) => {
    setForm((current) => ({ ...current, ...changes }));
    setDirty(true);
  }, []);

  function updateTechText(value) {
    setTechText(value);
    patch({ tech_stack: parseTechStack(value) });
  }

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
    setDirty(true);
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
    const version = ++imagePathVersion.current;
    imageUploadVersion.current += 1;
    patch({ image: value });
    if (validateImagePath(value)) {
      setDimensionsDetected(false);
      return;
    }
    clearFieldError("image");
    const probe = new Image();
    probe.onload = () => {
      if (version !== imagePathVersion.current) return;
      patch({
        image_width: probe.naturalWidth,
        image_height: probe.naturalHeight,
      });
      setDimensionsDetected(true);
    };
    probe.onerror = () => {
      if (version === imagePathVersion.current) setDimensionsDetected(false);
    };
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
    const version = ++imageUploadVersion.current;
    const result = await requestImageUpload(file);
    if (version !== imageUploadVersion.current) return;
    imagePathVersion.current += 1;
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
    setDirty(false);
    setLoaded(true);
    setLoadedProjectId(id);
    imageUploadVersion.current += 1;
    imagePathVersion.current += 1;
  }, [id]);

  useEffect(() => {
    if (!isEditing) return undefined;
    let alive = true;
    void Promise.resolve()
      .then(() => refresh())
      .catch((err) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 404) {
          navigate("/projects", { replace: true });
          return;
        }
        setLoadError(
          err && err.message ? err.message : "Could not load this project.",
        );
        toast.error(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id, reloadKey, refresh, navigate, toast, isEditing]);

  function parseTechStack(text) {
    return text
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function requestLeave() {
    if (dirty) {
      setConfirmLeave(true);
      return;
    }
    navigate("/projects");
  }

  function confirmLeaveEditor() {
    setConfirmLeave(false);
    setDirty(false);
    navigate("/projects");
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
    if (savingRef.current || (isEditing && !loaded)) return;
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
    focusProjectErrorsRef.current = Object.keys(projectErrors).length > 0;
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

    savingRef.current = true;
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
      setDirty(false);
      navigate("/projects");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "STALE_WRITE") {
          toast.warn("This project was changed elsewhere. Review and save again.");
        } else {
          const mapped = normalizeServerErrors(fieldErrorMap(err));
          if (Object.keys(mapped).length > 0) {
            focusCaseStudyErrorsRef.current = hasCaseStudyErrors(mapped);
            focusProjectErrorsRef.current = Object.keys(mapped).some(
              (path) => !isCaseStudyErrorPath(path),
            );
            setErrorSources(sourceMapFor(Object.keys(mapped), "server"));
            setFieldErrors(mapped);
          } else toast.error(err.message);
        }
      } else {
        toast.error(err.message);
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="admin-card admin-error-state" role="alert">
        <h2>Project could not be loaded</h2>
        <p>{loadError}</p>
        <p>
          Editing is blocked until the project loads, so an empty form cannot
          overwrite it. Retry or return to the projects list.
        </p>
        <div className="admin-toolbar">
          <button
            type="button"
            className="admin-btn"
            onClick={() => {
              setLoadError(null);
              setLoading(true);
              setReloadKey((key) => key + 1);
            }}
          >
            Retry loading project
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--secondary"
            onClick={() => navigate("/projects")}
          >
            Back to projects
          </button>
        </div>
      </div>
    );
  }

  if (loading || (isEditing && loadedProjectId !== id)) {
    return <div className="admin-loading">Loading project…</div>;
  }

  const permalinkSlug = isEditing ? form.slug : slugPreview(form.title);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const permalink = `${origin}/projects/${permalinkSlug || "…"}/`;
  const canSave = !isEditing || loaded;

  return (
    <div>
      <p>
        <button
          type="button"
          className="admin-btn admin-btn--ghost admin-btn--sm"
          onClick={requestLeave}
        >
          ← Back to projects
        </button>
      </p>

      <Form id="project-form" onSubmit={onSubmit}>
        <ProjectErrorSummary
          ref={projectErrorSummaryRef}
          errors={fieldErrors}
          sectionForPath={projectSectionForPath}
        />

        <section
          id="project-identity"
          tabIndex={-1}
          className="admin-card"
          aria-labelledby="project-identity-heading"
        >
          <h2 id="project-identity-heading">1 · Identity</h2>

          <Field
            label="Title"
            htmlFor="project-title"
            required
            error={fieldErrors.title}
          >
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
            htmlFor="project-permalink"
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

          <Field label="Short description" htmlFor="project-short-description" required error={fieldErrors.short_description}>
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

          <Field label="Category" htmlFor="project-category">
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
            htmlFor="project-tech-stack"
            hint="Comma-separated list, e.g. React, FastAPI, PostgreSQL. Spaces around commas are trimmed."
          >
            {(fieldId) => (
              <input
                id={fieldId}
                className="admin-input"
                value={techText}
                onChange={(event) => updateTechText(event.target.value)}
              />
            )}
          </Field>
        </section>

        <section
          id="project-media"
          tabIndex={-1}
          className="admin-card"
          aria-labelledby="project-media-heading"
        >
          <h2 id="project-media-heading">2 · Media</h2>

          <ImagePicker
            id="project-image"
            label="Image path"
            value={form.image}
            onChange={handleImageChange}
            onBlur={handleImageBlur}
            onUpload={handleUpload}
            error={fieldErrors.image}
            previewVariant="cover"
            required
          />

          <Field label="Image alt text" htmlFor="project-image-alt" required error={fieldErrors.image_alt}>
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

          <p className="admin-field-hint" id="project-image-dimensions-hint">
            {dimensionsDetected
              ? "Size detected from the upload and locked. The preview shows the project card crop."
              : "If detection fails, enter the image's intrinsic pixel size (width × height). Landscape images crop more predictably."}
          </p>

          <div className="admin-grid-two">
            <Field
              label="Image width (px)"
              htmlFor="project-image-width"
              hint="Whole pixels from the original file."
              required
              error={fieldErrors.image_width}
            >
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
                  aria-describedby={linked.errorId || linked.hintId}
                />
              )}
            </Field>
            <Field
              label="Image height (px)"
              htmlFor="project-image-height"
              hint="Whole pixels from the original file."
              required
              error={fieldErrors.image_height}
            >
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
                  aria-describedby={linked.errorId || linked.hintId}
                />
              )}
            </Field>
          </div>
        </section>

        <section
          id="project-content"
          tabIndex={-1}
          className="admin-card"
          aria-labelledby="project-content-heading"
        >
          <h2 id="project-content-heading">3 · Content & links</h2>

          <Field label="Long description" htmlFor="project-long-description">
            {(fieldId) => (
              <textarea
                id={fieldId}
                className="admin-textarea"
                value={form.long_description}
                onChange={(event) => patch({ long_description: event.target.value })}
              />
            )}
          </Field>

          <Field
            label="Live URL"
            htmlFor="project-live-url"
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

          <Field
            label="GitHub URL"
            htmlFor="project-github-url"
            hint={<><code>https://github.com/…</code></>}
            error={fieldErrors.github_url}
          >
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

        <section
          id="project-publishing"
          tabIndex={-1}
          className="admin-card"
          aria-labelledby="project-publishing-heading"
        >
          <h2 id="project-publishing-heading">4 · Publishing</h2>
          <p>
            Two independent controls: <strong>status</strong> puts the project on the
            site; <strong>indexable</strong> puts it in the sitemap and generated pages.
            No draft or archive state exists (ADR-016).
          </p>

          <Field
            label="Status"
            htmlFor="project-status"
            hint="Published shows the project on the site; hidden keeps the row but removes it from listings."
          >
            {(fieldId, linked) => (
              <select
                id={fieldId}
                className="admin-select"
                value={form.status}
                onChange={(event) => patch({ status: event.target.value })}
                aria-describedby={linked.hintId}
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
              aria-describedby="project-indexable-hint"
            />
            <label htmlFor="project-indexable">Indexable (included in sitemap)</label>
          </div>
          <p className="admin-field-hint" id="project-indexable-hint">
            Turn off only for thin or duplicate pages; the sitemap and generated project pages follow this flag.
          </p>

          <div className="admin-checkbox">
            <input
              id="project-featured"
              type="checkbox"
              checked={form.featured}
              onChange={(event) => patch({ featured: event.target.checked })}
            />
            <label htmlFor="project-featured">Featured</label>
          </div>

          <Field label="Display order" htmlFor="project-display-order" hint="Lower numbers appear first in project listings.">
            {(fieldId, linked) => (
              <input
                id={fieldId}
                className="admin-input"
                type="number"
                step="1"
                value={form.display_order}
                onChange={(event) => patch({ display_order: event.target.value })}
                aria-describedby={linked.hintId}
              />
            )}
          </Field>
        </section>

        <section
          id="project-seo"
          tabIndex={-1}
          className="admin-card"
          aria-labelledby="project-seo-heading"
        >
          <h2 id="project-seo-heading">Search engine</h2>
          <p>These fields are validated at build time; both are required.</p>

          <Field label="SEO title" htmlFor="project-seo-title" required error={fieldErrors.seo_title}>
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

          <Field label="SEO description" htmlFor="project-seo-description" required error={fieldErrors.seo_description}>
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

        <div className="admin-toolbar admin-save-bar">
          <div className="admin-toolbar-actions">
            <button type="submit" className="admin-btn" disabled={saving || !canSave}>
              {saving ? "Saving…" : isEditing ? "Save changes" : "Create project"}
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--secondary"
              onClick={requestLeave}
            >
              Cancel
            </button>
          </div>
          {dirty ? (
            <span className="admin-dirty-status" role="status">
              Unsaved changes
            </span>
          ) : null}
        </div>
      </Form>

      <ConfirmDialog
        open={confirmLeave}
        title="Leave without saving?"
        message="Your project changes have not been saved. Leave this page anyway?"
        confirmLabel="Leave page"
        onCancel={() => setConfirmLeave(false)}
        onConfirm={confirmLeaveEditor}
      />
    </div>
  );
}