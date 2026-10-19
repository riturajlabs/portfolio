// FE-1 regression (docs/PORTFOLIO_UPGRADE.md §3.1): the cold-start
// fallback must be a *complete* profile — avatar_url, login and name
// included — because GithubStats renders them unguarded and the
// pre-U2 fallback produced a broken avatar plus "@undefined".

import { afterEach, describe, expect, it, vi } from "vitest";

import { getGithubData } from "./githubService";

describe("getGithubData", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("returns a complete fallback profile (avatar, login, name) when the proxy is unreachable", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
        vi.spyOn(console, "warn").mockImplementation(() => {});

        const { profile, repositories } = await getGithubData();

        expect(profile.avatar_url).toBeTruthy();
        expect(profile.login).toBeTruthy();
        expect(profile.name).toBeTruthy();
        expect(profile.html_url).toBeTruthy();
        expect(repositories).toEqual([]);
    });

    it("returns backend data when the proxy responds", async () => {
        const backendPayload = {
            profile: { login: "someone", avatar_url: "https://x/a.png", name: "Some One" },
            repositories: [{ name: "repo" }],
        };
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({ ok: true, json: async () => backendPayload })
        );

        const { profile, repositories } = await getGithubData();
        expect(profile.login).toBe("someone");
        expect(repositories).toHaveLength(1);
    });
});
