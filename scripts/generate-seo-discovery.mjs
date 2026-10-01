// =========================================================
// 🔍 SEO DISCOVERY GENERATOR
// =========================================================
// Runs as the last step of `npm run build`, after the SPA build and
// the project-page prerender, and writes four files into dist/:
//
//   dist/sitemap.xml
//   dist/sitemap-images.xml
//   dist/robots.txt
//   dist/llms.txt
//
// Everything it emits is derived from src/data/projects.js,
// src/data/profile.js and src/config/seo.js via the compiled
// prerender bundle, so adding a project to projects.js needs no edit
// here and no hand-editing of any generated file. No slug is
// hardcoded in this script or in scripts/seo/discovery.mjs.
//
// ARCHITECTURE (why dist-only)
// ---------------------------
// These four files are build output, not source. Vite already copies
// public/ into dist/ during `vite build`, so hand-maintained copies
// in public/ would be duplicated inputs that silently drift from the
// generator — editing one and rebuilding would discard the edit with
// no warning. The hand-authored public/ copies were therefore removed
// and these files now exist only in dist/, written fresh on every
// build. Nothing in production changes shape: the four paths
// (/sitemap.xml, /sitemap-images.xml, /robots.txt, /llms.txt) are
// served exactly as before, and Vercel's existing header rules for
// /sitemap.xml, /robots.txt and /llms.txt still match.
//
// VALIDATION
// ----------
// The generated files are validated before the build is allowed to
// succeed: XML well-formedness, absolute https URLs, no fragments, no
// duplicates, no forbidden paths, robots rules intact, and llms.txt
// agreeing with the project data. Each generated URL is also checked
// against the real file in dist/, so the sitemap can never advertise
// a page or image that the build did not produce.
// =========================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
    buildImageSitemapXml,
    buildLlmsTxt,
    buildRobotsTxt,
    buildSitemapXml,
    findLlmsProblems,
    findRobotsProblems,
    findSitemapUrlProblems,
    resolveDiscoveryInputs,
} from "./seo/discovery.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const distDir = path.join(rootDir, "dist");
const prerenderDir = path.join(rootDir, ".prerender");
const entryPath = path.join(prerenderDir, "entry.mjs");

const LABEL = "[discovery]";

function fail(message) {
    console.error(`\n${LABEL} FAILED: ${message}\n`);
    process.exit(1);
}



// =========================================================
// INPUTS
// =========================================================

if (!fs.existsSync(entryPath)) {
    fail(
        "prerender bundle is missing — run " +
        "`vite build --config vite.prerender.config.js` first."
    );
}

// One compiled view of the data, shared with the project-page
// generator: URLs here are produced by the same helpers that wrote
// the canonical tags on the pages themselves.
const {
    SITE_URL,
    absoluteUrl,
    projectPageUrl,
    projects,
    profile,
    seo,
} = await import(pathToFileURL(entryPath).href);

if (!fs.existsSync(path.join(distDir, "index.html"))) {
    fail("dist/index.html is missing — run `vite build` first.");
}

// Distinguishing the two sitemaps in robots.txt and llms.txt.
const sitemaps = [
    `${SITE_URL}/sitemap.xml`,
    `${SITE_URL}/sitemap-images.xml`,
];

// lastmod for the two non-project URLs is carried over verbatim from
// the sitemap that was already published. There is no trustworthy
// machine-readable "last modified" value for a static homepage or a
// hand-uploaded PDF, and a build-clock or git-commit substitute would
// be a fabricated date, so the published values are preserved rather
// than regenerated. Projects use only their own `updatedAt` field,
// which is null for all five today, so no project emits a lastmod.
const publishedHomepageLastmod = "2026-08-12";
const publishedResumeLastmod = "2026-08-12";

