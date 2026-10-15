// Shared e2e environment values. `e2e/start-backend.mjs` seeds the admin from
// the same defaults, so the specs and the launcher can never disagree unless
// someone deliberately overrides both via environment variables.

export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "admin@e2e.local";
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "e2e-admin-password!";
export const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT || 8901);
export const S3_PORT = Number(process.env.E2E_S3_PORT || 8903);

export function watchPageErrors(page) {
  const collected = [];
  page.on("pageerror", (err) => collected.push(`pageerror: ${String(err)}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") collected.push(`console.error: ${msg.text()}`);
  });
  return collected;
}