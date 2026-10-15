// Messages — read-only inbox with status filtering and mark read/archived.
// No delete, no resend, no "mark unread" (API.md §6.6).

import { useCallback, useEffect, useState } from "react";

import { get, patch } from "../api/client.js";
import DataTable from "../components/DataTable.jsx";
import { useToast } from "../components/Toast.jsx";
import { formatDateTime } from "../lib/validators.js";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "read", label: "Read" },
  { value: "archived", label: "Archived" },
];

function StatusBadge({ status }) {
  if (status === "archived") return <span className="admin-badge admin-badge--hidden">Archived</span>;
  if (status === "read") return <span className="admin-badge admin-badge--muted">Read</span>;
  return <span className="admin-badge admin-badge--published">Unread</span>;
}

export default function Messages() {
  const toast = useToast();

  const [filter, setFilter] = useState("unread");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(false);

  const pageSize = 20;

  const refresh = useCallback(async () => {
    try {
      setLoadError(null);
      const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      if (filter !== "all") query.set("status", filter);
      setData(await get(`/messages?${query.toString()}`));
    } catch (err) {
      setLoadError(err.message);
    }
  }, [filter, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on mount/page-change; setState runs after the GET resolves
    refresh();
  }, [refresh]);

  function goTo(nextPage) {
    setPage(Math.max(1, Math.min(nextPage, data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1)));
  }

  async function setStatus(message, status) {
    if (busy) return;
    setBusy(true);
    try {
      await patch(`/messages/${message.id}`, { status });
      toast.success(status === "archived" ? "Message archived." : "Marked as read.");
      await refresh();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;

  return (
    <div>
      <div className="admin-toolbar">
        <div role="tablist" aria-label="Filter messages by status">
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              className={`admin-btn admin-btn--sm ${filter === value ? "" : "admin-btn--ghost"}`}
              onClick={() => {
                setFilter(value);
                setPage(1);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {data ? <span className="admin-topbar-user">{data.total} message(s)</span> : null}
      </div>

      {loadError ? <div className="admin-empty" role="alert">{loadError}</div> : null}
      {data === null && !loadError ? (
        <div className="admin-loading">Loading inbox…</div>
      ) : (
        <DataTable
          ariaLabel="Messages"
          rowKey={(row) => row.id}
          rows={data ? data.items : []}
          emptyState="No messages in this view."
          columns={[
            { key: "name", label: "Name" },
            { key: "email", label: "Email" },
            { key: "subject", label: "Subject" },
            {
              key: "message",
              label: "Message",
              render: (row) => (
                <span title={row.message} style={{ maxWidth: "28rem", display: "inline-block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row.message}
                </span>
              ),
            },
            {
              key: "status",
              label: "Status",
              render: (row) => <StatusBadge status={row.status} />,
            },
            {
              key: "created_at",
              label: "Received",
              render: (row) => formatDateTime(row.created_at),
            },
            {
              key: "actions",
              label: "Actions",
              render: (row) => {
                if (row.status === "archived") return "—";
                return (
                  <span>
                    {row.status !== "read" ? (
                      <>
                        <button type="button" className="admin-btn admin-btn--secondary admin-btn--sm" disabled={busy} onClick={() => setStatus(row, "read")}>
                          Mark read
                        </button>{" "}
                      </>
                    ) : null}
                    <button type="button" className="admin-btn admin-btn--danger admin-btn--sm" disabled={busy} onClick={() => setStatus(row, "archived")}>
                      Archive
                    </button>
                  </span>
                );
              },
            },
          ]}
        />
      )}

      <div className="admin-toolbar" aria-label="Pagination">
        <button type="button" className="admin-btn admin-btn--secondary admin-btn--sm" disabled={!data || page <= 1} onClick={() => goTo(page - 1)}>
          ← Previous
        </button>
        <span className="admin-topbar-user">
          Page {page} of {totalPages}
        </span>
        <button type="button" className="admin-btn admin-btn--secondary admin-btn--sm" disabled={!data || page >= totalPages} onClick={() => goTo(page + 1)}>
          Next →
        </button>
      </div>
    </div>
  );
}