const inputs = resolveDiscoveryInputs({
    projects,
    siteUrl: SITE_URL,
    homepageUrl: `${SITE_URL}/`,
    resumeUrl: profile.resume,
    siteImageUrl: seo.image,
    robotsUrl: `${SITE_URL}/robots.txt`,
    sitemaps,
    resume: profile,
    seoConfig: seo,
    toAbsoluteUrl: absoluteUrl,
    toProjectUrl: projectPageUrl,
});

// Attach the preserved lastmod values to the two static entries only.
inputs.sitemapUrls[0].lastmod = publishedHomepageLastmod;
inputs.sitemapUrls[1].lastmod = publishedResumeLastmod;



// =========================================================
// BUILD
// =========================================================

const sitemapXml = buildSitemapXml({ urls: inputs.sitemapUrls });
const imageSitemapXml = buildImageSitemapXml({ entries: inputs.imageEntries });
const robotsTxt = buildRobotsTxt({ sitemaps });
const llmsTxt = buildLlmsTxt({
    identity: inputs.identity,
    projects: inputs.llmsProjects,
    resumeUrl: inputs.resumeUrl,
    sitemaps,
});

const outputs = [
    { name: "sitemap.xml", contents: sitemapXml },
    { name: "sitemap-images.xml", contents: imageSitemapXml },
    { name: "robots.txt", contents: robotsTxt },
    { name: "llms.txt", contents: llmsTxt },
];

for (const output of outputs) {
    fs.writeFileSync(path.join(distDir, output.name), output.contents, "utf8");
}



// =========================================================
// VALIDATION
// =========================================================

const problems = [];

