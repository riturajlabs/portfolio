import { afterEach, describe, expect, it, vi } from "vitest";

async function loadService() {
    vi.resetModules();
    return import("./githubService");
}

function invalidResponse() {
    return { ok: false, status: 503, json: async () => ({}) };
}

describe("getGithubData", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("returns a complete fallback profile with an explicit unavailable status", async () => {
        const { getGithubData } = await loadService();
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
        vi.spyOn(console, "warn").mockImplementation(() => {});

        const result = await getGithubData();

        expect(result.status).toBe("unavailable");
        expect(result.error).toContain("ECONNREFUSED");
        expect(result.profile.avatar_url).toBeTruthy();
        expect(result.profile.login).toBeTruthy();
        expect(result.profile.name).toBeTruthy();
        expect(result.profile.html_url).toBeTruthy();
        expect(result.repositories).toEqual([]);
    });

    it("returns live data from the proxy and caches it for the next failure", async () => {
        const { getGithubData } = await loadService();
        const backendPayload = {
            profile: { login: "someone", avatar_url: "https://x/a.png", name: "Some One" },
            repositories: [{ name: "repo" }],
        };
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => backendPayload,
            })
        );

        const live = await getGithubData();

        expect(live.status).toBe("live");
        expect(live.error).toBe("");
        expect(live.profile.login).toBe("someone");
        expect(live.repositories).toHaveLength(1);

        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
        vi.spyOn(console, "warn").mockImplementation(() => {});

        const cached = await getGithubData();

        expect(cached.status).toBe("cached");
        expect(cached.profile).toEqual(live.profile);
        expect(cached.repositories).toEqual(live.repositories);
        expect(cached.error).toContain("offline");
    });

    it("does not treat an invalid payload as live data", async () => {
        const { getGithubData } = await loadService();
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
        vi.spyOn(console, "warn").mockImplementation(() => {});

        const result = await getGithubData();

        expect(result.status).toBe("unavailable");
        expect(result.profile.login).toBe("riturajlabs");
        expect(result.repositories).toEqual([]);
    });

    it("does not cache a failed request", async () => {
        const { getGithubData } = await loadService();
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(invalidResponse()));
        vi.spyOn(console, "warn").mockImplementation(() => {});

        const first = await getGithubData();
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    profile: { login: "late", avatar_url: "https://x/late.png", name: "Late" },
                    repositories: [],
                }),
            })
        );

        const second = await getGithubData();

        expect(first.status).toBe("unavailable");
        expect(second.status).toBe("live");
        expect(second.profile.login).toBe("late");
    });
});
