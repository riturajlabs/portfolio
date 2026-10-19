// FE-6 regression (docs/PORTFOLIO_UPGRADE.md §3.1): About must render
// the CMS `about` payload (via src/lib/publicContent.js), not
// hardcoded copy — admin edits to the about content have to reach the
// page. The generated snapshot is committed, so the real adapter can
// be asserted against directly.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import About from "./About";
import { about } from "../../lib/publicContent";

describe("About", () => {
    it("renders the CMS about payload through the public-content adapter", () => {
        render(<About />);

        expect(screen.getByText(about.title)).toBeInTheDocument();
        expect(screen.getByText(about.description)).toBeInTheDocument();
        expect(screen.getByText(about.heading)).toBeInTheDocument();

        for (const card of about.cards) {
            expect(screen.getByText(card.title)).toBeInTheDocument();
            expect(screen.getByText(card.description)).toBeInTheDocument();
        }
        for (const paragraph of about.paragraphs) {
            expect(screen.getByText(paragraph)).toBeInTheDocument();
        }
    });

    it("renders one card per CMS card and no undefined text", () => {
        const { container } = render(<About />);
        expect(container.textContent).not.toContain("undefined");
        expect(screen.getAllByText((_, el) => el?.classList.contains("about-card")))
            .toHaveLength(about.cards.length);
    });
});
