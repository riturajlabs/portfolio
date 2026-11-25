import { motion } from "framer-motion";

import {
    FaGithub,
} from "react-icons/fa";

import SectionTitle from "../common/SectionTitle";

import useGithub from "../../hooks/useGithub";

import "../../styles/github.css";

const FALLBACK_AVATAR = "https://github.com/riturajlabs.png";

// Cold-start safety net (U6-R1). The service already returns a complete
// fallback profile, but the hook can still hand us `null` before data
// lands or if a future failure path skips it. This shape guarantees the
// profile card always renders identity + avatar with no `@undefined` and
// no broken image, independent of the hook's state.
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
    } = useGithub();

    // Only substitute when the hook gave us nothing usable; a real
    // profile (even a partial one) is always preferred, and every field
    // read below still falls back per-key.
    const safeProfile = profile || SAFE_PROFILE;

    // Status chip (U6-R1): derive a label from state the component
    // already has rather than inventing a metric. The Contribution card
    // carries a real status string as its value ("Active" / "Consistent"
    // / "Learning"), so reuse it; numeric cards report the only honest
    // state available here — that the data is live from the proxy.
    const statsWithStatus = stats.map((item) => ({
        ...item,
        status:
            typeof item.value === "string" && item.value
                ? item.value
                : "Live",
    }));



    return (

        <section
            id="github"
            className="github-section"
        >

            <div className="container">


                {/* ================= HEADER ================= */}

                <SectionTitle

                    tag="GitHub Activity"

                    title="My Coding Journey"

                    description="Consistently building projects, improving problem-solving skills, and exploring modern technologies."

                />





                {/* ================= LOADING (SKELETONS) ================= */}

                {
                    loading && (
                        <div className="github-loading" aria-label="Loading GitHub data">

                            {/* Profile skeleton */}
                            <div className="github-profile-skeleton">
                                <div className="skeleton skeleton-avatar"></div>
                                <div className="skeleton skeleton-line w-60"></div>
                                <div className="skeleton skeleton-line w-40"></div>
                            </div>

                            {/* Stat card skeletons */}
                            <div className="github-cards">
                                {
                                    [0, 1, 2, 3].map((i) => (
                                        <div key={i} className="github-card github-card-skeleton">
                                            <div className="skeleton skeleton-title"></div>
                                            <div className="skeleton skeleton-line w-60"></div>
                                        </div>
                                    ))
                                }
                            </div>

                        </div>
                    )
                }





                {/* ================= ERROR ================= */}

                {
                    error && (

                        <div className="github-error" role="status">

                            {error}

                        </div>

                    )
                }





                {/* ================= STATS ================= */}

                {/* U6-R1: the profile fallback renders whenever we are
                    past loading — including on a proxy failure — so a
                    cold start degrades to a complete, safe identity
                    card instead of only an error string. The stats grid
                    is naturally empty when the fetch failed. */}
                {
                    !loading && (

                        <>


                            {/* ================= PROFILE CARD ================= */}

                            {
                                safeProfile && (

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

                                        {
                                            safeProfile.bio && (
                                                <p className="github-bio">
                                                    {safeProfile.bio}
                                                </p>
                                            )
                                        }

                                    </div>

                                )
                            }


                            <div className="github-cards">


                                {
                                    statsWithStatus.map(
                                        (item,index)=>(


                                        <motion.div

                                            key={item.title}

                                            className="github-card"


                                            initial={{
                                                opacity:0,
                                                y:30
                                            }}


                                            whileInView={{
                                                opacity:1,
                                                y:0
                                            }}


                                            viewport={{
                                                once:true
                                            }}


                                            transition={{
                                                delay:index*0.1
                                            }}

                                        >

                                            <h3>
                                                {item.value}
                                            </h3>


                                            <h4>
                                                {item.title}
                                            </h4>

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


                                            <p>
                                                {item.description}
                                            </p>


                                        </motion.div>


                                    ))

                                }


                            </div>






                            {/* ================= PROFILE BUTTON ================= */}


                            {
                                safeProfile && (

                                    <div className="github-action">


                                        <a

                                            href={safeProfile.html_url || SAFE_PROFILE.html_url}

                                            target="_blank"

                                            rel="noopener noreferrer"

                                            className="github-profile-btn"

                                        >

                                            <FaGithub />

                                            View GitHub Profile

                                        </a>


                                    </div>

                                )
                            }



                        </>

                    )
                }



            </div>


        </section>

    );

}


export default GithubStats;