// Admin entry — a separate React root / bundle (ADR-010). Deliberately imports
// no `src/styles/*` and no public component; its own stylesheet and token values
// live in `src/admin/` (DESIGN_SYSTEM.md §4).

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import "./admin.css";

import AdminApp from "./AdminApp.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter basename="/admin">
      <AdminApp />
    </BrowserRouter>
  </StrictMode>,
);