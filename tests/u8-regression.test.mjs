// =========================================================
// U8 — REGRESSION: external widget removal
// =========================================================
// Verifies that the redundant third-party WebChat script has been removed
// from index.html. The native React ChatAssistant is the sole AI chat
// interface; shipping both would cause a double-widget and an unnecessary
// external network request on every page load.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(
    path.resolve(__dirname, "../index.html"),
    "utf8",
);
const chatAssistantSource = readFileSync(
    path.resolve(__dirname, "../src/components/common/ChatAssistant.jsx"),
    "utf8",
);
const appSource = readFileSync(
    path.resolve(__dirname, "../src/App.jsx"),
    "utf8",
);
const viteConfigSource = readFileSync(
    path.resolve(__dirname, "../vite.config.js"),
    "utf8",
);

describe("U8 — index.html: external widget removed", () => {
    it("does not contain the webchat-ai-widget external script", () => {
        expect(indexHtml).not.toContain("webchat-ai-widget.vercel.app");
    });

    it("does not contain the old Railway webchat API base URL", () => {
        expect(indexHtml).not.toContain("webchat-ai-production-becf.up.railway.app");
    });

    it("does not contain a data-widget-id attribute (legacy external widget attribute)", () => {
        expect(indexHtml).not.toContain("data-widget-id");
    });

    it("still contains the React app entry point", () => {
        // Belt-and-suspenders: confirm we didn't accidentally remove main.jsx.
        expect(indexHtml).toContain("/src/main.jsx");
    });
});

// The markdown stack is heavy and only needed once the chat renders an AI
// answer. A static import (or a forced manualChunks entry) drags it into the
// initial homepage graph — the U8 leakage bug. These guards run without a
// build, so a regression fails in the normal unit suite.
describe("U8 — markdown stays behind the chat import boundary", () => {
    it("does not statically import react-markdown", () => {
        expect(chatAssistantSource).not.toMatch(
            /import\s+[^;]*\bfrom\s+["']react-markdown["']/
        );
    });

    it("does not statically import remark-gfm", () => {
        expect(chatAssistantSource).not.toMatch(
            /import\s+[^;]*\bfrom\s+["']remark-gfm["']/
        );
    });

    it("loads react-markdown and remark-gfm through dynamic imports", () => {
        expect(chatAssistantSource).toMatch(/import\(\s*["']react-markdown["']\s*\)/);
        expect(chatAssistantSource).toMatch(/import\(\s*["']remark-gfm["']\s*\)/);
    });

    it("lazy-loads ChatAssistant from App", () => {
        expect(appSource).toMatch(
            /lazy\(\s*\(\)\s*=>\s*import\(\s*["']\.\/components\/common\/ChatAssistant["']\s*\)\s*\)/
        );
    });

    it("does not force markdown packages into a named manual chunk", () => {
        // Forcing them into `markdown` made Rolldown co-locate shared modules
        // (react/jsx-runtime) there, turning the chunk into a static entry
        // dependency. Vite must remain free to emit dynamic-only chunks.
        expect(viteConfigSource).not.toMatch(/return\s+["']markdown["']/);
    });
});


