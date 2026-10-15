// @vitest-environment node
// =========================================================
// CONTENT LOADER TESTS
// =========================================================
// Unit tests for the build-time content loader (src/lib/content.js)
// and its fail-closed guarantees (docs/MIGRATION.md Phase 7).
//
// The transport layer is mocked; the "valid payload" fixture is the
// committed snapshot itself (src/generated/content.js), so this suite
// also guards that snapshot against accidental manual edits: if
// someone hand-edits it into a shape the API schema would reject, the
// validation tests fail.
// =========================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import * as generated from "../generated/content.js";

import {
    ContentBuildError,
    ContentValidationError,
    DEFAULT_CONTENT_API_URL,
    contentTimeoutSeconds,
    fetchContent,
    resolveContentUrl,
    validateContent,
} from "./content.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, "../..");

// The committed snapshot is the validated GET /api/content payload
// (plus url/verification merged into `seo`). Reshape it back into the
// exact API wire shape: everything the endpoint sends, nothing the
// endpoint does not send.
function payloadFixture() {
    const apiSeo = { ...generated.seo };
    delete apiSeo.url;
    delete apiSeo.verification;
    return {
        profile: generated.profile,
        about: generated.about,
        projects: generated.projects,
        skills: generated.skills,
        certifications: generated.certifications,
        seo: apiSeo,
        meta: generated.meta,
    };
}

function fetchOk(body, { status = 200 } = {}) {
    return vi.fn(async () => ({
        ok: status >= 200 && status < 300,
        status,
        async text() {
            return typeof body === "string" ? body : JSON.stringify(body);
        },
    }));
}



// =========================================================
// CONFIGURATION
// =========================================================

describe("resolveContentUrl", () => {
    it("falls back to the local development backend when unset", () => {
        expect(resolveContentUrl({})).toBe(DEFAULT_CONTENT_API_URL);
    });

    it("prefers CONTENT_API_URL verbatim", () => {
        expect(
            resolveContentUrl({ CONTENT_API_URL: "https://x/api/content" })
        ).toBe("https://x/api/content");
    });

    it("ignores a blank CONTENT_API_URL", () => {
        expect(resolveContentUrl({ CONTENT_API_URL: "   " })).toBe(
            DEFAULT_CONTENT_API_URL
        );
    });
});

describe("contentTimeoutSeconds", () => {
    it("defaults to 10 seconds", () => {
        expect(contentTimeoutSeconds({})).toBe(10);
    });

    it("parses CONTENT_API_TIMEOUT", () => {
        expect(contentTimeoutSeconds({ CONTENT_API_TIMEOUT: "30" })).toBe(30);
    });

    it("ignores a non-numeric or non-positive value", () => {
        expect(contentTimeoutSeconds({ CONTENT_API_TIMEOUT: "banana" })).toBe(10);
        expect(contentTimeoutSeconds({ CONTENT_API_TIMEOUT: "0" })).toBe(10);
        expect(contentTimeoutSeconds({ CONTENT_API_TIMEOUT: "-5" })).toBe(10);
    });
});



// =========================================================
// FETCH + FAIL-CLOSED BEHAVIOUR
// =========================================================

