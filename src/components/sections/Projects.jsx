import { motion } from "framer-motion";

import SectionTitle from "../common/SectionTitle";
import ProjectCard from "../common/ProjectCard";

import projects from "../../data/projects";

import "../../styles/projects.css";

function Projects() {
    return (
        <section
            id="projects"
            className="projects-section"
        >
            <div className="container">

                <SectionTitle
                    tag="My Projects"
                    title="Things I Have Built"
                    description="A collection of my real-world projects combining Full Stack Development, Artificial Intelligence, and modern technologies."
                />

                <div className="projects-grid">
                    {projects.map((project, index) => (
                        <motion.div
                            key={project.title}
                            initial={{
                                opacity: 0,
                                y: 40,
                            }}
                            whileInView={{
                                opacity: 1,
                                y: 0,
                            }}
                            viewport={{
                                once: true,
                            }}
                            transition={{
                                duration: 0.5,
                                delay: index * 0.1,
                            }}
                        >
                            <ProjectCard
                                project={project}
                            />
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    );
}

export default Projects;