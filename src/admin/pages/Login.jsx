// Login — the single gate to the admin surface. Password is never kept;
// the session arrives as an HttpOnly cookie set by the server.

import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { ApiError, login } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { Field, Form } from "../components/Form.jsx";

export default function Login() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    return <Navigate to="/" replace />;
  }

  async function onSubmit() {
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        const wait = err.retryAfter ? ` Try again in ${err.retryAfter}s.` : "";
        setError(`Too many attempts.${wait}`);
      } else {
        setError("Incorrect email or password.");
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="admin-login-shell">
      <div className="admin-card admin-login-card">
        <h1>Portfolio Admin</h1>
        <p>Sign in to manage content. The session is a server-side cookie.</p>

        <Form onSubmit={onSubmit}>
          {error ? (
            <div className="admin-login-error" role="alert">
              {error}
            </div>
          ) : null}

          <Field label="Email" required>
            {(id, linked) => (
              <input
                id={id}
                className="admin-input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-describedby={error ? linked.errorId : undefined}
              />
            )}
          </Field>

          <Field label="Password" required>
            {(id) => (
              <input
                id={id}
                className="admin-input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </Field>

          <button type="submit" className="admin-btn" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </Form>
      </div>
    </div>
  );
}