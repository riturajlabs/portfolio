// FE-18 (docs/PORTFOLIO_UPGRADE.md: the homepage static JSON-LD/meta
// baseline in `index.html` hand-duplicates the runtime CMS `seo` payload,
// which is the classic source of metadata drift).
//
// The authoritative runtime value is `seo` from
// `src/generated/content.js` — the same object `<SEO />`
// (src/components/common/SEO.jsx) renders through react-helmet-async and
// the same one `src/lib/projectPages.js` uses for the prerendered project
// pages. `index.html` carries a JS-free static baseline for crawlers that
// do not execute JavaScript.
//
// Nothing currently asserts that the two agree: the migration-validation
// suite only checks that the static tags EXIST (tests/migration-
// validation.test.mjs "the homepage declares social metadata"), never that
// their values match the CMS. This suite closes that gap. It reads the
// source `index.html` (not `dist/`), so it runs in the default `npm test`
// pass with no build precondition.
//
// Only genuinely irrelevant formatting is normalised: surrounding
// whitespace in <title>, HTML entity decoding, and attribute order inside
// a tag. Every value that a crawler actually consumes is compared
// literally, so a real divergence between `index.html` and the CMS `seo`
// payload fails the test.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { seo } from "../src/generated/content.js";
import { robotsDirective } from "../src/lib/projectPages.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const homepageHtml = readFileSync(path.join(repoRoot, "index.html"), "utf8");

// ---------------------------------------------------------------------------
// Minimal, dependency-free HTML head parsing. The document is hand-written
// and well-formed, so a tag scanner is sufficient and keeps the test honest
// about exactly what it matches (no DOM normalisation hiding a mismatch).
// ---------------------------------------------------------------------------

const HTML_ENTITIES = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
};

