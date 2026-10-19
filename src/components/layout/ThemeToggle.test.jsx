// Phase U3 (docs/PORTFOLIO_UPGRADE.md §7 U3, DESIGN_SYSTEM.md §8): the
// theme control must announce its state and name its action, so the
// current theme is conveyed by more than the icon alone.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import ThemeToggle from "./ThemeToggle";
import ThemeProvider from "../../context/ThemeContext";

function renderToggle() {
    return render(
        <ThemeProvider>
            <ThemeToggle />
        </ThemeProvider>
    );
}

beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
});

describe("ThemeToggle", () => {
    it("names the action and reports the unpressed (dark) state", () => {
        renderToggle();

        const button = screen.getByRole("button", {
            name: "Switch to light theme",
        });

        expect(button).toHaveAttribute("aria-pressed", "false");
    });

    it("toggles to light: label, aria-pressed and the document update", () => {
        renderToggle();

        fireEvent.click(
            screen.getByRole("button", { name: "Switch to light theme" })
        );

        const button = screen.getByRole("button", {
            name: "Switch to dark theme",
        });

        expect(button).toHaveAttribute("aria-pressed", "true");
        expect(document.documentElement.getAttribute("data-theme")).toBe(
            "light"
        );
    });
});
