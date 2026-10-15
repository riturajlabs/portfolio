// assert-admin-bundle.mjs — post-build guard for ADR-010 + MIGRATION.md Phase 5
// acceptance:
//
//   - the PUBLIC entry (index.html) must not ship react-router-dom and must not
//     ship any admin module. Both are asserted by scanning the chunks the public
//     entry actually loads (from the build manifest) for distinctive marker
//     strings. If the manifest is missing or a marker appears, the check fails
//     and `npm run build` stops.
//   - the ADMIN entry (admin.html) must exist as a separate entry and must
//     actually contain the admin markers, so the check cannot pass vacuously.
//
// Marker choice: react-router emits the literal `react-router` in one of its
// invariants even minified; the admin UI keeps distinctive string literals in
// production (a class name and the login heading). Checking chunk *content*
// rather than the module graph sidesteps manifest-format drift across Vite
// versions.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

const ADMIN_MARKERS = ["admin-login-card", "Portfolio Admin"];
const ROUTER_MARKER = "react-router";

function findManifest() {
  const candidates = [
    join(DIST, ".vite", "manifest.json"),
    join(DIST, "manifest.json"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    "Build manifest not found at dist/.vite/manifest.json or dist/manifest.json. " +
      "Is `build.manifest: true` set in vite.config.js?",
  );
}

function entryBySrc(manifest, suffix) {
  return Object.values(manifest).find(
    (entry) => entry && entry.isEntry === true && entry.src === suffix,
  );
}

function reachableChunks(manifest, entry) {
  const visited = new Set();
  const queue = [...(entry.imports || []), ...(entry.dynamicImports || [])];

  while (queue.length > 0) {
    const ref = queue.shift();
    if (visited.has(ref)) continue;
    visited.add(ref);

    const node = manifest[ref];
    if (!node) continue;
    queue.push(...(node.imports || []));
  }

  const files = new Set();
  // The entry's own chunk is not in its `imports` array — it is the file the
  // HTML loads first.
  if (entry.file) files.add(entry.file);
  for (const ref of visited) {
    const node = manifest[ref];
    if (node && node.file) files.add(node.file);
    else if (typeof ref === "string" && ref.endsWith(".js") && !ref.includes("/")) {
      files.add(`assets/${ref}`);
    }
  }
  return [...files];
}

function readChunks(files) {
  const out = [];
  for (const file of files) {
    const path = join(DIST, file);
    if (!existsSync(path)) {
      throw new Error(`Chunk referenced by the public entry is missing: ${file}`);
    }
    out.push({ file, text: readFileSync(path, "utf8") });
  }
  return out;
}

try {
  const manifestPath = findManifest();
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  const entries = readdirSync(DIST).filter((name) => name.endsWith(".html"));

  const publicEntry = entryBySrc(manifest, "index.html");
  const adminEntry = entryBySrc(manifest, "admin.html");

  if (!publicEntry) throw new Error("index.html is not a build entry.");
  if (!adminEntry) {
    throw new Error("admin.html is not a separate build entry — the admin dashboard is missing.");
  }

  const publicChunks = reachableChunks(manifest, publicEntry);
  const adminChunks = reachableChunks(manifest, adminEntry);

  const publicTexts = readChunks(publicChunks).map((c) => c.text);
  const adminTexts = readChunks(adminChunks).map((c) => c.text);

  const publicAll = publicTexts.join("\n");
  const adminAll = adminTexts.join("\n");

  const violations = [];
  if (publicAll.includes(ROUTER_MARKER)) {
    violations.push(`react-router-dom marker "${ROUTER_MARKER}" found in a PUBLIC-entry chunk.`);
  }
  for (const marker of ADMIN_MARKERS) {
    if (publicAll.includes(marker)) {
      violations.push(`admin marker "${marker}" found in a PUBLIC-entry chunk.`);
    }
  }

  const adminMissing = [];
  if (!adminAll.includes(ROUTER_MARKER)) {
    adminMissing.push(`react-router marker missing from the admin entry — routing may be broken.`);
  }
  for (const marker of ADMIN_MARKERS) {
    if (!adminAll.includes(marker)) {
      adminMissing.push(`admin marker "${marker}" missing from the admin entry.`);
    }
  }

  if (violations.length > 0) {
    console.error("[assert-admin-bundle] public bundle isolation FAILED:");
    for (const v of violations) console.error("  -", v);
    process.exit(1);
  }

  if (adminMissing.length > 0) {
    console.error("[assert-admin-bundle] admin entry markers FAILED:");
    for (const v of adminMissing) console.error("  -", v);
    process.exit(1);
  }

  console.log(
    `[assert-admin-bundle] public bundle clean (` +
      `${publicChunks.length} chunks, ${entries.length} html entries); ` +
      `admin is a separate entry (${adminChunks.length} chunks).`,
  );
} catch (err) {
  console.error("[assert-admin-bundle] failed:", err.message);
  process.exit(1);
}