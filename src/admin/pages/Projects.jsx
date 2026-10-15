// Projects — list + reorder (via PUT display_order) + soft delete. Editing is on
// /projects/new and /projects/:id (ProjectEditor).

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FaArrowDown, FaArrowUp, FaEdit, FaPlus } from "react-icons/fa";

import { get, put, del } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { useToast } from "../components/Toast.jsx";
import { formatDateTime } from "../lib/validators.js";

function StatusBadge({ project }) {
  if (project.status === "published") {
    return <span className="admin-badge admin-badge--published">Published</span>;
  }
  return <span className="admin-badge admin-badge--hidden">Hidden</span>;
}

export default function Projects() {
  const toast = useToast();
  const navigate = useNavigate();

  const [projects, setProjects] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const payload = await get("/projects");
      setLoadError(null);
      setProjects(payload);
    } catch (err) {
      setLoadError(err.message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on mount; setState runs after the GET resolves
    refresh();
  }, [refresh]);

  const ordered = [...(projects || [])].sort((a, b) => a.display_order - b.display_order);

  async function move(row, direction) {
    const index = ordered.indexOf(row);
    const swapWith = ordered[index + direction];
    if (!swapWith) return;
    try {
      setBusy(true);
      await put(`/projects/${row.id}`, { display_order: swapWith.display_order });
      await put(`/projects/${swapWith.id}`, { display_order: row.display_order });
      toast.success("Order updated.");
      await refresh();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      setBusy(true);
      const result = await del(`/projects/${deleting.id}`);
      toast.success(`"${deleting.title}" hidden${result.audit_id ? " (logged)" : ""}`);
      setDeleting(null);
      await refresh();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const columns = [
    {
      key: "order",
      label: "Order",
      align: "num",
      render: (row) => {
        const index = ordered.indexOf(row);
        return (
          <span>
            <span className="admin-order-dot" aria-hidden="true">⋮⋮ </span>
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              aria-label={`Move ${row.title} up`}
              disabled={index === 0 || busy}
              onClick={() => move(row, -1)}
            >
              <FaArrowUp aria-hidden="true" />
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              aria-label={`Move ${row.title} down`}
              disabled={index === ordered.length - 1 || busy}
              onClick={() => move(row, 1)}
            >
              <FaArrowDown aria-hidden="true" />
            </button>
          </span>
        );
      },
    },
    {
      key: "title",
      label: "Title",
      render: (row) => <Link to={`/projects/${row.id}`}>{row.title}</Link>,
    },
    {
      key: "slug",
      label: "Slug",
      render: (row) => <code>{row.slug}</code>,
    },
    {
      key: "status",
      label: "Status",
      render: (row) => <StatusBadge project={row} />,
    },
    {
      key: "indexable",
      label: "Indexable",
      render: (row) =>
        row.indexable ? (
          <span className="admin-badge admin-badge--published">Indexed</span>
        ) : (
          <span className="admin-badge admin-badge--hidden">No index</span>
        ),
    },
    {
      key: "featured",
      label: "Featured",
      render: (row) => (row.featured ? "★" : "—"),
    },
    {
      key: "updated_at",
      label: "Updated",
      sort: true,
      render: (row) => formatDateTime(row.updated_at),
    },
    {
      key: "actions",
      label: "Actions",
      render: (row) => (
        <span>
          <Link className="admin-btn admin-btn--secondary admin-btn--sm" to={`/projects/${row.id}`}>
            <FaEdit aria-hidden="true" /> Edit
          </Link>{" "}
          <button
            type="button"
            className="admin-btn admin-btn--danger admin-btn--sm"
            onClick={() => setDeleting(row)}
          >
            Hide
          </button>
        </span>
      ),
    },
  ];

  return (
    <div>
      <div className="admin-toolbar">
        <p>Soft-delete hides a project and removes it from the sitemap; the row survives for audit.</p>
        <button type="button" className="admin-btn" onClick={() => navigate("/projects/new")}>
          <FaPlus aria-hidden="true" /> New project
        </button>
      </div>

      {loadError ? <div className="admin-empty" role="alert">{loadError}</div> : null}
      {projects === null && !loadError ? (
        <div className="admin-loading">Loading projects…</div>
      ) : (
        <DataTable
          columns={columns}
          rows={ordered}
          rowKey={(row) => row.id}
          ariaLabel="Projects"
          emptyState="No projects yet. Create one."
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Hide this project?"
        message={deleting ? `"${deleting.title}" leaves the site and the sitemap. The row is kept for the audit log.` : ""}
        confirmLabel="Hide project"
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}