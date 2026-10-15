// Phase 10 (docs/TESTING.md §4, §6): the rendered homepage. This is an
// integration test over App — Navbar, Hero, every lazy section, Footer and
// the chat mount — asserting the facts a visitor depends on: all seven
// anchors resolve to real sections, the hero identity/resume facts are
// correct, and every published project links to its static page.
//
// Assertions are by role and accessible name. Motion states are deliberately
// not asserted (TESTING.md §6: animations are explicitly not unit-tested).

import { HelmetProvider } from "react-helmet-async";
import { render, screen, waitFor } from "@testing-library/react";
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

        const nav = screen.getByRole("navigation");
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
