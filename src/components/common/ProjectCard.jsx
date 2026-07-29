import PropTypes from "prop-types";
import { motion } from "framer-motion";
import {
    FaGithub,
    FaExternalLinkAlt,
    FaStar,
} from "react-icons/fa";

import Button from "./Button";

function ProjectCard({ project }) {
    const technologies =
        project.techStack || project.technologies || [];

    const hasLiveDemo =
        project.live && project.live !== "#";

    const hasGithub =
        project.github && project.github !== "#";

    return (
        <motion.article
            className={`project-card ${
                project.featured ? "featured-project" : ""
            }`}
            whileHover={{ y: -8 }}
            transition={{ duration: 0.3 }}
        >
            {project.featured && (
                <div className="featured-badge">
                    <FaStar />
                    <span>Featured</span>
                </div>
            )}

            {project.image && (
                <div className="project-image">
                    <img
                        src={project.image}
                        alt={project.title}
                        loading="lazy"
                    />
                </div>
            )}

            <div className="project-content">
                <h3 className="project-title">
                    {project.title}
                </h3>

                <p className="project-description">
                    {project.description}
                </p>

                {technologies.length > 0 && (
                    <div className="project-tech">
                        {technologies.map((tech) => (
                            <span key={tech}>
                                {tech}
                            </span>
                        ))}
                    </div>
                )}

                <div className="project-buttons">
                    {hasGithub && (
                        <Button
                            href={project.github}
                            target="_blank"
                            rel="noopener noreferrer"
                            variant="outline"
                        >
                            <FaGithub />
                            <span>Code</span>
                        </Button>
                    )}

                    {hasLiveDemo && (
                        <Button
                            href={project.live}
                            target="_blank"
                            rel="noopener noreferrer"
                            variant="primary"
                        >
                            <FaExternalLinkAlt />
                            <span>Live Demo</span>
                        </Button>
                    )}
                </div>
            </div>
        </motion.article>
    );
}

ProjectCard.propTypes = {
    project: PropTypes.shape({
        title: PropTypes.string.isRequired,
        description: PropTypes.string.isRequired,
        image: PropTypes.string,
        github: PropTypes.string,
        live: PropTypes.string,
        featured: PropTypes.bool,
        techStack: PropTypes.arrayOf(PropTypes.string),
        technologies: PropTypes.arrayOf(PropTypes.string),
    }).isRequired,
};

export default ProjectCard;