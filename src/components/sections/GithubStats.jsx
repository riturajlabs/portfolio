import { motion } from "framer-motion";

import {
    FaGithub,
} from "react-icons/fa";

import useGithub from "../../hooks/useGithub";

import "../../styles/github.css";


function GithubStats() {

    const {
        profile,
        stats,
        loading,
        error,
    } = useGithub();



    return (

        <section
            id="github"
            className="github-section"
        >

            <div className="container">


                {/* ================= HEADER ================= */}

                <motion.div

                    className="section-header"

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

                >

                    <span className="section-tag">
                        GitHub Activity
                    </span>


                    <h2 className="section-title">
                        My Coding Journey
                    </h2>


                    <p className="section-description">

                        Consistently building projects,
                        improving problem-solving skills,
                        and exploring modern technologies.

                    </p>


                </motion.div>





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

                        <div className="github-error">

                            {error}

                        </div>

                    )
                }





                {/* ================= STATS ================= */}

                {
                    !loading && !error && (

                        <>


                            {/* ================= PROFILE CARD ================= */}

                            {
                                profile && (

                                    <div className="github-profile">

                                        <a
                                            href={profile.html_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="github-profile-link"
                                            aria-label={`${profile.name || profile.login} on GitHub`}
                                        >
                                            <img
                                                src={profile.avatar_url}
                                                alt={profile.name || profile.login}
                                                className="github-avatar"
                                                loading="lazy"
                                            />

                                            <div className="github-profile-info">

                                                <h3>
                                                    {profile.name || profile.login}
                                                </h3>

                                                <span>
                                                    @{profile.login}
                                                </span>

                                            </div>

                                        </a>

                                        {
                                            profile.bio && (
                                                <p className="github-bio">
                                                    {profile.bio}
                                                </p>
                                            )
                                        }

                                    </div>

                                )
                            }


                            <div className="github-cards">


                                {
                                    stats.map(
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


                                            <p>
                                                {item.description}
                                            </p>


                                        </motion.div>


                                    ))

                                }


                            </div>






                            {/* ================= PROFILE BUTTON ================= */}


                            {
                                profile && (

                                    <div className="github-action">


                                        <a

                                            href={profile.html_url}

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