// Patterns a discovery file must never contain: internal API routes,
// the discovery files themselves, and non-page asset URLs.
const forbiddenPatterns = [
    { label: "an /api/ route", re: /\/api\//i },
    { label: "robots.txt", re: /\/robots\.txt$/i },
    { label: "sitemap.xml", re: /\/sitemap\.xml$/i },
    { label: "sitemap-images.xml", re: /\/sitemap-images\.xml$/i },
    { label: "llms.txt", re: /\/llms\.txt$/i },
    { label: "a favicon", re: /favicon/i },
    { label: "a hashed JS/CSS asset", re: /\/assets\/.*-[A-Za-z0-9_-]{8,}\.(js|css)/i },
    { label: "a bare image URL", re: /\.(png|jpe?g|webp|svg|ico|gif)$/i },
    { label: "a fragment", re: /#/ },
];

for (const problem of findSitemapUrlProblems(sitemapXml)) {
    problems.push(`sitemap.xml: ${problem}`);
}

for (const problem of findSitemapUrlProblems(imageSitemapXml)) {
    problems.push(`sitemap-images.xml: ${problem}`);
}

// The image sitemap legitimately carries image URLs as <image:loc>,
// so only the page-level rules apply to it.
for (const entry of inputs.imageEntries) {
    for (const pattern of forbiddenPatterns) {
        if (pattern.re.test(entry.loc)) {
            problems.push(
                `sitemap-images.xml: page URL ${entry.loc} is ${pattern.label}`
            );
        }
    }
}

for (const problem of findRobotsProblems(robotsTxt, { sitemaps })) {
    problems.push(`robots.txt: ${problem}`);
}

for (const problem of findLlmsProblems(llmsTxt, {
    projects: inputs.llmsProjects,
    sitemaps,
    allowedUrls: [
        inputs.identity.homepageUrl,
        inputs.identity.robotsUrl,
        inputs.identity.github,
        inputs.identity.linkedin,
        inputs.resumeUrl,
    ],
})) {
    problems.push(`llms.txt: ${problem}`);
}

// Every URL in the sitemaps must correspond to a file this build
// actually produced. This is what stops a sitemap advertising a page
// or image that 404s.
for (const entry of inputs.sitemapUrls) {
    if (entry.loc === inputs.identity.homepageUrl) continue;

    const relative = absoluteUrlToDistPath(entry.loc);

    if (!fs.existsSync(relative)) {
        problems.push(`sitemap.xml: ${entry.loc} has no file in dist/`);
    }
}

for (const entry of inputs.imageEntries) {
    for (const image of entry.images) {
        const relative = absoluteUrlToDistPath(image);

        if (!fs.existsSync(relative)) {
            problems.push(`sitemap-images.xml: ${image} has no file in dist/`);
        }
    }
}

// A project page must exist for every project the sitemaps list, and
// must not exist for one that is excluded.
for (const project of inputs.selected) {
    const page = path.join(
        distDir,
        "projects",
        project.slug,
        "index.html"
    );

    if (!fs.existsSync(page)) {
        problems.push(
            `project "${project.slug}" is listed in discovery files but ` +
            "no page was generated for it"
        );
    }
}

const excluded = projects.filter((project) => project.indexable === false);

for (const project of excluded) {
    const page = path.join(
        distDir,
        "projects",
        project.slug,
        "index.html"
    );

    if (fs.existsSync(page)) {
        problems.push(
            `project "${project.slug}" is non-indexable but a page was ` +
            "generated and would be advertised"
        );
    }
}

// The excluded projects' URLs must not appear anywhere in discovery.
for (const project of excluded) {
    const url = projectPageUrl(project.slug);

    for (const output of outputs) {
        if (output.contents.includes(url)) {
            problems.push(
                `${output.name} references non-indexable project: ${url}`
            );
        }
    }
}

// Confirm the project data really is the only source: a slug that
// appears in no *selected* project must never reach a generated file.
//
// This iterates `inputs.selected` — the very collection
// resolveDiscoveryInputs() used to BUILD the discovery files — not
// the raw `projects` array. Iterating the raw array would demand a
// URL for projects deliberately excluded by `indexable: false`,
// contradicting the exclusion assertions above, and would break the
// build for a project that was correctly left out of every file.
for (const output of outputs) {
    for (const project of inputs.selected) {
        const marker = `/projects/${project.slug}/`;

        const expectedInSitemap =
            output.name === "sitemap.xml" ||
            output.name === "sitemap-images.xml" ||
            output.name === "llms.txt";

        if (!expectedInSitemap) continue;

        if (!output.contents.includes(marker)) {
            problems.push(
                `${output.name} is missing the project URL for ` +
                `"${project.slug}" (${marker})`
            );
        }
    }
}

function absoluteUrlToDistPath(url) {
    if (!url.startsWith(`${SITE_URL}/`)) {
        return null;
    }

    return path.join(distDir, url.slice(SITE_URL.length + 1));
}



// =========================================================
// REPORT
// =========================================================

if (problems.length > 0) {
    problems.forEach((problem) => console.error(`  - ${problem}`));
    fail(`${problems.length} problem(s) found in the generated discovery files.`);
}

const urlCount = (xml) => (xml.match(/<loc>/g) || []).length;
const imageCount = (xml) => (xml.match(/<image:loc>/g) || []).length;
const lastmodCount = (xml) => (xml.match(/<lastmod>/g) || []).length;

for (const output of outputs) {
    console.log(
        `${LABEL} ${output.name.padEnd(20)} ` +
        `${String(Buffer.byteLength(output.contents)).padStart(6)} B`
    );
}

console.log(
    `${LABEL} sitemap.xml          ${inputs.sitemapUrls.length} URLs, ` +
    `${lastmodCount(sitemapXml)} lastmod (2 preserved, ` +
    `${inputs.selected.length} projects with null updatedAt)`
);
console.log(
    `${LABEL} sitemap-images.xml  ${urlCount(imageSitemapXml)} pages, ` +
    `${imageCount(imageSitemapXml)} images`
);
console.log(`${LABEL} robots.txt          ${sitemaps.length} sitemap references`);

if (excluded.length > 0) {
    console.log(
        `${LABEL} excluded ${excluded.length} non-indexable project(s): ` +
        excluded.map((project) => project.slug).join(", ")
    );
}

console.log(`${LABEL} done — 4 discovery file(s) written to dist/\n`);