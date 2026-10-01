// =========================================================
// 📄 PROJECT PAGE SEO — SINGLE SOURCE OF TRUTH
// =========================================================
// Every piece of metadata and structured data for the static
// `/projects/<slug>/` documents is produced HERE, and only
// here. The build-time prerenderer (`scripts/prerender/`) is
// the only consumer, so there is exactly one authoritative
// project-page metadata path — no second implementation can
// drift away from this one.
//
// Canonical URLs are DERIVED from the site URL + slug. There is
// deliberately no `canonicalUrl` field on the project objects:
// a hand-maintained canonical is the classic source of
// duplicate-content bugs, so it is computed instead.
//
// Everything below reads only from `src/config/seo.js` and
// `src/data/projects.js`. No project fact is invented here.
// =========================================================

import seo from "../config/seo";
import projects from "../data/projects";



// =========================================================
// SITE IDENTITY
// =========================================================

// `seo.url` is the canonical origin + trailing slash. Strip the
// slash once so joins never produce a double slash.
export const SITE_URL = seo.url.replace(/\/+$/, "");

export const SITE_NAME = seo.siteName;

export const LOCALE = seo.locale;

export const TWITTER_CARD = seo.twitterCard;

// The Person node is emitted by index.html with this @id, so
// project pages reference the author by the same identifier
// instead of inventing a second author identity.
export const PERSON_ID = `${SITE_URL}/#person`;



// =========================================================
// URL HELPERS
// =========================================================

/**
 * Turn a root-relative path into an absolute URL.
 * Absolute URLs are required by Open Graph, Twitter cards and
 * JSON-LD `image`/`url`, all of which must survive being read
 * outside the site (social scrapers, crawlers).
 */
