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
    DEFAULT_CONTENT_ATTEMPTS,
    contentAttempts,
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
    return structuredClone({
        profile: generated.profile,
        about: generated.about,
        projects: generated.projects,
        skills: generated.skills,
        certifications: generated.certifications,
        seo: apiSeo,
        meta: generated.meta,
    });
}

function normalizedCaseStudyPayload(payload) {
    return {
        ...payload,
        projects: payload.projects.map((project) => ({
            ...project,
            caseStudy: project.caseStudy ?? null,
        })),
    };
}

function caseStudyFixture() {
    return {
        schemaVersion: 1,
        role: "Solo full-stack developer",
        timeline: {
            label: "Jan - Mar 2025",
            start: "2025",
            end: "2025-03",
            duration: "10 weeks",
        },
        team: {
            size: 1,
            roles: ["Frontend", "Backend"],
            note: "Solo build",
        },
        problem: {
            summary: "Support teams had no way to answer repeat questions.",
            context: "The product needed a self-serve assistant.",
        },
        constraints: ["No paid vector database at launch."],
        approach: [
            {
                heading: "Ingestion",
                body: "Documents were normalized, chunked, and embedded.",
            },
        ],
        architecture: {
            summary: "A React dashboard talks to an API and an AI service.",
            components: [
                {
                    name: "Dashboard",
                    role: "Tenant-facing chat",
                    technology: "React, Vite",
                },
            ],
            diagram: {
                src: "https://media.example.com/project-images/diagram.webp",
                alt: "Architecture diagram",
                width: 1600,
                height: 900,
                caption: "Request path.",
            },
        },
        keyDecisions: [
            {
                decision: "Use server-sent events.",
                rationale: "The browser needed incremental tokens.",
                tradeoff: "One-way streaming only.",
            },
        ],
        challenges: [
            {
                problem: "Tenant isolation.",
                resolution: "Every chunk carried a tenant identifier.",
                lesson: "Enforce isolation in the data model.",
            },
        ],
        outcomes: [
            {
                kind: "quantitative",
                statement: "Reduced first-token latency.",
                metric: "first-token latency",
                value: "420",
                unit: "ms",
                baseline: "1.8 s",
                direction: "lower",
                evidence: {
                    status: "verified",
                    source: "Server timing report captured on 2025-03-14.",
                    url: "https://example.com/evidence/latency",
                    note: "Reference deployment only.",
                },
            },
            {
                kind: "qualitative",
                statement: "A non-engineer updated the knowledge base.",
                evidence: null,
            },
        ],
        learnings: ["Grounding the prompt was valuable."],
        gallery: [
            {
                src: "/images/projects/webchat-ai.webp",
                alt: "Chat panel",
                width: 1600,
                height: 900,
                caption: "Streamed answer.",
            },
        ],
        links: [
            {
                label: "Source code",
                url: "https://github.com/riturajlabs/webchat-AI",
                kind: "source",
            },
        ],
    };
}

const CASE_STUDY_WHITESPACE_CODEPOINTS = [
    "\u0009",
    "\u000a",
    "\u000b",
    "\u000c",
    "\u000d",
    "\u0020",
    "\u0085",
    "\u00a0",
    "\u1680",
    "\u2000",
    "\u2001",
    "\u2002",
    "\u2003",
    "\u2004",
    "\u2005",
    "\u2006",
    "\u2007",
    "\u2008",
    "\u2009",
    "\u200a",
    "\u2028",
    "\u2029",
    "\u202f",
    "\u205f",
    "\u3000",
];

const NON_WHITESPACE_CODEPOINTS = [
    "\u001c",
    "\u001d",
    "\u001e",
    "\u001f",
    "\ufeff",
    "\u180e",
    "\u200b",
];

