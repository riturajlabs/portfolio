#!/usr/bin/env node
// Resolve the Python interpreter for a service directory and run it.
//
// Local development creates a per-service virtualenv (backend/.venv,
// ai_service/.venv) and the historical package.json scripts called
// `.venv/bin/python` directly. CI never creates a virtualenv: it installs the
// dependencies into the interpreter provisioned by actions/setup-python and
// exposes it on PATH as `python`. Hardcoding `.venv/bin/python` therefore broke
// every Python npm script in CI (`sh: 1: .venv/bin/python: not found`).
//
// Resolution order:
//   1. $PYTHON, if set (explicit override).
//   2. the service-local virtualenv, if present (local development).
//   3. `python` from PATH (CI's configured interpreter).
//
// Usage: node scripts/run-python.mjs <service-dir> <python-args...>
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const [service, ...args] = process.argv.slice(2);
if (!service || args.length === 0) {
  console.error("usage: node scripts/run-python.mjs <service-dir> <python-args...>");
  process.exit(2);
}

const serviceDir = path.resolve(repoRoot, service);
const venvCandidates = [
  path.join(serviceDir, ".venv", "bin", "python"),
  path.join(serviceDir, ".venv", "Scripts", "python.exe"),
];

let candidates;
if (process.env.PYTHON) {
  candidates = [process.env.PYTHON];
} else {
  const venv = venvCandidates.find((candidate) => existsSync(candidate));
  // `python` is what actions/setup-python exposes; `python3` covers images
  // (and developers) whose only interpreter is named `python3`.
  candidates = venv ? [venv] : ["python", "python3"];
}

let lastError;
for (const candidate of candidates) {
  const result = spawnSync(candidate, args, { cwd: serviceDir, stdio: "inherit" });
  if (result.error?.code === "ENOENT") {
    lastError = result.error;
    continue;
  }
  if (result.error) {
    console.error(`failed to run ${candidate}: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

console.error(
  `failed to run any Python interpreter (tried: ${candidates.join(", ")}): ${lastError?.message ?? "not found"}`,
);
process.exit(1);