export function absoluteUrl(path) {
    if (!path) return SITE_URL;

    if (/^https?:\/\//i.test(path)) return path;

    return `${SITE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

/**
 * Canonical path for one project page.
 *
 * The trailing slash is deliberate. Each page is a real
 * `projects/<slug>/index.html` directory index, so the
 * slash-terminated form is the one that reliably returns 200 as this
 * page. Requesting the form without the slash is ambiguous on a plain
 * static host: it can 308-redirect to the directory, or — as
 * `vite preview` does locally — fall through to the SPA shell and
 * return the homepage at 200. Canonicalising on the directory form is
 * correct in the first case and still points at the right page in the
 * second, so no host behaviour can turn the canonical into a redirect.
 */
export function projectPagePath(slug) {
    return `/projects/${slug}/`;
}

export function projectPageUrl(slug) {
    return absoluteUrl(projectPagePath(slug));
}

// The portfolio keeps its projects inside the single-page
// homepage under `#projects`; there is no separate /projects
// index page, so this anchor is the real list destination.
export const PROJECTS_LIST_PATH = "/#projects";



// =========================================================
// IMAGE DIMENSIONS
// =========================================================
// Measured during Phase B from the genuine WebP files in
// `public/images/projects/`. They are declared here so the
// prerendered <img> can emit width/height (which reserves layout
// space and avoids CLS) without shipping an image decoder.
//
// Every value is cross-checked at build time against the real
// file headers by scripts/generate-project-pages.mjs, so a
// mismatch fails the build instead of silently shipping a wrong
// intrinsic size.

export const PROJECT_IMAGE_DIMENSIONS = {
    "webchat-ai": { width: 1870, height: 896 },
    "orbit-ai": { width: 617, height: 322 },
    "stayora": { width: 512, height: 250 },
    "scientific-calculator": { width: 1437, height: 756 },
    "zerodha-clone": { width: 1863, height: 896 },
};

export function projectImageDimensions(project) {
    const dimensions = PROJECT_IMAGE_DIMENSIONS[project.slug];

    if (!dimensions) {
        throw new Error(
            `Missing PROJECT_IMAGE_DIMENSIONS entry for slug "${project.slug}". ` +
            `Add the measured intrinsic size of ${project.image}.`
        );
    }

    return dimensions;
}



// =========================================================
// PROJECT SELECTION
// =========================================================

/**
 * Projects that should get a public page.
 *
 * `indexable: false` projects are excluded from static output
 * entirely — they are neither emitted nor linked from a sitemap.
 * Nothing in the codebase acts on `indexable` yet beyond this
 * filter; no noindex behaviour is applied anywhere.
 */
export function indexableProjects() {
    return projects.filter((project) => project.indexable !== false);
}



// =========================================================
// RELATED PROJECTS
// =========================================================

/**
 * Projects genuinely related to `project`, most relevant first.
 *
 * Relevance is derived only from facts already in the data:
 *
 *   1. Shared technologies in `techStack` (ranked by how many match)
 *   2. An identical `category`
 *
 * A project is returned only if it shares at least one technology or
 * the exact same category. There is no popularity, recency or
 * hand-curated "related" list, because nothing in the repository
 * supports those — inventing a recommendation order would be
 * fabricating a relationship the data does not contain.
 *
 * Results are drawn from indexableProjects(), so a related-project
 * link can never point at a page the build does not emit, and a
 * project is never related to itself.
 *
 * Returns fewer than `limit` entries when the data does not support
 * more; it never pads the list with unrelated projects.
 */
export function relatedProjects(project, { limit = 3 } = {}) {
    const ownTech = new Set(project.techStack || []);

    return indexableProjects()
        .filter((candidate) => candidate.slug !== project.slug)
        .map((candidate) => ({
            project: candidate,
            sharedTech: (candidate.techStack || []).filter((tech) =>
                ownTech.has(tech)
            ),
            sameCategory:
                Boolean(project.category) &&
                candidate.category === project.category,
        }))
        .filter(
            (entry) => entry.sharedTech.length > 0 || entry.sameCategory
        )
        .sort(
            (a, b) =>
                b.sharedTech.length - a.sharedTech.length ||
                Number(b.sameCategory) - Number(a.sameCategory)
        )
        .slice(0, limit)
        .map((entry) => entry.project);
}



// =========================================================
// APPLICATION CATEGORY
// =========================================================
// Mirrors the mapping the homepage already uses in
// components/common/SEO.jsx (`category === "AI"` ->
// "AIApplication", otherwise "WebApplication"), extended to
// cover the "AI SaaS" category so the two stay consistent for
// the categories they share.
//
// NOTE: the homepage component deliberately keeps its own
// inline mapping. Routing it through this helper would change
// WebChat AI's homepage JSON-LD from "WebApplication" to
// "AIApplication", i.e. a homepage structured-data change, which
// is out of scope for this phase.

export function applicationCategory(category) {
    if (!category) return "WebApplication";

    if (category === "AI" || category.startsWith("AI ")) {
        return "AIApplication";
    }

    return "WebApplication";
}



// =========================================================
// PAGE METADATA
// =========================================================

/**
 * All <head> values for one project page.
 *
 * Every field is derived from the project object — nothing is
 * hardcoded per project and nothing is invented. `seoTitle` and
 * `seoDescription` come from the Phase C1 data model, the
 * canonical is computed from the slug.
 */
export function buildProjectMetadata(project) {
    const canonical = projectPageUrl(project.slug);

    const title = project.seoTitle;
    const description = project.seoDescription;
    const image = absoluteUrl(project.image);

    return {
        title,
        description,
        canonical,

        author: seo.author,

        robots:
            "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1",

        openGraph: {
            type: "article",
            siteName: SITE_NAME,
            locale: LOCALE,
            title,
            description,
            url: canonical,
            image,
            imageAlt: project.imageAlt,
            imageWidth: projectImageDimensions(project).width,
            imageHeight: projectImageDimensions(project).height,
        },

        twitter: {
            card: TWITTER_CARD,
            title,
            description,
            image,
            imageAlt: project.imageAlt,
        },
    };
}



// =========================================================
// STRUCTURED DATA
// =========================================================

/**
 * SoftwareApplication for the project page.
 *
 * `url` is the portfolio's own project page — that is the page
 * the entity describes. The external demo and repository are
 * exposed separately through `sameAs` / `codeRepository` so a
 * crawler is never told the project page *is* the demo.
 *
 * Deliberately absent because the repository holds no evidence
 * for them: aggregateRating, review, offers/pricing, numberOfDownloads,
 * user counts, awards.
 */
function buildSoftwareApplication(project) {
    const canonical = projectPageUrl(project.slug);

    const app = {
        "@type": "SoftwareApplication",
        "@id": canonical,
        name: project.title,
        description: project.seoDescription,
        url: canonical,
        applicationCategory: applicationCategory(project.category),
        operatingSystem: "Web",
        image: absoluteUrl(project.image),
        author: { "@id": PERSON_ID },
    };

    if (project.github && project.github !== "#") {
        app.codeRepository = project.github;
    }

    const sameAs = [project.github, project.live].filter(
        (url) => typeof url === "string" && url && url !== "#"
    );

    if (sameAs.length > 0) {
        app.sameAs = [...new Set(sameAs)];
    }

    return app;
}

/**
 * Minimal Person node, emitted alongside every project page so
 * the `author: { "@id": PERSON_ID }` reference resolves inside
 * the same document instead of dangling. Values are the existing
 * author facts from src/config/seo.js.
 */
function buildAuthorPerson() {
    return {
        "@type": "Person",
        "@id": PERSON_ID,
        name: seo.person.name,
        alternateName: seo.person.alternateName,
        jobTitle: seo.person.jobTitle,
        url: SITE_URL,
        sameAs: seo.sameAs,
    };
}

/**
 * BreadcrumbList.
 *
 * There is no `/projects` index page, so no intermediate crumb is
 * invented. Only real, reachable URLs appear: the homepage, then
 * this project page.
 */
function buildBreadcrumbList(project) {
    return {
        "@type": "BreadcrumbList",
        "@id": `${projectPageUrl(project.slug)}#breadcrumb`,
        itemListElement: [
            {
                "@type": "ListItem",
                position: 1,
                name: "Home",
                item: absoluteUrl("/"),
            },
            {
                "@type": "ListItem",
                position: 2,
                name: project.title,
                item: projectPageUrl(project.slug),
            },
        ],
    };
}

/**
 * The complete @graph for one project page: SoftwareApplication +
 * BreadcrumbList (+ the author Person they reference).
 */
export function buildProjectStructuredData(project) {
    return {
        "@context": "https://schema.org",
        "@graph": [
            buildAuthorPerson(),
            buildSoftwareApplication(project),
            buildBreadcrumbList(project),
        ],
    };
}

/**
 * Serialise structured data for embedding in a <script> block.
 * `<` is escaped so the payload can never terminate the script
 * element early.
 */
export function serializeStructuredData(data) {
    return JSON.stringify(data, null, 2).replace(/</g, "\\u003c");
}