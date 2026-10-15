// e2e backend launcher — provisions a disposable `portfolio_e2e` database
// (drop schema → alembic upgrade → optional seed → admin account) and then runs
// uvicorn on :8901. Playwright's `webServer` machinery probes :8901/health to
// decide readiness, so this script just has to get the process up.

import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND_DIR = path.join(ROOT, "backend");
const PORT = Number(process.env.E2E_BACKEND_PORT || 8901);
const RESEND_PORT = Number(process.env.E2E_RESEND_PORT || 8902);
const S3_PORT = Number(process.env.E2E_S3_PORT || 8903);

const DB_NAME = process.env.E2E_DATABASE_NAME || "portfolio_e2e";
const DB_HOST =
  process.env.E2E_DATABASE_HOST ||
  (process.env.CI ? "127.0.0.1" : "/var/run/postgresql");
const DB_PORT = process.env.E2E_DATABASE_PORT || "5432";
// The postgres role to connect as. Local dev relies on the login-user match
// (`$(whoami)`), but CI has no such role — the postgres:16 service container
// only creates `postgres`, so CI must set E2E_DATABASE_USER=postgres.
const DB_USER = process.env.E2E_DATABASE_USER || process.env.USER || "riturajlabs";
// Optional password. Peer-auth (unix socket) and CI's trust-auth service need
// none, but a TCP database that requires one (e.g. the detached postgres:17
// container on this machine, reached through the Docker gateway) needs it in
// both the `psql` connection string and the asyncpg URL. Unset stays empty so
// the common case is byte-for-byte unchanged.
const DB_PASSWORD = process.env.E2E_DATABASE_PASSWORD || "";
const DB_AUTH = DB_PASSWORD ? `:${encodeURIComponent(DB_PASSWORD)}` : "";
const PYTHON =
  process.env.E2E_PYTHON ||
  (process.env.CI
    ? "python3"
    : path.join(BACKEND_DIR, ".venv", "bin", "python"));
// A filesystem path means a unix-socket peer-auth connection; anything else is
// host/port TCP (e.g. the detached postgres:17 container used on this machine).
const isSocket = DB_HOST.startsWith("/");
const DB_PORT_SQL = isSocket ? "" : `&port=${DB_PORT}`;
const conn = (db) => `postgresql://${DB_USER}${DB_AUTH}@/${db}?host=${DB_HOST}${DB_PORT_SQL}`;
const DATABASE_URL = `postgresql+asyncpg://${DB_USER}${DB_AUTH}@/${DB_NAME}?host=${DB_HOST}${DB_PORT_SQL}`;

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "admin@e2e.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "e2e-admin-password!";

const PSQL_ADMIN = conn("postgres");
const PSQL_E2E = conn(DB_NAME);

// Hard safety guard. The steps below are destructive (CREATE DATABASE,
// DROP SCHEMA ... CASCADE, then bootstrap_admin.py resets an admin account),
// so before any psql statement runs the target must be *verifiably* a
// disposable E2E/test database:
//
//   * the database name must explicitly look disposable (*_e2e / *_test), so a
//     development or production name such as `portfolio` or `portfolio_dev` is
//     refused outright; and
//   * the connection must be local (loopback host or unix socket), so a remote
//     or production server can never be reached by accident.
//
// Anything that cannot be verified fails loudly here — never by continuing on
// a best guess.
function assertDisposableE2eTarget({ name, host }) {
  const problems = [];

  if (!/^[A-Za-z0-9_]+(?:_e2e|_test)$/i.test(name)) {
    problems.push(
      `database name ${JSON.stringify(name)} is not disposable: expected a *_e2e or *_test suffix ` +
        `(e.g. "portfolio_e2e"), not a dev/production name`,
    );
  }

  const isLocalHost =
    host === "127.0.0.1" || host === "::1" || host === "localhost" || host.startsWith("/");
  if (!isLocalHost) {
    problems.push(
      `database host ${JSON.stringify(host)} is not a loopback address or unix socket`,
    );
  }

  if (problems.length > 0) {
    throw new Error(
      "[start-backend] REFUSED to run: the configured database target cannot be " +
        "verified as a disposable E2E/test database.\n" +
        problems.map((problem) => `  - ${problem}`).join("\n") +
        "\n  Set E2E_DATABASE_NAME/E2E_DATABASE_HOST to a local disposable database " +
        "(e.g. portfolio_e2e on 127.0.0.1) before running the e2e suite.",
    );
  }
}

