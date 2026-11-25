import { motion } from "framer-motion";

import {
    FaGithub,
} from "react-icons/fa";

import SectionTitle from "../common/SectionTitle";
import Skeleton from "../common/Skeleton";

import useGithub from "../../hooks/useGithub";

import "../../styles/github.css";

const FALLBACK_AVATAR = "https://github.com/riturajlabs.png";

const SAFE_PROFILE = {
    html_url: "https://github.com/riturajlabs",
    avatar_url: FALLBACK_AVATAR,
    login: "riturajlabs",
    name: "Rituraj Labh",
};

function GithubStats() {
    const {
        profile,
        stats,
        loading,
        error,
        status: hookStatus,
    } = useGithub();

    const safeProfile = profile || SAFE_PROFILE;
    const status =
        hookStatus ||
        (loading
            ? "loading"
            : error || !stats?.length
                ? "unavailable"
                : "live");
    const stateLabel =
        status === "cached"
            ? "Cached"
            : status === "unavailable"
                ? "Unavailable"
                : "Live";
    const hasMetrics = status === "live" || status === "cached";
    const statItems = stats || [];
    const statsWithStatus = statItems.map((item) => ({
        ...item,
        status:
            item.status ||
            (typeof item.value === "string" && /[a-z]/i.test(item.value)
                ? item.value
                : stateLabel),
    }));
    const stateMessage =
        status === "unavailable"
            ? "GitHub metrics are unavailable right now. Showing the public profile link only."
            : status === "cached"
                ? "Showing the last available GitHub metrics."
                : "";

    return (
        <section
            id="github"
            className="github-section"
            aria-label="GitHub activity"
        >
            <div className="container">
                <SectionTitle
                    tag="GitHub Activity"
                    title="My Coding Journey"
                    description="Consistently building projects, improving problem-solving skills, and exploring modern technologies."
                />

                {loading && (
                    <div className="github-loading" aria-label="Loading GitHub data">
                        <div className="github-profile-skeleton">
                            <Skeleton className="skeleton skeleton-avatar" />
                            <Skeleton className="skeleton skeleton-line w-60" />
                            <Skeleton className="skeleton skeleton-line w-40" />
                        </div>

                        <div className="github-cards">
                            {[0, 1, 2, 3].map((i) => (
                                <div key={i} className="github-card github-card-skeleton">
                                    <Skeleton className="skeleton skeleton-title" />
                                    <Skeleton className="skeleton skeleton-line w-60" />
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {error && (
                    <div className="github-error" role="status">
                        {error}
                    </div>
                )}

                {!loading && stateMessage && (
                    <div
                        className="github-state"
                        data-status={status}
                        role="status"
                    >
                        <span className="github-state-chip">{stateLabel}</span>
                        {stateMessage}
                    </div>
                )}

                {!loading && (
                    <>
                        <div className="github-profile">
                            <a
                                href={safeProfile.html_url || SAFE_PROFILE.html_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="github-profile-link"
                                aria-label={`${safeProfile.name || safeProfile.login || "riturajlabs"} on GitHub`}
                            >
                                <img
                                    src={safeProfile.avatar_url || FALLBACK_AVATAR}
                                    alt={safeProfile.name || safeProfile.login || "GitHub profile"}
                                    className="github-avatar"
                                    loading="lazy"
                                />

                                <div className="github-profile-info">
                                    <h3>
                                        {safeProfile.name || safeProfile.login || "riturajlabs"}
                                    </h3>
                                    <span>
                                        @{safeProfile.login || "riturajlabs"}
                                    </span>
                                </div>
                            </a>

                            {safeProfile.bio && (
                                <p className="github-bio">
                                    {safeProfile.bio}
                                </p>
                            )}
                        </div>

                        {hasMetrics && (
                            <div className="github-cards">
                                {statsWithStatus.map((item, index) => (
                                    <motion.div
                                        key={item.title}
                                        className="github-card"
                                        initial={{ opacity: 0, y: 30 }}
                                        whileInView={{ opacity: 1, y: 0 }}
                                        viewport={{ once: true }}
                                        transition={{ delay: index * 0.1 }}
                                    >
                                        <h3>{item.value}</h3>
                                        <h4>{item.title}</h4>
                                        {item.status && (
                                            <span
                                                className="github-status-chip"
                                                data-status={item.status
                                                    .toLowerCase()
                                                    .replace(/\s+/g, "-")}
                                            >
                                                {item.status}
                                            </span>
                                        )}
                                        <p>{item.description}</p>
                                    </motion.div>
                                ))}
                            </div>
                        )}

                        <div className="github-action">
                            <a
                                href={safeProfile.html_url || SAFE_PROFILE.html_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="github-profile-btn"
                            >
                                <FaGithub aria-hidden="true" />
                                View GitHub Profile
                            </a>
                        </div>
                    </>
                )}
            </div>
        </section>
    );
}

export default GithubStats;
