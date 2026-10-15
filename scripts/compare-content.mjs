#!/usr/bin/env node
/**
 * Phase 6 parity check — `.cache/content-snapshot.json` vs `GET /api/content`.
 *
 * Usage (backend must be running):
 *
 *     npm run seed:verify
 *     CONTENT_API_URL=... node scripts/compare-content.mjs [snapshot-path]
 *
 * `CONTENT_API_URL` is the same variable `src/lib/content.js` and `ai_service`
 * read: the whole endpoint, `/api/content` included. A bare origin
 * (`https://portfolio-api.onrender.com`) is also accepted and normalised, so the
 * value recorded in the deployment runbook works for the build and this check
 * alike.
 *
 * The comparison is bidirectional and field-by-field: keys present on only one
 * side, type mismatches and value differences are all reported. `meta` is
 * generated per request by the API (`API.md` §5.1.4) and `_migration` is
 * extractor bookkeeping, so both are excluded from comparison.
 *
 * Exit codes:
 *   0  every entity/field matches
 *   1  at least one difference (or the snapshot is invalid)
 *   2  the API could not be reached / did not return the contract payload
 *
 * `TESTING.md` §5.2: exit 0 against a freshly seeded database, exit 1 when a
 * seeded value is tampered with.
 */

const CONTENT_API_URL = process.env.CONTENT_API_URL ?? "http://127.0.0.1:8001";
// One endpoint definition for both accepted shapes: the full URL with
// `/api/content` (what `src/lib/content.js` and `ai_service` take) or a bare
// origin, which is normalised to the same endpoint.
const CONTENT_ENDPOINT = CONTENT_API_URL.replace(/\/+$/, "").endsWith("/api/content")
  ? CONTENT_API_URL.replace(/\/+$/, "")
  : `${CONTENT_API_URL.replace(/\/+$/, "")}/api/content`;
const SNAPSHOT_PATH = process.argv[2] ?? ".cache/content-snapshot.json";
const COMPARED_KEYS = ["profile", "about", "projects", "skills", "certifications", "seo"];
const SKIP_KEYS = new Set(["meta"]);

const fail = (message) => {
  console.error(`[compare] ${message}`);
  process.exit(1);
};

const unreachable = (message) => {
  console.error(`[compare] ${message}`);
  process.exit(2);
};

const truncate = (value) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) return "undefined";
  return text.length > 88 ? `${text.slice(0, 85)}...` : text;
};

const differences = [];

const record = (entity, field, snapshot, api) => {
  differences.push({ entity, field, snapshot, api });
};

const walk = (entity, field, snapshotValue, apiValue) => {
  if (Array.isArray(snapshotValue) || Array.isArray(apiValue)) {
    if (!Array.isArray(snapshotValue) || !Array.isArray(apiValue)) {
      record(entity, field, snapshotValue, apiValue);
      return;
    }
    if (snapshotValue.length !== apiValue.length) {
      record(entity, `${field}.length`, snapshotValue.length, apiValue.length);
      return;
    }
    snapshotValue.forEach((item, index) => {
      walk(entity, `${field}[${index}]`, item, apiValue[index]);
    });
    return;
  }

  const bothObjects =
    snapshotValue !== null &&
    apiValue !== null &&
    typeof snapshotValue === "object" &&
    typeof apiValue === "object";
  if (bothObjects) {
    const keys = [...new Set([...Object.keys(snapshotValue), ...Object.keys(apiValue)])].sort();
    for (const key of keys) {
      const child = field ? `${field}.${key}` : key;
      const inSnapshot = Object.hasOwn(snapshotValue, key);
      const inApi = Object.hasOwn(apiValue, key);
      if (!inSnapshot) {
        record(entity, child, "(absent)", apiValue[key]);
      } else if (!inApi) {
        record(entity, child, snapshotValue[key], "(absent)");
      } else {
        walk(entity, child, snapshotValue[key], apiValue[key]);
      }
    }
    return;
  }

  if (snapshotValue !== apiValue) {
    record(entity, field, snapshotValue, apiValue);
  }
};

const readSnapshot = async () => {
  const { readFile } = await import("node:fs/promises");
  let raw;
  try {
    raw = await readFile(SNAPSHOT_PATH, "utf8");
  } catch (error) {
    fail(`cannot read snapshot ${SNAPSHOT_PATH}: ${error.message} — run \`npm run seed:extract\``);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`snapshot is not valid JSON: ${error.message}`);
  }
};

const fetchApi = async () => {
  let response;
  try {
    response = await fetch(CONTENT_ENDPOINT, {
      headers: { accept: "application/json" },
    });
  } catch (error) {
    unreachable(
      `cannot reach the API at ${CONTENT_ENDPOINT} (${error.cause?.code ?? error.message}) — ` +
        "start the backend (`cd backend && uvicorn app.main:app --port 8001`)"
    );
  }
  if (!response.ok) {
    unreachable(`GET /api/content returned ${response.status} ${response.statusText}`);
  }
  try {
    return await response.json();
  } catch (error) {
    unreachable(`GET /api/content did not return JSON: ${error.message}`);
  }
};

const main = async () => {
  const snapshot = await readSnapshot();
  const api = await fetchApi();

  for (const key of COMPARED_KEYS) {
    if (!Object.hasOwn(snapshot, key)) fail(`snapshot is missing "${key}"`);
    if (!Object.hasOwn(api, key)) unreachable(`API payload is missing "${key}" — contract drift?`);
    walk(key, key, snapshot[key], api[key]);
  }

  const snapshotExtra = Object.keys(snapshot).filter(
    (key) => !COMPARED_KEYS.includes(key) && key !== "_migration"
  );
  const apiExtra = Object.keys(api).filter(
    (key) => !COMPARED_KEYS.includes(key) && !SKIP_KEYS.has(key)
  );
  for (const key of snapshotExtra) record("(top level)", key, snapshot[key], "(absent)");
  for (const key of apiExtra) record("(top level)", key, "(absent)", api[key]);

  if (differences.length === 0) {
    console.log(
      `[compare] OK — ${COMPARED_KEYS.length} entities match ` +
        `(${SNAPSHOT_PATH} == ${CONTENT_ENDPOINT})`
    );
    process.exit(0);
  }

  const width = Math.max(...differences.map((d) => d.field.length), "field".length);
  console.log(
    `[compare] ${differences.length} difference(s) between snapshot and API:\n\n` +
      `${"entity".padEnd(16)} | ${"field".padEnd(width)} | snapshot | api\n` +
      `${"-".repeat(16)}-+-${"-".repeat(width)}-+-${"-".repeat(9)}-+-${"-".repeat(9)}`
  );
  for (const difference of differences) {
    console.log(
      `${difference.entity.padEnd(16)} | ${difference.field.padEnd(width)} | ` +
        `${truncate(difference.snapshot)} | ${truncate(difference.api)}`
    );
  }
  console.error(`\n[compare] FAILED — ${differences.length} difference(s)`);
  process.exit(1);
};

await main();
