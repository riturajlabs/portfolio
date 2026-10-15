// Phase 10 (docs/MIGRATION.md Phase 10, docs/TESTING.md §10): the migration
// validation list as an executable suite. Run through
// `npm run test:migration-validation` AFTER `npm run build` — the checks
// compare the current dist/ against the Phase 0 regression oracle in
// .cache/baseline/, so a build is a hard precondition (the suite fails with
// instructions when dist/ is missing rather than passing vacuously).
//
// Two tiers:
//
//   * Structure checks need only dist/ — page counts, image dimensions vs
//     real WebP headers, no admin/private data in the public documents, the
//     admin-bundle assertion. These run everywhere, including CI.
//   * Parity checks need .cache/baseline/ (gitignored, so a fresh clone and
//     CI do not have it). They are SKIPPED — visibly, never silently — when
//     the oracle is absent, and run in full on this machine.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { projects } from "../src/generated/content.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(repoRoot, "dist");
const baselineDir = path.join(repoRoot, ".cache", "baseline");

const PROJECT_SLUGS = [
    "webchat-ai",
    "orbit-ai",
    "stayora",
    "zerodha-clone",
    "scientific-calculator",
];

const hasDist = existsSync(distDir);
const hasBaseline = existsSync(baselineDir);

function distPath(...segments) {
    return path.join(distDir, ...segments);
}

function readDist(...segments) {
    return readFileSync(distPath(...segments), "utf8");
}

function htmlFilesUnderDist() {
    const root = readdirSync(distDir).filter((name) => name.endsWith(".html"));
    const projectDir = distDir + path.sep + "projects";
    const projectPages = existsSync(projectDir)
        ? readdirSync(projectDir).flatMap((slug) => {
              const file = path.join(projectDir, slug, "index.html");
              return existsSync(file) ? [file] : [];
          })
        : [];
    return { root, projectPages };
}

function metaContent(html, attribute, value) {
    const escaped = value.replace(/:/g, "\\:");
    const contentFirst = html.match(
        new RegExp(`<meta[^>]+${attribute}="${escaped}"[^>]+content="([^"]*)"`)
    );
    if (contentFirst) return contentFirst[1];
    const contentLast = html.match(
        new RegExp(`<meta[^>]+content="([^"]*)"[^>]+${attribute}="${escaped}"`)
    );
    return contentLast ? contentLast[1] : null;
}

// Minimal WebP container reader — same three chunk layouts the build accepts.
function readWebpSize(buffer) {
    if (buffer.length < 30) throw new Error("file too small to be a WebP image");
    if (buffer.subarray(0, 4).toString("ascii") !== "RIFF") {
        throw new Error("missing RIFF signature");
    }
    if (buffer.subarray(8, 12).toString("ascii") !== "WEBP") {
        throw new Error("missing WEBP signature");
    }
    const chunk = buffer.subarray(12, 16).toString("ascii");
    if (chunk === "VP8X") {
        return {
            width: 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)),
            height: 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)),
        };
    }
    if (chunk === "VP8L") {
        if (buffer[20] !== 0x2f) throw new Error("bad VP8L signature byte");
        const bits = buffer.readUInt32LE(21);
        return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (chunk === "VP8 ") {
        if (buffer.subarray(23, 26).toString("latin1") !== "\x9d\x01\x2a") {
            throw new Error("bad VP8 frame start code");
        }
        return {
            width: buffer.readUInt16LE(26) & 0x3fff,
            height: buffer.readUInt16LE(28) & 0x3fff,
        };
    }
    throw new Error(`unsupported WebP chunk "${chunk}"`);
}

function publicHtmlDocuments() {
    return [
        { label: "index.html", html: readDist("index.html") },
        ...PROJECT_SLUGS.map((slug) => ({
            label: `projects/${slug}/index.html`,
            html: readDist("projects", slug, "index.html"),
        })),
    ];
}

describe("build precondition", () => {
    it("dist/ exists (run `npm run build` first)", () => {
        expect(
            hasDist,
            "dist/ is missing — `npm run test:migration-validation` validates a " +
                "build. Run `npm run build` (with the backend up) and retry."
        ).toBe(true);
    });
});

