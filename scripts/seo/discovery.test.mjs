// Phase 10 (docs/TESTING.md §5.2): the discovery-document builders. Pure
// functions over synthetic inputs, so the format rules are locked down
// without touching a real build: escaping, omission of absent fields,
// selection of indexable projects, and every validator that has caught
// drift in this repo before (duplicate URLs, blocked paths, stale llms.txt
// links, the old Railway host).

import { describe, expect, it } from "vitest";

import {
    buildImageSitemapXml,
    buildLlmsTxt,
    buildRobotsTxt,
    buildSitemapXml,
    findLlmsProblems,
    findRobotsProblems,
    findSitemapUrlProblems,
    findXmlProblems,
    resolveDiscoveryInputs,
} from "./discovery.mjs";

const SITE = "https://example.test";

function makeProject(overrides = {}) {
    return {
        slug: "demo-project",
        title: "Demo Project",
        seoDescription: "A demo project used by the discovery tests.",
        image: "/images/projects/demo-project.webp",
        updatedAt: null,
        indexable: true,
        live: "https://demo.example.test",
        github: "https://github.com/example/demo",
        ...overrides,
    };
}

describe("buildSitemapXml", () => {
    it("emits a well-formed urlset with one <url> per entry", () => {
        const xml = buildSitemapXml({
            urls: [
                { loc: `${SITE}/`, changefreq: "weekly", priority: "1.0" },
                { loc: `${SITE}/projects/demo/`, lastmod: "2026-01-02" },
            ],
        });

        expect(findXmlProblems(xml)).toEqual([]);
        expect(xml).toContain(`<loc>${SITE}/</loc>`);
        expect(xml).toContain("<changefreq>weekly</changefreq>");
        expect(xml).toContain("<priority>1.0</priority>");
        expect(xml).toContain("<lastmod>2026-01-02</lastmod>");
        expect(xml.match(/<url>/g)).toHaveLength(2);
    });

    it("omits lastmod, changefreq and priority when not supplied", () => {
        const xml = buildSitemapXml({ urls: [{ loc: `${SITE}/` }] });

        expect(xml).not.toContain("<lastmod>");
        expect(xml).not.toContain("<changefreq>");
        expect(xml).not.toContain("<priority>");
        expect(findXmlProblems(xml)).toEqual([]);
    });

    it("escapes XML-significant characters in <loc>", () => {
        const xml = buildSitemapXml({
            urls: [{ loc: `${SITE}/?a=1&b=2` }],
        });

        expect(xml).toContain("&amp;b=2");
        expect(findXmlProblems(xml)).toEqual([]);
    });
});

describe("buildImageSitemapXml", () => {
    it("pairs each page with its images and skips image-less pages", () => {
        const xml = buildImageSitemapXml({
            entries: [
                { loc: `${SITE}/`, images: [`${SITE}/images/og.jpg`] },
                { loc: `${SITE}/projects/demo/`, images: [`${SITE}/images/demo.webp`] },
                { loc: `${SITE}/no-image/`, images: [] },
            ],
        });

        expect(findXmlProblems(xml)).toEqual([]);
        expect(xml).toContain("<image:loc>");
        expect(xml).not.toContain("/no-image/");
        expect(xml.match(/<url>/g)).toHaveLength(2);
    });
});

describe("buildRobotsTxt", () => {
    it("keeps the public site open, blocks /api/ and advertises every sitemap", () => {
        const text = buildRobotsTxt({
            sitemaps: [`${SITE}/sitemap.xml`, `${SITE}/sitemap-images.xml`],
        });

        expect(text).toMatch(/^User-agent: \*$/m);
        expect(text).toMatch(/^Allow: \/$/m);
        expect(text).toMatch(/^Disallow: \/api\/$/m);
        expect(text).toContain(`Sitemap: ${SITE}/sitemap.xml`);
        expect(text).toContain(`Sitemap: ${SITE}/sitemap-images.xml`);
        expect(findRobotsProblems(text, { sitemaps: [`${SITE}/sitemap.xml`] })).toEqual([]);
    });
});

