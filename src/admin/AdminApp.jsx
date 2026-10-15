// Route table for the admin surface. Everything hangs off `/admin` (the
// BrowserRouter basename). An anonymous caller is bounced to /admin/login; a
// logged-in caller who lands on /admin/login is bounced to the dashboard.

import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";

import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import { ToastProvider } from "./components/Toast.jsx";

import AdminLayout from "./layout/AdminLayout.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Projects from "./pages/Projects.jsx";
import ProjectEditor from "./pages/ProjectEditor.jsx";
import Skills from "./pages/Skills.jsx";
import Certifications from "./pages/Certifications.jsx";
import Profile from "./pages/Profile.jsx";
import Messages from "./pages/Messages.jsx";

function RequireAuth() {
  const { user } = useAuth();
  const location = useLocation();

  if (user === undefined) {
    return <div className="admin-loading">Checking session&hellip;</div>;
  }
  if (user === null) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

// 401s from the API fire a session-expired event; the auth context flips to
// logged-out and this effect nudges the router to the login screen.
function SessionExpiredRedirect() {
  const { user } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (user === null) {
      navigate("/login", { replace: true });
    }
  }, [user, navigate]);
  return null;
}

export default function AdminApp() {
  return (
    <AuthProvider>
      <ToastProvider>
        <SessionExpiredRedirect />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth />}>
            <Route element={<AdminLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="projects" element={<Projects />} />
              <Route path="projects/new" element={<ProjectEditor />} />
              <Route path="projects/:id" element={<ProjectEditor />} />
              <Route path="skills" element={<Skills />} />
              <Route path="certifications" element={<Certifications />} />
              <Route path="profile" element={<Profile />} />
              <Route path="messages" element={<Messages />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}