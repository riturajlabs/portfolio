import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // Only emit stats.html when explicitly requested: `npm run build -- --mode analyze` or `ANALYZE=1 npm run build`
    ...(mode === "analyze" || process.env.ANALYZE === "1"
      ? [
          visualizer({
            filename: "stats.html",
            open: false,
            gzipSize: true,
            brotliSize: true,
            template: "treemap",
          }),
        ]
      : []),
  ],

  server: {
    // Phase 5 (`docs/DEPLOYMENT.md` §1.5): the backend runs locally on :8001.
    // Proxying keeps the admin API same-origin in dev, so the `SameSite=Strict`
    // session cookie works over plain HTTP on localhost — no CORS-credentials
    // gymnastics, and the browser never talks to :8001 directly.
    // Phase 8 adds the public write path (`/api/contact`) and the GitHub proxy
    // (`/api/github`), which moved from `ai_service` to `backend/`; dev mirrors
    // production's same-origin routing so the deployed rewrite and the local
    // proxy always agree. `/api/chat` still reaches `ai_service` (:8000) in dev
    // — nothing here should point it at the content backend.
    proxy: {
      "/api/admin": {
        target: "http://localhost:8001",
        changeOrigin: true,
      },
      "/api/contact": {
        target: "http://localhost:8001",
        changeOrigin: true,
      },
      "/api/github": {
        target: "http://localhost:8001",
        changeOrigin: true,
      },
      // Phase 11: the resume download link (`GET /api/resume`) is fetched by the
      // browser at runtime, so dev mirrors production's rewrite to the backend.
      "/api/resume": {
        target: "http://localhost:8001",
        changeOrigin: true,
      },
    },
  },

  build: {
    sourcemap: false,

    // Phase 5: the admin dashboard is a second, isolated entry (ADR-010).
    // `rollupOptions.input` declares both HTML files so `npm run build` emits a
    // distinct admin chunk set. The public entry graph is untouched, so the
    // homepage bundle cannot regress because of admin work.
    manifest: true,

    // Default Vite behaviour eagerly preloads every chunk referenced by
    // the entry graph — including the markdown chunk behind the chat
    // assistant's `lazy(() => import("react-markdown"))` boundary. That
    // wastes ~155 KB of bandwidth on the initial paint for visitors who
    // never open the chat. resolveDependencies filters those out so we
    // only preload chunks needed at boot.
    modulePreload: {
      polyfill: false,
      resolveDependencies: (_, deps) => {
        const lazyChunkNames = ["markdown"];
        const eager = deps.filter(
          (url) => !lazyChunkNames.some((name) => url.includes(`/${name}-`)),
        );
        // Drop the .css sibling from the deps list — Vite already emits
        // a <link rel="stylesheet"> tag for it in the HTML head.
        return eager;
      },
    },

    rollupOptions: {
      input: {
        main: "index.html",
        admin: "admin.html",
      },
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("react-dom") || id.includes("/react/")) {
              return "react";
            }
            if (id.includes("bootstrap")) {
              return "bootstrap";
            }
            if (id.includes("framer-motion")) {
              return "motion";
            }
            // 🚀 Removed Gemini from here. It's now safely on the backend!
            if (
              id.includes("react-markdown") ||
              id.includes("remark-gfm") ||
              id.includes("micromark") ||
              id.includes("mdast") ||
              id.includes("hast")
            ) {
              return "markdown";
            }
            // react-icons v5 (>=5.5) only exposes the *pack* root
            // (`react-icons/fa`), not individual files like `fa/FaX`.
            // With `sideEffects:false` in its package.json, named imports
            // tree-shake cleanly under Rolldown, so a single 'icons'
            // chunk doesn't bloat the bundle — and it lets us cache the
            // full FA module across reloads.
            if (id.includes("react-icons")) {
              return "icons";
            }
          }
        },
      },
    },
  },

  test: {
    // Phase 5 (`docs/TESTING.md` §3.1): `npm test` runs vitest.
    // Phase 10 adds `tests/` — repo-level suites that are not product code
    // (the git tripwires). `tests/migration-validation.test.mjs` matches the
    // same include but is excluded from the default run by the `test` script:
    // it validates a built dist/ and has no business running before a build.
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.js"],
    include: [
      "src/**/*.{test,spec}.{js,jsx}",
      "scripts/**/*.{test,spec}.mjs",
      "tests/**/*.{test,spec}.{js,mjs}",
    ],
  },
}));