describe("buildLlmsTxt", () => {
    const identity = {
        siteName: "Example Portfolio",
        tagline: "Official portfolio of Example Person (Example), Developer, based in Testville.",
        homepageUrl: `${SITE}/`,
        robotsUrl: `${SITE}/robots.txt`,
        github: "https://github.com/example",
        linkedin: "https://linkedin.com/in/example",
        email: "person@example.test",
        credential: "B.Sc. Example",
    };

    it("lists every project with its page, live and code URLs", () => {
        const text = buildLlmsTxt({
            identity,
            projects: [
                {
                    name: "Demo Project",
                    url: `${SITE}/projects/demo-project/`,
                    summary: "A demo project.",
                    live: "https://demo.example.test",
                    github: "https://github.com/example/demo",
                },
            ],
            resumeUrl: `${SITE}/resume.pdf`,
            sitemaps: [`${SITE}/sitemap.xml`],
        });

        expect(text).toContain("# Example Portfolio");
        expect(text).toContain("## Projects");
        expect(text).toContain(
            `- Demo Project: A demo project. Page: ${SITE}/projects/demo-project/ | Live: https://demo.example.test | Code: https://github.com/example/demo`
        );
        expect(text).toContain(`- ${SITE}/resume.pdf`);
        expect(text).not.toMatch(/railway\.app/i);
    });
});

describe("findXmlProblems", () => {
    it("flags a raw ampersand, unclosed elements and a missing declaration", () => {
        expect(
            findXmlProblems(`<?xml version="1.0" encoding="UTF-8"?>\n<root>&bad</root>`)
        ).toContainEqual(expect.stringMatching(/unescaped "&"/));

        expect(
            findXmlProblems(`<?xml version="1.0" encoding="UTF-8"?>\n<root><child></root>`)
        ).toContainEqual(expect.stringMatching(/closes/));

        expect(findXmlProblems(`<root></root>`)).toContain(
            "missing or malformed XML declaration"
        );
    });

    it("accepts a correctly generated document", () => {
        const xml = buildSitemapXml({ urls: [{ loc: `${SITE}/` }] });
        expect(findXmlProblems(xml)).toEqual([]);
    });
});

describe("findSitemapUrlProblems", () => {
    const declaration = `<?xml version="1.0" encoding="UTF-8"?>\n`;

    it("rejects non-https, fragment, duplicate and empty sitemaps", () => {
        expect(
            findSitemapUrlProblems(
                `${declaration}<urlset><url><loc>http://insecure.test/</loc></url></urlset>`
            )
        ).toContainEqual(expect.stringMatching(/not an absolute https/));

        expect(
            findSitemapUrlProblems(
                `${declaration}<urlset><url><loc>${SITE}/#section</loc></url></urlset>`
            )
        ).toContainEqual(expect.stringMatching(/fragment/));

        expect(
            findSitemapUrlProblems(
                `${declaration}<urlset>` +
                    `<url><loc>${SITE}/a</loc></url>` +
                    `<url><loc>${SITE}/a</loc></url>` +
                    `</urlset>`
            )
        ).toContainEqual(expect.stringMatching(/duplicate URL/));

        expect(
            findSitemapUrlProblems(`${declaration}<urlset></urlset>`)
        ).toContain("sitemap contains no <loc> entries");
    });

    it("honours forbidden patterns", () => {
        expect(
            findSitemapUrlProblems(
                `${declaration}<urlset><url><loc>${SITE}/admin/</loc></url></urlset>`,
                { forbidden: [/\/admin/] }
            )
        ).toContainEqual(expect.stringMatching(/forbidden pattern/));
    });
});

describe("findRobotsProblems", () => {
    it("flags a missing /api/ disallow and any rule blocking public content", () => {
        const missingApi = `User-agent: *\nAllow: /\n`;
        expect(findRobotsProblems(missingApi)).toContain(
            'missing "Disallow: /api/"'
        );

        const blocksProjects = `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /projects\n`;
        expect(findRobotsProblems(blocksProjects)).toContainEqual(
            expect.stringMatching(/blocks public content/)
        );
    });
});