describe("dist structure", () => {
    it("emits exactly the 5 project pages", () => {
        const { projectPages } = htmlFilesUnderDist();
        expect(projectPages).toHaveLength(5);
        for (const slug of PROJECT_SLUGS) {
            expect(existsSync(distPath("projects", slug, "index.html"))).toBe(true);
        }
    });

    it("emits index + admin + the public/*.html verification files, plus 5 project pages", () => {
        const { root, projectPages } = htmlFilesUnderDist();
        // Root-level HTML is exactly the two entries plus whatever static
        // HTML public/ ships (the Google site-verification file).
        const publicHtml = readdirSync(path.join(repoRoot, "public")).filter((name) =>
            name.endsWith(".html")
        );
        expect([...root].sort()).toEqual(
            ["admin.html", "index.html", ...publicHtml].sort()
        );
        expect(projectPages).toHaveLength(5);
        expect(root.length + projectPages.length).toBe(2 + publicHtml.length + 5);
    });

    it("emits all four discovery documents", () => {
        for (const file of ["sitemap.xml", "sitemap-images.xml", "robots.txt", "llms.txt"]) {
            expect(existsSync(distPath(file)), `${file} missing from dist/`).toBe(true);
        }
        expect(readDist("llms.txt")).not.toMatch(/railway\.app/i);
        expect(readDist("robots.txt")).toMatch(/^Disallow: \/api\/$/m);
    });

    it("copies the static public files, including humans.txt", () => {
        // These are authored in public/ and copied verbatim by `vite build`;
        // a missing one means a hand-maintained file was dropped from source or
        // excluded from the copy step.
        for (const file of [
            ["humans.txt"],
            ["site.webmanifest"],
            [".well-known", "security.txt"],
        ]) {
            expect(
                existsSync(distPath(...file)),
                `${file.join("/")} missing from dist/`
            ).toBe(true);
        }
        expect(readDist("humans.txt")).toMatch(/^\/\* TEAM \*\/$/m);
    });

    it("declares project-page image dimensions that match the real image", () => {
        for (const project of projects) {
            const html = readDist("projects", project.slug, "index.html");

            const width = metaContent(html, "property", "og:image:width");
            const height = metaContent(html, "property", "og:image:height");
            expect(width, `projects/${project.slug}: og:image:width missing`).toBeTruthy();
            expect(height, `projects/${project.slug}: og:image:height missing`).toBeTruthy();

            if (/^https?:\/\//i.test(project.image)) {
                // An uploaded image lives in object storage, so there is no local
                // file to read. The size the server measured at upload time is
                // carried on the project, and the emitted metadata must match it.
                expect(
                    { width: Number(width), height: Number(height) },
                    `projects/${project.slug}: declared size drifted from the stored image dimensions`
                ).toEqual({ width: project.image_width, height: project.image_height });
                continue;
            }

            const webp = readWebpSize(
                readFileSync(path.join(repoRoot, "public", project.image))
            );
            expect(
                { width: Number(width), height: Number(height) },
                `projects/${project.slug}: declared size drifted from ${project.image}`
            ).toEqual(webp);
        }
    });

    it("the homepage declares social metadata", () => {
        const html = readDist("index.html");
        expect(metaContent(html, "property", "og:title")).toBeTruthy();
        expect(metaContent(html, "property", "og:image")).toBeTruthy();
        expect(metaContent(html, "name", "description")).toBeTruthy();
    });

    it("contains no admin or private data in the public documents", () => {
        // admin.html is the admin entry itself and legitimately carries login
        // markup; the leak vector is the PUBLIC surface.
        const forbidden = [
            "/admin",
            "/api/admin",
            "portfolio_admin_session",
            "X-CSRF-Token",
            "admin@example",
            "RESEND_API_KEY",
            "DATABASE_URL",
            "BACKEND_API_KEY",
            "AI_SERVICE_KEY",
        ];

        for (const document of publicHtmlDocuments()) {
            for (const marker of forbidden) {
                expect(
                    document.html.includes(marker),
                    `${document.label} leaks "${marker}"`
                ).toBe(false);
            }
        }
    });

    it("public bundle carries no admin or router code (assert-admin-bundle)", () => {
        const stdout = execFileSync(
            process.execPath,
            [path.join(repoRoot, "scripts", "assert-admin-bundle.mjs")],
            { cwd: repoRoot, encoding: "utf8" }
        );
        expect(stdout).toMatch(/ok|pass|clean|no admin/i);
    });
});

