// =========================================================
// 📸 BASELINE CAPTURE
// =========================================================
// Writes the pre-migration build output to .cache/baseline/ so a
// later build can be compared against it (docs/TESTING.md §4).
//
//   .cache/baseline/
//     home.html               dist/index.html (SPA shell + static SEO)
//     project-<slug>.html      one per dist/projects/<slug>/index.html
//     sitemap.xml              dist/sitemap.xml
//     sitemap-images.xml       dist/sitemap-images.xml
//     robots.txt               dist/robots.txt
//     llms.txt                 dist/llms.txt
//     seo.json                 title/description/canonical/OG/Twitter/JSON-LD per URL
//     bundle-sizes.json        gzipped sizes of every chunk in dist/assets/
//
// The baseline is a regression oracle, not a running record: it must
// be taken once, before the cutover, and must not be silently
// overwritten later. The script refuses to clobber an existing
// baseline unless --force is passed.
//
// Usage:
//   npm run build
//   node scripts/capture-baseline.mjs            # first capture
//   node scripts/capture-baseline.mjs --force    # deliberate refresh
// =========================================================

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const distDir = path.join(rootDir, "dist");
const baselineDir = path.join(rootDir, ".cache", "baseline");

function fail(message) {
    console.error(`\n[capture-baseline] FAILED: ${message}\n`);
    process.exit(1);
}

if (!fs.existsSync(path.join(distDir, "index.html"))) {
    fail("dist/index.html is missing — run `npm run build` first.");
}

if (fs.existsSync(baselineDir) && !process.argv.includes("--force")) {
    fail(
        `baseline already exists at .cache/baseline/ — a baseline is a ` +
        "one-time oracle. Pass --force to overwrite deliberately."
    );
}

fs.mkdirSync(baselineDir, { recursive: true });



// =========================================================
// SEO SUMMARY (seo.json)
// =========================================================

const META_SELECTORS = ["canonical", "description", "robots", "author", "googlebot"];

function extractSeo(html, url) {
    const metas = {};
    const og = {};
    const twitter = {};

    for (const match of html.matchAll(/<meta\s+name="([^"]+)"\s+content="([^"]*)"/g)) {
        const [, name, content] = match;
        if (META_SELECTORS.includes(name)) metas[name] = content;
    }

    for (const match of html.matchAll(
        /<meta\s+property="og:([^"]+)"\s+content="([^"]*)"/g
    )) {
        og[match[1]] = match[2];
    }

    for (const match of html.matchAll(
        /<meta\s+property="og:([^"]+)"\s+content="([^"]*)"[^>]*\/?>/gi
    )) {
        og[match[1]] = match[2];
    }

    for (const match of html.matchAll(
        /<meta\s+name="twitter:([^"]+)"\s+content="([^"]*)"/g
    )) {
        twitter[match[1]] = match[2];
    }

    return {
        url,
        title: html.match(/<title>\s*\n?\s*([^<\n]+)/)?.[1]?.trim() ?? null,
        canonical: metas.canonical ?? null,
        description: metas.description ?? null,
        robots: metas.robots ?? null,
        author: metas.author ?? null,
        openGraph: og,
        twitter,
        jsonLd: [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
            .map((match) => {
                try {
                    return JSON.parse(match[1]);
                } catch {
                    return null;
                }
            })
            .filter(Boolean),
    };
}

function seoSummary() {
    const entries = [];

    const home = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
    entries.push(extractSeo(home, "https://riturajlabs.vercel.app/"));

    const projectDir = path.join(distDir, "projects");
    if (fs.existsSync(projectDir)) {
        for (const slug of fs.readdirSync(projectDir)) {
            if (!slug.startsWith(".")) {
                const page = path.join(projectDir, slug, "index.html");
                if (fs.existsSync(page)) {
                    entries.push(
                        extractSeo(
                            fs.readFileSync(page, "utf8"),
                            `https://riturajlabs.vercel.app/projects/${slug}/`
                        )
                    );
                }
            }
        }
    }

    return entries;
}



// =========================================================
// BUNDLE SIZES (bundle-sizes.json)
// =========================================================

function bundleSizes() {
    const assetsDir = path.join(distDir, "assets");
    const sizes = [];

    if (fs.existsSync(assetsDir)) {
        for (const file of fs.readdirSync(assetsDir)) {
            const full = path.join(assetsDir, file);
            if (fs.statSync(full).isFile()) {
                const bytes = fs.readFileSync(full);
                sizes.push({
                    file: `assets/${file}`,
                    bytes: bytes.length,
                    gzipBytes: zlib.gzipSync(bytes).length,
                });
            }
        }
    }

    return sizes.sort((a, b) => a.file.localeCompare(b.file));
}



// =========================================================
// RUN
// =========================================================

const copies = [
    ["index.html", "home.html"],
    ["sitemap.xml", "sitemap.xml"],
    ["sitemap-images.xml", "sitemap-images.xml"],
    ["robots.txt", "robots.txt"],
    ["llms.txt", "llms.txt"],
];

for (const [from, to] of copies) {
    const source = path.join(distDir, from);
    if (!fs.existsSync(source)) {
        fail(`${from} is missing from dist/ — run a full \`npm run build\`.`);
    }
    fs.copyFileSync(source, path.join(baselineDir, to));
}

const projectDir = path.join(distDir, "projects");
if (fs.existsSync(projectDir)) {
    for (const slug of fs.readdirSync(projectDir)) {
        if (slug.startsWith(".")) continue;
        const source = path.join(projectDir, slug, "index.html");
        if (fs.existsSync(source)) {
            fs.copyFileSync(source, path.join(baselineDir, `project-${slug}.html`));
        }
    }
} else {
    fail("dist/projects/ is missing — no project pages were prerendered.");
}

fs.writeFileSync(
    path.join(baselineDir, "seo.json"),
    JSON.stringify(seoSummary(), null, 2)
);

fs.writeFileSync(
    path.join(baselineDir, "bundle-sizes.json"),
    JSON.stringify(bundleSizes(), null, 2)
);

const captured = fs.readdirSync(baselineDir).sort();
console.log(
    `[capture-baseline] captured ${captured.length} file(s) to .cache/baseline/`
);
for (const file of captured) {
    console.log(`  - ${file}`);
}
console.log("");