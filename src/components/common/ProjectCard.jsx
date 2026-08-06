import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { motion, AnimatePresence } from "framer-motion";
import {
    FaGithub,
    FaExternalLinkAlt,
    FaStar,
    FaEye,
    FaTimes,
} from "react-icons/fa";

import Button from "./Button";

function ProjectCard({ project }) {
    const [open, setOpen] = useState(false);
    const detailsBtnRef = useRef(null);
    const closeBtnRef = useRef(null);

    const technologies =
        project.techStack || project.technologies || [];
    const highlights = project.highlights || [];

    const hasLiveDemo =
        project.live && project.live !== "#";

    const hasGithub =
        project.github && project.github !== "#";

    // Modal lifecycle: lock body scroll, close on Escape,
    // focus the close button, restore focus to the trigger on close.
    useEffect(() => {
        if (!open) return;

        const closeBtn = closeBtnRef.current;
        const detailsBtn = detailsBtnRef.current;

        const onKey = (e) => {
            if (e.key === "Escape") setOpen(false);
        };

        document.body.style.overflow = "hidden";
        window.addEventListener("keydown", onKey);
        closeBtn?.focus();

        return () => {
            document.body.style.overflow = "";
            window.removeEventListener("keydown", onKey);
            detailsBtn?.focus();
        };
    }, [open]);

    return (
        <>
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

                        <div className="project-image-overlay">
                            <button
                                className="project-overlay-btn"
                                onClick={() => setOpen(true)}
                                aria-haspopup="dialog"
                            >
                                <FaEye />
                                <span>View Details</span>
                            </button>
                        </div>
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
                        <button
                            ref={detailsBtnRef}
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => setOpen(true)}
                            aria-haspopup="dialog"
                        >
                            <FaEye />
                            <span>Details</span>
                        </button>

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

            {/* ================= DETAILS MODAL ================= */}
            <AnimatePresence>
                {open && (
                    <motion.div
                        className="project-modal-overlay"
                        onClick={() => setOpen(false)}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        role="dialog"
                        aria-modal="true"
                        aria-label={`${project.title} details`}
                    >
                        <motion.div
                            className="project-modal"
                            onClick={(e) => e.stopPropagation()}
                            initial={{ opacity: 0, scale: 0.95, y: 24 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 24 }}
                            transition={{ duration: 0.25 }}
                        >
                            <button
                                ref={closeBtnRef}
                                className="project-modal-close"
                                onClick={() => setOpen(false)}
                                aria-label="Close details"
                            >
                                <FaTimes />
                            </button>

                            {project.image && (
                                <div className="project-modal-image">
                                    <img
                                        src={project.image}
                                        alt={project.title}
                                    />
                                </div>
                            )}

                            <div className="project-modal-body">
                                {project.category && (
                                    <span className="project-modal-category">
                                        {project.category}
                                    </span>
                                )}

                                <h3>{project.title}</h3>

                                <p>{project.description}</p>

                                {highlights.length > 0 && (
                                    <div className="project-modal-metrics">
                                        <h4>Highlights</h4>
                                        <ul>
                                            {highlights.map((item) => (
                                                <li key={item}>
                                                    {item}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {technologies.length > 0 && (
                                    <div className="project-tech">
                                        {technologies.map((tech) => (
                                            <span key={tech}>
                                                {tech}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                <div className="project-modal-actions">
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
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
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
        category: PropTypes.string,
        techStack: PropTypes.arrayOf(PropTypes.string),
        technologies: PropTypes.arrayOf(PropTypes.string),
        highlights: PropTypes.arrayOf(PropTypes.string),
    }).isRequired,
};

export default ProjectCard;
