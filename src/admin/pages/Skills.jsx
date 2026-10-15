// Skills — skill categories (with their icons/order/visibility) and the skills
// inside them. Category delete is hard and cascades; the API refuses a category
// that still owns skills unless `?cascade=true`, so the confirm step offers that
// choice explicitly.

import { useCallback, useEffect, useState } from "react";

import { ApiError, fieldErrorMap, del, get, post, put } from "../api/client.js";
import { Field, Form } from "../components/Form.jsx";
import IconPicker from "../components/IconPicker.jsx";
import DataTable from "../components/DataTable.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { AdminIcon } from "../lib/icons.jsx";
import { useToast } from "../components/Toast.jsx";

function EmptyCategoryForm() {
  return { name: "", icon_key: "", display_order: 0, is_visible: true };
}

function EmptySkillForm() {
  return { category_id: "", name: "", icon_key: "", display_order: 0, is_visible: true };
}

export default function Skills() {
  const toast = useToast();

  const [categories, setCategories] = useState(null);
  const [skills, setSkills] = useState([]);
  const [loadError, setLoadError] = useState(null);

  const [catForm, setCatForm] = useState(EmptyCategoryForm());
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [catErrors, setCatErrors] = useState({});

  const [skillForm, setSkillForm] = useState(EmptySkillForm());
  const [editingSkillId, setEditingSkillId] = useState(null);
  const [skillErrors, setSkillErrors] = useState({});
  const [skillFilter, setSkillFilter] = useState("all");

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [cascadeChecked, setCascadeChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [cats, skls] = await Promise.all([get("/skill-categories"), get("/skills")]);
      setLoadError(null);
      setCategories(cats);
      setSkills(skls);
      if (cats.length > 0) {
        setSkillForm((current) => {
          const stillValid = cats.some((c) => c.id === current.category_id);
          return stillValid ? current : { ...current, category_id: cats[0].id };
        });
      }
    } catch (err) {
      setLoadError(err.message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on mount; setState runs after the GETs resolve
    refresh();
  }, [refresh]);

  async function saveCategory() {
    const body = {
      name: catForm.name.trim(),
      icon_key: catForm.icon_key,
      display_order: Number(catForm.display_order) || 0,
      is_visible: catForm.is_visible,
    };
    if (!body.name) {
      setCatErrors({ name: "Name is required." });
      return;
    }
    if (!body.icon_key) {
      setCatErrors({ icon_key: "Pick an icon." });
      return;
    }
    setBusy(true);
    try {
      if (editingCategoryId) {
        await put(`/skill-categories/${editingCategoryId}`, body);
        toast.success("Category saved.");
      } else {
        await post("/skill-categories", body);
        toast.success("Category created.");
      }
      setCatForm(EmptyCategoryForm());
      setEditingCategoryId(null);
      setCatErrors({});
      await refresh();
    } catch (err) {
      handleApiError(err, setCatErrors, toast);
    } finally {
      setBusy(false);
    }
  }

  function editCategory(category) {
    setEditingCategoryId(category.id);
    setCatForm({
      name: category.name,
      icon_key: category.icon_key,
      display_order: category.display_order,
      is_visible: category.is_visible,
    });
    setCatErrors({});
  }

  async function saveSkill() {
    const body = {
      category_id: skillForm.category_id,
      name: skillForm.name.trim(),
      icon_key: skillForm.icon_key,
      display_order: Number(skillForm.display_order) || 0,
      is_visible: skillForm.is_visible,
    };
    const errors = {};
    if (!body.category_id) errors.category_id = "Choose a category.";
    if (!body.name) errors.name = "Name is required.";
    if (!body.icon_key) errors.icon_key = "Pick an icon.";
    setSkillErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    try {
      if (editingSkillId) {
        await put(`/skills/${editingSkillId}`, body);
        toast.success("Skill saved.");
      } else {
        await post("/skills", body);
        toast.success("Skill created.");
      }
      setSkillForm(EmptySkillForm());
      setEditingSkillId(null);
      await refresh();
    } catch (err) {
      handleApiError(err, setSkillErrors, toast);
    } finally {
      setBusy(false);
    }
  }

  function editSkill(skill) {
    setEditingSkillId(skill.id);
    setSkillForm({
      category_id: skill.category_id,
      name: skill.name,
      icon_key: skill.icon_key,
      display_order: skill.display_order,
      is_visible: skill.is_visible,
    });
    setSkillErrors({});
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      setBusy(true);
      const query =
        deleteTarget.kind === "category" && cascadeChecked
          ? "?cascade=true"
          : "";
      await del(`/${deleteTarget.kind === "category" ? "skill-categories" : "skills"}/${deleteTarget.id}${query}`);
      toast.success(deleteTarget.kind === "category" ? "Category deleted." : "Skill deleted.");
      setDeleteTarget(null);
      setCascadeChecked(false);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "VALIDATION_ERROR" && !cascadeChecked) {
        setDeleteTarget(null);
        toast.warn("This category still has skills. Repeat the delete and choose to cascade.");
      } else {
        toast.error(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return <div className="admin-empty" role="alert">{loadError}</div>;
  }
  if (categories === null) {
    return <div className="admin-loading">Loading skills…</div>;
  }

  const visibleSkills = skillFilter === "all" ? skills : skills.filter((s) => s.category_id === skillFilter);
  const categoryName = (id) => categories.find((c) => c.id === id)?.name || "—";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(22rem, 1fr))", gap: "1.25rem", alignItems: "start" }}>
      <section className="admin-card">
        <h2>{editingCategoryId ? "Edit category" : "New category"}</h2>
        <Form onSubmit={saveCategory}>
          <Field label="Name" required error={catErrors.name}>
            {(fieldId, linked) => (
              <input
                id={fieldId}
                className="admin-input"
                value={catForm.name}
                onChange={(event) => setCatForm((f) => ({ ...f, name: event.target.value }))}
                aria-invalid={Boolean(catErrors.name)}
                aria-describedby={linked.errorId}
              />
            )}
          </Field>

          <IconPicker
            id="category-icon"
            label="Icon"
            value={catForm.icon_key}
            onChange={(value) => setCatForm((f) => ({ ...f, icon_key: value }))}
          />

          <Field label="Display order">
            {(fieldId) => (
              <input
                id={fieldId}
                className="admin-input"
                type="number"
                step="1"
                value={catForm.display_order}
                onChange={(event) => setCatForm((f) => ({ ...f, display_order: event.target.value }))}
              />
            )}
          </Field>

          <div className="admin-checkbox">
            <input
              id="category-visible"
              type="checkbox"
              checked={catForm.is_visible}
              onChange={(event) => setCatForm((f) => ({ ...f, is_visible: event.target.checked }))}
            />
            <label htmlFor="category-visible">Visible on the site</label>
          </div>

          <button type="submit" className="admin-btn" disabled={busy}>
            {editingCategoryId ? "Save category" : "Add category"}
          </button>
        </Form>

        <h3 style={{ marginTop: "1.5rem" }}>Categories</h3>
        <DataTable
          ariaLabel="Skill categories"
          rowKey={(row) => row.id}
          rows={[...(categories || [])].sort((a, b) => a.display_order - b.display_order)}
          columns={[
            {
              key: "icon",
              label: "Icon",
              render: (row) => <AdminIcon iconKey={row.icon_key} />,
            },
            { key: "name", label: "Name" },
            {
              key: "skills",
              label: "Skills",
              align: "num",
              render: (row) => row.skill_count,
            },
            {
              key: "visible",
              label: "Visible",
              render: (row) => (row.is_visible ? "✓" : "—"),
            },
            {
              key: "actions",
              label: "Actions",
              render: (row) => (
                <span>
                  <button type="button" className="admin-btn admin-btn--secondary admin-btn--sm" onClick={() => editCategory(row)}>
                    Edit
                  </button>{" "}
                  <button type="button" className="admin-btn admin-btn--danger admin-btn--sm" onClick={() => { setCascadeChecked(false); setDeleteTarget({ kind: "category", ...row }); }}>
                    Delete
                  </button>
                </span>
              ),
            },
          ]}
          emptyState="No categories yet."
        />
      </section>

      <section className="admin-card">
        <h2>{editingSkillId ? "Edit skill" : "New skill"}</h2>
        <Form onSubmit={saveSkill}>
          <Field label="Category" required error={skillErrors.category_id}>
            {(fieldId, linked) => (
              <select
                id={fieldId}
                className="admin-select"
                value={skillForm.category_id}
                onChange={(event) => setSkillForm((f) => ({ ...f, category_id: event.target.value }))}
                aria-invalid={Boolean(skillErrors.category_id)}
                aria-describedby={linked.errorId}
              >
                <option value="">Choose…</option>
                {[...(categories || [])].sort((a, b) => a.display_order - b.display_order).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Name" required error={skillErrors.name}>
            {(fieldId, linked) => (
              <input
                id={fieldId}
                className="admin-input"
                value={skillForm.name}
                onChange={(event) => setSkillForm((f) => ({ ...f, name: event.target.value }))}
                aria-invalid={Boolean(skillErrors.name)}
                aria-describedby={linked.errorId}
              />
            )}
          </Field>

          <IconPicker
            id="skill-icon"
            label="Icon"
            value={skillForm.icon_key}
            onChange={(value) => setSkillForm((f) => ({ ...f, icon_key: value }))}
          />

          <Field label="Display order">
            {(fieldId) => (
              <input
                id={fieldId}
                className="admin-input"
                type="number"
                step="1"
                value={skillForm.display_order}
                onChange={(event) => setSkillForm((f) => ({ ...f, display_order: event.target.value }))}
              />
            )}
          </Field>

          <div className="admin-checkbox">
            <input
              id="skill-visible"
              type="checkbox"
              checked={skillForm.is_visible}
              onChange={(event) => setSkillForm((f) => ({ ...f, is_visible: event.target.checked }))}
            />
            <label htmlFor="skill-visible">Visible on the site</label>
          </div>

          <button type="submit" className="admin-btn" disabled={busy}>
            {editingSkillId ? "Save skill" : "Add skill"}
          </button>
        </Form>

        <div className="admin-toolbar" style={{ marginTop: "1.5rem" }}>
          <h3 style={{ margin: 0 }}>Skills</h3>
          <select
            className="admin-select"
            style={{ width: "auto" }}
            aria-label="Filter skills by category"
            value={skillFilter}
            onChange={(event) => setSkillFilter(event.target.value)}
          >
            <option value="all">All categories</option>
            {[...(categories || [])].sort((a, b) => a.display_order - b.display_order).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <DataTable
          ariaLabel="Skills"
          rowKey={(row) => row.id}
          rows={visibleSkills}
          columns={[
            {
              key: "icon",
              label: "Icon",
              render: (row) => <AdminIcon iconKey={row.icon_key} />,
            },
            { key: "name", label: "Name" },
            {
              key: "category",
              label: "Category",
              render: (row) => categoryName(row.category_id),
            },
            {
              key: "visible",
              label: "Visible",
              render: (row) => (row.is_visible ? "✓" : "—"),
            },
            {
              key: "actions",
              label: "Actions",
              render: (row) => (
                <span>
                  <button type="button" className="admin-btn admin-btn--secondary admin-btn--sm" onClick={() => editSkill(row)}>
                    Edit
                  </button>{" "}
                  <button type="button" className="admin-btn admin-btn--danger admin-btn--sm" onClick={() => setDeleteTarget({ kind: "skill", id: row.id, name: row.name })}>
                    Delete
                  </button>
                </span>
              ),
            },
          ]}
          emptyState="No skills in this category yet."
        />
      </section>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget?.kind === "category" ? "Delete this category?" : "Delete this skill?"}
        message={
          deleteTarget?.kind === "category"
            ? `"${deleteTarget.name}" will be deleted permanently. ${
                deleteTarget.skill_count > 0
                  ? `It still contains ${deleteTarget.skill_count} skill(s).`
                  : "It has no skills."
              }`
            : `"${deleteTarget?.name}" will be deleted permanently.`
        }
        confirmLabel="Delete"
        onCancel={() => { setDeleteTarget(null); setCascadeChecked(false); }}
        onConfirm={confirmDelete}
      >
        {deleteTarget?.kind === "category" && deleteTarget.skill_count > 0 ? (
          <div className="admin-checkbox" style={{ marginTop: "0.75rem" }}>
            <input
              id="cascade-delete"
              type="checkbox"
              checked={cascadeChecked}
              onChange={(event) => setCascadeChecked(event.target.checked)}
            />
            <label htmlFor="cascade-delete">
              Also delete its {deleteTarget.skill_count} skill(s) (cascade)
            </label>
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

function handleApiError(err, setFieldErrors, toast) {
  if (err instanceof ApiError) {
    const mapped = fieldErrorMap(err);
    if (Object.keys(mapped).length > 0) {
      setFieldErrors(mapped);
    } else {
      toast.error(err.message);
    }
  } else {
    toast.error(err.message);
  }
}