// Phase U3 (docs/PORTFOLIO_UPGRADE.md §7 U3): ThemeContext is the only
// writer of `data-theme`/`color-scheme` after first paint. These tests
// cover the behaviours the blueprint requires — respect the pre-paint
// value, follow the OS when the user has not chosen, persist an
// explicit choice, and never re-render consumers for an unchanged
// theme.

import { memo, useContext, useEffect } from "react";
import { act, render, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ThemeProvider from "./ThemeContext";
import { ThemeContext } from "./themeContext";

function Probe() {
    const { theme, toggleTheme } = useContext(ThemeContext);

    return (
        <button type="button" onClick={toggleTheme}>
            {theme}
        </button>
    );
}

beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
    // jsdom default: no preference → dark.
    window.matchMedia = vi.fn(() => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
    }));
});

describe("ThemeProvider", () => {
    it("honours the theme the pre-paint script already applied", () => {
        document.documentElement.setAttribute("data-theme", "light");

        const { getByRole } = render(
            <ThemeProvider>
                <Probe />
            </ThemeProvider>
        );

        expect(getByRole("button")).toHaveTextContent("light");
    });

    it("does not persist to localStorage on mount (keeps the OS preference live)", () => {
        render(
            <ThemeProvider>
                <Probe />
            </ThemeProvider>
        );

        expect(localStorage.getItem("theme")).toBeNull();
    });

    it("resolves from prefers-color-scheme when nothing is stored", () => {
        window.matchMedia = () => ({
            matches: true,
            addEventListener: () => {},
            removeEventListener: () => {},
        });

        render(
            <ThemeProvider>
                <Probe />
            </ThemeProvider>
        );

        expect(document.documentElement.getAttribute("data-theme")).toBe(
            "light"
        );
    });

    it("persists an explicit choice and updates the DOM", () => {
        const { getByRole } = render(
            <ThemeProvider>
                <Probe />
            </ThemeProvider>
        );

        const button = getByRole("button");
        expect(button).toHaveTextContent("dark");

        fireEvent.click(button);

        expect(button).toHaveTextContent("light");
        expect(document.documentElement.getAttribute("data-theme")).toBe(
            "light"
        );
        expect(localStorage.getItem("theme")).toBe("light");
    });

    it("follows a live OS change only while no explicit choice is stored", () => {
        let listener;
        window.matchMedia = () => ({
            matches: false,
            addEventListener: (_event, handler) => {
                listener = handler;
            },
            removeEventListener: () => {},
        });

        render(
            <ThemeProvider>
                <Probe />
            </ThemeProvider>
        );

        act(() => listener({ matches: true }));

        expect(document.documentElement.getAttribute("data-theme")).toBe(
            "light"
        );
        expect(localStorage.getItem("theme")).toBeNull();
    });

    it("re-renders a memoized consumer only when the theme changes", () => {
        const renders = { count: 0 };

        const MemoProbe = memo(function MemoProbe() {
            useContext(ThemeContext);

            useEffect(() => {
                renders.count += 1;
            });

            return null;
        });

        const { rerender } = render(
            <ThemeProvider>
                <MemoProbe />
            </ThemeProvider>
        );

        const first = renders.count;

        // A parent re-render with an unchanged theme must leave the
        // memoized consumer alone: the context value is memoized.
        rerender(
            <ThemeProvider>
                <MemoProbe />
            </ThemeProvider>
        );

        expect(renders.count).toBe(first);
    });
});