function boundaryCaseStudy(contextLength) {
    return {
        schemaVersion: 1,
        role: "r".repeat(120),
        problem: {
            summary: "s".repeat(600),
            context: "c".repeat(contextLength),
        },
        approach: Array.from({ length: 12 }, () => ({
            heading: "A",
            body: "x".repeat(2000),
        })),
        constraints: Array.from({ length: 12 }, () => "c".repeat(240)),
        learnings: Array.from({ length: 12 }, () => "l".repeat(300)),
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

describe("contentAttempts", () => {
    it("defaults to the bounded attempt budget", () => {
        expect(contentAttempts({})).toBe(DEFAULT_CONTENT_ATTEMPTS);
    });

    it("parses CONTENT_API_ATTEMPTS", () => {
        expect(contentAttempts({ CONTENT_API_ATTEMPTS: "2" })).toBe(2);
    });

    it("ignores a non-integer or non-positive value", () => {
        expect(contentAttempts({ CONTENT_API_ATTEMPTS: "banana" })).toBe(
            DEFAULT_CONTENT_ATTEMPTS
        );
        expect(contentAttempts({ CONTENT_API_ATTEMPTS: "0" })).toBe(
            DEFAULT_CONTENT_ATTEMPTS
        );
        expect(contentAttempts({ CONTENT_API_ATTEMPTS: "-3" })).toBe(
            DEFAULT_CONTENT_ATTEMPTS
        );
        expect(contentAttempts({ CONTENT_API_ATTEMPTS: "2.5" })).toBe(
            DEFAULT_CONTENT_ATTEMPTS
        );
    });

    it("caps at the hard maximum so a misconfiguration cannot loop forever", () => {
        expect(contentAttempts({ CONTENT_API_ATTEMPTS: "1000" })).toBe(10);
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

        expect(result).toEqual(normalizedCaseStudyPayload(payload));
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

        const error = await fetchContent({ url: URL, fetchImpl, attempts: 1 }).catch(
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

        const error = await fetchContent({ url: URL, fetchImpl, attempts: 1 }).catch(
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
            attempts: 1,
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
// BOUNDED RETRIES (cold-start resilience)
// =========================================================
// The production backend is a Render free-tier service: the first request after
// an idle period triggers a cold start that can outlast a single fetch timeout.
// These tests pin the rule set — transient failures are retried up to the bounded
// budget; deterministic ones are not — so the build recovers from a cold start
// without ever weakening the fail-closed contract.

describe("fetchContent retries", () => {
    const URL = "http://127.0.0.1:8001/api/content";

    function textResponse(body, status) {
        return {
            ok: status >= 200 && status < 300,
            status,
            async text() {
                return typeof body === "string" ? body : JSON.stringify(body);
            },
        };
    }

    it("retries a transient transport failure and succeeds on a later attempt", async () => {
        const payload = payloadFixture();
        const fetchImpl = vi
            .fn()
            .mockRejectedValueOnce(new Error("ECONNRESET"))
            .mockResolvedValueOnce(textResponse(payload, 200));

        const result = await fetchContent({
            url: URL,
            fetchImpl,
            attempts: 3,
            retryBackoffMs: 0,
        });

        expect(result).toEqual(normalizedCaseStudyPayload(payload));
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("retries a retryable HTTP status (503) and then succeeds", async () => {
        const payload = payloadFixture();
        const fetchImpl = vi
            .fn()
            .mockResolvedValueOnce(textResponse({ detail: "warming up" }, 503))
            .mockResolvedValueOnce(textResponse(payload, 200));

        const result = await fetchContent({
            url: URL,
            fetchImpl,
            attempts: 3,
            retryBackoffMs: 0,
        });

        expect(result).toEqual(normalizedCaseStudyPayload(payload));
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("retries a timeout and succeeds once the backend answers", async () => {
        vi.useFakeTimers();
        const payload = payloadFixture();
        let calls = 0;
        const fetchImpl = vi.fn((_, { signal }) => {
            calls += 1;
            if (calls === 1) {
                // Never answers: only the AbortController can end this attempt.
                return new Promise((_resolve, reject) => {
                    signal.addEventListener("abort", () =>
                        reject(new DOMException("aborted", "AbortError"))
                    );
                });
            }
            return Promise.resolve(textResponse(payload, 200));
        });

        const promise = fetchContent({
            url: URL,
            timeoutSeconds: 0.5,
            attempts: 2,
            retryBackoffMs: 0,
            fetchImpl,
        });

        await vi.advanceTimersByTimeAsync(600);
        const result = await promise;
        vi.useRealTimers();

        expect(result).toEqual(normalizedCaseStudyPayload(payload));
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("does not retry a deterministic 404", async () => {
        const fetchImpl = fetchOk({ detail: "Not found." }, { status: 404 });

        const error = await fetchContent({
            url: URL,
            fetchImpl,
            attempts: 3,
            retryBackoffMs: 0,
        }).catch((e) => e);

        expect(error).toBeInstanceOf(ContentBuildError);
        expect(error.status).toBe(404);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("does not retry an invalid-JSON body", async () => {
        const fetchImpl = fetchOk("<html>not json</html>", { status: 200 });

        const error = await fetchContent({
            url: URL,
            fetchImpl,
            attempts: 3,
            retryBackoffMs: 0,
        }).catch((e) => e);

        expect(error).toBeInstanceOf(ContentBuildError);
        expect(error.message).toContain("response was not valid JSON");
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("does not retry a payload that fails validation", async () => {
        const payload = payloadFixture();
        payload.projects = [];
        const fetchImpl = fetchOk(payload, { status: 200 });

        const error = await fetchContent({
            url: URL,
            fetchImpl,
            attempts: 3,
            retryBackoffMs: 0,
        }).catch((e) => e);

        expect(error).toBeInstanceOf(ContentValidationError);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("fails closed after exhausting the bounded attempt budget", async () => {
        const fetchImpl = fetchOk({ detail: "still down" }, { status: 503 });

        const error = await fetchContent({
            url: URL,
            fetchImpl,
            attempts: 3,
            retryBackoffMs: 0,
        }).catch((e) => e);

        expect(error).toBeInstanceOf(ContentBuildError);
        expect(error.status).toBe(503);
        expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it("clamps a non-positive attempt budget to a single attempt", async () => {
        const fetchImpl = fetchOk({ detail: "down" }, { status: 503 });

        const error = await fetchContent({
            url: URL,
            fetchImpl,
            attempts: 0,
            retryBackoffMs: 0,
        }).catch((e) => e);

        expect(error).toBeInstanceOf(ContentBuildError);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("backs off exponentially and caps the delay", async () => {
        vi.useFakeTimers();
        const fetchImpl = fetchOk({ detail: "still down" }, { status: 503 });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        const promise = fetchContent({
            url: URL,
            fetchImpl,
            attempts: 5,
            retryBackoffMs: 2000,
        }).catch((e) => e);

        await vi.advanceTimersByTimeAsync(120000);
        const error = await promise;

        expect(error).toBeInstanceOf(ContentBuildError);
        expect(fetchImpl).toHaveBeenCalledTimes(5);
        const delays = warn.mock.calls.map(([message]) =>
            Number(String(message).match(/retrying in (\d+)ms/)?.[1])
        );
        expect(delays).toEqual([2000, 4000, 8000, 10000]);

        warn.mockRestore();
        vi.useRealTimers();
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
// CASE STUDY CONTRACT
// =========================================================

describe("caseStudy validation", () => {
    function payloadWithCaseStudy(caseStudy = caseStudyFixture()) {
        const payload = payloadFixture();
        payload.projects[0].caseStudy = caseStudy;
        return payload;
    }

    it("normalizes a missing caseStudy to null", () => {
        const payload = payloadFixture();
        expect(payload.projects[0]).not.toHaveProperty("caseStudy");

        const result = validateContent(payload);

        expect(result.projects[0].caseStudy).toBeNull();
    });

    it("accepts an explicit null caseStudy", () => {
        const payload = payloadWithCaseStudy(null);

        expect(() => validateContent(payload)).not.toThrow();
        expect(validateContent(payload).projects[0].caseStudy).toBeNull();
    });

    it("accepts a valid v1 document", () => {
        const payload = payloadWithCaseStudy();

        expect(() => validateContent(payload)).not.toThrow();
    });

    it("still tolerates unknown project-level keys", () => {
        const payload = payloadFixture();
        payload.projects[0].futureProjectKey = true;

        expect(() => validateContent(payload)).not.toThrow();
    });

    it("rejects an unknown top-level case-study key", () => {
        const caseStudy = caseStudyFixture();
        caseStudy.unexpected = true;

        expect(() => validateContent(payloadWithCaseStudy(caseStudy))).toThrow(
            'projects[0].caseStudy has unknown key "unexpected"'
        );
    });

    it("rejects an unknown nested key", () => {
        const caseStudy = caseStudyFixture();
        caseStudy.timeline.season = "spring";

        expect(() => validateContent(payloadWithCaseStudy(caseStudy))).toThrow(
            'projects[0].caseStudy.timeline has unknown key "season"'
        );
    });

    it("rejects a missing or unsupported schemaVersion", () => {
        const missing = caseStudyFixture();
        delete missing.schemaVersion;
        expect(() => validateContent(payloadWithCaseStudy(missing))).toThrow(
            "projects[0].caseStudy.schemaVersion must be 1"
        );

        const unsupported = caseStudyFixture();
        unsupported.schemaVersion = 2;
        expect(() => validateContent(payloadWithCaseStudy(unsupported))).toThrow(
            "projects[0].caseStudy.schemaVersion must be 1"
        );
    });

    it("rejects non-integer schemaVersion values", () => {
        for (const value of [true, false, "1", 1.5]) {
            const caseStudy = caseStudyFixture();
            caseStudy.schemaVersion = value;

            expect(() =>
                validateContent(payloadWithCaseStudy(caseStudy))
            ).toThrow("projects[0].caseStudy.schemaVersion must be 1");
        }
    });

    it("accepts an integral JSON float as 1 after JavaScript parsing", () => {
        const caseStudy = caseStudyFixture();
        caseStudy.schemaVersion = 1.0;

        expect(() =>
            validateContent(payloadWithCaseStudy(caseStudy))
        ).not.toThrow();
    });

    it("rejects an empty document", () => {
        expect(() =>
            validateContent(payloadWithCaseStudy({ schemaVersion: 1 }))
        ).toThrow("must contain at least one substantive field");
    });

    it("accepts normalized timeline endpoints", () => {
        const caseStudy = caseStudyFixture();
        caseStudy.timeline = { start: "2025-06", end: "2025" };

        expect(() => validateContent(payloadWithCaseStudy(caseStudy))).not.toThrow();
    });

    it("rejects a reversed timeline", () => {
        const caseStudy = caseStudyFixture();
        caseStudy.timeline = { start: "2026-01", end: "2025" };

        expect(() => validateContent(payloadWithCaseStudy(caseStudy))).toThrow(
            "timeline.start must be on or before"
        );
    });

    it("rejects a timeline with a day component or invalid month", () => {
        const withDay = caseStudyFixture();
        withDay.timeline = { start: "2025-01-01" };
        expect(() => validateContent(payloadWithCaseStudy(withDay))).toThrow(
            "timeline.start must be YYYY or YYYY-MM"
        );

        const badMonth = caseStudyFixture();
        badMonth.timeline = { end: "2025-13" };
        expect(() => validateContent(payloadWithCaseStudy(badMonth))).toThrow(
            "timeline.end must be YYYY or YYYY-MM"
        );
    });

    it("rejects Arabic-Indic timeline digits", () => {
        for (const start of ["\u0662\u0660\u0662\u0665", "\u0662\u0660\u0662\u0665-\u0660\u0666"]) {
            const caseStudy = caseStudyFixture();
            caseStudy.timeline = { start };

            expect(() =>
                validateContent(payloadWithCaseStudy(caseStudy))
            ).toThrow("timeline.start must be YYYY or YYYY-MM");
        }
    });

    it("requires evidence for quantitative outcomes", () => {
        const caseStudy = caseStudyFixture();
        caseStudy.outcomes[0].evidence = null;

        expect(() => validateContent(payloadWithCaseStudy(caseStudy))).toThrow(
            "evidence is required for quantitative outcomes"
        );
    });

    it("rejects quantitative outcomes without metric or value", () => {
        const caseStudy = caseStudyFixture();
        delete caseStudy.outcomes[0].metric;

        expect(() => validateContent(payloadWithCaseStudy(caseStudy))).toThrow(
            "metric is required for quantitative outcomes"
        );
    });

    it("rejects qualitative outcomes carrying metric fields", () => {
        const caseStudy = caseStudyFixture();
        caseStudy.outcomes[1].metric = "users";

        expect(() => validateContent(payloadWithCaseStudy(caseStudy))).toThrow(
            "qualitative outcomes must not include metric"
        );
    });

    it("requires a descriptive source for verified evidence", () => {
        const caseStudy = caseStudyFixture();
        caseStudy.outcomes[0].evidence.source = null;

        expect(() => validateContent(payloadWithCaseStudy(caseStudy))).toThrow(
            "source is required when status is verified"
        );
    });

    it("rejects a bare URL as evidence source", () => {
        const caseStudy = caseStudyFixture();
        caseStudy.outcomes[0].evidence.source = "https://example.com/evidence";

        expect(() => validateContent(payloadWithCaseStudy(caseStudy))).toThrow(
            "source must describe the artifact, not just a URL"
        );
    });

    it("accepts unverified quantitative outcomes without a source", () => {
        const caseStudy = caseStudyFixture();
        caseStudy.outcomes[0].evidence = { status: "unverified" };

        expect(() => validateContent(payloadWithCaseStudy(caseStudy))).not.toThrow();
    });

    it("accepts flat and absolute image sources", () => {
        const caseStudy = caseStudyFixture();
        caseStudy.gallery.push({
            src: "https://media.example.com/project-images/gallery.webp",
            alt: "Gallery image",
            width: 1200,
            height: 800,
        });

        expect(() => validateContent(payloadWithCaseStudy(caseStudy))).not.toThrow();
    });

    it("rejects a nested local image path", () => {
        const caseStudy = caseStudyFixture();
        caseStudy.gallery[0].src = "/images/projects/webchat-ai/gallery.webp";

        expect(() => validateContent(payloadWithCaseStudy(caseStudy))).toThrow(
            "src must be an absolute http(s) URL or /images/projects/<slug>.webp"
        );
    });

    it("rejects non-positive image dimensions", () => {
        const caseStudy = caseStudyFixture();
        caseStudy.gallery[0].height = 0;

        expect(() => validateContent(payloadWithCaseStudy(caseStudy))).toThrow(
            "projects[0].caseStudy.gallery[0].height must be a positive integer"
        );
    });

    it("rejects numeric strings and booleans for integer fields", () => {
        const invalid = [
            [
                "projects[0].caseStudy.gallery[0].width must be a positive integer",
                (caseStudy) => {
                    caseStudy.gallery[0].width = "1600";
                },
            ],
            [
                "projects[0].caseStudy.gallery[0].width must be a positive integer",
                (caseStudy) => {
                    caseStudy.gallery[0].width = true;
                },
            ],
            [
                "projects[0].caseStudy.gallery[0].height must be a positive integer",
                (caseStudy) => {
                    caseStudy.gallery[0].height = "900";
                },
            ],
            [
                "projects[0].caseStudy.gallery[0].height must be a positive integer",
                (caseStudy) => {
                    caseStudy.gallery[0].height = true;
                },
            ],
            [
                "projects[0].caseStudy.team.size must be an integer from 1 to 1000",
                (caseStudy) => {
                    caseStudy.team.size = "1";
                },
            ],
            [
                "projects[0].caseStudy.team.size must be an integer from 1 to 1000",
                (caseStudy) => {
                    caseStudy.team.size = true;
                },
            ],
            [
                "projects[0].caseStudy.gallery[0].width must be a positive integer",
                (caseStudy) => {
                    caseStudy.gallery[0].width = 1600.5;
                },
            ],
            [
                "projects[0].caseStudy.gallery[0].height must be a positive integer",
                (caseStudy) => {
                    caseStudy.gallery[0].height = 900.5;
                },
            ],
            [
                "projects[0].caseStudy.team.size must be an integer from 1 to 1000",
                (caseStudy) => {
                    caseStudy.team.size = 1.5;
                },
            ],
        ];

        for (const [message, mutate] of invalid) {
            const caseStudy = caseStudyFixture();
            mutate(caseStudy);

            expect(() =>
                validateContent(payloadWithCaseStudy(caseStudy))
            ).toThrow(message);
        }
    });

    it("rejects duplicate link URLs", () => {
        const caseStudy = caseStudyFixture();
        caseStudy.links.push({
            label: "Demo",
            url: caseStudy.links[0].url,
            kind: "demo",
        });

        expect(() => validateContent(payloadWithCaseStudy(caseStudy))).toThrow(
            "links[1].url duplicates an earlier link"
        );
    });

    it("counts Unicode code points for bounded strings", () => {
        const atLimit = caseStudyFixture();
        atLimit.role = "\u{1f600}".repeat(120);
        atLimit.constraints = ["\u{1f600}".repeat(240)];

        expect(() =>
            validateContent(payloadWithCaseStudy(atLimit))
        ).not.toThrow();

        const overRole = caseStudyFixture();
        overRole.role = "\u{1f600}".repeat(121);
        expect(() =>
            validateContent(payloadWithCaseStudy(overRole))
        ).toThrow("role must be 1-120 characters when present");

        const overConstraint = caseStudyFixture();
        overConstraint.constraints = ["\u{1f600}".repeat(241)];
        expect(() =>
            validateContent(payloadWithCaseStudy(overConstraint))
        ).toThrow("constraints[0] must be 1-240 characters");
    });

    it("uses normalized canonical JSON for the 32 KiB limit", () => {
        const multibyte = (bodyLength) => ({
            schemaVersion: 1,
            approach: Array.from({ length: 6 }, () => ({
                heading: "A",
                body: "\u6f22".repeat(bodyLength),
            })),
        });

        expect(() =>
            validateContent(payloadWithCaseStudy(multibyte(1800)))
        ).not.toThrow();
        expect(() =>
            validateContent(payloadWithCaseStudy(multibyte(1805)))
        ).toThrow("must be 32768 bytes or fewer");
        expect(() =>
            validateContent(payloadWithCaseStudy(multibyte(1810)))
        ).toThrow("must be 32768 bytes or fewer");
    });

    it("rejects a document larger than 32 KiB", () => {
        const caseStudy = caseStudyFixture();
        caseStudy.approach = Array.from({ length: 12 }, (_, index) => ({
            heading: `Approach ${index}`,
            body: "x".repeat(2000),
        }));
        caseStudy.challenges = Array.from({ length: 10 }, (_, index) => ({
            problem: `Problem ${index} ${"x".repeat(580)}`,
            resolution: "x".repeat(1200),
            lesson: "x".repeat(600),
        }));

        expect(() => validateContent(payloadWithCaseStudy(caseStudy))).toThrow(
            "must be 32768 bytes or fewer when serialized"
        );
    });

    it.each([
        [953, true],
        [954, true],
        [955, false],
    ])(
        "pins the exact 32 KiB boundary at context length %i",
        (contextLength, accepted) => {
            const payload = payloadWithCaseStudy(
                boundaryCaseStudy(contextLength)
            );

            if (accepted) {
                expect(() => validateContent(payload)).not.toThrow();
            } else {
                expect(() => validateContent(payload)).toThrow(
                    "must be 32768 bytes or fewer when serialized"
                );
            }
        }
    );

    it.each(CASE_STUDY_WHITESPACE_CODEPOINTS)(
        "trims shared whitespace U+%s from text",
        (whitespace) => {
            const padded = caseStudyFixture();
            padded.role = `${whitespace}Solo${whitespace}`;
            expect(() =>
                validateContent(payloadWithCaseStudy(padded))
            ).not.toThrow();

            const atLimit = caseStudyFixture();
            atLimit.role = `${"x".repeat(120)}${whitespace}`;
            expect(() =>
                validateContent(payloadWithCaseStudy(atLimit))
            ).not.toThrow();

            const blank = caseStudyFixture();
            blank.constraints = [whitespace];
            expect(() =>
                validateContent(payloadWithCaseStudy(blank))
            ).toThrow("constraints[0] must be a non-empty string");
        }
    );

    it.each(NON_WHITESPACE_CODEPOINTS)(
        "retains non-whitespace U+%s as content",
        (character) => {
            const text = caseStudyFixture();
            text.role = `${character}Solo${character}`;
            expect(() =>
                validateContent(payloadWithCaseStudy(text))
            ).not.toThrow();

            const atLimit = caseStudyFixture();
            atLimit.role = `${"x".repeat(120)}${character}`;
            expect(() =>
                validateContent(payloadWithCaseStudy(atLimit))
            ).toThrow("role must be 1-120 characters when present");

            expect(() =>
                validateContent(
                    payloadWithCaseStudy({ schemaVersion: 1, role: character })
                )
            ).not.toThrow();
        }
    );

    it.each(CASE_STUDY_WHITESPACE_CODEPOINTS)(
        "does not treat shared whitespace U+%s as substantive",
        (whitespace) => {
            expect(() =>
                validateContent(
                    payloadWithCaseStudy({ schemaVersion: 1, role: whitespace })
                )
            ).toThrow("must contain at least one substantive field");
        }
    );

    it.each(CASE_STUDY_WHITESPACE_CODEPOINTS)(
        "rejects shared whitespace U+%s anywhere in URLs",
        (whitespace) => {
            for (const url of [
                `${whitespace}https://example.com/a`,
                `https://example.com/a${whitespace}b`,
                `https://example.com/a${whitespace}`,
            ]) {
                const evidence = caseStudyFixture();
                evidence.outcomes[0].evidence.url = url;
                expect(() =>
                    validateContent(payloadWithCaseStudy(evidence))
                ).toThrow("outcomes[0].evidence.url must be an absolute http(s) URL");

                const image = caseStudyFixture();
                image.gallery[0].src = url;
                expect(() =>
                    validateContent(payloadWithCaseStudy(image))
                ).toThrow("gallery[0].src must be an absolute http(s) URL");

                const link = caseStudyFixture();
                link.links[0].url = url;
                expect(() =>
                    validateContent(payloadWithCaseStudy(link))
                ).toThrow("links[0].url must be an absolute http(s) URL");
            }
        }
    );

    it.each(NON_WHITESPACE_CODEPOINTS)(
        "allows non-whitespace U+%s in URLs",
        (character) => {
            const url = `https://example.com/a${character}b`;
            const caseStudy = caseStudyFixture();
            caseStudy.outcomes[0].evidence.url = url;
            caseStudy.gallery[0].src = url;
            caseStudy.links[0].url = url;

            expect(() =>
                validateContent(payloadWithCaseStudy(caseStudy))
            ).not.toThrow();
        }
    );

    it("rejects whitespace-only optional URLs but accepts an empty string", () => {
        const empty = caseStudyFixture();
        empty.outcomes[0].evidence.url = "";
        expect(() =>
            validateContent(payloadWithCaseStudy(empty))
        ).not.toThrow();

        const whitespaceOnly = caseStudyFixture();
        whitespaceOnly.outcomes[0].evidence.url = "\u0085";
        expect(() =>
            validateContent(payloadWithCaseStudy(whitespaceOnly))
        ).toThrow("outcomes[0].evidence.url must be an absolute http(s) URL");
    });

    it.each([
        ["\u0020", true],
        ["\u0085", true],
        ["\u001c", false],
        ["\ufeff", false],
    ])(
        "measures canonical bytes after trimming U+%s",
        (wrapper, accepted) => {
            const caseStudy = boundaryCaseStudy(954);
            caseStudy.problem.context =
                `${wrapper}${caseStudy.problem.context}${wrapper}`;
            const payload = payloadWithCaseStudy(caseStudy);

            if (accepted) {
                expect(() => validateContent(payload)).not.toThrow();
            } else {
                expect(() => validateContent(payload)).toThrow(
                    "must be 32768 bytes or fewer when serialized"
                );
            }
        }
    );
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

    it("reads only non-secret CONTENT_API_* build inputs, never a secret", () => {
        const source = fs.readFileSync(
            path.join(rootDir, "src", "lib", "content.js"),
            "utf8"
        );

        expect(source).not.toMatch(/process\.env\s*\.?\s*\[?\s*["']?DATABASE_URL/);
        expect(source).not.toMatch(/process\.env\s*\.?\s*\[?\s*["']?ADMIN_TOKEN/);
        expect(source).not.toMatch(/VITE_[A-Z_]+/);
        expect(source).toContain("CONTENT_API_URL");
        expect(source).toContain("CONTENT_API_TIMEOUT");
        expect(source).toContain("CONTENT_API_ATTEMPTS");
    });
});