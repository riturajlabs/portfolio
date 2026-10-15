import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND = path.join(ROOT, "backend");
const AI = path.join(ROOT, "ai_service");
const CACHE = path.join(ROOT, ".cache");
const LOGS = path.join(CACHE, "local");
const DEV_STATE = path.join(CACHE, "local-services.json");
const PROD_STATE = path.join(CACHE, "local-production-services.json");

const DEV = {
  frontend: { port: 5173, url: "http://127.0.0.1:5173/", label: "Frontend" },
  backend: { port: 8001, url: "http://127.0.0.1:8001", label: "Backend" },
  ai: { port: 8000, url: "http://127.0.0.1:8000", label: "AI service" },
};
const PROD = {
  frontend: { port: 4173, url: "http://127.0.0.1:4173/", label: "Frontend preview" },
  backend: { port: 8101, url: "http://127.0.0.1:8101", label: "Production-like backend" },
  ai: { port: 8100, url: "http://127.0.0.1:8100", label: "Production-like AI" },
};

const log = (message) => console.log(`[local] ${message}`);
const fail = (message) => {
  console.error(`[local] ERROR: ${message}`);
  process.exitCode = 1;
};

function readEnv(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.replace(/^(['"])(.*)\1$/, "$2")]),
  );
}

function statePath(production = false) {
  return production ? PROD_STATE : DEV_STATE;
}

function readState(production = false) {
  const file = statePath(production);
  if (!existsSync(file)) return { services: {} };
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { services: {} };
  }
}

function writeState(production, state) {
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(statePath(production), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function commandExists(command) {
  return spawnSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" }).status === 0;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
    stdio: options.quiet ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0) {
    const detail = options.quiet ? `${result.stdout || ""}${result.stderr || ""}`.trim() : "";
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return result;
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function get(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: null };
  }
}

async function waitFor(url, timeout = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const result = await get(url);
    if (result.ok) return result;
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${url}`);
}

function databaseConfig(production = false) {
  const env = readEnv(path.join(BACKEND, ".env"));
  const value = process.env.DATABASE_URL || env.DATABASE_URL || "";
  if (!value) throw new Error("DATABASE_URL is missing from backend/.env");
  const match = value.match(/^postgres(?:ql)?(?:\+\w+)?:\/\/([^@]+)@(?:[^/]*)\/([^?]+)(?:\?(.*))?$/);
  if (!match) throw new Error("DATABASE_URL must be a local PostgreSQL URL for local orchestration");
  const user = match[1].split(":")[0];
  const query = new URLSearchParams(match[3] || "");
  const host = query.get("host") || "127.0.0.1";
  const database = production ? process.env.LOCAL_PROD_DATABASE || "portfolio_local_prod" : match[2];
  return { user, host, database, query };
}

function psqlArgs(config, database = config.database) {
  const args = [];
  if (config.user) args.push("-U", config.user);
  if (config.host.startsWith("/")) args.push("-h", config.host);
  else args.push("-h", config.host, "-p", config.query.get("port") || "5432");
  args.push("-d", database);
  return args;
}

function ensureDatabase(production) {
  const config = databaseConfig(production);
  if (!commandExists("psql")) throw new Error("psql is required but was not found on PATH");
  const probe = spawnSync("psql", [...psqlArgs(config), "-Atqc", "SELECT 1"], {
    stdio: "ignore",
  });
  if (probe.status === 0) return config;
  if (!production) {
    throw new Error(`cannot connect to local database "${config.database}"; start PostgreSQL or fix backend/.env`);
  }
  const created = spawnSync("createdb", [...psqlArgs(config, "postgres").filter((arg) => arg !== "-d" && arg !== "postgres"), config.database], {
    stdio: "ignore",
  });
  if (created.status !== 0) {
    const retry = spawnSync("psql", [...psqlArgs(config), "-Atqc", "SELECT 1"], { stdio: "ignore" });
    if (retry.status !== 0) {
      throw new Error(`cannot create or connect to production-like database "${config.database}"`);
    }
  }
  return config;
}

function serviceEnvironment(kind, production) {
  if (!production) return {};
  const config = databaseConfig(true);
  return {
    DATABASE_URL: `postgresql+asyncpg://${config.user}@/${config.database}?host=${config.host}`,
    ENVIRONMENT: "staging",
    ALLOWED_ORIGINS: "http://127.0.0.1:4173,http://localhost:4173",
    PORT: kind === "backend" ? String(PROD.backend.port) : String(PROD.ai.port),
    CONTENT_API_URL: `http://127.0.0.1:${PROD.backend.port}/api/content`,
    VITE_BACKEND_URL: `http://127.0.0.1:${PROD.ai.port}`,
  };
}

function spawnService(name, command, args, options, production) {
  mkdirSync(LOGS, { recursive: true });
  const logPath = path.join(LOGS, `${production ? "prod-" : ""}${name}.log`);
  const output = requireFsAppend(logPath);
  const child = spawn(command, args, {
    cwd: options.cwd || ROOT,
    env: { ...process.env, ...(options.env || {}) },
    detached: true,
    stdio: ["ignore", output, output],
  });
  child.unref();
  return { pid: child.pid, command: `${command} ${args.join(" ")}`, log: logPath };
}

function requireFsAppend(file) {
  return openSync(file, "a");
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function startService(name, spec, command, args, options, production) {
  const health = name === "backend" || name === "ai" ? `${spec.url}/health` : spec.url;
  if (await portOpen(spec.port)) {
    const result = await get(health);
    if (result.ok) {
      log(`${spec.label} already healthy on :${spec.port}; reusing it`);
      return null;
    }
    throw new Error(`port ${spec.port} is occupied but ${spec.label} is not healthy`);
  }
  const entry = spawnService(name, command, args, options, production);
  const state = readState(production);
  state.services[name] = { ...entry, port: spec.port };
  writeState(production, state);
  await waitFor(health);
  log(`${spec.label} ready on :${spec.port}`);
  return entry;
}

async function setup(production = false) {
  for (const tool of ["node", "psql"]) {
    if (!commandExists(tool)) throw new Error(`${tool} is required but was not found on PATH`);
  }
  const python = production ? path.join(BACKEND, ".venv", "bin", "python") : path.join(BACKEND, ".venv", "bin", "python");
  for (const file of [python, path.join(AI, ".venv", "bin", "python")]) {
    if (!existsSync(file)) throw new Error(`missing Python environment: ${file}`);
  }
  for (const file of [path.join(ROOT, ".env"), path.join(BACKEND, ".env"), path.join(AI, ".env")]) {
    if (!existsSync(file)) throw new Error(`missing environment file: ${file}`);
  }
  const db = ensureDatabase(production);
  log(`PostgreSQL connection verified for database "${db.database}"`);
  const env = production
    ? serviceEnvironment("backend", true)
    : { DATABASE_URL: process.env.DATABASE_URL || readEnv(path.join(BACKEND, ".env")).DATABASE_URL };
  run(python, ["-m", "alembic", "upgrade", "head"], { cwd: BACKEND, env });
  run(python, ["-m", "db.seed"], { cwd: BACKEND, env });
}

async function up(production = false) {
  const specs = production ? PROD : DEV;
  await setup(production);
  const backendEnv = serviceEnvironment("backend", production);
  const aiEnv = serviceEnvironment("ai", production);
  if (production) aiEnv.ENV = "staging";
  const backendPython = path.join(BACKEND, ".venv", "bin", "python");
  const aiPython = path.join(AI, ".venv", "bin", "python");
  await startService(
    "backend",
    specs.backend,
    backendPython,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(specs.backend.port)],
    { cwd: BACKEND, env: backendEnv },
    production,
  );
  await startService(
    "ai",
    specs.ai,
    aiPython,
    ["-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", String(specs.ai.port)],
    { cwd: AI, env: aiEnv },
    production,
  );
  const frontendEnv = production ? { ...serviceEnvironment("frontend", true), CONTENT_API_URL: `http://127.0.0.1:${specs.backend.port}/api/content` } : {};
  await startService(
    "frontend",
    specs.frontend,
    production ? "npm" : "npm",
    production
      ? ["run", "preview", "--", "--host", "127.0.0.1", "--port", String(specs.frontend.port)]
      : ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(specs.frontend.port)],
    { cwd: ROOT, env: frontendEnv },
    production,
  );
  log(`${production ? "Production-like" : "Development"} environment is ready`);
}

