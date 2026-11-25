/**
 * GitHub data fetcher.
 *
 * Routes through the backend `/api/github` proxy so the PAT stays on
 * the server (5000 req/hr instead of 60 req/hr/IP).
 *
 * Falls back gracefully: if the backend is offline or rate-limited,
 * returns an explicit `unavailable` state instead of pretending the
 * fallback identity is live data. A previous successful payload can be
 * served as `cached` state.
 */

const BACKEND_URL =
    (import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

const FALLBACK_PROFILE = {
    public_repos: 0,
    followers: 0,
    following: 0,
    html_url: "https://github.com/riturajlabs",
    avatar_url: "https://github.com/riturajlabs.png",
    login: "riturajlabs",
    name: "Rituraj Labh",
};

const FALLBACK_REPOS = [];

let cachedResult = null;

async function fetchFromBackend() {
    const response = await fetch(`${BACKEND_URL}/api/github`, {
        method: "GET",
        headers: { Accept: "application/json" },
    });

    if (!response.ok) {
        throw new Error(`GitHub proxy HTTP ${response.status}`);
    }
    return response.json();
}

export async function getGithubData() {
    try {
        const data = await fetchFromBackend();
        if (!data?.profile || !Array.isArray(data.repositories)) {
            throw new Error("GitHub proxy returned an invalid payload");
        }

        cachedResult = {
            profile: data.profile,
            repositories: data.repositories,
            status: "live",
            error: "",
        };
        return cachedResult;
    } catch (err) {
        const message = err?.message || "GitHub data is unavailable.";
        console.warn("[githubService] Backend proxy unavailable:", message);

        if (cachedResult) {
            return { ...cachedResult, status: "cached", error: message };
        }

        return {
            profile: FALLBACK_PROFILE,
            repositories: FALLBACK_REPOS,
            status: "unavailable",
            error: message,
        };
    }
}

export function getContributionStatus(repositories) {
    if (!repositories || !repositories.length) return "Learning";

    const latestPush = repositories
        .map((repo) => new Date(repo.pushed_at))
        .sort((a, b) => b - a)[0];

    const today = new Date();
    const diffDays = Math.floor(
        (today - latestPush) / (1000 * 60 * 60 * 24)
    );

    if (diffDays <= 7) return "Active";
    if (diffDays <= 30) return "Consistent";
    return "Learning";
}
