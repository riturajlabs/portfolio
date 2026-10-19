import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Reveal from "./Reveal";

vi.mock("framer-motion", async () => {
    const actual = await vi.importActual("framer-motion");
    return {
        ...actual,
        useReducedMotion: () => true,
    };
});

describe("Reveal", () => {
    it("renders children directly (no motion wrapper) when the user prefers reduced motion", () => {
        const { container } = render(
            <Reveal>
                <p>revealed content</p>
            </Reveal>
        );
        expect(screen.getByText("revealed content")).toBeInTheDocument();
        // No intermediate motion.div — the child is mounted as-is.
        expect(container.querySelector("div.motion, [data-testid]")).toBeNull();
        expect(container.firstElementChild.tagName).toBe("P");
    });
});
