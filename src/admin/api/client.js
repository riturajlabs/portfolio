// Admin API client — `docs/SECURITY.md` §4 + `docs/API.md` §6.
//
// Rules this module exists to enforce:
// * the session token is an HttpOnly cookie (`portfolio_admin_session`); it is
//   never read by JS, never stored in localStorage/sessionStorage, never sent
//   in an Authorization header. Requests use `credentials: "same-origin"` —
//   which works because production routes `/api/admin/*` through a Vercel
//   rewrite and dev proxies it in `vite.config.js`, so the origin is always
//   the site's own.
// * every unsafe method carries `X-CSRF-Token`, obtained exclusively from
//   `GET /api/admin/me` (the one disclosure point, `API.md` §6.1) — with one
//   deliberate exception: `POST /api/admin/auth/login`, which by definition
//   runs before any session (and therefore before `/me`) exists. The server
//   already exempts login from CSRF (`API.md` §6.3), so the client sends the
//   login POST without a token.
//   * 403 FORBIDDEN on a mutation means the CSRF token went stale — re-read
//     `/me` (same session) and retry once.
//   * 401 UNAUTHENTICATED anywhere means the session is gone; the server also
//     cleared the cookie. We emit a `session-expired` event so the auth gate
//     redirects to `/admin/login` exactly once.
//   * 429 RATE_LIMITED surfaces the `Retry-After` value.

export const ADMIN_API_BASE = "/api/admin";
export const CSRF_HEADER = "X-CSRF-Token";

export class ApiError extends Error {
  constructor(status, { code = null, message = null, fields = [], request_id = null, retryAfter = null } = {}) {
    super(message || `Request failed with status ${status}.`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = Array.isArray(fields) ? fields : [];
    this.request_id = request_id;
    this.retryAfter = retryAfter === null ? null : Number(retryAfter);
  }
}

let csrfToken = null;

const sessionEvents = new EventTarget();

export function onSessionExpired(handler) {
  sessionEvents.addEventListener("session-expired", handler);
  return () => sessionEvents.removeEventListener("session-expired", handler);
}

function emitSessionExpired() {
  sessionEvents.dispatchEvent(new Event("session-expired"));
}

async function parseResponse(response) {
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = (payload && payload.error) || {};
    const err = new ApiError(response.status, {
      code: error.code,
      message: error.message,
      fields: error.fields,
      request_id: error.request_id,
      retryAfter: response.headers.get("Retry-After"),
    });
    if (response.status === 401) {
      emitSessionExpired();
    }
    throw err;
  }

  return payload;
}

async function request(
  path,
  { method = "GET", body, formData, ifUnmodifiedSince, _csrfRetried = false } = {},
) {
  const unsafe = !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
  const headers = new Headers();
  if (unsafe && path !== "/auth/login") {
    headers.set(CSRF_HEADER, await ensureCsrfToken());
  }
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (ifUnmodifiedSince !== undefined) {
    headers.set("If-Unmodified-Since", ifUnmodifiedSince);
  }

  let response;
  try {
    response = await fetch(`${ADMIN_API_BASE}${path}`, {
      method,
      headers,
      credentials: "same-origin",
      // A `FormData` body must not carry an explicit Content-Type: the browser
      // sets `multipart/form-data; boundary=…` itself, and overriding it would
      // drop the boundary and make the body unparseable server-side.
      body:
        formData !== undefined
          ? formData
          : body === undefined
            ? undefined
            : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, {
      code: "NETWORK",
      message: "Could not reach the admin API. Check your connection and retry.",
    });
  }

  // Stale/missing CSRF header → the value derived from the session slipped;
  // refresh it from `/me` (the session itself is fine) and retry the call once.
  // If the refresh itself hits 401 the session really died; either way the
  // original caller sees an error mapped from the true state.
  if (response.status === 403 && !_csrfRetried && unsafe) {
    csrfToken = null;
    await getMe();
    return request(path, { method, body, formData, ifUnmodifiedSince, _csrfRetried: true });
  }

  return parseResponse(response);
}

export async function getMe() {
  const payload = await request("/me", { method: "GET" });
  csrfToken = payload && payload.csrf_token ? payload.csrf_token : csrfToken;
  return payload;
}

function ensureCsrfToken() {
  if (csrfToken) return Promise.resolve(csrfToken);
  return getMe().then((payload) => {
    csrfToken = payload.csrf_token;
    return csrfToken;
  });
}

export function login(email, password) {
  return request("/auth/login", { method: "POST", body: { email, password } });
}

export function logout() {
  return request("/auth/logout", { method: "POST" });
}

export function get(path) {
  return request(path, { method: "GET" });
}

export function post(path, body) {
  return request(path, { method: "POST", body });
}

export function put(path, body, options = {}) {
  return request(path, { method: "PUT", body, ...options });
}

export function patch(path, body) {
  return request(path, { method: "PATCH", body });
}

export function del(path) {
  return request(path, { method: "DELETE" });
}

/**
 * Upload one project cover image to object storage (`POST /api/admin/uploads`).
 *
 * The server measures the image and returns `{ image, image_width, image_height,
 * key, audit_id }` — the editor writes those three fields into the form and then
 * saves as usual. Upload is deliberately its own call, not part of the save: the
 * object is stored before the project row exists (the create form has no id yet).
 */
export function uploadImage(file) {
  const formData = new FormData();
  formData.append("file", file, file.name || "upload");
  return request("/uploads", { method: "POST", formData });
}

/**
 * Upload the resume PDF to private object storage (`POST /api/admin/profile/resume`).
 *
 * Unlike a project image, this *is* the profile save for the resume: the server
 * stores the object, points `site_profile.resume` at the stable public route
 * `/api/resume` and records the object key, in one audited transaction. The
 * response `{ resume, key, audit_id }` is written straight into the form.
 */
export function uploadResume(file) {
  const formData = new FormData();
  formData.append("file", file, file.name || "resume.pdf");
  return request("/profile/resume", { method: "POST", formData });
}

/**
 * Map a thrown `ApiError` to `{ [fieldName]: message }` for inline field errors.
 * Field names arrive as the request-side keys ("slug", "image_width", ...) —
 * `API.md` §7.2, `error.fields[]`.
 */
export function fieldErrorMap(error) {
  const map = {};
  for (const entry of error && Array.isArray(error.fields) ? error.fields : []) {
    if (entry && entry.field) map[entry.field] = entry.message;
  }
  return map;
}