import { motion } from "framer-motion";

import { resolveIcon } from "../icons.jsx";
import { about, profile } from "../../lib/publicContent";
import SectionTitle from "../common/SectionTitle";

import "../../styles/about.css";

const aboutCards = Array.isArray(about?.cards)
    ? about.cards.map((card) => ({
          icon: resolveIcon(card.icon_key),
          title: card.title,
          description: card.description,
      }))
    : [];

function About() {
    const roles = Array.isArray(profile?.roles) ? profile.roles : [];

    return (
        <>
        <section
            id="about"
            className="about-section"
            aria-label="About"
        >
            <div className="container">
                <SectionTitle
                    tag={about?.tag || "About Me"}
                    title={about?.title || ""}
                    description={about?.description || ""}
                />

                <div className="about-content">
                    <motion.div
                        className="about-text"
                        initial={{
                            opacity: 0,
                            x: -40,
                        }}
                        whileInView={{
                            opacity: 1,
                            x: 0,
                        }}
                        viewport={{
                            once: true,
                            margin: "-50px",
                        }}
                        transition={{
                            duration: 0.7,
                        }}
                    >
                        <h3>{about?.heading || "My Journey"}</h3>

                        {(about?.paragraphs || []).map((paragraph) => (
                            <p key={paragraph}>{paragraph}</p>
                        ))}
                    </motion.div>

                    <div className="about-cards">
                        {aboutCards.map((card, index) => {
                            const Icon = card.icon;

                            return (
                                <motion.div
                                    key={card.title}
                                    className="about-card"
                                    initial={{
                                        opacity: 0,
                                        y: 30,
                                    }}
                                    whileInView={{
                                        opacity: 1,
                                        y: 0,
                                    }}
                                    viewport={{
                                        once: true,
                                        margin: "-50px",
                                    }}
                                    transition={{
                                        duration: 0.5,
                                        delay: index * 0.15,
                                    }}
                                >
                                    <div className="about-icon">
                                        <Icon />
                                    </div>

                                    <div className="about-card-info">
                                        <h4>{card.title}</h4>

                                        <p>{card.description}</p>
                                    </div>
                                </motion.div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </section>

        <section
            id="experience"
            className="experience-section"
            aria-label="Experience"
        >
            <div className="container">
                <div className="section-header section-center">
                    <span className="section-tag">Experience</span>

                    <h2 className="section-title">
                        {profile?.title || "Experience"}
                    </h2>

                    {profile?.description && (
                        <p className="section-description">
                            {profile.description}
                        </p>
                    )}
                </div>

                {roles.length > 0 && (
                    <ul className="experience-roles">
                        {roles.map((role) => (
                            <li key={role}>{role}</li>
                        ))}
                    </ul>
                )}
            </div>
        </section>
        </>
    );
}

export default About;