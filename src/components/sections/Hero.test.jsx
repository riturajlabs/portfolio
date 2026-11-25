// U4 contrast regression (docs/PORTFOLIO_UPGRADE.md §7 U4): the
// above-the-fold hero text the axe gate scans must draw its colour from
// link/status tokens that pass AA in both themes. `--primary` as text
// (#2563EB) is only 3.45:1 on the dark background — the exact
// `color-contrast` nodes U4 fixes at source. This pins the three fixes:
// the greeting and the resume outline button use `--link`, the
// availability pill uses `--success-text`, and both tokens exist in
// both theme blocks of variables.css (docs/DESIGN_SYSTEM.md D4).

import { readFileSync } from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Hero from "./Hero";

function readStyle(name) {
    return readFileSync(
        path.resolve(process.cwd(), `src/styles/${name}`),
        "utf8"
    );
}

describe("Hero (U4 contrast: link/status tokens at source)", () => {
    it("renders the gated hero text nodes the rules target", () => {
        const { container } = render(<Hero />);

        expect(container.querySelector(".hero-greeting")).toBeTruthy();
        expect(container.querySelector(".hero-status > span")).toBeTruthy();
        expect(container.querySelector(".btn-outline")).toBeTruthy();
    });

    it("paints the greeting with the link token, not --primary", () => {
        const rule = readStyle("hero.css").match(
            /\.hero-greeting\s*\{[^}]*\}/
        )?.[0];

        expect(rule, ".hero-greeting rule missing").toBeTruthy();
        expect(rule).toMatch(/color:\s*var\(--link\)/);
        expect(rule).not.toMatch(/--primary/);
    });

    it("paints the availability pill text with the success-text token", () => {
        const rule = readStyle("hero.css").match(
            /\.hero-status\s*>\s*span\s*\{[^}]*\}/
        )?.[0];

        expect(rule, ".hero-status > span rule missing").toBeTruthy();
        expect(rule).toMatch(/color:\s*var\(--success-text\)/);
    });

    it("defines --success-text and --link in both theme token blocks", () => {
        const vars = readStyle("variables.css");
        const lightStart = vars.indexOf('[data-theme="light"]');
        expect(lightStart).toBeGreaterThan(-1);

        const darkBlock = vars.slice(0, lightStart);
        const lightBlock = vars.slice(lightStart);

        expect(darkBlock).toMatch(/--success-text:\s*#22C55E/);
        expect(lightBlock).toMatch(/--success-text:\s*#166534/);
        expect(darkBlock).toMatch(/--link:\s*#60A5FA/);
        expect(lightBlock).toMatch(/--link:\s*#1D4ED8/);
    });

    it("paints the resume outline button text with the link token", () => {
        const rule = readStyle("button.css").match(
            /\.btn-outline\s*\{[^}]*\}/
        )?.[0];

        expect(rule, ".btn-outline rule missing").toBeTruthy();
        expect(rule).toMatch(/color:\s*var\(--link\)/);
        expect(rule).toMatch(/border-color:\s*var\(--primary/);
    });
});
