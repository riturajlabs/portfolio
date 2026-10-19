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
});
