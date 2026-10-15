// =========================================================
// 🔨 CONTENT BUILD STEP
// =========================================================
// Phase 7 (docs/MIGRATION.md): the public build reads its content
// from `GET /api/content` at build time and bakes a validated
// snapshot into `src/generated/content.js`, which the components,
// the prerenderer and the discovery generator all import instead of
// `src/data/*.js`.
//
//   PostgreSQL → GET /api/content → this script →
//   src/generated/content.js → bundler → static dist/
//
// FAIL CLOSED:
//   * unreachable endpoint / HTTP error / invalid JSON → exit 1,
//     the `npm run build` step that follows never runs
//   * payload fails strict validation (missing profile, zero
//     projects, unknown keys, bad dimensions/status/URLs, ...) → exit 1
//   * there is NO fallback to `src/data/*.js`. Gone means gone.
//
// The generated module is a *snapshot*, not an editable source: this
// script overwrites it on every build from the API, and its header
// says so. It is committed so a fresh clone can lint/test without a
// running backend, but it is never hand-edited.
//
// Generated output is byte-deterministic for a given payload: no
// wall-clock timestamp is embedded, so a stable content payload
// produces an identical file on every build.
// =========================================================

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
    fetchContent,
    resolveContentUrl,
    contentTimeoutSeconds,
    ContentBuildError,
    ContentValidationError,
} from "../src/lib/content.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const contentOutDir = path.join(rootDir, "src", "generated");
const contentOutPath = path.join(contentOutDir, "content.js");
const fetchLogPath = path.join(rootDir, ".cache", "last-content-fetch.json");

const LABEL = "[content]";

function fail(message) {
    console.error(`\n${LABEL} FAILED: ${message}\n`);
    process.exit(1);
}

const url = resolveContentUrl();
const timeoutSeconds = contentTimeoutSeconds();

console.log(`${LABEL} fetching content from ${url} (timeout ${timeoutSeconds}s)`);

let payload;
try {
    payload = await fetchContent({
        url,
        timeoutSeconds,
    });
} catch (error) {
    if (
        error instanceof ContentBuildError ||
        error instanceof ContentValidationError
    ) {
        fail(error.message);
    }
    fail(error instanceof Error ? error.message : String(error));
}

// ------------------------------------------------------------------
// static SEO the API deliberately does not own (docs/DEPLOYMENT.md
// §3, docs/DATABASE.md §5.1.3): the deployed origin and the search
// console verification tokens live in src/config/seo.js and are
// merged into the snapshot here, so discovery + project pages keep
// emitting them while every *content* field comes from the API.
// ------------------------------------------------------------------
const staticSeo = (await import(pathToFileURL(
    path.join(rootDir, "src", "config", "seo.js")
))).default;

const seo = {
    ...payload.seo,
    url: staticSeo.url,
    verification: staticSeo.verification,
};

const PROJECT_IMAGE_DIMENSIONS = Object.fromEntries(
    payload.projects.map((project) => [
        project.slug,
        { width: project.image_width, height: project.image_height },
    ])
);



// =========================================================
// EMIT src/generated/content.js
// =========================================================
// Every export is emitted from the validated payload in a fixed
// order, so the file is byte-stable across builds with the same
// content.

const HEADER = `// =========================================================
// 📦 CONTENT SNAPSHOT — GENERATED FILE. DO NOT EDIT.
// =========================================================
// Produced by scripts/build-content.mjs from GET ${url}.
//
// This module is a build-time snapshot of the public content API
// (GET /api/content). It is written fresh on every \`npm run build\`
// and overwritten from the API — hand-editing it is overwritten and
// pointless. It is committed only so a fresh clone can lint and test
// without a running backend.
//
// Content authority: the backend + PostgreSQL, fetched at build time,
// validated fail-closed in src/lib/content.js. \`url\` and
// \`verification\` are merged in from src/config/seo.js, which owns
// those two deployment-level values.
//
// src/data/*.js are NOT this source. They are the legacy migration
// input (docs/CONTENT_MAPPING.md) and are no longer the public
// runtime authority.
// =========================================================
`;

function exportBlock(name, value) {
    return `export const ${name} = ${JSON.stringify(value, null, 4)};\n`;
}

const chunks = [
    HEADER,
    exportBlock("meta", payload.meta),
    exportBlock("profile", payload.profile),
    exportBlock("about", payload.about),
    exportBlock("projects", payload.projects),
    exportBlock("skills", payload.skills),
    exportBlock("certifications", payload.certifications),
    exportBlock("seo", seo),
    exportBlock("PROJECT_IMAGE_DIMENSIONS", PROJECT_IMAGE_DIMENSIONS),
];

const generated = chunks.join("\n");

fs.mkdirSync(contentOutDir, { recursive: true });
fs.writeFileSync(contentOutPath, generated, "utf8");

const sha = createHash("sha256").update(generated).digest("hex");
const bytes = Buffer.byteLength(generated);

console.log(
    `${LABEL} wrote src/generated/content.js ` +
    `(${bytes} B, sha256 ${sha.slice(0, 16)}…)`
);
console.log(
    `${LABEL} ${payload.projects.length} project(s), ` +
    `${payload.projects.filter((p) => p.indexable !== false).length} indexable, ` +
    `${payload.skills.length} skill(s), ` +
    `${payload.certifications.length} certification(s)`
);
console.log(
    `${LABEL} seo.url=${seo.url} (from src/config/seo.js), ` +
    `seo.robots=${JSON.stringify(seo.robots)}`
);

// Build-side fetch record for observability (gitignored; not part of
// the deployable output).
fs.mkdirSync(path.dirname(fetchLogPath), { recursive: true });
fs.writeFileSync(
    fetchLogPath,
    JSON.stringify(
        {
            url,
            fetchedAt: new Date().toISOString(),
            sha256: sha,
            bytes,
            counts: {
                projects: payload.projects.length,
                indexable: payload.projects.filter(
                    (p) => p.indexable !== false
                ).length,
                skills: payload.skills.length,
                certifications: payload.certifications.length,
            },
            meta: payload.meta,
        },
        null,
        2
    ) + "\n"
);

console.log("");