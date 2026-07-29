const USERNAME = "riturajlabs";

const BASE_URL = `https://api.github.com/users/${USERNAME}`;

async function fetchData(url) {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error("Unable to fetch GitHub data.");
    }

    return response.json();
}

export async function getGithubData() {
    const [profile, repositories] = await Promise.all([
        fetchData(BASE_URL),
        fetchData(`${BASE_URL}/repos?sort=updated&per_page=100`)
    ]);

    return {
        profile,
        repositories
    };
}

export function getContributionStatus(repositories) {
    if (!repositories.length) return "Learning";

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