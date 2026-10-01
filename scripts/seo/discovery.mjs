// =========================================================
// 🔍 SEO DISCOVERY — CONTENT BUILDERS (pure)
// =========================================================
// Everything that turns project/site data into the four discovery
// documents:
//
//   dist/sitemap.xml
//   dist/sitemap-images.xml
//   dist/robots.txt
//   dist/llms.txt
//
// This module is deliberately pure: no fs, no network, no imports
// from src/. Every function takes already-resolved primitives and
// returns a string. That keeps the format logic unit-testable and
// lets the future-content test drive it with synthetic project data
// without ever touching the real projects.js.
//
// Nothing here hardcodes a project slug. The slug list only ever
// arrives through the `projects` array it is handed, so adding a
// project to src/data/projects.js is the only edit required.
//
// I/O and validation live in scripts/generate-seo-discovery.mjs.
// =========================================================



// =========================================================
//// XML ESCAPING
// =========================================================
// <loc> values are URLs, so they rarely need escaping, but a bare
// `&` in a query string would make the document malformed XML and
// crawlers would silently reject the whole file. Escaping is cheap
// insurance.

const XML_ESCAPES = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
};

// Characters XML 1.0 forbids outright, even escaped. A URL can
// legitimately carry a percent-encoded space, but never a raw
// control character, so these are stripped before escaping.
const XML_INVALID_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

