// =========================================================
// 📄 PROJECT PAGE
// =========================================================
// A single reusable React component that renders the visible
// HTML for one project. It is rendered two ways from one source:
//
//   1. Build time — `scripts/prerender/entry.jsx` calls it with
//      renderToStaticMarkup() to write dist/projects/<slug>/index.html
//   2. The future /projects route, unchanged, if the homepage
//      ever grows client-side navigation.
//
// It renders strictly from the project object: no props beyond
// `project`, no invented facts, no hardcoded copy. It touches no
// browser globals, so it is safe to evaluate in Node.
// =========================================================

import PropTypes from "prop-types";

import Button from "../common/Button";
import {
    PROJECTS_LIST_PATH,
    SITE_NAME,
    projectImageDimensions,
    projectPagePath,
    relatedProjects,
} from "../../lib/projectPages";

import "../../styles/variables.css";
import "../../styles/button.css";
import "../../styles/project-page.css";



function ProjectPage({ project }) {
    const technologies = project.techStack || [];
    const highlights = project.highlights || [];

    const { width, height } = projectImageDimensions(project);

    const hasLiveDemo =
        typeof project.live === "string" && project.live !== "#";

    const hasGithub =
        typeof project.github === "string" && project.github !== "#";

    // Relevance comes from shared technologies / category in the data
    // (see relatedProjects). May legitimately be empty.
    const related = relatedProjects(project);

    return (
        <div className="project-page">
            <div className="container">
                <main className="project-page-main">
                    <article className="project-page-article">

                        {/* ============ HEADER ============ */}
                        <header className="project-page-header">
                            <a
                                className="project-page-back"
                                href={PROJECTS_LIST_PATH}
                            >
                                &larr; All projects
                            </a>

                            {project.category && (
                                <p className="project-page-category">
                                    {project.category}
                                </p>
                            )}

                            <h1 className="project-page-title">
                                {project.title}
                            </h1>

                            <p className="project-page-summary">
                                {project.description}
                            </p>
                        </header>



                        {/* ============ IMAGE ============ */}
                        {project.image && (
                            <figure className="project-page-figure">
                                {/* No fetchPriority here on purpose:
                                    React 19 hoists a high-priority
                                    image into a <link rel=preload> emitted
                                    at the top of the markup, in the body
                                    and with non-standard attribute casing.
                                    The document template emits a correct
                                    preload in <head> instead. */}
                                <img
                                    src={project.image}
                                    alt={project.imageAlt}
                                    width={width}
                                    height={height}
                                    loading="eager"
                                    decoding="async"
                                />
                            </figure>
                        )}



                        {/* ============ ABOUT ============ */}
                        <section className="project-page-section">
                            <h2>About this project</h2>

                            <p>{project.description}</p>
                        </section>



                        {/* ============ TECH STACK ============ */}
                        {technologies.length > 0 && (
                            <section className="project-page-section">
                                <h2>Built with</h2>

                                <ul className="project-page-tech">
                                    {technologies.map((tech) => (
                                        <li key={tech}>{tech}</li>
                                    ))}
                                </ul>
                            </section>
                        )}



                        {/* ============ HIGHLIGHTS ============ */}
                        {highlights.length > 0 && (
                            <section className="project-page-section">
                                <h2>Highlights</h2>

                                <ul className="project-page-highlights">
                                    {highlights.map((item) => (
                                        <li key={item}>{item}</li>
                                    ))}
                                </ul>
                            </section>
                        )}



                        {/* ============ SOURCE / DEMO ============ */}
                        <nav
                            className="project-page-actions"
                            aria-label={`${project.title} links`}
                        >
                            {hasLiveDemo && (
                                <Button
                                    href={project.live}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    variant="primary"
                                >
                                    Live demo
                                </Button>
                            )}

                            {hasGithub && (
                                <Button
                                    href={project.github}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    variant="outline"
                                >
                                    View source code
                                </Button>
                            )}
                        </nav>



                        {/* ============ RELATED ============ */}
                        {/* Internal links only, to pages this build
                            actually emits (indexableProjects). */}
                        {related.length > 0 && (
                            <section className="project-page-section">
                                <h2>Related projects</h2>

                                <ul className="project-page-related">
                                    {related.map((item) => (
                                        <li
                                            key={item.slug}
                                            className="project-page-related-item"
                                        >
                                            <a
                                                className="project-page-related-link"
                                                href={projectPagePath(
                                                    item.slug
                                                )}
                                            >
                                                {item.title}
                                            </a>

                                            <span className="project-page-related-category">
                                                {item.category}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}



                        {/* ============ BACK ============ */}
                        <footer className="project-page-footer">
                            <a href="/">Back to {SITE_NAME}</a>
                        </footer>

                    </article>
                </main>
            </div>
        </div>
    );
}

ProjectPage.propTypes = {
    project: PropTypes.shape({
        title: PropTypes.string.isRequired,
        description: PropTypes.string.isRequired,
        image: PropTypes.string,
        imageAlt: PropTypes.string,
        slug: PropTypes.string.isRequired,
        category: PropTypes.string,
        live: PropTypes.string,
        github: PropTypes.string,
        techStack: PropTypes.arrayOf(PropTypes.string),
        highlights: PropTypes.arrayOf(PropTypes.string),
    }).isRequired,
};

export default ProjectPage;