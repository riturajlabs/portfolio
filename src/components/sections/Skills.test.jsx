// U4 FE-9/FE-10a regression (docs/PORTFOLIO_UPGRADE.md §7 U4): the
// react-icons `si`/`fa` glyphs ship `role="img"` with no accessible
// name, which axe flags as `svg-img-alt` on `/`. They are decorative —
// the skill name/category heading is adjacent text — so they must be
// hidden from assistive technology (`aria-hidden="true"`), not given a
// redundant accessible name. This test pins the decoration contract:
// every skill icon must be `aria-hidden` so the axe gate's
// `svg-img-alt` exclusion stays removed.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Skills from "./Skills";
import { skillCategories } from "../../lib/publicContent";

describe("Skills (U4 FE-9: icons decorative, named by adjacent text)", () => {
    it("exposes a labelled Skills region", () => {
        render(<Skills />);
        expect(screen.getByRole("region", { name: "Skills" })).toBeTruthy();
    });

    it("hides every skill icon from assistive technology", () => {
        const { container } = render(<Skills />);

        const iconWrappers = container.querySelectorAll(".skill-icon");
        expect(iconWrappers.length).toBeGreaterThan(0);

        for (const wrapper of iconWrappers) {
            expect(wrapper).toHaveAttribute("aria-hidden", "true");
        }

        // Each wrapper's react-icons child must also be hidden (the svg
        // itself carries role="img" by default from react-icons).
        const iconSvgs = container.querySelectorAll(".skill-icon > svg");
        expect(iconSvgs.length).toBe(iconWrappers.length);

        for (const svg of iconSvgs) {
            expect(svg).toHaveAttribute("aria-hidden", "true");
        }
    });

    it("hides the category icon from assistive technology", () => {
        const { container } = render(<Skills />);

        const wrappers = container.querySelectorAll(".skill-category-icon");
        expect(wrappers.length).toBeGreaterThan(0);

        for (const wrapper of wrappers) {
            expect(wrapper).toHaveAttribute("aria-hidden", "true");
            const svg = wrapper.querySelector("svg");
            expect(svg).not.toBeNull();
            expect(svg).toHaveAttribute("aria-hidden", "true");
        }
    });

    it("renders each skill name as the accessible (visible) text", () => {
        render(<Skills />);

        for (const category of skillCategories) {
            expect(
                screen.getByRole("heading", { name: category.title })
            ).toBeInTheDocument();

            for (const skill of category.skills) {
                expect(
                    screen.getByText(skill.name)
                ).toBeInTheDocument();
            }
        }
    });

    it("gives no icon an aria-label (they are decorative, not meaningful)", () => {
        const { container } = render(<Skills />);

        const labelled = container.querySelectorAll(
            ".skill-icon[aria-label], .skill-category-icon[aria-label]"
        );
        expect(labelled).toHaveLength(0);
    });

    it("keys icon tones to the technology name, not list position", () => {
        const { container } = render(<Skills />);

        const expectedSlugs = skillCategories.flatMap((category) =>
            category.skills.map((skill) =>
                skill.name
                    .toLowerCase()
                    .replace(/&/g, " ")
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-+|-+$/g, "")
            )
        );

        const actualSlugs = Array.from(
            container.querySelectorAll(".skill-icon")
        ).map((wrapper) => wrapper.getAttribute("data-skill"));

        expect(actualSlugs).toEqual(expectedSlugs);
    });
});
