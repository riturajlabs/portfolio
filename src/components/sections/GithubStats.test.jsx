// U6 regression (docs/PORTFOLIO_UPGRADE.md §7 U6, U6-R1):
//   1. Cold-start / API-failure state renders a complete, safe
//      fallback — identity + avatar, never `@undefined`, never a
//      broken image source.
//   2. The status chip renders for each stat card.
//   3. The status chip styling is a theme token (D4), not a literal.

import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import GithubStats from "./GithubStats";

// Mutable hook return so each test can pick a state.
const hookState = {
    profile: null,
    stats: [],
    loading: false,
    error: "",
    status: "",
};

vi.mock("../../hooks/useGithub", () => ({
    default: () => hookState,
}));

function setHook(state) {
    Object.assign(hookState, {
        profile: null,
        stats: [],
        loading: false,
        error: "",
        status: "",
        ...state,
    });
}

function readStyle(name) {
    return readFileSync(
        path.resolve(process.cwd(), `src/styles/${name}`),
        "utf8"
    );
}

const REAL_STATS = [
    {
        title: "Repositories",
        value: "4+",
        description: "Projects & Experiments",
    },
    {
        title: "Contribution",
        value: "Active",
        description: "Learning & Building",
    },
];

describe("GithubStats (U6-R1 cold-start fallback)", () => {
    it("renders a complete fallback profile when the hook yields no profile", () => {
        setHook({ profile: null, stats: [] });
        const { container } = render(<GithubStats />);

        expect(container.textContent).not.toContain("undefined");
        // Identity is present and the avatar has a real source.
        expect(screen.getByText("@riturajlabs")).toBeTruthy();
        const avatar = container.querySelector(".github-avatar");
        expect(avatar).toHaveAttribute("src");
        expect(avatar.getAttribute("src")).not.toContain("undefined");
    });

    it("never renders '@undefined' even for a partial profile", () => {
        setHook({
            profile: { html_url: "https://github.com/x" },
            stats: [],
        });
        const { container } = render(<GithubStats />);

        expect(container.textContent).not.toContain("@undefined");
        expect(container.textContent).not.toContain("undefined");
    });

    it("renders a complete fallback profile on API failure (not just an error string)", () => {
        setHook({
            profile: null,
            stats: [],
            error: "Unable to fetch Github data.",
        });
        const { container } = render(<GithubStats />);

        // Error notice is shown ...
        expect(screen.getByText("Unable to fetch Github data.")).toBeTruthy();
        // ... and the safe identity card is still rendered.
        expect(screen.getByText("@riturajlabs")).toBeTruthy();
        expect(container.querySelector(".github-avatar")).not.toBeNull();
        expect(container.textContent).not.toContain("undefined");
    });
});

describe("GithubStats (U6-R1 status chip)", () => {
    it("renders a status chip per stat card", () => {
        setHook({
            profile: null,
            stats: REAL_STATS,
        });
        const { container } = render(<GithubStats />);

        const chips = container.querySelectorAll(".github-status-chip");
        expect(chips.length).toBe(REAL_STATS.length);
        // Contribution's real status value is surfaced as the chip label.
        const chipText = Array.from(chips).map((c) => c.textContent);
        expect(chipText).toContain("Active");
    });

    it("styles the status chip with theme tokens, not literals (D4)", () => {
        const css = readStyle("github.css");
        const rule = css.match(/\.github-status-chip\s*\{[^}]*\}/)?.[0];

        expect(rule, ".github-status-chip rule missing").toBeTruthy();
        expect(rule).toMatch(/background:\s*var\(--primary-soft\)/);
        expect(rule).toMatch(/color:\s*var\(--link\)/);
        expect(rule).not.toMatch(/rgba\(/);
    });

    it("gives the profile button a ≥44px tap target (FE-13)", () => {
        const css = readStyle("github.css");
        const rule = css.match(/\.github-profile-btn\s*\{[^}]*\}/)?.[0];

        expect(rule, ".github-profile-btn rule missing").toBeTruthy();
        expect(rule).toMatch(/min-height:\s*44px/);
    });
});

describe("GithubStats (explicit data state)", () => {
    it("labels the section and hides metrics when data is unavailable", () => {
        setHook({ status: "unavailable", profile: null, stats: [] });
        const { container } = render(<GithubStats />);

        expect(screen.getByRole("region", { name: "GitHub activity" })).toBeTruthy();
        expect(screen.getByText(/metrics are unavailable right now/i)).toBeTruthy();
        expect(screen.getByText("Unavailable")).toBeTruthy();
        expect(container.querySelector(".github-cards")).toBeNull();
        expect(container.querySelector(".github-profile-link")).toBeTruthy();
    });

    it("marks cached metrics as cached instead of presenting them as live", () => {
        setHook({ status: "cached", profile: null, stats: REAL_STATS });
        const { container } = render(<GithubStats />);

        expect(screen.getByText(/last available github metrics/i)).toBeTruthy();
        expect(container.querySelector(".github-state-chip")).toHaveTextContent("Cached");
        expect(container.querySelectorAll(".github-card")).toHaveLength(
            REAL_STATS.length
        );
    });

    it("uses skeletons while loading", () => {
        setHook({ status: "loading", loading: true, stats: [] });
        const { container } = render(<GithubStats />);

        expect(container.querySelector(".github-loading")).toBeTruthy();
        expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
        expect(container.querySelector(".github-profile")).toBeNull();
    });
});
