// U6 regression (docs/PORTFOLIO_UPGRADE.md §7 U6, U6-R4):
//   FE-11 — contact destinations come from the CMS-backed
//   `profile.social` via the `socials` adapter, not hardcoded
//   literals, while the delivery contract (form + validation) is
//   untouched.

import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Contact from "./Contact";

vi.mock("../../lib/publicContent", () => ({
    socials: [
        {
            name: "GitHub",
            url: "https://github.com/from-cms",
            icon: () => null,
        },
        {
            name: "LinkedIn",
            url: "https://linkedin.com/in/from-cms",
            icon: () => null,
        },
        {
            name: "Email",
            url: "mailto:hello@from-cms.test",
            icon: () => null,
        },
    ],
}));

vi.mock("../../services/emailService", () => ({
    sendEmail: vi.fn(),
}));

const links = () =>
    Array.from(document.querySelectorAll(".contact-link-row a"));

describe("Contact (U6-R4 CMS-backed social links)", () => {
    it("renders destinations from the socials adapter, not literals", () => {
        render(<Contact />);
        const hrefs = links().map((a) => a.getAttribute("href"));

        expect(hrefs).toEqual([
            "mailto:hello@from-cms.test",
            "https://linkedin.com/in/from-cms",
            "https://github.com/from-cms",
        ]);
    });

    it("preserves the established display order and shows the derived value", () => {
        render(<Contact />);
        const titles = links().map((a) =>
            a.querySelector("h4").textContent
        );

        expect(titles).toEqual(["Email", "LinkedIn", "GitHub"]);
        const emailRow = links()[0];
        expect(emailRow.textContent).toContain("hello@from-cms.test");
    });

    it("keeps the delivery contract intact (form + submit + honeypot present)", () => {
        const { container } = render(<Contact />);

        expect(screen.getByRole("button", { name: /send message/i })).toBeTruthy();
        expect(container.querySelector('#contact input[name="name"]')).not.toBeNull();
        expect(
            container.querySelector(".contact-honeypot")
        ).not.toBeNull();
    });

    it("gives the copy button and send button ≥44px tap targets (FE-13)", () => {
        const css = readFileSync(
            path.resolve(process.cwd(), "src/styles/contacts.css"),
            "utf8"
        );
        const copyRule = css.match(/\.contact-copy-btn\s*\{[^}]*\}/)?.[0];
        const sendRule = css.match(/\.contact-form button\s*\{[^}]*\}/)?.[0];

        expect(copyRule, ".contact-copy-btn rule missing").toBeTruthy();
        expect(copyRule).toMatch(/width:\s*44px/);
        expect(copyRule).toMatch(/height:\s*44px/);
        expect(sendRule, ".contact-form button rule missing").toBeTruthy();
        expect(sendRule).toMatch(/min-height:\s*44px/);
    });
});
