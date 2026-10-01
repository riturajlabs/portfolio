// =========================================================
// 📄 PROJECT PAGE GENERATOR
// =========================================================
// Runs after the SPA build + the SSR (prerender) build and writes
// one real HTML document per indexable project:
//
//   dist/projects/<slug>/index.html
//
// Each document contains the project's own markup, title,
// description, canonical, Open Graph, Twitter and JSON-LD —
// server-rendered HTML, not a copy of the SPA shell.
//
// It reads the real Vite build manifest for stylesheet URLs, so
// no hashed filename is ever hardcoded, and it verifies the
// intrinsic image dimensions declared in
// src/lib/projectPages.js against the actual WebP file headers,
// so a wrong width/height fails the build instead of shipping.
// =========================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

const distDir = path.join(rootDir, "dist");
const prerenderDir = path.join(rootDir, ".prerender");
const manifestPath = path.join(prerenderDir, ".vite", "manifest.json");
const entryPath = path.join(prerenderDir, "entry.mjs");



// =========================================================
// WEBP HEADER READER (dependency free)
// =========================================================
// Only enough of the container spec to recover the canvas size.
// Supports the three chunk layouts a .webp can use: VP8X
// (extended), VP8L (lossless — what Phase B produced) and VP8
// (lossy).

function readWebpSize(buffer) {
    if (buffer.length < 30) {
        throw new Error("file too small to be a WebP image");
    }

    const isRiff =
        buffer.subarray(0, 4).toString("ascii") === "RIFF";
    const isWebp =
        buffer.subarray(8, 12).toString("ascii") === "WEBP";

    if (!isRiff || !isWebp) {
        throw new Error("missing RIFF/WEBP signature — not a WebP file");
    }

    const chunk = buffer.subarray(12, 16).toString("ascii");

    if (chunk === "VP8X") {
        // 24-bit little-endian canvas dimensions, minus one.
        const width =
            1 +
            (buffer[24] |
                (buffer[25] << 8) |
                (buffer[26] << 16));
        const height =
            1 +
            (buffer[27] |
                (buffer[28] << 8) |
                (buffer[29] << 16));

        return { width, height, chunk };
    }

    if (chunk === "VP8L") {
        // Signature byte 0x2F, then 14 bits width-1 and 14 bits
        // height-1 packed into the following four bytes.
        if (buffer[20] !== 0x2f) {
            throw new Error("bad VP8L signature byte");
        }

        const bits = buffer.readUInt32LE(21);

        return {
            width: 1 + (bits & 0x3fff),
            height: 1 + ((bits >> 14) & 0x3fff),
            chunk,
        };
    }

    if (chunk === "VP8 ") {
        // Lossy: 3-byte frame tag, 3-byte start code, then two
        // 16-bit dimensions with 2 scale bits each.
        const start = buffer.subarray(23, 26).toString("ascii");

        if (start !== "\x9d\x01\x2a") {
            throw new Error("bad VP8 frame start code");
        }

        return {
            width: buffer.readUInt16LE(26) & 0x3fff,
            height: buffer.readUInt16LE(28) & 0x3fff,
            chunk,
        };
    }

    throw new Error(`unsupported WebP chunk "${chunk}"`);
}



// =========================================================
// INPUTS
// =========================================================

function fail(message) {
    console.error(`\n[prerender] FAILED: ${message}\n`);
    process.exit(1);
}

if (!fs.existsSync(path.join(distDir, "index.html"))) {
    fail("dist/index.html is missing — run `vite build` first.");
}

if (!fs.existsSync(manifestPath)) {
    fail(
        "prerender manifest is missing — run " +
        "`vite build --config vite.prerender.config.js` first."
    );
}

