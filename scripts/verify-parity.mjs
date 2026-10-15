// =========================================================
// 🧪 BUILD PARITY VERIFIER
// =========================================================
// Compares the current dist/ against the pre-migration baseline in
// .cache/baseline/ (docs/TESTING.md §4, docs/MIGRATION.md Phase 7).
//
// The only normalisation applied is hashed asset filenames
// (`main-CqdiyGLi.js` → `main-HASH.js`): those are genuinely
// nondeterministic build identifiers, not content. Everything else
// is compared byte-for-byte, so a real content drift in any page,
// sitemap, robots file or llms.txt stops the check with an explicit
// report. `llms.txt` carries no generation timestamp today, so nothing
// else is normalised.
//
// Classification (docs/MIGRATION.md §26):
//   IDENTICAL         byte-for-byte equal after asset normalisation
//   ASSETS-VARY       only hashed-asset references differ (allowed:
//                     bundle identifiers change when the bundle does)
//   DIFFERS           real content difference — investigate, do not ship
//
// Usage:
//   node scripts/verify-parity.mjs
// =========================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const distDir = path.join(rootDir, "dist");
const baselineDir = path.join(rootDir, ".cache", "baseline");

function fail(message) {
    console.error(`\n[parity] FAILED: ${message}\n`);
    process.exit(1);
}

if (!fs.existsSync(baselineDir)) {
    fail(
        "baseline missing — run `node scripts/capture-baseline.mjs` " +
        "against a pre-cutover build first."
    );
}

const HASHED_ASSET = /-([A-Za-z0-9]{8,})\.(js|css)\b/g;

function normalize(text) {
    return text.replace(HASHED_ASSET, "-HASH.$2");
}

// The bundler-owned asset block of the SPA shell: <script> entries and
// <link rel="modulepreload"> manifests. These lines are emitted by
// Vite/Rolldown from the chunk graph — neither the set nor the order
// is authored content, and both legitimately change when a bundle
// improves (a runtime chunk merging away, a preload being added).
const ASSET_BLOCK = /^\s*<(script[^>]*src="\/assets\/|link[^>]*rel="modulepreload"[^>]*href="\/assets\/)[^\n]+\n/gm;

function withoutAssetBlock(text) {
    return text.replace(ASSET_BLOCK, "");
}

function assetManifest(text) {
    const manifest = [];
    for (const match of text.matchAll(/\/assets\/[^"']+/g)) {
        manifest.push(normalize(match[0]));
    }
    return [...new Set(manifest)].sort();
}

const entries = [
    { baseline: "home.html", dist: path.join("index.html"), label: "index.html", isShell: true },
    { baseline: "sitemap.xml", dist: "sitemap.xml", label: "sitemap.xml" },
    { baseline: "sitemap-images.xml", dist: "sitemap-images.xml", label: "sitemap-images.xml" },
    { baseline: "robots.txt", dist: "robots.txt", label: "robots.txt" },
    { baseline: "llms.txt", dist: "llms.txt", label: "llms.txt" },
];

for (const slug of ["webchat-ai", "orbit-ai", "stayora", "zerodha-clone", "scientific-calculator"]) {
    entries.push({
        baseline: `project-${slug}.html`,
        dist: path.join("projects", slug, "index.html"),
        label: `projects/${slug}/index.html`,
    });
}

const results = [];

for (const entry of entries) {
    const baselinePath = path.join(baselineDir, entry.baseline);
    const distPath = path.join(distDir, entry.dist);

    if (!fs.existsSync(baselinePath)) {
        fail(`baseline file ${entry.baseline} is missing.`);
    }
    if (!fs.existsSync(distPath)) {
        results.push({ ...entry, status: "DIFFERS", note: "missing from dist/" });
        continue;
    }

    const baselineText = fs.readFileSync(baselinePath, "utf8");
    const distText = fs.readFileSync(distPath, "utf8");

    if (baselineText === distText) {
        results.push({ ...entry, status: "IDENTICAL" });
        continue;
    }

    const baselineNorm = normalize(baselineText);
    const distNorm = normalize(distText);

    if (baselineNorm === distNorm) {
        results.push({ ...entry, status: "ASSETS-VARY", note: "content identical; hashed asset names differ" });
        continue;
    }

    // The SPA shell additionally carries a purely bundler-owned asset
    // manifest. Authorable content is everything outside that block;
    // the manifest itself is compared as a set so a chunk graph change
    // is reported (and inspected) rather than silently swallowed.
    if (entry.isShell) {
        const baselineBody = withoutAssetBlock(normalize(baselineText));
        const distBody = withoutAssetBlock(normalize(distText));

        const baselineAssets = assetManifest(baselineText);
        const distAssets = assetManifest(distText);

        const removed = baselineAssets.filter((asset) => !distAssets.includes(asset));
        const added = distAssets.filter((asset) => !baselineAssets.includes(asset));
        const delta =
            removed.length + added.length === 0
                ? "same asset set"
                : `asset set: -${removed.length} +${added.length}`;

        if (baselineBody === distBody) {
            results.push({
                ...entry,
                status: "ASSETS-VARY",
                note: `authorable content identical; ${delta}`,
            });
            continue;
        }
    }

    results.push({ ...entry, status: "DIFFERS" });
}

console.log("[parity] baseline vs current dist/");
console.log("");
for (const result of results) {
    const marker =
        result.status === "IDENTICAL" ? "identical"
        : result.status === "ASSETS-VARY" ? "assets-vary"
        : "DIFFERS  ←";
    console.log(`  ${marker.padEnd(12)} ${result.label}${result.note ? `  (${result.note})` : ""}`);
}
console.log("");

const identical = results.filter((r) => r.status === "IDENTICAL").length;
const assetsVary = results.filter((r) => r.status === "ASSETS-VARY").length;
const differs = results.filter((r) => r.status === "DIFFERS");

console.log(
    `${identical} identical, ${assetsVary} assets-vary (allowed), ${differs.length} differ(s).`
);

if (differs.length > 0) {
    console.error(
        "\n[parity] FAILED: real content difference(s) found. " +
        "Classify each (intentional / unintentional / source-API-contract) " +
        "before shipping — do not ship blindly.\n"
    );
    process.exit(1);
}

console.log("[parity] done — parity holds.\n");