function decodeEntities(value) {
    return value.replace(/&(?:amp|lt|gt|quot|#39|apos);/g, (entity) => HTML_ENTITIES[entity]);
}

/** Parse the attributes of a single start tag into a plain object. */
function parseAttributes(tag) {
    const attributes = {};
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g;
    let match;
    while ((match = re.exec(tag))) {
        attributes[match[1].toLowerCase()] = decodeEntities(match[2]);
    }
    return attributes;
}

function allTags(source, tagName) {
    return source.match(new RegExp(`<${tagName}\\b[^>]*>`, "gi")) || [];
}

/**
 * Every <meta> tag, grouped by (name|property) → array of contents in
 * document order. Grouping (rather than a last-wins `Map.set`) keeps
 * duplicate tags visible: a key that appears twice is a real SEO defect
 * (crawlers disagree on which value wins), so `metaContent` below fails
 * loudly on duplicates instead of hiding them behind an overwrite.
 */
function metaGroups(source) {
    const groups = new Map();
    for (const tag of allTags(source, "meta")) {
        const attributes = parseAttributes(tag);
        const key = attributes.name
            ? `name:${attributes.name.toLowerCase()}`
            : attributes.property
              ? `property:${attributes.property.toLowerCase()}`
              : null;
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(attributes.content);
    }
    return groups;
}

/**
 * Content of a single `<meta>` key. Throws if the key occurs more than
 * once so a duplicate tag fails the test instead of being silently
 * collapsed to the last occurrence.
 */
function metaContent(groups, key) {
    const values = groups.get(key);
    if (!values) return undefined;
    expect(
        values.length,
        `static index.html declares <meta ${key.replace(":", '="')}..."> ${values.length} times (duplicate metadata)`
    ).toBe(1);
    return values[0];
}

function linkHref(source, rel) {
    for (const tag of allTags(source, "link")) {
        const attributes = parseAttributes(tag);
        if ((attributes.rel || "").toLowerCase() === rel) return attributes.href;
    }
    return null;
}

function titleText(source) {
    const match = /<title>([\s\S]*?)<\/title>/i.exec(source);
    return match ? decodeEntities(match[1]).trim() : null;
}

/** All application/ld+json blocks parsed into objects. */
function structuredDataBlocks(source) {
    const blocks = [];
    const re =
        /<script\b[^>]*type\s*=\s*"application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = re.exec(source))) {
        blocks.push(JSON.parse(match[1]));
    }
    return blocks;
}

const homepageMeta = metaGroups(homepageHtml);

// ---------------------------------------------------------------------------
// Expected runtime values — derived from the CMS `seo` payload using the
// exact helpers/components the runtime uses, so the static baseline is
// compared against what the app would actually emit.
// ---------------------------------------------------------------------------

describe("FE-18 homepage SEO parity (static index.html ↔ CMS seo)", () => {
    it("the static <title> matches the CMS seo title", () => {
        expect(titleText(homepageHtml)).toBe(seo.title);
    });

    it("primary meta tags match the CMS seo payload", () => {
        expect(metaContent(homepageMeta, "name:description")).toBe(seo.description);
        expect(metaContent(homepageMeta, "name:author")).toBe(seo.author);
    });

    it("the static keywords carry exactly the CMS seo keywords", () => {
        // A `keywords` meta is a comma-separated keyword set: membership is
        // what a crawler consumes, ordering is not semantically meaningful.
        // So the set is compared exactly and the order is intentionally not
        // asserted here. Observed FE-18 finding, recorded for the U8 report
        // (not fixed — fixing would change page output): the two lists
        // contain the same keywords but order them differently —
        // `"Software Developer Internship"` is the 15th keyword in the CMS
        // payload and the last in the static baseline. Any added, dropped or
        // renamed keyword still fails this test.
        const staticKeywords = (metaContent(homepageMeta, "name:keywords") || "")
            .split(",")
            .map((keyword) => keyword.trim())
            .filter(Boolean);

        expect(new Set(staticKeywords)).toEqual(new Set(seo.keywords));
        expect(staticKeywords).toHaveLength(seo.keywords.length);
    });

    it("the static robots directive matches the runtime robots directive", () => {
        // The runtime <SEO /> serialises `seo.robots` via robotsDirective()
        // (src/components/common/SEO.jsx), the same helper the project-page
        // prerenderer uses (src/lib/projectPages.js buildProjectMetadata).
        // Comparing against robotsDirective(seo.robots) — not the static
        // ROBOTS_DIRECTIVE constant — means a CMS flip such as
        // `seo.robots.index = false` (which would emit "noindex") fails this
        // test while index.html still advertises "index,follow,...".
        expect(metaContent(homepageMeta, "name:robots")).toBe(
            robotsDirective(seo.robots)
        );
    });

    it("the static canonical link matches the CMS seo URL", () => {
        expect(linkHref(homepageHtml, "canonical")).toBe(seo.url);
    });

    it("Open Graph tags match the CMS seo payload", () => {
        expect(metaContent(homepageMeta, "property:og:type")).toBe(seo.type);
        expect(metaContent(homepageMeta, "property:og:site_name")).toBe(seo.siteName);
        expect(metaContent(homepageMeta, "property:og:title")).toBe(seo.title);
        expect(metaContent(homepageMeta, "property:og:description")).toBe(seo.description);
        expect(metaContent(homepageMeta, "property:og:url")).toBe(seo.url);
        expect(metaContent(homepageMeta, "property:og:image")).toBe(seo.image);
        expect(metaContent(homepageMeta, "property:og:image:alt")).toBe(seo.imageAlt);
        expect(metaContent(homepageMeta, "property:og:locale")).toBe(seo.locale);
    });

    it("Twitter card tags match the CMS seo payload", () => {
        expect(metaContent(homepageMeta, "name:twitter:card")).toBe(seo.twitterCard);
        expect(metaContent(homepageMeta, "name:twitter:title")).toBe(seo.title);
        expect(metaContent(homepageMeta, "name:twitter:description")).toBe(seo.description);
        expect(metaContent(homepageMeta, "name:twitter:image")).toBe(seo.image);
        expect(metaContent(homepageMeta, "name:twitter:image:alt")).toBe(seo.imageAlt);
    });

    it("the static JSON-LD @graph carries Person + WebSite consistent with the CMS seo payload", () => {
        const blocks = structuredDataBlocks(homepageHtml);
        expect(blocks.length).toBeGreaterThan(0);

        const graph = blocks.flatMap((entry) => entry["@graph"] || [entry]);
        const person = graph.find((node) => node["@type"] === "Person");
        const website = graph.find((node) => node["@type"] === "WebSite");

        expect(person, "static index.html is missing the Person node").toBeTruthy();
        expect(website, "static index.html is missing the WebSite node").toBeTruthy();

        const personId = `${seo.url}#person`;

        // Person — identity + author facts the CMS owns.
        expect(person["@id"]).toBe(personId);
        expect(person.name).toBe(seo.person.name);
        expect(person.alternateName).toBe(seo.person.alternateName);
        expect(person.url).toBe(seo.url);
        expect(person.image).toBe(seo.image);
        expect(person.jobTitle).toBe(seo.person.jobTitle);
        expect(person.description).toBe(seo.description);
        expect(person.email).toBe(`mailto:${seo.person.email}`);
        expect(person.nationality).toBe(seo.person.nationality);
        expect(person.knowsAbout).toEqual(seo.person.knowsAbout);
        expect(person.sameAs).toEqual(seo.sameAs);
        expect(person.hasCredential?.name).toBe(seo.person.credential);

        // WebSite — site identity pointing back at the Person node.
        expect(website["@id"]).toBe(`${seo.url}#website`);
        expect(website.url).toBe(seo.url);
        expect(website.name).toBe(seo.siteName);
        expect(website.description).toBe(seo.description);
        expect(website.publisher?.["@id"]).toBe(personId);
    });
});

// ---------------------------------------------------------------------------
// Regression guards for the two FE-18 hardening fixes. These operate on
// synthetic HTML through the same public helpers the parity assertions use,
// so they prove the guards are load-bearing independently of the current
// index.html contents.
// ---------------------------------------------------------------------------

describe("FE-18 parity guard — robots mismatch is rejected", () => {
    it("fails when seo.robots.index is false but the static baseline still says index,follow", () => {
        // The static baseline is unchanged from index.html (index,follow,...),
        // but the CMS payload has been flipped to noindex. The parity
        // assertion compares the static value against robotsDirective(seo.robots),
        // so it must NOT match.
        const staticRobots = robotsDirective({ index: true, follow: true });
        const mutated = { ...seo.robots, index: false };

        expect(robotsDirective(mutated)).toBe("noindex");
        expect(staticRobots).not.toBe(robotsDirective(mutated));
    });
});

describe("FE-18 parity guard — duplicate metadata is rejected", () => {
    it("fails when a validated meta key appears more than once", () => {
        const duplicated = `<html><head>
            <meta name="robots" content="index,follow">
            <meta name="robots" content="noindex">
        </head></html>`;
        const groups = metaGroups(duplicated);

        expect(() => metaContent(groups, "name:robots")).toThrow();
    });

    it("returns the single content when a validated meta key is unique", () => {
        const unique = `<html><head>
            <meta name="robots" content="index,follow">
        </head></html>`;
        const groups = metaGroups(unique);

        expect(metaContent(groups, "name:robots")).toBe("index,follow");
    });
});
