// e2e static server — serves `dist/` (the artifact CI passed) and proxies the
// same-origin API calls the admin UI makes (`/api/admin/*`) to the disposable
// e2e backend on :8901. The public chat/contact/github services in the build
// are VITE_BACKEND_URL-pinned to `http://localhost:8000`; those requests are
// intercepted at the browser layer by `e2e/intercept.mjs` so nothing ever
// reaches a real service.
//
// This mirrors vercel.json: `/admin` serves `admin.html`, `/projects/<slug>/`
// serves the generated project page, everything else falls through to the
// matching file under `dist/`.

import { createReadStream } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const PORT = Number(process.env.E2E_SITE_PORT || 4173);
const BACKEND = `http://127.0.0.1:${process.env.E2E_BACKEND_PORT || 8901}`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".xml": "application/xml",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function notFound(res, message = "Not found") {
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end(message);
}

async function serveFile(res, filePath) {
  const info = await stat(filePath);
  if (!info.isFile()) {
    notFound(res);
    return;
  }
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(filePath).pipe(res);
}

function resourcePath(urlPath) {
  if (urlPath === "/") {
    return path.join(DIST, "index.html");
  }
  if (urlPath === "/admin" || urlPath.startsWith("/admin/")) {
    return path.join(DIST, "admin.html");
  }
  const projectMatch = /^\/projects\/([^/]+)\/?$/.exec(urlPath);
  if (projectMatch) {
    return path.join(DIST, "projects", projectMatch[1], "index.html");
  }
  const decoded = decodeURIComponent(urlPath);
  const candidate = path.resolve(DIST, "." + decoded);
  if (candidate !== DIST && !candidate.startsWith(DIST + path.sep)) {
    return null;
  }
  return candidate;
}

const proxy = (req, res) => {
  const { pathname, search } = new URL(req.url || "/", "http://localhost");
  const headers = { ...req.headers };
  delete headers.host;
  const upstream = request(
    `${BACKEND}${pathname}${search || ""}`,
    {
      method: req.method,
      headers,
    },
    (downstream) => {
      const headers = { ...downstream.headers };
      if (downstream.headers["set-cookie"]) {
        headers["set-cookie"] = downstream.headers["set-cookie"];
      }
      res.writeHead(downstream.statusCode || 502, headers);
      downstream.pipe(res);
    }
  );
  upstream.on("error", (err) => {
    console.error("[serve] proxy error:", err.message);
    if (!res.headersSent) notFound(res, "Backend unreachable");
    else res.destroy();
  });
  req.pipe(upstream);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    proxy(req, res);
    return;
  }
  if (url.pathname.startsWith("/_vercel/")) {
    res.writeHead(200, {
      "Content-Type": "text/javascript",
      "Cache-Control": "no-store",
    });
    res.end(";window.__speedInsights = window.__speedInsights || {};");
    return;
  }
  const filePath = resourcePath(url.pathname);
  if (!filePath) {
    notFound(res);
    return;
  }
  try {
    await serveFile(res, filePath);
  } catch {
    notFound(res);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[serve] dist on http://127.0.0.1:${PORT}, API → ${BACKEND}`);
  readFile(path.join(DIST, "index.html"), "utf8").catch(() => {
    console.error(
      "[serve] FATAL: dist/ is missing or incomplete. Run `npm run build` first."
    );
    process.exit(1);
  });
});