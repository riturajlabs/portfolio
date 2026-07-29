import { motion } from "framer-motion";

import {
    FaGraduationCap,
    FaCode,
    FaBrain,
    FaRocket,
} from "react-icons/fa";

import SectionTitle from "../common/SectionTitle";

import "../../styles/about.css";

const aboutCards = [
    {
        icon: FaGraduationCap,
        title: "Education",
        description:
            "B.Sc. Artificial Intelligence & Machine Learning student, building strong foundations in programming, mathematics, and AI technologies.",
    },
    {
        icon: FaCode,
        title: "Development",
        description:
            "Full Stack Developer focused on building scalable web applications using MERN Stack, modern frontend practices, and backend architectures.",
    },
    {
        icon: FaBrain,
        title: "AI & Machine Learning",
        description:
            "Exploring Machine Learning, Deep Learning, Generative AI, RAG systems, and AI Agents to create intelligent applications.",
    },
    {
        icon: FaRocket,
        title: "Career Goal",
        description:
            "Aspiring AI Engineer combining Software Engineering and Artificial Intelligence to build impactful real-world products.",
    },
];

function About() {
    return (
        <section
            id="about"
            className="about-section"
        >
            <div className="container">
                <SectionTitle
                    tag="About Me"
                    title="Building Software. Exploring Intelligence."
                    description="I am an Artificial Intelligence and Machine Learning student passionate about creating modern software solutions and intelligent systems that solve real-world problems."
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
                        <h3>My Journey</h3>

                        <p>
                            My journey started with web development and
                            problem solving. While building full stack
                            applications, I developed a strong interest
                            in Artificial Intelligence and Machine
                            Learning.
                        </p>

                        <p>
                            Currently, I am strengthening my skills in
                            Data Structures & Algorithms, Machine
                            Learning, Deep Learning, Generative AI, and
                            building AI-powered applications.
                        </p>
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
    );
}

export default About;