// ---------------------------------------------------------------------------
// Baseline-dependent tier. .cache/baseline/ is gitignored (the oracle is a
// local capture), so a clone without it gets visible skips here — never a
// silent pass. This machine has the oracle; the full suite runs in
// `npm run test:migration-validation`.
// ---------------------------------------------------------------------------

describe.skipIf(!hasBaseline)("baseline parity", () => {
    it("verify-parity reports zero real differences (TESTING.md §10 checks 3–9)", () => {
        const stdout = execFileSync(
            process.execPath,
            [path.join(repoRoot, "scripts", "verify-parity.mjs")],
            { cwd: repoRoot, encoding: "utf8" }
        );
        expect(stdout).toMatch(/parity holds/);
        expect(stdout).not.toMatch(/DIFFERS/);
    });

    it("public gzipped bundle stays within baseline + 15 KB (check 12)", () => {
        const baseline = JSON.parse(
            readFileSync(path.join(baselineDir, "bundle-sizes.json"), "utf8")
        );
        const publicBaseline = baseline
            .filter((entry) => !entry.file.startsWith("assets/admin-"))
            .reduce((sum, entry) => sum + entry.gzipBytes, 0);

        const assetsDir = distPath("assets");
        const current = readdirSync(assetsDir)
            .filter((name) => /\.(js|css)$/.test(name) && !name.startsWith("admin-"))
            .map((name) =>
                gzipSync(readFileSync(path.join(assetsDir, name))).length
            )
            .reduce((sum, bytes) => sum + bytes, 0);

        expect(
            current,
            `public bundle grew beyond budget: ${current} > ${publicBaseline} + 15360`
        ).toBeLessThanOrEqual(publicBaseline + 15 * 1024);
    });

    it("project-page JSON-LD survives with the same @type, name and url (check 8)", () => {
        const baseline = JSON.parse(
            readFileSync(path.join(baselineDir, "seo.json"), "utf8")
        );

        for (const slug of PROJECT_SLUGS) {
            const html = readDist("projects", slug, "index.html");
            const jsonLdMatch = html.match(
                /<script type="application\/ld\+json">([\s\S]*?)<\/script>/
            );
            expect(jsonLdMatch, `projects/${slug}: JSON-LD missing`).toBeTruthy();

            const graph = JSON.parse(jsonLdMatch[1])["@graph"];
            const app = graph.find((node) => node["@type"] === "SoftwareApplication");
            expect(app, `projects/${slug}: SoftwareApplication missing`).toBeTruthy();

            const baselineEntry = baseline.find(
                (entry) => entry.url && entry.url.endsWith(`/projects/${slug}/`)
            );
            expect(baselineEntry, `baseline seo.json: projects/${slug} missing`).toBeDefined();

            const baselineGraph = (baselineEntry.jsonLd || [])
                .flatMap((entry) => entry["@graph"] || []);
            const baselineApp = baselineGraph.find(
                (node) => node["@type"] === "SoftwareApplication"
            );
            expect(baselineApp, `baseline JSON-LD for ${slug} missing`).toBeDefined();

            expect(app.name).toBe(baselineApp.name);
            expect(app.url).toBe(baselineApp.url);
            expect(app.description).toBe(baselineApp.description);
        }
    });
});

describe.skipIf(!hasBaseline)("baseline presence", () => {
    it("the regression oracle is captured on this machine", () => {
        for (const file of [
            "home.html",
            "sitemap.xml",
            "robots.txt",
            "llms.txt",
            "seo.json",
            "bundle-sizes.json",
        ]) {
            expect(existsSync(path.join(baselineDir, file)), file).toBe(true);
        }
        expect(statSync(baselineDir).isDirectory()).toBe(true);
    });
});