describe("fetchContent", () => {
    const URL = "http://127.0.0.1:8001/api/content";

    it("returns the validated payload on a successful fetch", async () => {
        const payload = payloadFixture();
        const fetchImpl = fetchOk(payload);

        const result = await fetchContent({ url: URL, fetchImpl });

        expect(result).toEqual(payload);
        expect(fetchImpl).toHaveBeenCalledWith(
            URL,
            expect.objectContaining({
                method: "GET",
                headers: { accept: "application/json" },
            })
        );
        expect(fetchImpl.mock.calls[0][1].signal).toBeDefined();
    });

    it("fails closed on HTTP 503 with the API detail", async () => {
        const fetchImpl = fetchOk(
            { detail: "Content is temporarily unavailable." },
            { status: 503 }
        );

        const error = await fetchContent({ url: URL, fetchImpl }).catch(
            (e) => e
        );

        expect(error).toBeInstanceOf(ContentBuildError);
        expect(error.status).toBe(503);
        expect(error.message).toContain("Content API build fetch failed:");
        expect(error.message).toContain(`GET ${URL}`);
        expect(error.message).toContain("HTTP 503");
        expect(error.message).toContain("Content is temporarily unavailable.");
        expect(error.message).toContain(
            "The public build cannot continue because content is unavailable."
        );
    });

    it("fails closed on HTTP 404", async () => {
        const fetchImpl = fetchOk({ detail: "Not found." }, { status: 404 });

        const error = await fetchContent({ url: URL, fetchImpl }).catch(
            (e) => e
        );

        expect(error).toBeInstanceOf(ContentBuildError);
        expect(error.status).toBe(404);
        expect(error.message).toContain("HTTP 404");
    });

    it("fails closed on invalid JSON", async () => {
        const fetchImpl = fetchOk("<html>not json</html>");

        const error = await fetchContent({ url: URL, fetchImpl }).catch(
            (e) => e
        );

        expect(error).toBeInstanceOf(ContentBuildError);
        expect(error.message).toContain("response was not valid JSON");
    });

    it("fails closed when the network layer rejects", async () => {
        const fetchImpl = vi.fn(async () => {
            throw new Error("getaddrinfo ENOTFOUND content.example");
        });

        const error = await fetchContent({ url: URL, fetchImpl }).catch(
            (e) => e
        );

        expect(error).toBeInstanceOf(ContentBuildError);
        expect(error.message).toContain("getaddrinfo ENOTFOUND content.example");
        expect(error.message).toContain("The public build cannot continue");
    });

    it("fails closed when the bounded fetch times out", async () => {
        vi.useFakeTimers();

        const fetchImpl = vi.fn(
            (_, { signal }) =>
                new Promise((_resolve, reject) => {
                    signal.addEventListener("abort", () =>
                        reject(new DOMException("aborted", "AbortError"))
                    );
                })
        );

        const errorPromise = fetchContent({
            url: URL,
            timeoutSeconds: 0.5,
            fetchImpl,
        }).catch((e) => e);

        await vi.advanceTimersByTimeAsync(600);
        await vi.useRealTimers();

        const error = await errorPromise;
        expect(error).toBeInstanceOf(ContentBuildError);
        expect(error.message).toContain("Content API build fetch failed:");
        expect(error.message).toContain(`GET ${URL}`);
    });

    it("rejects a payload with zero projects (fail closed)", async () => {
        const payload = payloadFixture();
        payload.projects = [];

        const error = await fetchContent({ url: URL, fetchImpl: fetchOk(payload) }).catch(
            (e) => e
        );

        expect(error).toBeInstanceOf(ContentValidationError);
        expect(error.message).toContain("projects must not be empty");
    });

    it("rejects a payload with no profile (fail closed)", async () => {
        const payload = payloadFixture();
        delete payload.profile;

        const error = await fetchContent({ url: URL, fetchImpl: fetchOk(payload) }).catch(
            (e) => e
        );

        expect(error).toBeInstanceOf(ContentValidationError);
        expect(error.message).toContain('missing required top-level key "profile"');
    });
});



// =========================================================
// STRICT VALIDATION
// =========================================================

