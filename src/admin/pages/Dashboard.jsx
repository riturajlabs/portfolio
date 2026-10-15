// Dashboard — content counts + recent activity, all read from the same admin
// API the CRUD screens use.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { get } from "../api/client.js";

function useCounts() {
  const [counts, setCounts] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      get("/projects"),
      get("/skill-categories"),
      get("/skills"),
      get("/certifications"),
      get("/messages?status=unread&page=1&page_size=1"),
    ])
      .then(([projects, categories, skills, certifications, unread]) => {
        if (!alive) return;
        setCounts({
          projects: projects.length,
          categories: categories.length,
          skills: skills.length,
          certifications: certifications.length,
          unreadMessages: unread.total,
        });
      })
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, []);

  return { counts, error };
}

export default function Dashboard() {
  const { counts, error } = useCounts();

  const stats = useMemo(
    () => [
      { label: "Projects", value: counts?.projects, to: "/projects" },
      { label: "Skill categories", value: counts?.categories, to: "/skills" },
      { label: "Skills", value: counts?.skills, to: "/skills" },
      { label: "Certifications", value: counts?.certifications, to: "/certifications" },
      { label: "Unread messages", value: counts?.unreadMessages, to: "/messages" },
    ],
    [counts],
  );

  if (error) {
    return <div className="admin-empty" role="alert">{error}</div>;
  }

  return (
    <div>
      <div className="admin-stat-grid">
        {stats.map((stat) => (
          <Link key={stat.label} className="admin-stat" to={stat.to}>
            <div className="admin-stat-label">{stat.label}</div>
            <div className="admin-stat-value">{stat.value === undefined ? "…" : stat.value}</div>
          </Link>
        ))}
      </div>

      <div className="admin-card">
        <h2>Getting started</h2>
        <ul>
          <li>Edit projects, skills, certifications and the profile under the menu.</li>
          <li>Hide a project with <strong>status</strong>; keep it out of the sitemap with <strong>indexable</strong> — the two controls are independent.</li>
          <li>Use <strong>Rebuild site</strong> in the top bar to start the production build and refresh the AI assistant's knowledge after content changes.</li>
        </ul>
      </div>
    </div>
  );
}