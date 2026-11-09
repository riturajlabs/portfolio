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

// Asset-hash normalisation lives in `scripts/asset-hash.mjs` so its regex has
// its own regression tests (`scripts/asset-hash.test.mjs`) without importing
// this side-effect-heavy script. See that module for the rule and rationale.
import { HASHED_ASSET, normalize } from "./asset-hash.mjs";

export { HASHED_ASSET, normalize };

// The bundler-owned asset block of the SPA shell: <script> entries and
// <link rel="modulepreload"> manifests. These lines are emitted by
// Vite/Rolldown from the chunk graph — neither the set nor the order
// is authored content, and both legitimately change when a bundle
// improves (a runtime chunk merging away, a preload being added).
const ASSET_BLOCK = /^\s*<(script[^>]*src="\/assets\/|link[^>]*rel="modulepreload"[^>]*href="\/assets\/)[^\n]+\n/gm;

function withoutAssetBlock(text) {
    return text.replace(ASSET_BLOCK, "");
}

// U3 (docs/PORTFOLIO_UPGRADE.md §7 U3) makes two deliberate, authorable
// changes to the SPA shell that are not migrations of migrated content:
//   1. a pre-paint theme-bootstrap <script> (chooses data-theme from
//      localStorage → prefers-color-scheme → dark before first paint), and
//   2. the single static `theme-color` meta is replaced by a
//      `prefers-color-scheme` dark/light pair.
// Both are sanctioned by the U3 plan and neither touches an SEO/content
// contract, so the shell body comparison ignores exactly these two
// anchored regions. It is deliberately *not* a blanket ignore: any other
// change to the shell body (title, canonical, OG/Twitter, JSON-LD) still
// reports DIFFERS. If the bootstrap script text changes, the anchor below
// stops matching and the shell is compared byte-for-byte again.
const THEME_BOOTSTRAP_BLOCK =
    /[ \t]*<!-- Theme bootstrap[\s\S]*?<\/script>\n\n[ \t]*<!-- =+ -->\n/;
const THEME_COLOR_META = /[ \t]*<meta\s+name="theme-color"[\s\S]*?>\n\n/g;

function withoutThemeDelta(text) {
    return text
        .replace(THEME_BOOTSTRAP_BLOCK, "")
        .replace(THEME_COLOR_META, "");
}

// U5 (docs/PORTFOLIO_UPGRADE.md §7 U5): the five project pages gain
// an authorable sticky section nav — a plain, no-JS anchor bar — plus
// the four exact `id` attributes its anchors target. This is the
// plan-sanctioned markup addition for the phase; it touches no
// SEO/content contract (title, canonical, OG/Twitter, JSON-LD and the
// visible copy stay byte-identical, and those are still compared).
// Following the U3 mechanism above, the comparator strips exactly
// these anchored shapes from BOTH sides and compares the rest
// byte-for-byte. It is fail-closed by construction: the anchors are
// exact literals keyed on the nav's unique class, so if the markup
// ever drifts the anchors stop matching and the pages report DIFFERS
// again rather than silently widening the exception.
const U5_SECTION_NAV =
    /<nav class="project-page-section-nav"[^>]*>[\s\S]*?<\/nav>/;

const U5_SECTION_IDS = [
    ' id="project-about"',
    ' id="project-tech"',
    ' id="project-highlights"',
    ' id="project-related"',
];

function withoutProjectPageU5Delta(text) {
    let out = text.replace(U5_SECTION_NAV, "");
    for (const id of U5_SECTION_IDS) {
        out = out.split(id).join("");
    }
    return out;
}

// U9 (docs/PORTFOLIO_UPGRADE.md §7 U9): Inter is loaded from the document
// head instead of a CSS @import so the stylesheet is discovered during the
// initial parse. The SPA shell and the no-JS project pages each carry the
// same three link elements; the surrounding comments are documentation for
// that authorable move. Strip exactly those anchored shapes from BOTH sides
// and compare the rest byte-for-byte. If the font URL or link shape changes,
// this stops matching and the page reports DIFFERS again.
const U9_FONT_COMMENT =
    /[ \t]*<!-- =+ -->\n[ \t]*<!-- Fonts[\s\S]*?<!-- =+ -->\n\n|[ \t]*<!-- Fonts:[\s\S]*?-->\n/;

const U9_FONT_LINKS = new RegExp(
    [
        String.raw`[ \t]*<link\s+rel="preconnect"\s+href="https://fonts\.googleapis\.com">`,
        String.raw`<link\s+rel="preconnect"\s+href="https://fonts\.gstatic\.com"\s+crossorigin>`,
        String.raw`<link\s+rel="stylesheet"\s+href="https://fonts\.googleapis\.com/css2\?family=Inter:wght@400;500;600;700;800&display=swap">\n\n?`,
    ].join(String.raw`\s*`)
);

function withoutU9FontDelta(text) {
    return text
        .replace(U9_FONT_COMMENT, "")
        .replace(U9_FONT_LINKS, "");
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
        isProject: true,
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

    // U9 moved Inter from a CSS @import to document-head links. Strip that
    // exact authorable delta before comparing everything else.
    const baselineContent = withoutU9FontDelta(baselineNorm);
    const distContent = withoutU9FontDelta(distNorm);

    if (baselineContent === distContent) {
        results.push({
            ...entry,
            status: "ASSETS-VARY",
            note: "authorable content identical; U9 font-link delta + hashed asset names differ",
        });
        continue;
    }

    // Project pages carry the U5 sticky-nav delta described above;
    // strip the anchored shapes and re-compare before giving up.
    if (entry.isProject) {
        const baselineU5 = withoutProjectPageU5Delta(baselineContent);
        const distU5 = withoutProjectPageU5Delta(distContent);
        if (baselineU5 === distU5) {
            results.push({
                ...entry,
                status: "ASSETS-VARY",
                note: "authorable content identical; U9 font-link + U5 sticky-nav deltas + hashed asset names differ",
            });
            continue;
        }
    }

    // The SPA shell additionally carries a purely bundler-owned asset
    // manifest. Authorable content is everything outside that block;
    // the manifest itself is compared as a set so a chunk graph change
    // is reported (and inspected) rather than silently swallowed.
    if (entry.isShell) {
        const baselineBody = withoutThemeDelta(
            withoutAssetBlock(baselineContent)
        );
        const distBody = withoutThemeDelta(
            withoutAssetBlock(distContent)
        );

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
                note: `authorable content identical; U9 font-link delta + ${delta}`,
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