// Admin shell — sidebar navigation, topbar (user + rebuild of the public site), outlet.
// React routes live under /admin (basename in AdminApp).

import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { FaChartPie, FaCog, FaEnvelope, FaGraduationCap, FaFolderOpen, FaPowerOff, FaListUl } from "react-icons/fa";
import { post } from "../api/client.js";
import { useToast } from "../components/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: FaChartPie, end: true },
  { to: "/projects", label: "Projects", icon: FaFolderOpen },
  { to: "/skills", label: "Skills", icon: FaListUl },
  { to: "/certifications", label: "Certifications", icon: FaGraduationCap },
  { to: "/profile", label: "Profile", icon: FaCog },
  { to: "/messages", label: "Messages", icon: FaEnvelope },
];

const TITLES = {
  "/": "Dashboard",
  "/projects": "Projects",
  "/projects/new": "New project",
  "/skills": "Skills",
  "/certifications": "Certifications",
  "/profile": "Profile",
  "/messages": "Messages",
};

// Longest exact-or-prefix match wins, so `/projects/<uuid>` resolves to
// "Projects" just like `/projects`, and `/projects/new` keeps its own title.
// The tab title and the in-page <h1> share this so they can't disagree.
function titleFor(pathname) {
  const match = Object.keys(TITLES)
    .filter((path) => {
      if (path === "/") return pathname === "/";
      return pathname === path || pathname.startsWith(`${path}/`);
    })
    .sort((a, b) => b.length - a.length)[0];
  return match ? TITLES[match] : "Admin";
}

export default function AdminLayout() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [rebuilding, setRebuilding] = useState(false);

  useEffect(() => {
    document.title = `${titleFor(location.pathname)} · Ritu Raj Portfolio`;
  }, [location.pathname]);

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  // The deploy hook and AI admin token live on the server (both are capability
  // tokens), so this calls the backend rather than Vercel directly. The response
  // reports the static rebuild and the AI re-ingestion separately; every path is
  // shown, so a partial result (one step unconfigured or failed) is surfaced
  // clearly instead of collapsing into a clean success.
  async function handleRebuild() {
    setRebuilding(true);
    try {
      const result = await post("/publish");
      const summary = [
        result.rebuild ? `Rebuild — ${result.rebuild.message}` : "Rebuild — no result",
        result.reingest ? `AI knowledge — ${result.reingest.message}` : "AI knowledge — no result",
      ].join("; ");
      if (result.ok) toast.success(summary);
      else if (result.status === "failed") toast.error(summary);
      else toast.warn(summary);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRebuilding(false);
    }
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <NavLink to="/" className="admin-brand" aria-label="Admin home">
          <span className="admin-brand-mark" aria-hidden="true">
            RR
          </span>
          <span>Portfolio Admin</span>
        </NavLink>

        <nav className="admin-nav" aria-label="Admin sections">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} aria-label={label}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="admin-content">
        <header className="admin-topbar">
          <h1>{titleFor(location.pathname)}</h1>
          <div className="admin-topbar-user">
            {user ? <span title={user.email}>{user.email}</span> : null}
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              title="Triggers the production build and refreshes the AI assistant's knowledge."
              onClick={handleRebuild}
              disabled={rebuilding}
            >
              {rebuilding ? "Rebuilding…" : "Rebuild site"}
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--secondary admin-btn--sm"
              onClick={handleSignOut}
            >
              <FaPowerOff aria-hidden="true" />
              Sign out
            </button>
          </div>
        </header>

        <Outlet />
      </main>
    </div>
  );
}