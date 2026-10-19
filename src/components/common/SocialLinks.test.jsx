import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SocialLinks from "./SocialLinks";

vi.mock("../../lib/publicContent", () => ({
    socials: [
        {
            name: "GitHub",
            url: "https://github.com/example",
            icon: () => null,
        },
    ],
}));

describe("SocialLinks", () => {
    it("renders with showLabel by default", () => {
        render(<SocialLinks />);
        expect(screen.getByText("GitHub")).toBeInTheDocument();
    });

    it("accepts showLabels prop for compatibility", () => {
        const { rerender } = render(<SocialLinks showLabels={false} />);
        expect(screen.queryByText("GitHub")).not.toBeInTheDocument();
        rerender(<SocialLinks showLabels />);
        expect(screen.getByText("GitHub")).toBeInTheDocument();
    });
});
