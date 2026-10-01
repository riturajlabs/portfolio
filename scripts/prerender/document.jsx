// =========================================================
// 📄 PROJECT DOCUMENT SHELL
// =========================================================
// The complete HTML document for one prerendered project page:
// head metadata + JSON-LD + the rendered <ProjectPage> markup.
//
// All SEO values come from src/lib/projectPages.js, which is the
// single authority for project-page metadata. This file only
// decides how they are serialised into HTML — it never invents a
// value of its own.
// =========================================================

import { renderToStaticMarkup } from "react-dom/server";

import ProjectPage from "../../src/components/pages/ProjectPage";
import {
    buildProjectMetadata,
    buildProjectStructuredData,
    serializeStructuredData,
} from "../../src/lib/projectPages";



const HTML_ESCAPES = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
};

function escapeHtml(value) {
    return String(value).replace(
        /[&<>"']/g,
        (char) => HTML_ESCAPES[char]
    );
}

function metaName(name, content) {
    return `    <meta name="${name}" content="${escapeHtml(content)}">`;
}

/**
 * React 19 automatically injects
 *
 *   <link rel="preload" as="image" href="...">
 *
 * ahead of any non-lazy <img> it renders — including inside
 * renderToStaticMarkup output. That lands the preload in the body,
 * where browsers discover it late, and leaves a duplicate once the
 * document supplies its own in <head>.
 *
 * So: keep the eager <img> (correct for this page's LCP element),
 * drop React's hoisted copy, and let the single <head> preload below
 * be the authoritative one.
 *
 * The pattern is scoped to image preloads whose href matches this
 * page's own image, so nothing else in the markup can be removed by
 * accident.
 */
function dropHoistedImagePreload(markup, imagePath) {
    if (!imagePath) return markup;

    const escapedPath = imagePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    return markup.replace(
        new RegExp(
            `<link rel="preload" as="image" href="${escapedPath}"[^>]*?\\s*/?>\\s*`,
            "g"
        ),
        ""
    );
}



/**
 * Render a full project HTML document.
 *
 * @param {object} project  entry from src/data/projects.js
 * @param {string[]} stylesheets  root-relative stylesheet URLs,
 *        already resolved from the real Vite build manifest so no
 *        hashed filename is ever hardcoded
 */
export function renderProjectDocument(project, stylesheets = []) {
    const meta = buildProjectMetadata(project);
    const structuredData = buildProjectStructuredData(project);

    const body = dropHoistedImagePreload(
        renderToStaticMarkup(<ProjectPage project={project} />),
        project.image
    );

    const styles = stylesheets
        .map(
            (href) =>
                `    <link rel="stylesheet" href="${escapeHtml(href)}">`
        )
        .join("\n");

    return `<!doctype html>
<html lang="en">

<head>

  <meta charset="UTF-8">

  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <meta http-equiv="X-UA-Compatible" content="IE=edge">

  <title>
    ${escapeHtml(meta.title)}
  </title>

${metaName("description", meta.description)}
${metaName("robots", meta.robots)}
${metaName("author", meta.author || "")}
  <link rel="canonical" href="${escapeHtml(meta.canonical)}">

  <!-- The project image is this page's LCP element: preload it so the
       browser can start fetching before the stylesheet resolves.
       The href matches the <img> src exactly so the request is
       de-duplicated rather than issued twice. -->
  <link rel="preload" as="image" href="${escapeHtml(
      project.image
  )}" fetchpriority="high">

  <meta name="theme-color" content="#2563EB">

  <meta name="color-scheme" content="dark light">

  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" type="image/png" href="/favicon.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192x192.png">
  <link rel="icon" type="image/png" sizes="512x512" href="/favicon-512x512.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">

  <meta property="og:type" content="${escapeHtml(meta.openGraph.type)}">
  <meta property="og:site_name" content="${escapeHtml(meta.openGraph.siteName)}">
  <meta property="og:locale" content="${escapeHtml(meta.openGraph.locale)}">
  <meta property="og:title" content="${escapeHtml(meta.openGraph.title)}">
  <meta property="og:description" content="${escapeHtml(meta.openGraph.description)}">
  <meta property="og:url" content="${escapeHtml(meta.openGraph.url)}">
  <meta property="og:image" content="${escapeHtml(meta.openGraph.image)}">
  <meta property="og:image:width" content="${meta.openGraph.imageWidth}">
  <meta property="og:image:height" content="${meta.openGraph.imageHeight}">
  <meta property="og:image:alt" content="${escapeHtml(meta.openGraph.imageAlt)}">

  <meta name="twitter:card" content="${escapeHtml(meta.twitter.card)}">
  <meta name="twitter:title" content="${escapeHtml(meta.twitter.title)}">
  <meta name="twitter:description" content="${escapeHtml(meta.twitter.description)}">
  <meta name="twitter:image" content="${escapeHtml(meta.twitter.image)}">
  <meta name="twitter:image:alt" content="${escapeHtml(meta.twitter.imageAlt)}">

  <script type="application/ld+json">
${serializeStructuredData(structuredData)}
  </script>

${styles}

</head>

<body>

  <div id="root">
${body}
  </div>

</body>

</html>
`;
}