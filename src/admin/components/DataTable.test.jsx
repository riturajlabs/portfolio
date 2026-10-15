import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import DataTable from "./DataTable.jsx";

const columns = [
  { key: "name", label: "Name", sort: true },
  { key: "role", label: "Role" },
];

const rows = [
  { id: 3, name: "Zoe", role: "Admin" },
  { id: 1, name: "Anna", role: "Editor" },
  { id: 2, name: "max", role: "Viewer" },
];

it("renders the configured columns and cells", () => {
  render(
    <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} ariaLabel="Members" />,
  );
  expect(screen.getByRole("table", { name: "Members" })).toBeInTheDocument();
  expect(screen.getAllByRole("columnheader").map((node) => node.textContent)).toEqual([
    "Name",
    "Role",
  ]);
  expect(screen.getAllByRole("row")).toHaveLength(4);
  expect(screen.getByText("Zoe")).toBeInTheDocument();
});

it("sorts by a sortable column and toggles direction", async () => {
  const user = userEvent.setup();
  render(
    <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} ariaLabel="Members" />,
  );

  await user.click(screen.getByRole("button", { name: /name/i }));
  const firstBodyRow = () => screen.getAllByRole("row")[1];
  expect(firstBodyRow()).toHaveTextContent("Anna");

  await user.click(screen.getByRole("button", { name: /name/i }));
  expect(firstBodyRow()).toHaveTextContent("Zoe");
});

it("shows the empty state when there are no rows", () => {
  render(
    <DataTable
      columns={columns}
      rows={[]}
      rowKey={(row) => row.id}
      emptyState="No members yet."
      ariaLabel="Members"
    />,
  );
  expect(screen.getByText("No members yet.")).toBeInTheDocument();
});

it("calls the column render function instead of reading the raw value", () => {
  const renderCell = vi.fn((row) => <span>{`#${row.id} ${row.name}`}</span>);
  render(
    <DataTable
      columns={[{ key: "name", label: "Name", render: renderCell }]}
      rows={rows}
      rowKey={(row) => row.id}
      ariaLabel="Members"
    />,
  );
  expect(renderCell).toHaveBeenCalledTimes(rows.length);
  expect(screen.getByText("#1 Anna")).toBeInTheDocument();
});