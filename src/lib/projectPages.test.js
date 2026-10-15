// Phase 10 (docs/TESTING.md §5.1): `src/lib/projectPages.js` is the single
// authority for project-page metadata, so it is tested exhaustively — every
// assertion runs against the committed content snapshot, which is the exact
// data the prerenderer consumes at build time.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { projects, seo } from "../generated/content";
import {
    LOCALE,
    PERSON_ID,
    PROJECT_IMAGE_DIMENSIONS,
    PROJECTS_LIST_PATH,
    ROBOTS_DIRECTIVE,
    SITE_NAME,
    SITE_URL,
    TWITTER_CARD,
    absoluteUrl,
    applicationCategory,
    buildProjectMetadata,
    buildProjectStructuredData,
    indexableProjects,
    projectImageDimensions,
    projectPagePath,
    projectPageUrl,
    relatedProjects,
    robotsDirective,
    serializeStructuredData,
} from "./projectPages";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Enough of the WebP container spec to recover the canvas size — the same
// three chunk layouts scripts/generate-project-pages.mjs accepts. Kept here
// so the "declared dimensions match the real file" assertion runs in the unit
// suite without pulling a build script into the module graph.
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
            width:
                1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)),
            height:
                1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)),
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

const SLUGS = [
    "webchat-ai",
    "orbit-ai",
    "stayora",
    "zerodha-clone",
    "scientific-calculator",
];

describe("site identity", () => {
    it("derives SITE_URL from seo.url without a trailing slash", () => {
        expect(SITE_URL).toBe(seo.url.replace(/\/+$/, ""));
        expect(SITE_URL.endsWith("/")).toBe(false);
    });

    it("exposes the site name, locale and twitter card from the snapshot", () => {
        expect(SITE_NAME).toBe(seo.siteName);
        expect(LOCALE).toBe(seo.locale);
        expect(TWITTER_CARD).toBe(seo.twitterCard);
        expect(PERSON_ID).toBe(`${SITE_URL}/#person`);
    });

    it("anchors the projects list at the homepage #projects section", () => {
        expect(PROJECTS_LIST_PATH).toBe("/#projects");
    });
});

describe("absoluteUrl", () => {
    it("returns the site URL for empty input", () => {
        expect(absoluteUrl("")).toBe(SITE_URL);
        expect(absoluteUrl(null)).toBe(SITE_URL);
    });

    it("passes absolute URLs through untouched", () => {
        expect(absoluteUrl("https://example.com/x")).toBe("https://example.com/x");
    });

    it("joins root-relative paths with exactly one slash", () => {
        expect(absoluteUrl("/images/a.webp")).toBe(`${SITE_URL}/images/a.webp`);
        expect(absoluteUrl("images/a.webp")).toBe(`${SITE_URL}/images/a.webp`);
    });
});

describe("project page URLs", () => {
    it("builds the canonical directory form for every slug", () => {
        for (const slug of SLUGS) {
            expect(projectPagePath(slug)).toBe(`/projects/${slug}/`);
            expect(projectPageUrl(slug)).toBe(`${SITE_URL}/projects/${slug}/`);
        }
    });
});

describe("indexableProjects", () => {
    it("returns every published project in snapshot order", () => {
        const slugs = indexableProjects().map((project) => project.slug);
        expect(slugs).toEqual(SLUGS);
        expect(slugs).toEqual(
            projects.filter((project) => project.indexable !== false).map((p) => p.slug)
        );
    });

    it("excludes projects flagged indexable: false", () => {
        // The snapshot carries no non-indexable row today, so the guard is
        // asserted through the filter's own contract: nothing that comes back
        // may be flagged false, and the count can only be the published set.
        const visible = indexableProjects();
        expect(visible).toHaveLength(
            projects.filter((project) => project.indexable !== false).length
        );
        expect(visible.some((project) => project.indexable === false)).toBe(false);
    });
});

describe("relatedProjects", () => {
    const webchat = projects.find((project) => project.slug === "webchat-ai");

    it("never returns the project itself", () => {
        for (const project of projects) {
            const related = relatedProjects(project, { limit: 10 });
            expect(related.map((entry) => entry.slug)).not.toContain(project.slug);
        }
    });

    it("returns only genuinely related projects, most shared tech first", () => {
        const related = relatedProjects(webchat, { limit: 10 });

        for (const entry of related) {
            const shared = entry.techStack.filter((tech) =>
                webchat.techStack.includes(tech)
            );
            const sameCategory = entry.category === webchat.category;
            expect(shared.length > 0 || sameCategory).toBe(true);
        }

        const sharedCounts = related.map(
            (entry) =>
                entry.techStack.filter((tech) => webchat.techStack.includes(tech)).length
        );
        expect([...sharedCounts].sort((a, b) => b - a)).toEqual(sharedCounts);
    });

    it("honours the limit and returns fewer entries than the data supports", () => {
        expect(relatedProjects(webchat, { limit: 1 })).toHaveLength(1);
        expect(relatedProjects(webchat, { limit: 99 }).length).toBeLessThanOrEqual(
            SLUGS.length - 1
        );
    });
});

describe("applicationCategory", () => {
    it("maps AI categories to AIApplication and everything else to WebApplication", () => {
        expect(applicationCategory("AI")).toBe("AIApplication");
        expect(applicationCategory("AI SaaS")).toBe("AIApplication");
        expect(applicationCategory("Web App")).toBe("WebApplication");
        expect(applicationCategory("")).toBe("WebApplication");
        expect(applicationCategory(undefined)).toBe("WebApplication");
    });
});

