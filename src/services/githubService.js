/**
 * GitHub data fetcher.
 *
 * Routes through the backend `/api/github` proxy so the PAT stays on
 * the server (5000 req/hr instead of 60 req/hr/IP).
 *
 * Falls back gracefully: if the backend is offline or rate-limited,
 * returns placeholder data instead of throwing — so the page still
 * renders.
 */

// Resolved once at module init. The Vercel env var `VITE_BACKEND_URL`
// should be set to `https://portfolio-lxdx.onrender.com` (no trailing slash).
const BACKEND_URL =
    import.meta.env.VITE_BACKEND_URL ||
    import.meta.env.VITE_API_URL ||
    "http://localhost:8000";

const FALLBACK_PROFILE = {
    public_repos: 0,
    followers: 0,
    following: 0,
    html_url: "https://github.com/riturajlabs",
};

const FALLBACK_REPOS = [];

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
        return {
            profile: data.profile ?? FALLBACK_PROFILE,
            repositories: data.repositories ?? FALLBACK_REPOS,
        };
    } catch (err) {
        console.warn(
            "[githubService] Backend proxy unreachable, using fallback:",
            err.message
        );
        return {
            profile: FALLBACK_PROFILE,
            repositories: FALLBACK_REPOS,
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