describe("findLlmsProblems", () => {
    const projects = [
        {
            name: "Demo Project",
            url: `${SITE}/projects/demo/`,
            live: "https://demo.example.test",
            github: "https://github.com/example/demo",
        },
    ];

    it("catches missing projects, stale URLs and the old Railway host", () => {
        expect(findLlmsProblems("no projects here", { projects })).toContainEqual(
            expect.stringMatching(/missing project name/)
        );

        const withStale =
            `Page: ${projects[0].url}\n` +
            `https://old-railway-host.example.test/app\n`;
        const problems = findLlmsProblems(withStale, { projects });
        expect(problems).toContainEqual(
            expect.stringMatching(/quotes an unknown URL/)
        );

        expect(
            findLlmsProblems(`https://x.example.railway.app/`, { projects })
        ).toContainEqual(expect.stringMatching(/Railway/));
    });

    it("passes a document generated from the same data", () => {
        const text = buildLlmsTxt({
            identity: {
                siteName: "Example",
                tagline: "tagline",
                homepageUrl: `${SITE}/`,
                robotsUrl: `${SITE}/robots.txt`,
                github: "https://github.com/example",
                linkedin: "https://linkedin.com/in/example",
                email: "person@example.test",
                credential: "B.Sc.",
            },
            projects: [
                {
                    name: projects[0].name,
                    url: projects[0].url,
                    summary: "A demo project.",
                    live: projects[0].live,
                    github: projects[0].github,
                },
            ],
            resumeUrl: `${SITE}/resume.pdf`,
            sitemaps: [`${SITE}/sitemap.xml`],
        });

        const problems = findLlmsProblems(text, {
            projects,
            sitemaps: [`${SITE}/sitemap.xml`],
            allowedUrls: [
                `${SITE}/resume.pdf`,
                `${SITE}/`,
                `${SITE}/robots.txt`,
                "https://github.com/example",
                "https://linkedin.com/in/example",
            ],
        });

        expect(problems).toEqual([]);
    });
});

describe("resolveDiscoveryInputs", () => {
    const base = {
        projects: [
            makeProject({ slug: "a", title: "A" }),
            makeProject({ slug: "b", title: "B", indexable: false }),
            makeProject({ slug: "c", title: "C", updatedAt: "2026-01-03" }),
        ],
        siteUrl: SITE,
        homepageUrl: `${SITE}/`,
        resumeUrl: "/resume.pdf",
        siteImageUrl: "/images/og.jpg",
        robotsUrl: `${SITE}/robots.txt`,
        sitemaps: [`${SITE}/sitemap.xml`, `${SITE}/sitemap-images.xml`],
        resume: {
            location: "Testville",
            social: {
                github: "https://github.com/example",
                linkedin: "https://linkedin.com/in/example",
            },
        },
        seoConfig: {
            siteName: "Example",
            person: {
                name: "Example Person",
                alternateName: "Example",
                jobTitle: "Developer",
                email: "person@example.test",
                credential: "B.Sc.",
            },
        },
        toAbsoluteUrl: (path) => (path.startsWith("http") ? path : `${SITE}${path}`),
        toProjectUrl: (slug) => `${SITE}/projects/${slug}/`,
    };

    it("selects only indexable projects for every discovery document", () => {
        const resolved = resolveDiscoveryInputs(base);

        expect(resolved.selected.map((project) => project.slug)).toEqual(["a", "c"]);
        expect(resolved.llmsProjects.map((project) => project.url)).toEqual([
            `${SITE}/projects/a/`,
            `${SITE}/projects/c/`,
        ]);
        expect(
            resolved.imageEntries.map((entry) => entry.loc)
        ).toEqual([`${SITE}/`, `${SITE}/projects/a/`, `${SITE}/projects/c/`]);
    });

    it("orders the sitemap home → resume → projects and carries lastmod only when present", () => {
        const resolved = resolveDiscoveryInputs(base);

        expect(resolved.sitemapUrls.map((entry) => entry.loc)).toEqual([
            `${SITE}/`,
            `${SITE}/resume.pdf`,
            `${SITE}/projects/a/`,
            `${SITE}/projects/c/`,
        ]);

        const [home, resume, a, c] = resolved.sitemapUrls;
        expect(home.lastmod).toBeUndefined();
        expect(resume.lastmod).toBeUndefined();
        expect(a.lastmod).toBeUndefined();
        expect(c.lastmod).toBe("2026-01-03");
    });

    it("keeps the indexable project out of every list when it has no page", () => {
        const resolved = resolveDiscoveryInputs({
            ...base,
            projects: [makeProject({ slug: "only-hidden", indexable: false })],
        });

        expect(resolved.selected).toEqual([]);
        expect(resolved.llmsProjects).toEqual([]);
        expect(resolved.sitemapUrls).toHaveLength(2);
    });
});
