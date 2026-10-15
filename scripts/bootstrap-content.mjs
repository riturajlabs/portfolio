#!/usr/bin/env node
/**
 * One-time production bootstrap — the *client* half of
 * `POST /api/admin/bootstrap` (`backend/app/routes/admin_bootstrap.py`).
 *
 * It exists because a free Render web service has no interactive shell and no
 * one-off jobs, so the first administrator and the initial CMS content have to
 * be created over the network. This script sends exactly one authenticated
 * request from your workstation; it never connects to the database directly and
 * it never prints the token or the administrator password.
 *
 * Usage (see `docs/DEPLOYMENT.md` §6):
 *
 *   ADMIN_EMAIL=you@example.com \
 *   ADMIN_PASSWORD='...12+ chars...' \
 *   ADMIN_BOOTSTRAP_TOKEN='<the same ≥32-char secret set on Render>' \
 *   CONTENT_API_URL=https://portfolio-api.onrender.com/api/content \
 *   npm run admin:bootstrap
 *
 * Environment:
 *   ADMIN_EMAIL            required  the first administrator's email
 *   ADMIN_PASSWORD         required  ≥12 characters; not logged, not stored
 *   ADMIN_BOOTSTRAP_TOKEN  required  ≥32 characters; must equal the backend's
 *   CONTENT_API_URL        endpoint  full `.../api/content` URL or bare origin;
 *                                    also read by the build and `ai_service`
 *   BOOTSTRAP_URL          optional  overrides CONTENT_API_URL entirely
 *   BOOTSTRAP_SNAPSHOT     optional  snapshot path (default
 *                                    `.cache/content-snapshot.json`)
 *
 * Exit codes:
 *   0  bootstrapped
 *   1  the server rejected the request (see the mapped message)
 *   2  local usage/environment problem (missing var, short password, no snapshot)
 *   3  the backend could not be reached
 *
 * Disable it afterwards: unset `ADMIN_BOOTSTRAP_TOKEN` on the backend, which
 * makes the endpoint answer 404. A completed bootstrap already answers 409.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIN_TOKEN_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 12;
const REQUEST_TIMEOUT_MS = 90_000; // generous: free-tier cold start can take ~1 min

const usage = (message) => {
  console.error(`[bootstrap] ${message}`);
  console.error(
    "[bootstrap] required env: ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_BOOTSTRAP_TOKEN, CONTENT_API_URL"
  );
  process.exit(2);
};

const endpoint = () => {
  const explicit = process.env.BOOTSTRAP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const base = (process.env.CONTENT_API_URL ?? "").trim();
  if (!base) {
    usage("set CONTENT_API_URL (or BOOTSTRAP_URL) to your backend, e.g. https://portfolio-api.onrender.com");
  }
  const origin = base.replace(/\/+$/, "").replace(/\/api\/content$/, "");
  return `${origin}/api/admin/bootstrap`;
};

const readSnapshot = async () => {
  const snapshotPath = process.env.BOOTSTRAP_SNAPSHOT?.trim()
    ? path.resolve(process.env.BOOTSTRAP_SNAPSHOT.trim())
    : path.join(REPO_ROOT, ".cache", "content-snapshot.json");
  let raw;
  try {
    raw = await readFile(snapshotPath, "utf8");
  } catch (error) {
    usage(
      `cannot read snapshot ${snapshotPath}: ${error.message} — run \`npm run seed:extract\` first`
    );
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    usage(`snapshot ${snapshotPath} is not valid JSON: ${error.message}`);
  }
};

// Maps a non-2xx response to a plain-language remediation. Never includes the
// request body or any header value.
const explain = (status) => {
  switch (status) {
    case 401:
      return "the bootstrap token did not match ADMIN_BOOTSTRAP_TOKEN on the backend";
    case 403:
      return "the backend requires HTTPS; call the https:// URL (not http://)";
    case 404:
      return "bootstrap is disabled (ADMIN_BOOTSTRAP_TOKEN is unset on the backend)";
    case 409:
      return "an administrator already exists — bootstrap has already run (nothing to do)";
    case 413:
      return "the snapshot exceeds the 1 MB payload limit";
    case 422:
      return "the snapshot failed validation or the admin email/password was rejected";
    case 429:
      return "too many attempts — wait ~15 minutes and try again";
    case 503:
      return "the database is unreachable or migrations have not run yet (deploy first)";
    default:
      return `unexpected status ${status}`;
  }
};

const main = async () => {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD ?? "";
  const token = process.env.ADMIN_BOOTSTRAP_TOKEN ?? "";

  if (!email) usage("ADMIN_EMAIL is required");
  if (!password) usage("ADMIN_PASSWORD is required");
  if (password.length < MIN_PASSWORD_LENGTH) {
    usage(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (!token) usage("ADMIN_BOOTSTRAP_TOKEN is required");
  if (token.length < MIN_TOKEN_LENGTH) {
    usage(`ADMIN_BOOTSTRAP_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
  }

  const url = endpoint();
  const content = await readSnapshot();

  console.log(`[bootstrap] POST ${url}`);
  console.log("[bootstrap] sending administrator email + content snapshot (no secrets printed)");

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        admin: { email, password },
        content,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    console.error(
      `[bootstrap] cannot reach ${url} (${error.cause?.code ?? error.message}) — ` +
        "is the backend deployed and awake?"
    );
    process.exit(3);
  }

  if (response.status === 409) {
    console.log("[bootstrap] already bootstrapped (409) — nothing to do.");
    process.exit(0);
  }

  if (!response.ok) {
    console.error(`[bootstrap] ${response.status}: ${explain(response.status)}`);
    process.exit(1);
  }

  let body;
  try {
    body = await response.json();
  } catch {
    console.error("[bootstrap] 200 but the response was not JSON — unexpected");
    process.exit(1);
  }

  console.log(
    `[bootstrap] OK — administrator ${body.admin_email} created; ` +
      `seeded ${body.summary?.projects ?? "?"} projects, ` +
      `${body.summary?.skills ?? "?"} skills, ` +
      `${body.summary?.categories ?? "?"} categories, ` +
      `${body.summary?.certifications ?? "?"} certifications.`
  );
  console.log(
    "[bootstrap] Now disable bootstrap: remove ADMIN_BOOTSTRAP_TOKEN from the Render service and redeploy."
  );
  process.exit(0);
};

await main();
