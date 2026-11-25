// Phase 10 (docs/TESTING.md §4, §6): the rendered homepage. This is an
// integration test over App — Navbar, Hero, every lazy section, Footer and
// the chat mount — asserting the facts a visitor depends on: all seven
// anchors resolve to real sections, the hero identity/resume facts are
// correct, and every published project links to its static page.
//
// Assertions are by role and accessible name. Motion states are deliberately
// not asserted (TESTING.md §6: animations are explicitly not unit-tested).

import { HelmetProvider } from "react-helmet-async";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import ThemeProvider from "./context/ThemeContext";
import { profile, projects } from "./lib/publicContent";
import { projectPagePath } from "./lib/projectPages";

// Speed Insights injects a third-party script; irrelevant under jsdom.
vi.mock("@vercel/speed-insights/react", () => ({
    SpeedInsights: () => null,
}));

const NAV_ANCHORS = [
    "home",
    "about",
    "skills",
    "projects",
    "github",
    "certifications",
    "blog",
    "contact",
];

function renderApp() {
    // Same provider stack as src/main.jsx.
    return render(
        <HelmetProvider>
            <ThemeProvider>
                <App />
            </ThemeProvider>
        </HelmetProvider>
    );
}

describe("homepage", () => {
    let consoleErrors;

    beforeEach(() => {
        consoleErrors = [];
        vi.spyOn(console, "error").mockImplementation((...args) => {
            consoleErrors.push(args.map(String).join(" "));
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("renders every major section and all 7 navigation anchors resolve", async () => {
        renderApp();

        // Each lazy section has to actually mount — the anchor test below is
        // worthless if the target section is still behind a Suspense boundary.
        for (const id of NAV_ANCHORS) {
            await waitFor(
                () => {
                    expect(
                        document.getElementById(id),
                        `section #${id} never rendered`
                    ).not.toBeNull();
                },
                { timeout: 5000 }
            );
        }

        const nav = screen.getByRole("navigation", {
            name: "Main navigation",
        });
        const links = [...nav.querySelectorAll("a[href^='#']")];
        const hrefs = links.map((link) => link.getAttribute("href"));

        for (const id of NAV_ANCHORS) {
            expect(hrefs, `nav link to #${id} is missing`).toContain(`#${id}`);
            expect(
                document.getElementById(id),
                `nav link #${id} points at no section`
            ).not.toBeNull();
        }

        // No dead hash links beyond the seven real anchors.
        for (const href of hrefs) {
            expect(NAV_ANCHORS).toContain(href.slice(1));
        }
    }, 30000);

    it("shows the profile identity and a working resume link in the hero", async () => {
        renderApp();

        expect(
            await screen.findByRole("heading", { level: 1, name: profile.name })
        ).toBeInTheDocument();

        const resume = await screen.findByRole("link", { name: /download resume/i });
        expect(resume).toHaveAttribute("href", profile.resume);

        const explore = await screen.findByRole("link", { name: /explore my work/i });
        expect(explore).toHaveAttribute("href", "#projects");
    });

    it("renders a card for every published project, each linking to its page", async () => {
        renderApp();

        const published = projects.filter((project) => project.indexable !== false);
        expect(published).toHaveLength(5);

        for (const project of published) {
            // Anchored: the card, its GitHub link and its live-demo link all
            // carry the title, so a loose regex would match three elements.
            const card = await screen.findByRole(
                "link",
                {
                    name: new RegExp(
                        `^View project: ${project.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`
                    ),
                },
                { timeout: 5000 }
            );
            expect(card).toHaveAttribute("href", projectPagePath(project.slug));
        }
    }, 30000);

    it("applies the site title through Helmet", async () => {
        renderApp();

        await waitFor(() => {
            expect(document.title).toBeTruthy();
        });
        expect(document.title).toContain(profile.name.split(" ")[0]);
    });

    it("provides a skip link to the main landmark", async () => {
        renderApp();

        const skipLink = screen.getByRole("link", {
            name: "Skip to main content",
        });
        expect(skipLink).toHaveAttribute("href", "#main-content");
        expect(document.getElementById("main-content")).not.toBeNull();
        expect(document.getElementById("main-content").tagName).toBe("MAIN");
    });

    it("mounts the footer", async () => {
        renderApp();
        expect(await screen.findByRole("contentinfo")).toBeInTheDocument();
    });

    it("logs no unexpected console errors while rendering", async () => {
        renderApp();

        // Let every lazy boundary resolve and the async data paths settle.
        await waitFor(
            () => {
                expect(document.getElementById("contact")).not.toBeNull();
            },
            { timeout: 5000 }
        );
        await new Promise((resolve) => setTimeout(resolve, 50));

        // React's "not wrapped in act(...)" notices are an artifact of
        // timer-driven components (the type animation) updating between
        // assertions, not a defect in the page.
        const unexpected = consoleErrors.filter(
            (message) => !/not wrapped in act/i.test(message)
        );

        expect(unexpected, unexpected.join("\n")).toHaveLength(0);
    }, 30000);
});

// =========================================================
// U8 — App-level chat lifecycle regression
// =========================================================
// App owns the single source of truth for open state. These tests exercise
// the real integration: one trigger before opening, the lazy ChatAssistant
// mount, open → close → remain closed, and reopen — plus the ARIA contract.

// jsdom has no layout engine.
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
}

async function openChat() {
    const fab = await screen.findByRole(
        "button",
        { name: "Open AI Chat" },
        { timeout: 5000 }
    );
    fireEvent.click(fab);
    await waitFor(
        () => expect(screen.getByRole("dialog")).toBeInTheDocument(),
        { timeout: 5000 }
    );
    return fab;
}

describe("U8 — App chat lifecycle", () => {
    beforeEach(() => {
        sessionStorage.clear();
        localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("shows exactly one closed trigger before chat is opened", async () => {
        renderApp();

        const fabs = await screen.findAllByRole("button", {
            name: "Open AI Chat",
        });
        expect(fabs).toHaveLength(1);
        expect(fabs[0]).toHaveAttribute("aria-haspopup", "dialog");
        expect(fabs[0]).toHaveAttribute("aria-expanded", "false");
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("clicking the trigger lazy-mounts ChatAssistant and opens the dialog", async () => {
        renderApp();
        await openChat();

        expect(screen.getByRole("dialog")).toHaveAccessibleName(
            "AI Portfolio Assistant"
        );
        // The single App trigger is hidden while the dialog is open, and the
        // internal trigger stays suppressed — no double FAB.
        expect(
            screen.queryByRole("button", { name: "Open AI Chat" })
        ).toBeNull();
        expect(
            screen.queryByRole("button", { name: "Close AI Chat" })
        ).toBeNull();
    }, 10000);

    it("open → close → remains closed, and the trigger stays available", async () => {
        renderApp();
        await openChat();

        fireEvent.click(screen.getByRole("button", { name: "Close Chat" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

        // The trigger is back, closed, and unique.
        const fabs = await screen.findAllByRole("button", {
            name: "Open AI Chat",
        });
        expect(fabs).toHaveLength(1);
        expect(fabs[0]).toHaveAttribute("aria-expanded", "false");

        // The old bug re-opened the dialog on the next microtask. Let React
        // flush pending updates and give timers a chance to run; it must stay
        // closed.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
        });
        expect(screen.queryByRole("dialog")).toBeNull();
    }, 10000);

    it("reopens correctly after a deliberate close", async () => {
        renderApp();
        await openChat();

        fireEvent.click(screen.getByRole("button", { name: "Close Chat" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

        fireEvent.click(
            screen.getByRole("button", { name: "Open AI Chat" })
        );

        await waitFor(
            () => expect(screen.getByRole("dialog")).toBeInTheDocument(),
            { timeout: 5000 }
        );
    }, 10000);

    it("Escape closes the dialog and leaves the trigger available", async () => {
        renderApp();
        await openChat();

        fireEvent.keyDown(window, { key: "Escape" });
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

        expect(
            screen.getByRole("button", { name: "Open AI Chat" })
        ).toHaveAttribute("aria-expanded", "false");
    }, 10000);
});
