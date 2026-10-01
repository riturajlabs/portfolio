// =========================================================
// 🧪 PRERENDER ENTRY
// =========================================================
// SSR build entry. Vite compiles this (and the React tree it
// pulls in) into a plain Node-runnable ESM bundle at
// .prerender/entry.mjs, which
// scripts/generate-project-pages.mjs then imports.
//
// Keeping the JSX inside a Vite build is what lets the project
// page be a real shared React component instead of duplicated
// template strings — no extra JSX toolchain, no new dependency.
// =========================================================

// Pulled in for their side effect of registering the page CSS
// with the bundler, so it lands in the manifest as a real,
// hashed asset the generated <link> can point at.
import "../../src/styles/variables.css";
import "../../src/styles/button.css";
import "../../src/styles/project-page.css";

import { renderProjectDocument } from "./document.jsx";
import projects from "../../src/data/projects";
import profile from "../../src/data/profile";
import seo from "../../src/config/seo";
import {
    PROJECT_IMAGE_DIMENSIONS,
    PROJECTS_LIST_PATH,
    SITE_URL,
    absoluteUrl,
    indexableProjects,
    projectPagePath,
    projectPageUrl,
} from "../../src/lib/projectPages";

export { renderProjectDocument };
export { indexableProjects };
export { projects };
export { PROJECT_IMAGE_DIMENSIONS };

// URL helpers + site identity are re-exported so the SEO discovery
// generator builds every URL with exactly the same functions that
// produced the canonical tags on the pages themselves. Re-deriving
// URLs inside the generator is how a sitemap drifts away from the
// canonical it claims to describe.
export { SITE_URL };
export { absoluteUrl };
export { projectPagePath };
export { projectPageUrl };
export { PROJECTS_LIST_PATH };

// Profile and site config are the source of truth for the resume
// path, contact details and social profiles quoted in llms.txt.
// Importing profile here also pulls its bundled portrait asset into
// the SSR output; that asset is unused and is never published to
// dist/, so it has no production effect.
export { profile };
export { seo };