assertDisposableE2eTarget({ name: DB_NAME, host: DB_HOST });

function run(label, cmd, args, env = {}) {
  console.log(`[start-backend] ${label}`);
  const result = spawnSync(cmd, args, {
    cwd: BACKEND_DIR,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`${label} failed with exit ${result.status}`);
  }
  return result;
}

const serverEnv = {
  ...process.env,
  DATABASE_URL,
  ENVIRONMENT: "development",
  RESEND_API_KEY: "e2e-dummy-key",
  RESEND_API_URL: `http://127.0.0.1:${RESEND_PORT}/resend`,
  CONTACT_FROM_EMAIL: "e2e@example.com",
  CONTACT_TO_EMAIL: "e2e-inbox@example.com",
  CONTACT_RATE_LIMIT: "100",
  CONTACT_RATE_WINDOW_SECONDS: "60",
  // Point object storage at the `e2e/mock-s3.mjs` stand-in so resume uploads
  // complete end-to-end. Fake credentials still sign the requests, which is what
  // lets the mock prove that unsigned (anonymous) object access is refused.
  AWS_ENDPOINT_URL_S3: `http://127.0.0.1:${S3_PORT}`,
  AWS_ACCESS_KEY_ID: "e2e-access-key",
  AWS_SECRET_ACCESS_KEY: "e2e-secret-key",
  AWS_REGION: "us-east-1",
  S3_BUCKET: "media",
  S3_RESUME_BUCKET: "uploads",
  ADMIN_LOGIN_IP_LIMIT: "100",
  ADMIN_LOGIN_IP_WINDOW_SECONDS: "900",
  ADMIN_LOGIN_EMAIL_FAILURE_LIMIT: "100",
  ADMIN_LOGIN_EMAIL_WINDOW_SECONDS: "900",
  LOG_LEVEL: "INFO",
};

// 1. Create the database if missing (peer auth, owner).
const probe = spawnSync(
  "psql",
  [PSQL_ADMIN, "-tAc", `SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'`],
  { encoding: "utf8" }
);
if ((probe.stdout || "").trim() !== "1") {
  run(
    "ensure database exists",
    "psql",
    [PSQL_ADMIN, "-c", `CREATE DATABASE ${DB_NAME}`],
    {},
  );
}
// 2. Throw away whatever the previous run left behind.
// Destructive: its failure is never swallowed — a failed reset must fail the
// run loudly rather than silently leaving a stale schema behind.
run(
  "reset schema",
  "psql",
  [PSQL_E2E, "-c", "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"],
  {},
);

// 3. Migrate to head.
run("alembic upgrade head", PYTHON, ["-m", "alembic", "upgrade", "head"], { DATABASE_URL });

// 4. Seed from the content snapshot when one exists. CI regenerates it in the
// "Extract deterministic seed snapshot" step, so the e2e database is seeded
// there too; a missing snapshot simply skips this step.
const snapshot = path.join(ROOT, ".cache", "content-snapshot.json");
if (existsSync(snapshot)) {
  run("seed content snapshot", PYTHON, ["-m", "db.seed", snapshot], { DATABASE_URL });
} else {
  console.log("[start-backend] no content snapshot found; skipping seed");
}

// 5. Ensure the admin account the specs log in with.
run(
  "bootstrap admin",
  PYTHON,
  [path.join(ROOT, "e2e", "bootstrap_admin.py")],
  { DATABASE_URL, E2E_ADMIN_EMAIL: ADMIN_EMAIL, E2E_ADMIN_PASSWORD: ADMIN_PASSWORD, PYTHONPATH: BACKEND_DIR },
);

// 6. Long-running uvicorn; keep this process alive for Playwright.
const child = spawn(
  PYTHON,
  ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(PORT)],
  { cwd: BACKEND_DIR, env: serverEnv, stdio: "inherit" },
);

function shutdown() {
  child.kill("SIGKILL");
}
process.on("exit", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

child.on("exit", (code) => process.exit(code ?? 0));