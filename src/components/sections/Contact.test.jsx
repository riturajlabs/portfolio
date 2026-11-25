// U6 regression (docs/PORTFOLIO_UPGRADE.md §7 U6, U6-R4):
//   FE-11 — contact destinations come from the CMS-backed
//   `profile.social` via the `socials` adapter, not hardcoded
//   literals, while the delivery contract (form + validation) is
//   untouched.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Contact from "./Contact";
import { sendEmail } from "../../services/emailService";

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

function fillAndSubmit() {
    fireEvent.change(document.querySelector('#contact input[name="name"]'), {
        target: { value: "Ada Lovelace" },
    });
    fireEvent.change(document.querySelector('#contact input[name="email"]'), {
        target: { value: "ada@example.com" },
    });
    fireEvent.change(document.querySelector('#contact textarea[name="message"]'), {
        target: { value: "Hello there" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));
}

describe("Contact (U6-R4 CMS-backed social links)", () => {
    beforeEach(() => {
        sendEmail.mockReset();
    });

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

        const linkRule = css.match(/\.contact-links a\s*\{[^}]*\}/)?.[0];
        expect(linkRule, ".contact-links a rule missing").toBeTruthy();
        expect(linkRule).toMatch(/min-height:\s*44px/);
    });
});

describe("Contact (delivery states)", () => {
    beforeEach(() => {
        sendEmail.mockReset();
    });

    it("labels every form field", () => {
        render(<Contact />);

        expect(screen.getByRole("region", { name: "Contact" })).toBeTruthy();
        expect(screen.getByLabelText("Your Name")).toBeTruthy();
        expect(screen.getByLabelText("Your Email")).toBeTruthy();
        expect(screen.getByLabelText("Your Message")).toBeTruthy();
    });

    it("cancels an in-flight request and explains that nothing was sent", async () => {
        let abortSignal;
        sendEmail.mockImplementation(
            (_, { signal }) =>
                new Promise((resolve, reject) => {
                    abortSignal = signal;
                    signal.addEventListener(
                        "abort",
                        () => reject(new Error("cancelled")),
                        { once: true }
                    );
                })
        );

        render(<Contact />);
        fillAndSubmit();
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        expect(abortSignal.aborted).toBe(true);
        expect(
            await screen.findByText(/sending was cancelled/i)
        ).toBeTruthy();
        expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    });

    it("offers a retry after a failed delivery", async () => {
        sendEmail
            .mockRejectedValueOnce(new Error("Server asleep"))
            .mockResolvedValueOnce({});

        render(<Contact />);
        fillAndSubmit();

        expect(await screen.findByRole("alert")).toHaveTextContent("Server asleep");
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));

        await waitFor(() =>
            expect(screen.getByText("Message sent successfully")).toBeTruthy()
        );
        expect(sendEmail).toHaveBeenCalledTimes(2);
    });

    it("lets the user dismiss a success message", async () => {
        sendEmail.mockResolvedValue({});

        render(<Contact />);
        fillAndSubmit();

        const success = await screen.findByRole("status");
        expect(success).toHaveTextContent("Message sent successfully");
        fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
        expect(screen.queryByText("Message sent successfully")).toBeNull();
    });
});