if (!fs.existsSync(entryPath)) {
    fail(
        "prerender bundle is missing — run " +
        "`vite build --config vite.prerender.config.js` first."
    );
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const entryKey = Object.keys(manifest).find(
    (key) => manifest[key].isEntry
);

if (!entryKey) {
    fail("no entry found in the prerender manifest.");
}

const entry = manifest[entryKey];

const stylesheets = (entry.css || []).map((file) => `/${file}`);

if (stylesheets.length === 0) {
    fail(
        "the prerender bundle emitted no CSS — project pages would " +
        "ship unstyled."
    );
}

// The SSR build writes its assets to .prerender, but the deployable
// output is dist/. Publish every manifest-referenced stylesheet there
// under the same hashed name the manifest gave us, so the generated
// <link> resolves and no filename is ever hardcoded. A missing or
// failed copy fails the build rather than shipping a 404 stylesheet.
for (const file of entry.css) {
    const source = path.join(prerenderDir, file);
    const target = path.join(distDir, file);

    if (!fs.existsSync(source)) {
        fail(`manifest lists "${file}" but it is missing from .prerender.`);
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);

    if (!fs.existsSync(target)) {
        fail(`failed to publish "${file}" into dist/.`);
    }
}

// Everything the generator needs comes from the compiled prerender
// bundle — never from raw source, so there is exactly one compiled
// view of the project data.
const {
    renderProjectDocument,
    indexableProjects,
    projects: allProjects,
    PROJECT_IMAGE_DIMENSIONS,
} = await import(pathToFileURL(entryPath).href);

const indexable = indexableProjects();

console.log(
    `[prerender] ${stylesheets.length} stylesheet(s) from manifest: ` +
    stylesheets.join(", ")
);



// =========================================================
// GENERATE
// =========================================================

const generated = [];
const problems = [];

for (const project of indexable) {
    const expectedSlugPath = `/images/projects/${project.slug}.webp`;

    // The image filename and the slug must stay in lockstep:
    // the page, the canonical URL and the asset all key off the
    // slug, so a mismatch is a build error, not a 404 later.
    if (project.image !== expectedSlugPath) {
        problems.push(
            `${project.title}: image "${project.image}" does not match ` +
            `slug-derived path "${expectedSlugPath}"`
        );
        continue;
    }

    const imagePath = path.join(
        distDir,
        "images",
        "projects",
        `${project.slug}.webp`
    );

    if (!fs.existsSync(imagePath)) {
        problems.push(
            `${project.title}: missing image asset ${imagePath}`
        );
        continue;
    }

    const imageBuffer = fs.readFileSync(imagePath);

    let actual;
    try {
        actual = readWebpSize(imageBuffer);
    } catch (error) {
        problems.push(
            `${project.title}: ${imagePath} is not a readable WebP — ` +
            error.message
        );
        continue;
    }

    const declared = PROJECT_IMAGE_DIMENSIONS[project.slug];

    // Compare against what the document actually emitted, which is
    // the single source consumers will trust.
    const html = renderProjectDocument(project, stylesheets);

    const emittedWidth = Number(
        html.match(/<img[^>]*\swidth="(\d+)"/)?.[1]
    );
    const emittedHeight = Number(
        html.match(/<img[^>]*\sheight="(\d+)"/)?.[1]
    );

    // Two independent checks: the declared constant must match the
    // real asset, and the emitted markup must match the real asset.
    // Either drifting fails the build instead of shipping a wrong
    // intrinsic size (which would cause layout shift).
    const declaredMatches =
        declared &&
        declared.width === actual.width &&
        declared.height === actual.height;

    const emittedMatches =
        emittedWidth === actual.width &&
        emittedHeight === actual.height;

    // Exactly one image preload, and it belongs in <head>. A stray
    // duplicate would mean React's hoisting leaked back into the body.
    const preloadCount = (
        html.match(/<link rel="preload" as="image"/g) || []
    ).length;
    const bodyStart = html.indexOf("<body>");
    const preloadsInBody =
        html.slice(bodyStart).match(/<link rel="preload" as="image"/g) || [];

    if (!emittedMatches || !declaredMatches || preloadsInBody.length > 0) {
        problems.push(
            `${project.title}: ${path.basename(imagePath)} is really ` +
            `${actual.width}x${actual.height} (${actual.chunk}), but ` +
            `PROJECT_IMAGE_DIMENSIONS declares ` +
            `${declared ? `${declared.width}x${declared.height}` : "nothing"} ` +
            `and the page emitted ${emittedWidth}x${emittedHeight} ` +
            `(${preloadCount} image preload(s), ` +
            `${preloadsInBody.length} of them inside <body>)`
        );
        continue;
    }

    const outputDir = path.join(distDir, "projects", project.slug);
    fs.mkdirSync(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, "index.html");
    fs.writeFileSync(outputPath, html, "utf8");

    generated.push({
        title: project.title,
        slug: project.slug,
        bytes: Buffer.byteLength(html),
        imageBytes: imageBuffer.length,
        dimensions: `${actual.width}x${actual.height}`,
        chunk: actual.chunk,
        output: path.relative(rootDir, outputPath),
    });

    console.log(
        `[prerender] ${project.slug.padEnd(24)} ` +
        `${String(Buffer.byteLength(html)).padStart(7)} B html  ` +
        `${actual.chunk} ${actual.width}x${actual.height}`
    );
}



// =========================================================
// REPORT
// =========================================================

const skipped = allProjects.filter((project) => project.indexable === false);

if (skipped.length > 0) {
    console.log(
        `[prerender] skipped ${skipped.length} non-indexable project(s): ` +
        skipped.map((project) => project.slug).join(", ")
    );
}

if (problems.length > 0) {
    problems.forEach((problem) => console.error(`  - ${problem}`));
    fail(
        `${problems.length} problem(s) found while generating project pages.`
    );
}

if (generated.length === 0) {
    fail("no project pages were generated.");
}

console.log(
    `[prerender] done — ${generated.length} project page(s) written to ` +
    "dist/projects/\n"
);