import { render } from "@testing-library/react";
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

describe("Certifications", () => {
    it("does not render an empty description paragraph when the field is absent", () => {
        const { container } = render(<Certifications />);
        expect(container.textContent).not.toContain("undefined");
        const paragraphs = container.querySelectorAll(".certificate-card p");
        expect(paragraphs.length).toBe(1);
        expect(paragraphs[0].textContent).toBe("Has a description");
    });
});
