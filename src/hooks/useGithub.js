import { useEffect, useState } from "react";

import {
    getGithubData,
    getContributionStatus,
} from "../services/githubService";

function buildStats(profile, repositories) {
    if (!profile) return [];

    return [
        {
            title: "Repositories",
            value: `${profile.public_repos}`,
            description: "Projects & Experiments",
        },
        {
            title: "Followers",
            value: `${profile.followers}`,
            description: "Developer Network",
        },
        {
            title: "Following",
            value: `${profile.following}`,
            description: "Community Connections",
        },
        {
            title: "Contribution",
            value: getContributionStatus(repositories),
            description: "Learning & Building",
        },
    ];
}

function useGithub() {
    const [data, setData] = useState({
        profile: null,
        repositories: [],
        stats: [],
        status: "loading",
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        let active = true;

        async function loadGithubData() {
            try {
                const result = await getGithubData();
                if (!active) return;

                const hasMetrics = result.status === "live" || result.status === "cached";
                setData({
                    profile: result.profile,
                    repositories: result.repositories,
                    stats: hasMetrics
                        ? buildStats(result.profile, result.repositories)
                        : [],
                    status: result.status,
                });
                setError(
                    result.status === "unavailable"
                        ? "GitHub data is currently unavailable."
                        : "",
                );
            } catch (err) {
                if (!active) return;
                setData((prev) => ({ ...prev, status: "unavailable", stats: [] }));
                setError(err?.message || "Unable to fetch Github data.");
            } finally {
                if (active) setLoading(false);
            }
        }

        loadGithubData();
        return () => {
            active = false;
        };
    }, []);

    const status = loading ? "loading" : data.status;

    return {
        ...data,
        status,
        live: status === "live",
        cached: status === "cached",
        unavailable: status === "unavailable",
        loading,
        error,
    };
}

export default useGithub;
