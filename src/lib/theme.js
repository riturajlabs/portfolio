// =========================================================
// 🎨 THEME — SINGLE SOURCE OF TRUTH
// =========================================================
// The theme ladder is deliberately tiny and lives here once, so
// `ThemeContext` and the pre-paint script in `index.html` cannot
// disagree about which theme applies:
//
//   1. an explicit choice saved in localStorage.theme
//   2. otherwise, the OS preference (prefers-color-scheme)
//   3. otherwise, dark
//
// `index.html` carries an inlined copy of the ladder because it must
// run before the module graph loads (no flash of the wrong theme).
// This module is the reference implementation; keep the two in sync.
// =========================================================

export const THEME_STORAGE_KEY = "theme";

export const LIGHT_QUERY = "(prefers-color-scheme: light)";

export const THEMES = ["light", "dark"];

export const DEFAULT_THEME = "dark";

/**
 * A value is a theme only when it is exactly one of the two known
 * names. Anything else (null, "auto", corrupt storage) is rejected
 * rather than passed through to the DOM.
 */
export function isTheme(value) {
    return value === "light" || value === "dark";
}

/**
 * Read the explicit preference. Returns `null` when nothing valid is
 * stored, so callers can fall through to the system preference. Storage
 * can throw (Safari private mode, disabled cookies); that is treated as
 * "no preference", not an error.
 */
export function getStoredTheme(storage) {
    try {
        const store =
            storage ??
            (typeof window !== "undefined" ? window.localStorage : null);

        const value = store?.getItem(THEME_STORAGE_KEY);

        return isTheme(value) ? value : null;
    } catch {
        return null;
    }
}

/**
 * Resolve the OS preference from a MediaQueryList. `matches` on the
 * `(prefers-color-scheme: light)` query means light; anything else
 * (dark, or a host without matchMedia) falls back to the default.
 */
export function systemThemeFromMediaList(mediaList) {
    return mediaList?.matches ? "light" : DEFAULT_THEME;
}

/**
 * Resolve the OS preference, injecting `matchMedia` for testability.
 * Falls back to the default when the API is unavailable or throws.
 */
export function getSystemTheme(matchMedia) {
    const mm =
        matchMedia ??
        (typeof window !== "undefined" ? window.matchMedia : undefined);

    if (typeof mm !== "function") {
        return DEFAULT_THEME;
    }

    try {
        return systemThemeFromMediaList(mm(LIGHT_QUERY));
    } catch {
        return DEFAULT_THEME;
    }
}

/**
 * The ladder. `stored` and `system` are both optional; each must be a
 * valid theme name to win. This is the function the pre-paint script
 * mirrors inline.
 */
export function resolveInitialTheme({ stored, system } = {}) {
    if (isTheme(stored)) return stored;
    if (isTheme(system)) return system;
    return DEFAULT_THEME;
}

/**
 * Read the theme already applied to the document by the pre-paint
 * script (or a previous update). Returns `null` when unset/invalid so
 * the provider can resolve from storage instead.
 */
export function getAppliedTheme(root) {
    const node =
        root ??
        (typeof document !== "undefined" ? document.documentElement : null);

    const value = node?.getAttribute("data-theme");

    return isTheme(value) ? value : null;
}

/**
 * Apply a theme to an element (defaults to `<html>`): the
 * `data-theme` attribute selects the token block in
 * `src/styles/variables.css`, and `color-scheme` tells the browser to
 * render native controls (scrollbars, form widgets) to match.
 */
export function applyTheme(theme, root) {
    const node =
        root ??
        (typeof document !== "undefined" ? document.documentElement : null);

    if (!node || !isTheme(theme)) return;

    node.setAttribute("data-theme", theme);
    node.style.colorScheme = theme;
}
