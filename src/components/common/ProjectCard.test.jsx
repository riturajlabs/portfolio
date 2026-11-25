// U5 regression (docs/PORTFOLIO_UPGRADE.md §7 U5):
//  1. FE-12 — the project details modal must trap Tab inside the
//     dialog (modelled on ChatAssistant's trap), close on Escape and
//     restore focus to the trigger.
//  2. Image treatment — card and modal images carry explicit
//     width/height so the fixed containers never shift layout.
//  3. Theme consistency — the FE-16 overlays, the hover elevation and
//     every text colour the modal/cards use come from theme tokens
//     that pass AA in both themes (measured in-browser during the U5
//     planning probe; these contracts pin the source of each fix).

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import ProjectCard from "./ProjectCard";

function readStyle(name) {
    return readFileSync(
        path.resolve(process.cwd(), `src/styles/${name}`),
        "utf8"
    );
}

const PROJECT = {
    title: "WebChat AI",
    description: "A multi-tenant AI support chatbot.",
    slug: "webchat-ai",
    image: "/images/projects/webchat-ai.webp",
    imageAlt: "WebChat AI dashboard",
    featured: true,
    category: "AI",
    techStack: ["React", "Node.js"],
    highlights: ["Shipped to production"],
};

// jsdom performs no layout, so every element reports
// offsetParent === null and the trap's visibility filter would drop
// every focusable. Mirror the usual jsdom workaround: non-null
// offsetParent for attached elements.
beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetParent", {
        configurable: true,
        get() {
            return this.parentElement;
        },
    });
});

function openModal() {
    render(<ProjectCard project={PROJECT} />);
    // Exact name: the image overlay also renders a "View Details"
    // control, so a loose /details/i matcher hits both.
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    return screen.getByRole("dialog", { name: /WebChat AI details/i });
}

describe("ProjectCard (U5 FE-12 modal focus trap)", () => {
    it("renders the card, tags, featured badge and the project-page link", () => {
        render(<ProjectCard project={PROJECT} />);

        expect(screen.getByText("WebChat AI")).toBeTruthy();
        expect(screen.getByText("React")).toBeTruthy();
        expect(screen.getByText("Featured")).toBeTruthy();

        const link = screen.getByRole("link", {
            name: "View project: WebChat AI",
        });
        expect(link).toHaveAttribute("href", "/projects/webchat-ai/");
    });

    it("gives the card and modal images explicit intrinsic dimensions", () => {
        const { container } = render(<ProjectCard project={PROJECT} />);

        const cardImg = container.querySelector(".project-image img");
        expect(cardImg).toHaveAttribute("width");
        expect(cardImg).toHaveAttribute("height");
        expect(cardImg).toHaveAttribute("loading", "lazy");

        fireEvent.click(screen.getByRole("button", { name: "Details" }));
        const modalImg = container.querySelector(".project-modal-image img");
        expect(modalImg).toHaveAttribute("width");
        expect(modalImg).toHaveAttribute("height");
    });

    it("opens the dialog with aria-modal and focuses the close button", () => {
        const dialog = openModal();

        expect(dialog).toHaveAttribute("aria-modal", "true");
        expect(document.activeElement).toBe(
            dialog.querySelector(".project-modal-close")
        );
    });

    it("wraps Tab from the last focusable back to the first", () => {
        const dialog = openModal();
        // The trap listens on the inner .project-modal; key events on
        // the focused element bubble up to it, like a real Tab press.
        const modal = dialog.querySelector(".project-modal");
        const focusables = modal.querySelectorAll(
            "button:not([disabled]), [href]"
        );
        const last = focusables[focusables.length - 1];

        last.focus();
        fireEvent.keyDown(last, { key: "Tab" });

        expect(document.activeElement).toBe(focusables[0]);
    });

    it("wraps Shift+Tab from the first focusable to the last", () => {
        const dialog = openModal();
        const modal = dialog.querySelector(".project-modal");
        const focusables = modal.querySelectorAll(
            "button:not([disabled]), [href]"
        );
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        first.focus();
        fireEvent.keyDown(first, { key: "Tab", shiftKey: true });

        expect(document.activeElement).toBe(last);
    });

    it("closes on Escape and restores focus to the Details trigger", async () => {
        render(<ProjectCard project={PROJECT} />);

        const details = screen.getByRole("button", { name: "Details" });
        fireEvent.click(details);
        expect(screen.getByRole("dialog")).toBeTruthy();

        fireEvent.keyDown(window, { key: "Escape" });

        // AnimatePresence keeps the overlay mounted until the exit
        // animation finishes; the dialog must be gone afterwards.
        await waitFor(() => {
            expect(screen.queryByRole("dialog")).toBeNull();
        });
        expect(document.activeElement).toBe(details);
    });
});