async function status(production = false) {
  const specs = production ? PROD : DEV;
  const db = (() => {
    try {
      const config = databaseConfig(production);
      return spawnSync("psql", [...psqlArgs(config), "-Atqc", "SELECT 1"], { stdio: "ignore" }).status === 0;
    } catch {
      return false;
    }
  })();
  const rows = [
    ["Database", db ? "healthy" : "unhealthy", "PostgreSQL connection"],
    ["Backend", (await get(`${specs.backend.url}/health`)).ok ? "healthy" : "unhealthy", specs.backend.url],
    ["AI service", (await get(`${specs.ai.url}/health`)).ok ? "healthy" : "unhealthy", specs.ai.url],
    ["Frontend", (await get(specs.frontend.url)).ok ? "healthy" : "unhealthy", specs.frontend.url],
    ["Admin", (await get(`${specs.frontend.url.replace(/\/$/, "")}/admin`)).status === 200 ? "reachable" : "unhealthy", "/admin"],
  ];
  console.log("\nService       Status      Details");
  console.log("-----------------------------------------------");
  for (const [name, state, details] of rows) console.log(`${name.padEnd(13)}${state.padEnd(12)}${details}`);
  return rows.every(([, state]) => ["healthy", "reachable"].includes(state));
}

async function check(production = false) {
  const specs = production ? PROD : DEV;
  await setup(production);
  const healthy = await status(production);
  const content = await get(`${specs.backend.url}/api/content`);
  const ready = await get(`${specs.ai.url}/ready`);
  if (!content.ok) throw new Error(`content API check failed with HTTP ${content.status || "connection error"}`);
  if (!ready.ok) throw new Error(`AI readiness check failed with HTTP ${ready.status || "connection error"}`);
  if (!healthy) throw new Error("one or more local services are unhealthy");
  log("all local checks passed");
}

