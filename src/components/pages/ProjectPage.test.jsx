// U5 regression (docs/PORTFOLIO_UPGRADE.md §7 U5): the prerendered
// project pages gain a header band and a sticky, no-JS section nav.
// These tests pin the authorable contract: the nav exists, every
// anchor it emits resolves to a section the page actually renders
// (no dead links), sections carry the ids the nav targets, and the
// CSS carries the U5 theme-consistency fixes (link tokens for hover
// text, --secondary-text for the category chip, the sticky/focus
// rules the static pages need without global.css).

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import ProjectPage from "./ProjectPage";

function readStyle(name) {
    return readFileSync(
        path.resolve(process.cwd(), `src/styles/${name}`),
        "utf8"
    );
}

// A fixture that renders every conditional block: real slug (the
// image-dimensions map keys on it), tech, highlights, category.
// live/github left as "#" so no external action buttons render.
const PROJECT = {
    title: "WebChat AI",
    description: "A multi-tenant AI support chatbot.",
    slug: "webchat-ai",
    image: "/images/projects/webchat-ai.webp",
    imageAlt: "WebChat AI dashboard",
    category: "AI SaaS",
    live: "#",
    github: "#",
    techStack: ["React", "Node.js", "Gemini"],
    highlights: ["Multi-tenant by design"],
};

describe("ProjectPage (U5 header band + sticky section nav)", () => {
    it("renders a labelled section nav", () => {
        const { container } = render(<ProjectPage project={PROJECT} />);

        const nav = container.querySelector(".project-page-section-nav");
        expect(nav, "sticky section nav missing").toBeTruthy();
        expect(nav).toHaveAttribute("aria-label", "Section navigation");
    });

    it("emits only anchors that resolve to a section on the page", () => {
        const { container } = render(<ProjectPage project={PROJECT} />);

        const links = container.querySelectorAll(
            ".project-page-section-nav a"
        );
        expect(links.length).toBeGreaterThan(0);

        for (const link of links) {
            const id = link.getAttribute("href").slice(1);
            expect(
                container.querySelector(`#${id}`),
                `nav links to #${id} but no such section exists`
            ).toBeTruthy();
        }

        // The sections that always render are always linked.
        const hrefs = [...links].map((a) => a.getAttribute("href"));
        expect(hrefs).toContain("#project-about");
        expect(hrefs).toContain("#project-tech");
        expect(hrefs).toContain("#project-highlights");
    });

    it("gives the content sections the ids the nav targets", () => {
        const { container } = render(<ProjectPage project={PROJECT} />);

        expect(container.querySelector("#project-about")).toBeTruthy();
        expect(container.querySelector("#project-tech")).toBeTruthy();
        expect(container.querySelector("#project-highlights")).toBeTruthy();
    });

    it("keeps explicit image dimensions on the LCP figure", () => {
        const { container } = render(<ProjectPage project={PROJECT} />);

        const img = container.querySelector(".project-page-figure img");
        expect(img, "project figure image missing").toBeTruthy();
        expect(img).toHaveAttribute("width");
        expect(img).toHaveAttribute("height");
        expect(img).toHaveAttribute("loading", "eager");
    });

    it("styles the header as a raised band and the nav as sticky", () => {
        const css = readStyle("project-page.css");

        const header = css.match(/\.project-page-header\s*\{[^}]*\}/)?.[0];
        expect(header, ".project-page-header rule missing").toBeTruthy();
        expect(header).toMatch(/border-radius:\s*var\(--radius-card\)/);
        expect(header).toMatch(/var\(--card\)/);

        const nav = css.match(/\.project-page-section-nav\s*\{[^}]*\}/)?.[0];
        expect(nav, ".project-page-section-nav rule missing").toBeTruthy();
        expect(nav).toMatch(/position:\s*sticky/);
        expect(nav).toMatch(/top:\s*0/);

        const navLink = css.match(
            /\.project-page-section-nav a\s*\{[^}]*\}/
        )?.[0];
        expect(navLink, "nav link rule missing").toBeTruthy();
        expect(navLink).toMatch(/min-height:\s*44px/);

        expect(css).toMatch(/scroll-margin-top/);
        expect(css).toMatch(/\.project-page-section-nav a:focus-visible/);
    });

    it("paints page hover text with link tokens and the chip with --secondary-text", () => {
        const css = readStyle("project-page.css");

        const backHover = css.match(/\.project-page-back:hover\s*\{[^}]*\}/)?.[0];
        expect(backHover, ".project-page-back:hover rule missing").toBeTruthy();
        expect(backHover).toMatch(/color:\s*var\(--link-hover\)/);

        const relatedHover = css.match(
            /\.project-page-related-link:hover\s*\{[^}]*\}/
        )?.[0];
        expect(relatedHover, "related-link hover rule missing").toBeTruthy();
        expect(relatedHover).toMatch(/color:\s*var\(--link-hover\)/);

        const chip = css.match(/\.project-page-category\s*\{[^}]*\}/)?.[0];
        expect(chip, ".project-page-category rule missing").toBeTruthy();
        expect(chip).toMatch(/color:\s*var\(--secondary-text\)/);

        const tech = css.match(/\.project-page-tech li\s*\{[^}]*\}/)?.[0];
        expect(tech, ".project-page-tech li rule missing").toBeTruthy();
        expect(tech).toMatch(/color:\s*var\(--link\)/);
        expect(tech).toMatch(/background:\s*var\(--primary-soft\)/);
    });
});
