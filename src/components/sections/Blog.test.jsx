import { readFileSync } from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Blog from "./Blog";

vi.mock("../../data/blogs", () => ({
    default: [
        {
            title: "Post 1",
            category: "AI",
            status: "Coming Soon",
            readTime: "8 min read",
            description: "d",
            link: "#",
        },
        {
            title: "Post 2",
            category: "Programming",
            readTime: undefined,
            description: "d",
            link: "#",
        },
    ],
}));

function readStyle(name) {
    return readFileSync(
        path.resolve(process.cwd(), `src/styles/${name}`),
        "utf8"
    );
}

describe("Blog", () => {
    it("never renders the string 'undefined' when date is absent and readTime is missing", () => {
        const { container } = render(<Blog />);
        expect(container.textContent).not.toContain("undefined");
    });

    it("shows the status in the meta slot when date is absent, and readTime when present", () => {
        const { container } = render(<Blog />);
        const meta = container.querySelector(".blog-meta");
        expect(meta).not.toBeNull();
        expect(meta.textContent).toContain("Coming Soon");
        expect(meta.textContent).toContain("8 min read");
    });

    // U6-R3: deliberate, field-aware rendering instead of a fallback chain.
    it("renders status and readTime as distinct, labelled elements", () => {
        const { container } = render(<Blog />);
        const status = container.querySelector(".blog-status");
        const readTime = container.querySelector(".blog-readtime");

        expect(status, ".blog-status missing").not.toBeNull();
        expect(readTime, ".blog-readtime missing").not.toBeNull();
        expect(status.textContent).toBe("Coming Soon");
        expect(readTime.textContent).toBe("8 min read");
    });

    it("does not emit an empty label when a field is absent", () => {
        const { container } = render(<Blog />);
        // Post 2 has no status and no readTime — neither element should
        // exist for it, so no empty <span> is rendered.
        const empties = Array.from(
            container.querySelectorAll(".blog-status, .blog-readtime")
        ).filter((el) => el.textContent.trim() === "");
        expect(empties.length).toBe(0);
    });

    it("styles the status label with a theme token (D4)", () => {
        const css = readStyle("blogs.css");
        const rule = css.match(/\.blog-status\s*\{[^}]*\}/)?.[0];

        expect(rule, ".blog-status rule missing").toBeTruthy();
        expect(rule).toMatch(/color:\s*var\(--link\)/);
    });

    it("gives the coming-soon button a ≥44px tap target (FE-13)", () => {
        const css = readStyle("blogs.css");
        const rule = css.match(/\.blog-coming-btn\s*\{[^}]*\}/)?.[0];

        expect(rule, ".blog-coming-btn rule missing").toBeTruthy();
        expect(rule).toMatch(/min-height:\s*44px/);
    });
});
