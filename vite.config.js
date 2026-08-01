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
            if (id.includes("react-icons")) {
              return "icons";
            }
            if (id.includes("@emailjs")) {
              return "email";
            }
          }
        },
      },
    },
  },
}));