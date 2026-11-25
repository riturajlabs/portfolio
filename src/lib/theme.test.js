// Phase U3 (docs/PORTFOLIO_UPGRADE.md §7 U3): the theme ladder is the
// contract shared by the pre-paint script in index.html and
// ThemeContext. These tests pin the ladder (stored → system → dark),
// the strict theme-name validation and the DOM writer, so a change to
// either consumer can be checked against one reference implementation.

import { describe, expect, it, vi } from "vitest";

import {
    DEFAULT_THEME,
    THEME_STORAGE_KEY,
    applyTheme,
    getAppliedTheme,
    getStoredTheme,
    getSystemTheme,
    isTheme,
    resolveInitialTheme,
    systemThemeFromMediaList,
} from "./theme";

function fakeStorage(value) {
    return { getItem: (key) => (key === THEME_STORAGE_KEY ? value : null) };
}

function fakeRoot(attrs = {}) {
    return {
        style: {},
        setAttribute: vi.fn(),
        getAttribute: (name) => attrs[name] ?? null,
    };
}

describe("isTheme", () => {
    it("accepts only the two known theme names", () => {
        expect(isTheme("light")).toBe(true);
        expect(isTheme("dark")).toBe(true);

        for (const bad of ["auto", "Light", "", null, undefined, 0, {}]) {
            expect(isTheme(bad)).toBe(false);
        }
    });
});

describe("resolveInitialTheme", () => {
    it("prefers an explicit stored choice over the system", () => {
        expect(resolveInitialTheme({ stored: "light", system: "dark" })).toBe(
            "light"
        );
    });

    it("falls back to the system preference when nothing is stored", () => {
        expect(resolveInitialTheme({ stored: null, system: "light" })).toBe(
            "light"
        );
    });

    it("defaults to dark when neither is available or valid", () => {
        expect(resolveInitialTheme({ stored: "junk", system: "nonsense" })).toBe(
            DEFAULT_THEME
        );
        expect(resolveInitialTheme()).toBe(DEFAULT_THEME);
    });
});

describe("getStoredTheme", () => {
    it("returns a valid stored theme", () => {
        expect(getStoredTheme(fakeStorage("light"))).toBe("light");
    });

    it("returns null for a missing or invalid value", () => {
        expect(getStoredTheme(fakeStorage(null))).toBeNull();
        expect(getStoredTheme(fakeStorage("auto"))).toBeNull();
    });

    it("treats a throwing storage as no preference", () => {
        const throwing = {
            getItem: () => {
                throw new Error("SecurityError");
            },
        };
        expect(getStoredTheme(throwing)).toBe(null);
    });
});

describe("getSystemTheme / systemThemeFromMediaList", () => {
    it("reads the light media query", () => {
        expect(systemThemeFromMediaList({ matches: true })).toBe("light");
        expect(systemThemeFromMediaList({ matches: false })).toBe(
            DEFAULT_THEME
        );
        expect(systemThemeFromMediaList(null)).toBe(DEFAULT_THEME);
    });

    it("uses an injected matchMedia and defaults when it is missing", () => {
        const matchMedia = vi.fn(() => ({ matches: true }));
        expect(getSystemTheme(matchMedia)).toBe("light");
        expect(matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: light)");

        expect(getSystemTheme(() => {
            throw new Error("boom");
        })).toBe(DEFAULT_THEME);
    });
});

describe("applyTheme / getAppliedTheme", () => {
    it("writes data-theme and color-scheme", () => {
        const root = fakeRoot();
        applyTheme("light", root);

        expect(root.setAttribute).toHaveBeenCalledWith("data-theme", "light");
        expect(root.style.colorScheme).toBe("light");
    });

    it("ignores invalid theme names", () => {
        const root = fakeRoot();
        applyTheme("neon", root);

        expect(root.setAttribute).not.toHaveBeenCalled();
        expect(root.style.colorScheme).toBeUndefined();
    });

    it("reads back an applied theme, or null when unset/invalid", () => {
        expect(getAppliedTheme(fakeRoot({ "data-theme": "dark" }))).toBe("dark");
        expect(getAppliedTheme(fakeRoot({ "data-theme": "junk" }))).toBeNull();
        expect(getAppliedTheme(fakeRoot())).toBeNull();
    });
});
