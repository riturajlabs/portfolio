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
import {
    PROJECT_IMAGE_DIMENSIONS,
    PROJECTS_LIST_PATH,
    SITE_URL,
    absoluteUrl,
    indexableProjects,
    projectPagePath,
    projectPageUrl,
} from "../../src/lib/projectPages";

// Phase 7: the prerenderer consumes the build-time content snapshot
// (src/generated/content.js), not src/data/*.js. The snapshot is the
// validated GET /api/content payload baked in by
// scripts/build-content.mjs during every build.
import {
    profile,
    projects,
    seo,
} from "../../src/generated/content";

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

// Profile and site SEO are the source of truth for the resume path,
// contact details and social profiles quoted in llms.txt. Both come
// from the build-time content snapshot; `seo.url`/`seo.verification`
// were merged into that snapshot from src/config/seo.js by
// scripts/build-content.mjs.
export { profile };
export { seo };