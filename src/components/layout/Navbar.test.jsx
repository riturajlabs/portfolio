// U4 FE-9 regression (docs/PORTFOLIO_UPGRADE.md §7 U4): the Navbar
// must (a) expose the mobile toggle's open/closed state
// (`aria-expanded` + `aria-controls`), (b) mark the active nav link
// with `aria-current`, (c) ship a nav entry for the `#github` section
// so scroll-spy can never activate an id with no corresponding link,
// and (d) keep the icon-only controls at a ≥44×44 tap target
// (docs/DESIGN_SYSTEM.md §8). These are the accessibility facts U4
// fixes at source; the axe gate (with `svg-img-alt` now removed from
// the allowlist) guards them end to end. U4 also repaints active/hover
// nav text (e): `--primary` as text is only 3.45:1 on the dark
// background, so those states must come from the link tokens.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Navbar from "./Navbar";
import ThemeProvider from "../../context/ThemeContext";

function renderNavbar() {
    return render(
        <ThemeProvider>
            <Navbar />
        </ThemeProvider>
    );
}

describe("Navbar (U4 FE-9)", () => {
    it("exposes aria-expanded and aria-controls on the mobile menu toggle", () => {
        renderNavbar();

        const toggle = screen.getByRole("button", { name: "Open Menu" });

        expect(toggle).toHaveAttribute("aria-expanded", "false");
        expect(toggle).toHaveAttribute("aria-controls", "mobile-menu-panel");

        fireEvent.click(toggle);

        const closeToggle = screen.getByRole("button", { name: "Close Menu" });
        expect(closeToggle).toHaveAttribute("aria-expanded", "true");
        expect(closeToggle).toHaveAttribute("aria-controls", "mobile-menu-panel");
    });

    it("renders a nav link for every section id, including #github", () => {
        renderNavbar();

        const nav = screen.getByRole("navigation");
        const hrefs = [...nav.querySelectorAll("a[href^='#']")].map((a) =>
            a.getAttribute("href")
        );

        // #github is the id GithubStats renders; it previously had no
        // nav entry, so scroll-spy could activate an id with no link.
        expect(hrefs).toContain("#github");
    });

    it("marks the active link with aria-current, absent on inactive links", async () => {
        renderNavbar();

        // The hook initialises to "home"; Home should start aria-current.
        const homeLinks = screen.getAllByRole("link", { name: "Home" });

        await waitFor(() => {
            for (const link of homeLinks) {
                expect(link).toHaveAttribute("aria-current", "page");
            }
        });

        // Other links are not aria-current until they become active.
        const aboutLinks = screen.getAllByRole("link", { name: "About" });
        for (const link of aboutLinks) {
            expect(link).not.toHaveAttribute("aria-current");
        }
    });

    it("gives both icon-only controls (theme toggle, menu button) a ≥44px target in CSS", () => {
        // jsdom does no layout, so read the stylesheet rule that pins the
        // size (src/styles/navbar.css) rather than computed styles. Pre-U4
        // the menu button was 42px; U4 raises it to the 44px floor.
        const css = readFileSync(
            path.resolve(process.cwd(), "src/styles/navbar.css"),
            "utf8"
        );

        const menuBtnRule = css.match(/\.menu-btn\s*\{[^}]*\}/)?.[0];
        expect(menuBtnRule, ".menu-btn rule missing").toBeTruthy();
        expect(menuBtnRule).toMatch(/width:\s*44px/);
        expect(menuBtnRule).toMatch(/height:\s*44px/);

        const themeToggleRule = css.match(/\.theme-toggle\s*\{[^}]*\}/)?.[0];
        expect(themeToggleRule, ".theme-toggle rule missing").toBeTruthy();
        expect(themeToggleRule).toMatch(/width:\s*44px/);
        expect(themeToggleRule).toMatch(/height:\s*44px/);
    });

    it("paints active and hover nav text with link tokens, never --primary", () => {
        const css = readFileSync(
            path.resolve(process.cwd(), "src/styles/navbar.css"),
            "utf8"
        );

        // Lookbehind: the first `.active-link {` in the stylesheet is the
        // combined mobile rule; this pins the standalone override block.
        const activeRule = css.match(
            /(?<![\w-])\.active-link\s*\{[^}]*\}/
        )?.[0];
        expect(activeRule, ".active-link rule missing").toBeTruthy();
        expect(activeRule).toMatch(/color:\s*var\(--link,/);

        const hoverRule = css.match(/\.nav-links a:hover\s*\{[^}]*\}/)?.[0];
        expect(hoverRule, ".nav-links a:hover rule missing").toBeTruthy();
        expect(hoverRule).toMatch(/color:\s*var\(--link-hover,/);

        // No nav rule may set a text colour from the brand colour. The
        // lookbehind keeps `background-color: var(--primary)` fills legal.
        expect(css).not.toMatch(/(?<!-)color:\s*var\(--primary/);
    });
});
