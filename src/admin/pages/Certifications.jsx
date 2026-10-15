// Certifications — hard-delete CRUD. The `icon` column is a CSS-class token
// (e.g. "fa-solid fa-award"), not a registry key. `issued_on` is a free-text
// display string (the column is `text`, not `date`, e.g. "June 2025"), so it is
// edited and rendered verbatim — a date picker could not represent it and
// silently rewrote it.

import { useCallback, useEffect, useState } from "react";

import { ApiError, fieldErrorMap, del, get, post, put } from "../api/client.js";
import { Field, Form } from "../components/Form.jsx";
import DataTable from "../components/DataTable.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { useToast } from "../components/Toast.jsx";
import { validateUrl } from "../lib/validators.js";

function EmptyForm() {
  return {
    title: "",
    issuer: "",
    icon: "",
    issued_on: "",
    credential_id: "",
    credential_url: "",
    display_order: 0,
  };
}

export default function Certifications() {
  const toast = useToast();

  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState(EmptyForm());
  const [editingId, setEditingId] = useState(null);
  const [errors, setErrors] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setLoadError(null);
      setRows(await get("/certifications"));
    } catch (err) {
      setLoadError(err.message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on mount; setState runs after the GET resolves
    refresh();
  }, [refresh]);

  function edit(row) {
    setEditingId(row.id);
    setErrors({});
    setForm({
      title: row.title,
      issuer: row.issuer,
      icon: row.icon || "",
      issued_on: row.issued_on || "",
      credential_id: row.credential_id || "",
      credential_url: row.credential_url || "",
      display_order: row.display_order ?? 0,
    });
  }

  async function save() {
    const body = {
      title: form.title.trim(),
      issuer: form.issuer.trim(),
      icon: form.icon.trim() || null,
      issued_on: form.issued_on.trim() || null,
      credential_id: form.credential_id.trim() || null,
      credential_url: form.credential_url.trim() || null,
      display_order: Number(form.display_order) || 0,
    };
    const rawErrors = {};
    if (!body.title) rawErrors.title = "Title is required.";
    if (!body.issuer) rawErrors.issuer = "Issuer is required.";
    const urlError = validateUrl(body.credential_url);
    if (urlError) rawErrors.credential_url = urlError;
    setErrors(rawErrors);
    if (Object.keys(rawErrors).length > 0) return;

    setBusy(true);
    try {
      if (editingId) {
        await put(`/certifications/${editingId}`, body);
        toast.success("Certification saved.");
      } else {
        await post("/certifications", body);
        toast.success("Certification created.");
      }
      setForm(EmptyForm());
      setEditingId(null);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        const mapped = fieldErrorMap(err);
        if (Object.keys(mapped).length > 0) setErrors(mapped);
        else toast.error(err.message);
      } else {
        toast.error(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      setBusy(true);
      await del(`/certifications/${deleteTarget.id}`);
      toast.success("Certification deleted.");
      setDeleteTarget(null);
      await refresh();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(22rem, 1fr))", gap: "1.25rem", alignItems: "start" }}>
      <section className="admin-card">
        <h2>{editingId ? "Edit certification" : "New certification"}</h2>
        <Form onSubmit={save}>
          <Field label="Title" required error={errors.title}>
            {(fieldId, linked) => (
              <input
                id={fieldId}
                className="admin-input"
                value={form.title}
                onChange={(event) => setForm((f) => ({ ...f, title: event.target.value }))}
                aria-invalid={Boolean(errors.title)}
                aria-describedby={linked.errorId}
              />
            )}
          </Field>

          <Field label="Issuer" required error={errors.issuer}>
            {(fieldId, linked) => (
              <input
                id={fieldId}
                className="admin-input"
                value={form.issuer}
                onChange={(event) => setForm((f) => ({ ...f, issuer: event.target.value }))}
                aria-invalid={Boolean(errors.issuer)}
                aria-describedby={linked.errorId}
              />
            )}
          </Field>

          <Field label="Icon class" hint="e.g. fa-solid fa-award (rendered as a FontAwesome CSS class on the site)">
            {(fieldId) => (
              <input
                id={fieldId}
                className="admin-input"
                value={form.icon}
                onChange={(event) => setForm((f) => ({ ...f, icon: event.target.value }))}
              />
            )}
          </Field>

          <Field label="Issued on" hint='Free text, e.g. "June 2025"'>
            {(fieldId, linked) => (
              <input
                id={fieldId}
                className="admin-input"
                type="text"
                value={form.issued_on}
                onChange={(event) => setForm((f) => ({ ...f, issued_on: event.target.value }))}
                aria-describedby={linked.hintId}
                placeholder="June 2025"
                autoComplete="off"
              />
            )}
          </Field>

          <Field label="Credential ID">
            {(fieldId) => (
              <input
                id={fieldId}
                className="admin-input"
                value={form.credential_id}
                onChange={(event) => setForm((f) => ({ ...f, credential_id: event.target.value }))}
              />
            )}
          </Field>

          <Field label="Credential URL" error={errors.credential_url} hint="Must be a full http(s) URL">
            {(fieldId, linked) => (
              <input
                id={fieldId}
                className="admin-input"
                value={form.credential_url}
                onChange={(event) => setForm((f) => ({ ...f, credential_url: event.target.value }))}
                aria-invalid={Boolean(errors.credential_url)}
                aria-describedby={linked.errorId || linked.hintId}
                autoComplete="off"
                spellCheck="false"
              />
            )}
          </Field>

          <Field label="Display order">
            {(fieldId) => (
              <input
                id={fieldId}
                className="admin-input"
                type="number"
                step="1"
                value={form.display_order}
                onChange={(event) => setForm((f) => ({ ...f, display_order: event.target.value }))}
              />
            )}
          </Field>

          <button type="submit" className="admin-btn" disabled={busy}>
            {editingId ? "Save certification" : "Add certification"}
          </button>
        </Form>
      </section>

      <section className="admin-card">
        <h2>Certifications</h2>
        {loadError ? <div className="admin-empty" role="alert">{loadError}</div> : null}
        {rows === null && !loadError ? (
          <div className="admin-loading">Loading certifications…</div>
        ) : (
          <DataTable
            ariaLabel="Certifications"
            rowKey={(row) => row.id}
            rows={[...(rows || [])].sort((a, b) => a.display_order - b.display_order)}
            columns={[
              { key: "title", label: "Title" },
              { key: "issuer", label: "Issuer" },
              {
                key: "issued_on",
                label: "Issued",
                render: (row) => row.issued_on || "—",
              },
              {
                key: "actions",
                label: "Actions",
                render: (row) => (
                  <span>
                    <button type="button" className="admin-btn admin-btn--secondary admin-btn--sm" onClick={() => edit(row)}>
                      Edit
                    </button>{" "}
                    <button
                      type="button"
                      className="admin-btn admin-btn--danger admin-btn--sm"
                      onClick={() => setDeleteTarget(row)}
                    >
                      Delete
                    </button>
                  </span>
                ),
              },
            ]}
            emptyState="No certifications yet."
          />
        )}
      </section>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete this certification?"
        message={`"${deleteTarget?.title}" will be deleted permanently.`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}