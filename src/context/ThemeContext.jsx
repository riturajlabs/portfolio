import { useCallback, useEffect, useMemo, useState } from "react";

import { ThemeContext } from "./themeContext";
import {
    LIGHT_QUERY,
    THEME_STORAGE_KEY,
    applyTheme,
    getAppliedTheme,
    getStoredTheme,
    getSystemTheme,
    isTheme,
    resolveInitialTheme,
    systemThemeFromMediaList,
} from "../lib/theme";

// The pre-paint script in index.html has already applied the correct
// theme by the time this runs, so trust it first: reading the applied
// attribute means React's first render can never contradict first
// paint (the source of the old FOUC). Only when it is somehow unset
// (unit tests, stripped HTML) do we re-resolve the ladder.
function readInitialTheme() {
    return (
        getAppliedTheme() ??
        resolveInitialTheme({
            stored: getStoredTheme(),
            system: getSystemTheme(),
        })
    );
}

function ThemeProvider({ children }) {
    const [theme, setThemeState] = useState(readInitialTheme);

    // Persist only on an explicit choice — never on mount. Writing on
    // mount would freeze the OS preference for users who never picked a
    // theme, defeating the `localStorage → prefers-color-scheme → dark`
    // ladder on every later visit.
    const setTheme = useCallback(
        (next) => {
            const resolved =
                typeof next === "function" ? next(theme) : next;

            if (!isTheme(resolved)) return;

            setThemeState(resolved);

            try {
                window.localStorage.setItem(THEME_STORAGE_KEY, resolved);
            } catch {
                // Persistence is best-effort (private mode, disabled storage).
            }
        },
        [theme]
    );

    const toggleTheme = useCallback(() => {
        setTheme((current) => (current === "dark" ? "light" : "dark"));
    }, [setTheme]);

    // One writer for the DOM. Both the initial paint and every change
    // flow through here, so `data-theme` and `color-scheme` never drift.
    useEffect(() => {
        applyTheme(theme);
    }, [theme]);

    // Follow the OS preference live, but only while the user has made no
    // explicit choice. An explicit choice always wins and stops listening.
    useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) return;
        if (getStoredTheme() !== null) return;

        const media = window.matchMedia(LIGHT_QUERY);

        const handleChange = (event) => {
            setThemeState(systemThemeFromMediaList(event));
        };

        media.addEventListener?.("change", handleChange);

        return () => media.removeEventListener?.("change", handleChange);
    }, []);

    // Memoized so consumers only re-render when the theme actually changes.
    const value = useMemo(
        () => ({ theme, setTheme, toggleTheme }),
        [theme, setTheme, toggleTheme]
    );

    return (
        <ThemeContext.Provider value={value}>
            {children}
        </ThemeContext.Provider>
    );
}

export default ThemeProvider;