function stop(production = false) {
  const state = readState(production);
  for (const [name, entry] of Object.entries(state.services)) {
    if (!processAlive(entry.pid)) continue;
    try {
      process.kill(-entry.pid, "SIGTERM");
      log(`stopped ${name} process group ${entry.pid}`);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }

    function logs(production = false) {
      const state = readState(production);
      for (const [name, entry] of Object.entries(state.services)) {
        console.log(`\n[${name}] ${entry.log}`);
        if (!existsSync(entry.log)) continue;
        const lines = readFileSync(entry.log, "utf8").trimEnd().split(/\r?\n/);
        console.log(lines.slice(-40).join("\n"));
      }
    }
  }
  writeState(production, { services: {} });
}

async function prodBuild() {
  await setup(true);
  const specs = PROD;
  const backendPython = path.join(BACKEND, ".venv", "bin", "python");
  const env = serviceEnvironment("backend", true);
  await startService("backend", specs.backend, backendPython, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(specs.backend.port)], { cwd: BACKEND, env }, true);
  run("npm", ["run", "seed:load"], { env: { ...env, DATABASE_URL: env.DATABASE_URL } });
  run("npm", ["run", "build"], { env: { CONTENT_API_URL: `${specs.backend.url}/api/content`, VITE_BACKEND_URL: specs.ai.url } });
  log("production build completed; use npm run local:prod:up to serve it");
}

const command = process.argv[2] || "status";
const production = command.startsWith("prod:");
try {
  if (command === "setup") await setup();
  else if (command === "up" || command === "dev") await up();
  else if (command === "status") process.exitCode = (await status()) ? 0 : 1;
  else if (command === "check") await check();
  else if (command === "stop") stop();
  else if (command === "prod:setup") await setup(true);
  else if (command === "prod:build") await prodBuild();
  else if (command === "prod:up") await up(true);
  else if (command === "prod:status") process.exitCode = (await status(true)) ? 0 : 1;
  else if (command === "prod:check") await check(true);
  else if (command === "prod:stop") stop(true);
  else if (command === "prod:logs") logs(true);
  else throw new Error(`unknown command "${command}"`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
