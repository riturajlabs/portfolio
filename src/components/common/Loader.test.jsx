import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Loader from "./Loader";

describe("Loader", () => {
    it("renders skeleton placeholders instead of the old non-existent placeholder-glow markup", () => {
        const { container } = render(<Loader />);
        const skeletons = container.querySelectorAll(".placeholder-glow");
        expect(skeletons.length).toBeGreaterThan(0);
        // Every skeleton is decorative and hidden from assistive tech.
        for (const skeleton of skeletons) {
            expect(skeleton.getAttribute("aria-hidden")).toBe("true");
        }
    });

    it("is marked as busy", () => {
        const { container } = render(<Loader />);
        const busyElement = container.querySelector('[aria-busy="true"]');
        expect(busyElement).not.toBeNull();
    });
});