describe("ProjectCard (U5 theme-consistency contracts)", () => {
    it("replaces the hardcoded dark overlays with the --overlay token", () => {
        const css = readStyle("projects.css");

        expect(css).not.toMatch(/rgba\(2,\s*6,\s*23/);

        const imageOverlay = css.match(
            /\.project-image-overlay\s*\{[^}]*\}/
        )?.[0];
        expect(imageOverlay, ".project-image-overlay rule missing").toBeTruthy();
        expect(imageOverlay).toMatch(/background:\s*var\(--overlay\)/);

        const modalOverlay = css.match(
            /\.project-modal-overlay\s*\{[^}]*\}/
        )?.[0];
        expect(modalOverlay, ".project-modal-overlay rule missing").toBeTruthy();
        expect(modalOverlay).toMatch(/background:\s*var\(--overlay\)/);
    });

    it("pins card elevation to the token scale, base and hover", () => {
        const css = readStyle("projects.css");

        const base = css.match(/(?<![\w-])\.project-card\s*\{[^}]*\}/)?.[0];
        expect(base, ".project-card rule missing").toBeTruthy();
        expect(base).toMatch(/box-shadow:\s*var\(--elev-1\)/);

        const hover = css.match(/\.project-card:hover\s*\{[^}]*\}/)?.[0];
        expect(hover, ".project-card:hover rule missing").toBeTruthy();
        expect(hover).toMatch(/box-shadow:\s*var\(--elev-2\),\s*var\(--glow-brand-soft\)/);
        expect(hover).not.toMatch(/rgba\(/);
    });

    it("paints tech tags with AA tokens (--primary-soft + --link)", () => {
        const css = readStyle("projects.css");
        const rule = css.match(/\.project-tech span\s*\{[^}]*\}/)?.[0];

        expect(rule, ".project-tech span rule missing").toBeTruthy();
        expect(rule).toMatch(/background:\s*var\(--primary-soft\)/);
        expect(rule).toMatch(/color:\s*var\(--link\)/);
    });

    it("repaints ghost and secondary hover text with --link-hover", () => {
        const css = readStyle("button.css");

        const ghost = css.match(/\.btn-ghost:hover\s*\{[^}]*\}/)?.[0];
        expect(ghost, ".btn-ghost:hover rule missing").toBeTruthy();
        expect(ghost).toMatch(/color:\s*var\(--link-hover\)/);

        const secondary = css.match(/\.btn-secondary:hover\s*\{[^}]*\}/)?.[0];
        expect(secondary, ".btn-secondary:hover rule missing").toBeTruthy();
        expect(secondary).toMatch(/color:\s*var\(--link-hover\)/);
    });

    it("defines --secondary-text in both theme token blocks (D4)", () => {
        const vars = readStyle("variables.css");
        const lightStart = vars.indexOf('[data-theme="light"]');
        expect(lightStart).toBeGreaterThan(-1);

        const darkBlock = vars.slice(0, lightStart);
        const lightBlock = vars.slice(lightStart);

        expect(darkBlock).toMatch(/--secondary-text:\s*#A78BFA/);
        expect(lightBlock).toMatch(/--secondary-text:\s*#6D28D9/);
    });

    it("paints the modal category chip with the secondary-text token", () => {
        const css = readStyle("projects.css");
        const rule = css.match(/\.project-modal-category\s*\{[^}]*\}/)?.[0];

        expect(rule, ".project-modal-category rule missing").toBeTruthy();
        expect(rule).toMatch(/color:\s*var\(--secondary-text\)/);
    });
});
