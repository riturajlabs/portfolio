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

  build: {
    sourcemap: false,

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
}));