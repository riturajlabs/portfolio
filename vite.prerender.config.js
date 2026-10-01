// =========================================================
// 🧪 PRERENDER (SSR) BUILD CONFIG
// =========================================================
// A second, independent Vite build whose only job is to compile
// the project-page React tree into a Node-runnable ESM bundle at
// .prerender/entry.mjs, plus the page stylesheet as a real hashed
// asset.
//
// It is deliberately a separate config rather than a change to
// vite.config.js: the existing single-page app build stays exactly
// as it was, so the homepage bundle cannot regress because of
// prerendering work.
//
// publicDir is disabled so this build does not copy the whole
// public/ tree into .prerender — only the SPA build emits assets
// into dist/.
// =========================================================

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  publicDir: false,

  build: {
    ssr: "scripts/prerender/entry.jsx",

    outDir: ".prerender",
    emptyOutDir: true,

    // Emit the imported CSS as a real asset instead of discarding it,
    // so the generated <link> can reference it by its hashed name.
    ssrEmitAssets: true,

    // The generator reads this to resolve stylesheet filenames.
    // Nothing here is hardcoded in the generated HTML.
    manifest: true,

    minify: false,

    rollupOptions: {
      output: {
        entryFileNames: "entry.mjs",
      },
    },
  },
});