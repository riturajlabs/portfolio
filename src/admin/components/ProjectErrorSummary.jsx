import { forwardRef } from "react";

const PROJECT_FIELD_IDS = {
  title: "project-title",
  slug: "project-permalink",
  short_description: "project-short-description",
  long_description: "project-long-description",
  image: "project-image",
  image_alt: "project-image-alt",
  image_width: "project-image-width",
  image_height: "project-image-height",
  category: "project-category",
  tech_stack: "project-tech-stack",
  status: "project-status",
  featured: "project-featured",
  indexable: "project-indexable",
  display_order: "project-display-order",
  live_url: "project-live-url",
  github_url: "project-github-url",
  seo_title: "project-seo-title",
  seo_description: "project-seo-description",
};

const PROJECT_LABELS = {
  title: "Title",
  slug: "Permalink",
  short_description: "Short description",
  long_description: "Long description",
  image: "Image path",
  image_alt: "Image alt text",
  image_width: "Image width",
  image_height: "Image height",
  category: "Category",
  tech_stack: "Tech stack",
  status: "Status",
  featured: "Featured",
  indexable: "Indexable",
  display_order: "Display order",
  live_url: "Live URL",
  github_url: "GitHub URL",
  seo_title: "SEO title",
  seo_description: "SEO description",
};

function focusTarget(id) {
  const target = typeof document === "undefined" ? null : document.getElementById(id);
  if (target && typeof target.focus === "function") target.focus();
}

const ProjectErrorSummary = forwardRef(function ProjectErrorSummary(
  { errors, sectionForPath },
  ref,
) {
  const entries = Object.entries(errors || {}).filter(
    ([path]) => !String(path).startsWith("case_study.") && path !== "case_study",
  );

  if (entries.length === 0) return null;
  entries.sort(([left], [right]) => left.localeCompare(right));

  return (
    <div
      ref={ref}
      id="project-error-summary"
      className="case-study-error-summary admin-project-error-summary"
      role="alert"
      tabIndex={-1}
      aria-labelledby="project-error-summary-title"
    >
      <h3 id="project-error-summary-title">Project needs attention</h3>
      <ul>
        {entries.map(([path, message]) => {
          const targetId = PROJECT_FIELD_IDS[path] || sectionForPath?.(path) || "project-identity";
          return (
            <li key={path}>
              <a
                className="case-study-error-link"
                href={`#${targetId}`}
                onClick={() => focusTarget(targetId)}
              >
                <span className="case-study-error-label">
                  {PROJECT_LABELS[path] || path}
                </span>
                <code className="case-study-error-path">{path}</code>
              </a>
              <span>{message}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
});

export default ProjectErrorSummary;