function escapeXml(value) {
    return String(value)
        .replace(XML_INVALID_CHARS, "")
        .replace(/[&<>"']/g, (char) => XML_ESCAPES[char]);
}



// =========================================================
// CONSTANTS
// =========================================================

const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
const IMAGE_SITEMAP_NS = "http://www.google.com/schemas/sitemap-image/1.1";



// =========================================================
// LASTMOD
// =========================================================

/**
 * Emit <lastmod> only when there is a real date to report.
 *
 * `lastmod` tells crawlers how stale a URL is. A value invented from
 * the build clock, the git commit date or the image-migration date
 * would be a lie that makes every build look like fresh content, so
 * an absent date produces no element at all rather than a guess.
 * A project only gains a lastmod by setting `updatedAt` in
 * src/data/projects.js to a real date.
 */
function lastmodElement(lastmod, indent) {
    if (!lastmod) return "";

    return `${indent}<lastmod>${escapeXml(lastmod)}</lastmod>\n`;
}



// =========================================================
// SITEMAP.XML
// =========================================================

/**
 * Build sitemap.xml.
 *
 * `urls` is an ordered list of
 * `{ loc, lastmod?, changefreq?, priority? }`. Ordering and values
 * come from the caller; this function only formats. Only <loc> is
 * guaranteed — every other field is omitted when not supplied, so a
 * project with `updatedAt: null` can never grow a fabricated date.
 */
export function buildSitemapXml({ urls }) {
    const body = urls
        .map((entry) => {
            const fields = [
                `        <loc>${escapeXml(entry.loc)}</loc>\n`,
                lastmodElement(entry.lastmod, "        "),
                entry.changefreq
                    ? `        <changefreq>${escapeXml(entry.changefreq)}</changefreq>\n`
                    : "",
                entry.priority != null
                    ? `        <priority>${escapeXml(entry.priority)}</priority>\n`
                    : "",
            ].join("");

            return `    <url>\n${fields}    </url>\n`;
        })
        .join("\n");

    return (
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `\n` +
        `<urlset xmlns="${SITEMAP_NS}">\n` +
        `\n` +
        `${body}` +
        `</urlset>\n`
    );
}



// =========================================================
// SITEMAP-IMAGES.XML
// =========================================================

/**
 * Build the image sitemap.
 *
 * Uses only Google's currently supported element, <image:loc>.
 * The deprecated image:title / image:caption / image:license /
 * image:geo_location elements are deliberately absent: they have been
 * unsupported for years, carry no ranking benefit, and including them
 * is a common source of image-sitemap validation warnings.
 *
 * `entries` is a list of `{ loc, images: [absoluteImageUrl] }`,
 * pairing each page with the images it displays. Image URLs live
 * inside the page they belong to rather than as standalone entries,
 * which is the form Google's image sitemap format expects.
 */
export function buildImageSitemapXml({ entries }) {
    const body = entries
        .filter((entry) => entry.images.length > 0)
        .map((entry) => {
            const images = entry.images
                .map(
                    (image) =>
                        `            <image:image>\n` +
                        `                <image:loc>${escapeXml(image)}</image:loc>\n` +
                        `            </image:image>\n`
                )
                .join("");

            return (
                `    <url>\n` +
                `        <loc>${escapeXml(entry.loc)}</loc>\n` +
                `${images}` +
                `    </url>\n`
            );
        })
        .join("\n");

    return (
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `\n` +
        `<urlset xmlns="${SITEMAP_NS}" xmlns:image="${IMAGE_SITEMAP_NS}">\n` +
        `\n` +
        `${body}` +
        `</urlset>\n`
    );
}



// =========================================================
// ROBOTS.TXT
// =========================================================

/**
 * Build robots.txt.
 *
 * Only /api/ is disallowed. Projects, project images, CSS, JS and
 * every other asset needed to render the pages stay crawlable —
 * blocking them would make the pages themselves unindexable, since a
 * crawler cannot judge a page whose stylesheet or images it may not
 * fetch.
 *
 * The Googlebot-Image and bingbot groups are preserved verbatim from
 * the previously published file: they explicitly allow image crawling
 * and there is no reason to narrow that behaviour.
 */
export function buildRobotsTxt({ sitemaps }) {
    const sitemapLines = sitemaps
        .map((url) => `Sitemap: ${url}`)
        .join("\n");

    return (
        `User-agent: *\n` +
        `Allow: /\n` +
        `Disallow: /api/\n` +
        `\n` +
        `# Let search engines and AI crawlers reach images & resources\n` +
        `User-agent: Googlebot-Image\n` +
        `Allow: /\n` +
        `\n` +
        `User-agent: bingbot\n` +
        `Allow: /\n` +
        `\n` +
        `${sitemapLines}\n`
    );
}



// =========================================================
// LLMS.TXT
// =========================================================

/**
 * Build llms.txt.
 *
 * llms.txt is a plain-text map of the site for language models. It is
 * NOT a search-engine indexing mechanism and is deliberately absent
 * from sitemap.xml — listing it there would submit a text file to
 * Google as if it were a page.
 *
 * The prose sections (About / Education / Skills) are curated copy
 * held here as constants rather than derived, because they describe
 * the person, not the projects. Every factual identity value they
 * quote is asserted against the real data by validateLlmsTxt, and the
 * Projects section is generated entirely from src/data/projects.js —
 * which is what fixes the stale entries this file used to carry.
 */
export function buildLlmsTxt({ identity, projects, resumeUrl, sitemaps }) {
    const siteLines = [
        `- Homepage: ${identity.homepageUrl}`,
        ...sitemaps.map((url, index) => {
            const label =
                url.endsWith("sitemap-images.xml")
                    ? "Image sitemap"
                    : "Sitemap";
            return `- ${label}: ${url}`;
        }),
        `- Robots: ${identity.robotsUrl}`,
    ];

    const projectLines = projects.map((project) => {
        const links = [];

        // The project's own page is the canonical reference.
        links.push(`Page: ${project.url}`);

        if (project.live) links.push(`Live: ${project.live}`);
        if (project.github) links.push(`Code: ${project.github}`);

        return `- ${project.name}: ${project.summary} ${links.join(" | ")}`;
    });

    return [
        `# ${identity.siteName}`,
        ``,
        `> ${identity.tagline}`,
        ``,
        `## Website`,
        ``,
        ...siteLines,
        ``,
        `## About`,
        ``,
        `Ritu Raj is a Full Stack Developer (MERN Stack) and AI & Machine Learning student pursuing a B.Sc. in Artificial Intelligence & Machine Learning.`,
        `He builds modern web applications using React, JavaScript, Node.js, Express, MongoDB, Java and Python, and is open to Software Developer Internships.`,
        `His interests include Artificial Intelligence, Machine Learning, Generative AI, RAG systems, AI Agents, Data Structures & Algorithms and Software Engineering.`,
        ``,
        `## Education`,
        ``,
        `- ${identity.credential}`,
        ``,
        `## Skills`,
        ``,
        `- Frontend: React.js, JavaScript, HTML & CSS, Bootstrap`,
        `- Backend: Node.js, Express.js, FastAPI, REST APIs`,
        `- AI & ML: Python, Machine Learning, PyTorch, LangChain`,
        `- Database & Tools: MongoDB, PostgreSQL, Git & GitHub, Linux`,
        ``,
        `## Projects`,
        ``,
        ...projectLines,
        ``,
        `## Profiles`,
        ``,
        `- GitHub: ${identity.github}`,
        `- LinkedIn: ${identity.linkedin}`,
        `- Email: ${identity.email}`,
        ``,
        `## Resume`,
        ``,
        `- ${resumeUrl}`,
        ``,
        `## License`,
        ``,
        `Copyright © Ritu Raj.`,
        ``,
    ].join("\n");
}



// =========================================================
// INPUT RESOLUTION
// =========================================================

/**
 * Turn project data into the primitives every builder above needs.
 *
 * This is where project selection happens — once — so the sitemap,
 * the image sitemap and llms.txt can never disagree about which
 * projects exist. It is exported separately from the format builders
 * so the future-content test can resolve synthetic projects through
 * the exact same code path the real build uses.
 *
 * Selection rule: a project is included when it gets a public page,
 * i.e. `indexable !== false`. A project without a page must not be
 * linked from any discovery file, because the URL would not resolve.
 */
export function resolveDiscoveryInputs({
    projects,
    siteUrl,
    homepageUrl,
    resumeUrl,
    siteImageUrl,
    robotsUrl,
    sitemaps,
    resume,
    seoConfig,
    toAbsoluteUrl,
    toProjectUrl,
}) {
    const selected = projects.filter((project) => project.indexable !== false);

    const sitemapUrls = [
        {
            loc: homepageUrl,
            // Carried over unchanged from the previously published
            // sitemap; these are not generated (see the generator).
            changefreq: "weekly",
            priority: "1.0",
        },
        {
            loc: toAbsoluteUrl(resumeUrl),
            changefreq: "monthly",
            priority: "0.8",
        },
        ...selected.map((project) => ({
            loc: toProjectUrl(project.slug),
            lastmod: project.updatedAt || undefined,
            changefreq: "monthly",
            priority: "0.7",
        })),
    ];

    const imageEntries = [
        {
            loc: homepageUrl,
            images: siteImageUrl ? [toAbsoluteUrl(siteImageUrl)] : [],
        },
        ...selected
            .filter((project) => project.image)
            .map((project) => ({
                loc: toProjectUrl(project.slug),
                images: [toAbsoluteUrl(project.image)],
            })),
    ];

    const identity = {
        siteName: seoConfig.siteName,
        tagline:
            `Official portfolio of ${seoConfig.person.name} ` +
            `(${seoConfig.person.alternateName}), ${seoConfig.person.jobTitle}, ` +
            `based in ${resume.location}.`,
        homepageUrl,
        robotsUrl,
        github: resume.social.github,
        linkedin: resume.social.linkedin,
        email: seoConfig.person.email,
        credential: seoConfig.person.credential,
    };

    const llmsProjects = selected.map((project) => ({
        name: project.title,
        url: toProjectUrl(project.slug),
        summary: project.seoDescription,
        live:
            typeof project.live === "string" && project.live !== "#"
                ? project.live
                : null,
        github:
            typeof project.github === "string" && project.github !== "#"
                ? project.github
                : null,
    }));

    return {
        selected,
        sitemapUrls,
        imageEntries,
        identity,
        llmsProjects,
        siteUrl,
        resumeUrl: toAbsoluteUrl(resumeUrl),
        sitemaps,
    };
}



// =========================================================
// VALIDATION
// =========================================================

/**
 * Minimal XML well-formedness scan.
 *
 * A stack-based pass over the document's tags: every element must be
 * closed, self-closing or properly nested, and there must be exactly
 * one root. It is not a full parser, but the discovery files are
 * generated from a fixed template, so a genuine structural error (an
 * unescaped `&` truncating a <loc>, a dropped closing tag) shows up
 * here rather than passing silently to a crawler.
 */
export function findXmlProblems(xml) {
    const problems = [];

    if (!/^<\?xml version="1\.0" encoding="UTF-8"\?>/.test(xml)) {
        problems.push("missing or malformed XML declaration");
    }

    const tagPattern = /<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;

    const stack = [];
    let roots = 0;
    let match;

    while ((match = tagPattern.exec(xml)) !== null) {
        const [, closing, name, , selfClosing] = match;

        if (name.startsWith("?") || name.startsWith("!")) continue;

        if (closing) {
            const open = stack.pop();

            if (!open) {
                problems.push(`closing </${name}> with no opening tag`);
            } else if (open !== name) {
                problems.push(`</${name}> closes <${open}>`);
            }
        } else if (selfClosing) {
            // no stack change
        } else {
            if (stack.length === 0) roots += 1;
            stack.push(name);
        }
    }

    if (stack.length > 0) {
        problems.push(`unclosed element(s): ${stack.join(", ")}`);
    }

    if (roots !== 1) {
        problems.push(`expected exactly one root element, found ${roots}`);
    }

    // A raw `&` that is not part of a valid entity reference is the
    // single most common way a generated sitemap becomes invalid.
    const badAmp = xml.match(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/);

    if (badAmp) {
        problems.push(
            `unescaped "&" at offset ${badAmp.index} breaks XML well-formedness`
        );
    }

    return problems;
}

/**
 * Every <loc> must be an absolute https URL with no fragment, and no
 * URL may repeat — a duplicate tells a crawler two of its own entries
 * are the same page.
 */
export function findSitemapUrlProblems(xml, { forbidden = [] } = {}) {
    const problems = findXmlProblems(xml);

    const locs = [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map(
        (match) => match[1]
    );

    const seen = new Set();

    for (const loc of locs) {
        if (!/^https:\/\//i.test(loc)) {
            problems.push(`<loc> is not an absolute https URL: ${loc}`);
        }

        if (loc.includes("#")) {
            problems.push(`<loc> contains a fragment: ${loc}`);
        }

        if (loc.includes(" ")) {
            problems.push(`<loc> contains a raw space: ${loc}`);
        }

        if (seen.has(loc)) {
            problems.push(`duplicate URL: ${loc}`);
        }

        seen.add(loc);

        for (const pattern of forbidden) {
            if (pattern.test(loc)) {
                problems.push(`<loc> matches a forbidden pattern: ${loc}`);
            }
        }
    }

    if (locs.length === 0) {
        problems.push("sitemap contains no <loc> entries");
    }

    return problems;
}

/**
 * robots.txt must stay open to the public content it renders, keep
 * /api/ blocked, and advertise every generated sitemap.
 */
export function findRobotsProblems(text, { sitemaps = [] } = {}) {
    const problems = [];

    if (!/^User-agent: \*\s*$/m.test(text)) {
        problems.push('missing the "User-agent: *" group');
    }

    if (!/^Allow: \/\s*$/m.test(text)) {
        problems.push('missing "Allow: /"');
    }

    if (!/^Disallow: \/api\/\s*$/m.test(text)) {
        problems.push('missing "Disallow: /api/"');
    }

    for (const url of sitemaps) {
        if (!text.includes(`Sitemap: ${url}`)) {
            problems.push(`missing sitemap reference: ${url}`);
        }
    }

    // A block here would hide real content or the assets needed to
    // render it.
    for (const line of text.split("\n")) {
        const rule = line.match(/^Disallow:\s*(\S*)\s*$/);

        if (!rule) continue;

        const path = rule[1];

        if (
            path.startsWith("/projects") ||
            path.startsWith("/images") ||
            path.startsWith("/assets")
        ) {
            problems.push(`robots.txt blocks public content: ${line.trim()}`);
        }
    }

    return problems;
}

/**
 * llms.txt must agree with the data it was generated from.
 *
 * This is the drift guard for the file that had stale project
 * information: every project page URL has to be present, and every
 * live/repository URL quoted has to match the current project data
 * exactly. A project whose live URL changes in projects.js fails
 * here instead of shipping the old address.
 */
export function findLlmsProblems(
    text,
    { projects = [], sitemaps = [], allowedUrls = [] } = {}
) {
    const problems = [];

    if (projects.length === 0) {
        problems.push("llms.txt lists no projects");
    }

    for (const project of projects) {
        if (!text.includes(project.name)) {
            problems.push(`llms.txt is missing project name: ${project.name}`);
        }

        if (!text.includes(project.url)) {
            problems.push(`llms.txt is missing project URL: ${project.url}`);
        }

        if (project.live && !text.includes(project.live)) {
            problems.push(
                `llms.txt is missing live URL for ${project.name}: ${project.live}`
            );
        }

        if (project.github && !text.includes(project.github)) {
            problems.push(
                `llms.txt is missing repository for ${project.name}: ${project.github}`
            );
        }
    }

    // Any absolute URL in llms.txt that is not in the current data is
    // by definition a leftover from older project information. This
    // is what catches a project whose live URL moved.
    const known = new Set(
        [
            ...projects.flatMap((project) => [
                project.url,
                project.live,
                project.github,
            ])
                .filter(Boolean)
                .map(stripTrailingSlash),
            ...sitemaps,
            ...allowedUrls,
        ].map(stripTrailingSlash)
    );

    const quoted = [
        ...new Set(
            [...text.matchAll(/https?:\/\/[^\s|)>`]+/g)].map((match) =>
                stripTrailingSlash(match[0])
            )
        ),
    ];

    for (const url of quoted) {
        if (!known.has(url)) {
            problems.push(`llms.txt quotes an unknown URL: ${url}`);
        }
    }

    if (/railway\.app/i.test(text)) {
        problems.push("llms.txt still references a Railway URL");
    }

    return problems;
}

function stripTrailingSlash(url) {
    return url.replace(/\/+$/, "");
}