// Client-side mirrors of the backend validators in
// `backend/app/schemas/admin_content.py`. The UI must mirror them for immediate
// feedback — never as the only gate (docs/SECURITY.md §6). Inline these in the
// admin forms so a save is never attempted with a rule the server would reject.

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 80;
export const IMAGE_RE = /^\/images\/projects\/[a-z0-9-]+\.webp$/;
// An image stored in object storage: the absolute public URL
// `POST /api/admin/uploads` returns. Mirrors `IMAGE_URL_PATTERN` in
// `backend/app/schemas/admin_content.py` — http(s) only, no whitespace, quote or
// angle bracket, because the value becomes an `<img src>`.
export const IMAGE_URL_RE = /^https?:\/\/[^\s"'<>]+$/;
export const HTTP_URL_RE = /^https?:\/\/.+/;

export function isRemoteImage(value) {
  return typeof value === "string" && IMAGE_URL_RE.test(value);
}

export function validateSlug(value) {
  if (!value) return "Slug is required.";
  if (value.length > SLUG_MAX_LENGTH) return `Slug must be ${SLUG_MAX_LENGTH} characters or fewer.`;
  if (!SLUG_RE.test(value)) {
    return "Only lowercase letters, digits and single hyphens between words are allowed.";
  }
  return null;
}

export function validateImagePath(value) {
  if (!value) return "Image is required.";
  if (IMAGE_RE.test(value) || IMAGE_URL_RE.test(value)) return null;
  return "Upload an image, or use a path like /images/projects/your-project.webp";
}

export function validateImageDimensions(number) {
  const value = Number(number);
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    return "Must be a positive whole number.";
  }
  return null;
}

export function validateUrl(value) {
  if (!value) return null;
  if (!HTTP_URL_RE.test(value)) return "Must be a full http(s) URL.";
  return null;
}

/**
 * Human-readable "slugify" for an unstyled preview only. The saved value is
 * always the typed one — the server owns canonicalisation.
 */
export function slugPreview(slug) {
  const cleaned = (slug || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH);
  return cleaned;
}

export function formatDateTime(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function todayDateInputValue() {
  return new Date().toISOString().slice(0, 10);
}