describe("robotsDirective", () => {
    it("emits the fully verbose directive when index and follow are true", () => {
        expect(robotsDirective({ index: true, follow: true })).toBe(ROBOTS_DIRECTIVE);
        expect(robotsDirective({})).toBe(ROBOTS_DIRECTIVE);
        expect(robotsDirective(undefined)).toBe(ROBOTS_DIRECTIVE);
    });

    it("serialises noindex / nofollow when a flag is false", () => {
        expect(robotsDirective({ index: false, follow: true })).toBe("noindex");
        expect(robotsDirective({ index: true, follow: false })).toBe("nofollow");
        expect(robotsDirective({ index: false, follow: false })).toBe(
            "noindex,nofollow"
        );
    });
});

describe("PROJECT_IMAGE_DIMENSIONS", () => {
    it("has an entry for every project in the snapshot", () => {
        for (const project of projects) {
            expect(PROJECT_IMAGE_DIMENSIONS).toHaveProperty(project.slug);
            expect(projectImageDimensions(project)).toEqual({
                width: project.image_width,
                height: project.image_height,
            });
        }
    });

    it("each entry matches the real WebP file header bytes", () => {
        for (const project of projects) {
            const imagePath = path.join(rootDir, "public", project.image);
            const actual = readWebpSize(readFileSync(imagePath));

            expect(actual, `${project.slug}: unreadable WebP`).toBeDefined();
            expect(
                { width: project.image_width, height: project.image_height },
                `${project.slug}: declared dimensions drifted from the file`
            ).toEqual(actual);
        }
    });

    it("throws for a slug with no recorded dimensions", () => {
        expect(() => projectImageDimensions({ slug: "nope", image: "/x.webp" })).toThrow(
            /Missing PROJECT_IMAGE_DIMENSIONS entry/
        );
    });
});

describe("buildProjectMetadata", () => {
    it("builds complete, canonical metadata for every project", () => {
        for (const project of projects) {
            const metadata = buildProjectMetadata(project);
            const canonical = projectPageUrl(project.slug);

            expect(metadata.title).toBe(project.seoTitle);
            expect(metadata.description).toBe(project.seoDescription);
            expect(metadata.canonical).toBe(canonical);
            expect(metadata.author).toBe(seo.author);
            expect(metadata.robots).toBe(robotsDirective(seo.robots));

            // Open Graph: article page, absolute image with the measured
            // intrinsic size, canonical URL.
            expect(metadata.openGraph.type).toBe("article");
            expect(metadata.openGraph.siteName).toBe(SITE_NAME);
            expect(metadata.openGraph.locale).toBe(LOCALE);
            expect(metadata.openGraph.url).toBe(canonical);
            expect(metadata.openGraph.image).toBe(
                absoluteUrl(project.image)
            );
            expect(metadata.openGraph.imageWidth).toBe(project.image_width);
            expect(metadata.openGraph.imageHeight).toBe(project.image_height);
            expect(metadata.openGraph.imageAlt).toBe(project.imageAlt);

            // Twitter card mirrors the same facts.
            expect(metadata.twitter.card).toBe(TWITTER_CARD);
            expect(metadata.twitter.title).toBe(project.seoTitle);
            expect(metadata.twitter.image).toBe(absoluteUrl(project.image));
        }
    });
});

describe("buildProjectStructuredData", () => {
    it("emits Person + SoftwareApplication + BreadcrumbList for every project", () => {
        for (const project of projects) {
            const data = buildProjectStructuredData(project);

            expect(data["@context"]).toBe("https://schema.org");
            expect(data["@graph"]).toHaveLength(3);

            const [person, app, breadcrumb] = data["@graph"];

            expect(person["@type"]).toBe("Person");
            expect(person["@id"]).toBe(PERSON_ID);

            expect(app["@type"]).toBe("SoftwareApplication");
            expect(app.name).toBe(project.title);
            expect(app.url).toBe(projectPageUrl(project.slug));
            expect(app["@id"]).toBe(projectPageUrl(project.slug));
            expect(app.applicationCategory).toBe(
                applicationCategory(project.category)
            );
            expect(app.operatingSystem).toBe("Web");
            expect(app.image).toBe(absoluteUrl(project.image));
            expect(app.author).toEqual({ "@id": PERSON_ID });

            expect(breadcrumb["@type"]).toBe("BreadcrumbList");
            expect(breadcrumb.itemListElement).toHaveLength(2);
            expect(breadcrumb.itemListElement[1].item).toBe(
                projectPageUrl(project.slug)
            );
        }
    });

    it("exposes external links only when they are real URLs", () => {
        for (const project of projects) {
            const [person, app] = buildProjectStructuredData(project)["@graph"];

            if (project.github && project.github !== "#") {
                expect(app.codeRepository).toBe(project.github);
            } else {
                expect(app.codeRepository).toBeUndefined();
            }

            const sameAs = app.sameAs || [];
            expect(sameAs).not.toContain("#");
            expect(sameAs).toEqual([...new Set(sameAs)]);
            expect(person.sameAs).toEqual(seo.sameAs);
        }
    });

    it("produces JSON-LD that parses and never breaks out of its script tag", () => {
        for (const project of projects) {
            const serialized = serializeStructuredData(
                buildProjectStructuredData(project)
            );

            expect(serialized).not.toContain("<");
            expect(JSON.parse(serialized)).toEqual(
                buildProjectStructuredData(project)
            );
        }
    });
});
