import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Certifications from "./Certifications";

vi.mock("../../lib/publicContent", () => ({
    certificates: [
        {
            title: "Cert A",
            issuer: "Issuer A",
            icon: null,
            credential: "https://example.com/a",
            // no description — mirrors the adapter's deliberate omission
        },
        {
            title: "Cert B",
            issuer: "Issuer B",
            icon: null,
            credential: "https://example.com/b",
            description: "Has a description",
        },
    ],
}));

function readStyle(name) {
    return readFileSync(
        path.resolve(process.cwd(), `src/styles/${name}`),
        "utf8"
    );
}

describe("Certifications", () => {
    it("exposes a labelled Certifications region", () => {
        render(<Certifications />);
        expect(screen.getByRole("region", { name: "Certifications" })).toBeTruthy();
    });

    it("does not render an empty description paragraph when the field is absent", () => {
        const { container } = render(<Certifications />);
        expect(container.textContent).not.toContain("undefined");
        const paragraphs = container.querySelectorAll(".certificate-card p");
        expect(paragraphs.length).toBe(1);
        expect(paragraphs[0].textContent).toBe("Has a description");
    });

    // U6-R2: absent description is handled with a modifier class so the
    // card keeps its layout (button bottom-aligned) with no empty gap.
    it("tags description-less cards so the layout stays intact", () => {
        const { container } = render(<Certifications />);
        const cards = container.querySelectorAll(".certificate-card");

        expect(cards.length).toBe(2);
        expect(
            container.querySelectorAll(".certificate-card-no-description")
                .length
        ).toBe(1);
    });

    it("styles the no-description state via a token-free layout rule", () => {
        const css = readStyle("certifications.css");
        const rule = css.match(
            /\.certificate-card-no-description a\s*\{[^}]*\}/
        )?.[0];

        expect(rule, "no-description rule missing").toBeTruthy();
        expect(rule).toMatch(/margin-top:\s*auto/);
    });

    it("gives the credential button a ≥44px tap target (FE-13)", () => {
        const css = readStyle("certifications.css");
        const rule = css.match(/\.certificate-card a\s*\{[^}]*\}/)?.[0];

        expect(rule, ".certificate-card a rule missing").toBeTruthy();
        expect(rule).toMatch(/min-height:\s*44px/);
    });
});