describe("validateContent", () => {
    it("accepts the committed snapshot in API wire shape", () => {
        expect(() => validateContent(payloadFixture())).not.toThrow();
    });

    it("rejects unknown top-level keys (extra=forbid parity)", () => {
        const payload = payloadFixture();
        payload._migration = { tool: "extract" };

        expect(() => validateContent(payload)).toThrow(
            'unknown top-level key "_migration"'
        );
    });

    it("rejects a missing required top-level key", () => {
        const payload = payloadFixture();
        delete payload.about;

        expect(() => validateContent(payload)).toThrow('missing required top-level key "about"');
    });

    it("rejects zero projects", () => {
        const payload = payloadFixture();
        payload.projects = [];

        expect(() => validateContent(payload)).toThrow(/projects must not be empty/);
    });

    it("rejects a non-positive image dimension", () => {
        const payload = payloadFixture();
        payload.projects[0].image_width = 0;

        expect(() => validateContent(payload)).toThrow(
            "projects[0].image_width must be a positive integer"
        );
    });

    it("rejects an invalid project status", () => {
        const payload = payloadFixture();
        payload.projects[0].status = "draft";

        expect(() => validateContent(payload)).toThrow(
            "projects[0].status must be one of: published, hidden"
        );
    });

    it("rejects a malformed project URL", () => {
        const payload = payloadFixture();
        payload.projects[0].live = "javascript:alert(1)";

        expect(() => validateContent(payload)).toThrow(
            "projects[0].live must be null/empty"
        );
    });

    it("rejects a duplicated slug", () => {
        const payload = payloadFixture();
        payload.projects[1].slug = payload.projects[0].slug;

        expect(() => validateContent(payload)).toThrow(/is duplicated/);
    });

    it("rejects a missing profile name", () => {
        const payload = payloadFixture();
        delete payload.profile.name;

        expect(() => validateContent(payload)).toThrow(
            "profile.name must be a non-empty string"
        );
    });

    it("rejects a bad seo.robots shape", () => {
        const payload = payloadFixture();
        payload.seo.robots = { index: "yes", follow: false };

        expect(() => validateContent(payload)).toThrow(
            "seo.robots.index must be a boolean"
        );
    });

    it("rejects a malformed sameAs entry", () => {
        const payload = payloadFixture();
        payload.seo.sameAs = ["https://github.com/riturajlabs", "not-a-url"];

        expect(() => validateContent(payload)).toThrow(
            "seo.sameAs must be an array of absolute http(s) URLs"
        );
    });

    it("rejects an unparseable generated_at", () => {
        const payload = payloadFixture();
        payload.meta.generated_at = "yesterday";

        expect(() => validateContent(payload)).toThrow(
            "meta.generated_at must be a parseable ISO date string"
        );
    });
});



// =========================================================
// NO FALLBACK TO src/data — CANONICAL GUARD
// =========================================================
// The whole reason Phase 7 exists: the public pipeline must never
// quietly fall back to src/data/*.js. These tests scan the build-time
// + runtime modules for any import/require reaching into src/data and
// for any reference to credentials the loader must never know.
//
// `src/data/*.js` remain migration sources (docs/CONTENT_MAPPING.md);
// only the seed/verification scripts read them. The public pipeline
// reads src/generated/content.js.

describe("no fallback to src/data", () => {
    const files = [
        "src/lib/content.js",
        "src/lib/publicContent.js",
        "src/lib/projectPages.js",
        "src/generated/content.js",
        "scripts/build-content.mjs",
        "scripts/prerender/entry.jsx",
    ];

    it.each(files)("%s never imports src/data", (file) => {
        const source = fs.readFileSync(path.join(rootDir, file), "utf8");

        const imports = source.match(/from\s+["'][^"']*\/data\/[^"']*["']/g) || [];
        const requires = source.match(/require\(\s*["'][^"']*\/data\//g) || [];

        expect(imports.concat(requires)).toEqual([]);
    });

    it("reads only CONTENT_API_URL / CONTENT_API_TIMEOUT, never a secret", () => {
        const source = fs.readFileSync(
            path.join(rootDir, "src", "lib", "content.js"),
            "utf8"
        );

        expect(source).not.toMatch(/process\.env\s*\.?\s*\[?\s*["']?DATABASE_URL/);
        expect(source).not.toMatch(/process\.env\s*\.?\s*\[?\s*["']?ADMIN_TOKEN/);
        expect(source).not.toMatch(/VITE_[A-Z_]+/);
        expect(source).toContain("CONTENT_API_URL");
        expect(source).toContain("CONTENT_API_TIMEOUT");
    });
});