// DataTable — dense, keyboard-accessible sort/read grid. Column defs take a
// render function; `sort()` on a column opts that column into aria-sort.

import { useState } from "react";

export default function DataTable({
  columns,
  rows,
  rowKey,
  emptyState = "No rows.",
  ariaLabel = "Data table",
}) {
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  function toggleSort(column) {
    if (!column.sort) return;
    if (sortKey === column.key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(column.key);
      setSortDir(column.sort.defaultDir || "asc");
    }
  }

  const sorted = [...rows].sort((a, b) => {
    if (!sortKey) return 0;
    const column = columns.find((c) => c.key === sortKey);
    if (!column || !column.sort) return 0;
    const av = column.sort.get ? column.sort.get(a) : a[sortKey];
    const bv = column.sort.get ? column.sort.get(b) : b[sortKey];
    if (av === bv) return 0;
    const result = av == null ? 1 : bv == null ? -1 : String(av).localeCompare(String(bv));
    return sortDir === "asc" ? result : -result;
  });

  return (
    <div className="admin-table-scroll">
      <table className="admin-table" aria-label={ariaLabel}>
        <thead>
          <tr>
            {columns.map((column) => {
              const sortedByThis =
                column.sort && sortKey === column.key
                  ? sortDir === "asc"
                    ? "ascending"
                    : "descending"
                  : undefined;
              return (
                <th
                  key={column.key}
                  className={column.align === "num" ? "num" : undefined}
                  scope="col"
                  aria-sort={sortedByThis}
                >
                  {column.sort ? (
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={() => toggleSort(column)}
                    >
                      {column.label}
                      {sortedByThis ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="admin-empty">
                {emptyState}
              </td>
            </tr>
          ) : (
            sorted.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) => (
                  <td key={column.key} className={column.align === "num" ? "num" : undefined}>
                    {column.render ? column.render(row) : row[column.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}