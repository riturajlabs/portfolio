// =========================================================
// 📦 CONTENT LOADER — BUILD-TIME SOURCE OF TRUTH
// =========================================================
// Phase 7 (docs/MIGRATION.md): the public site reads content from
// `GET /api/content` at BUILD time, not from `src/data/*.js` and not
// at runtime in the browser.
//
// Architecture:
//
//   PostgreSQL → GET /api/content → `scripts/build-content.mjs` →
//   `src/generated/content.js` → bundler → static dist/
//
// This module is the loader half of that wiring: it resolves the
// endpoint, performs the bounded fetch, and validates the payload
// strictly — the same contract the backend enforces with pydantic
// `extra="forbid"` (docs/API.md §5.1.4.6). The browser never calls
// `/api/content`; the build does, once, and fails closed if anything
// is wrong.
//
// FAIL CLOSED — the design rule this module exists to serve:
//   * unreachable endpoint (connection refused, DNS, timeout) → build fails
//   * HTTP 401/403/404/429/500/503 → build fails
//   * invalid JSON → build fails
//   * payload missing a required key / carrying an unknown key / wrong
//     type / invalid project structure / bad dimensions / bad status /
//     bad URL / zero projects / missing profile → build fails
//   * there is NO fallback to `src/data/*.js`. The only way a static
//     build ships is from a validated `GET /api/content` response.
//
// Secrets are a non-goal: this module reads only `CONTENT_API_URL`
// and `CONTENT_API_TIMEOUT` (docs/DEPLOYMENT.md §3). Nothing here
// ever knows `DATABASE_URL`, `ADMIN_TOKEN` or an API key.
// =========================================================

// The endpoint CONTENT_API_URL must point AT (verbatim, including the
// trailing path). Docs/DEPLOYMENT.md §3.2 documents the production
// value; this default is the local development backend.
export const DEFAULT_CONTENT_API_URL =
    "http://127.0.0.1:8001/api/content";

export const DEFAULT_CONTENT_TIMEOUT_SECONDS = 10;

const TERMINAL_SENTENCE =
    "The public build cannot continue because content is unavailable.";



// =========================================================
// CONFIGURATION
// =========================================================

/**
 * The content endpoint URL. `CONTENT_API_URL` is the whole URL
 * (scheme, host, port, `/api/content`) — docs/DEPLOYMENT.md §3.2.
 * Unset falls back to the local development backend so `npm run dev`
 * and a local `npm run build` work out of the box while still
 * requiring a reachable backend: the fetch still runs and still fails
 * closed if nothing is listening.
 */
export function resolveContentUrl(env = process.env) {
    const value = env?.CONTENT_API_URL;
    return typeof value === "string" && value.trim() !== ""
        ? value.trim()
        : DEFAULT_CONTENT_API_URL;
}

/**
 * Bounded timeout for the build-time fetch, in seconds
 * (`CONTENT_API_TIMEOUT`, docs/DEPLOYMENT.md §3.2). Values that are
 * missing, non-numeric or ≤ 0 fall back to the 10 s default.
 */
export function contentTimeoutSeconds(env = process.env) {
    const parsed = Number(env?.CONTENT_API_TIMEOUT);
    return Number.isFinite(parsed) && parsed > 0
        ? parsed
        : DEFAULT_CONTENT_TIMEOUT_SECONDS;
}



// =========================================================
// ERRORS
// =========================================================

/**
 * A transport / HTTP / payload failure from the build-time fetch.
 * The `.message` is the human-facing build error, formatted so a
 * build log shows exactly what was attempted and why it stopped.
 * Structured fields let tests assert on the parts.
 */
export class ContentBuildError extends Error {
    constructor(message, { url, status = null, detail = null } = {}) {
        super(message);
        this.name = "ContentBuildError";
        this.url = url;
        this.status = status;
        this.detail = detail;
    }
}

/**
 * The payload was reachable but did not match the API contract.
 * `.problems` is the list of contract violations, one per line.
 */
export class ContentValidationError extends Error {
    constructor(message, problems) {
        super(message);
        this.name = "ContentValidationError";
        this.problems = problems || [];
    }
}

function formatWithTerminal(message) {
    return `${message.trimEnd()}\n\n${TERMINAL_SENTENCE}`;
}

export function formatTimeoutFailure(url, timeoutMs) {
    const message = [
        "Content API build fetch failed:",
        `GET ${url}`,
        `timed out after ${timeoutMs}ms`,
    ].join("\n");
    return formatWithTerminal(message);
}

export function formatHttpFailure(url, status, detail) {
    const body =
        detail && detail.trim() !== ""
            ? detail
            : `the endpoint returned HTTP ${status}.`;
    const message = [
        "Content API build fetch failed:",
        `GET ${url}`,
        `HTTP ${status}`,
        body,
    ].join("\n");
    return formatWithTerminal(message);
}

export function formatInvalidJsonFailure(url, parseError) {
    const message = [
        "Content API build fetch failed:",
        `GET ${url}`,
        `response was not valid JSON (${parseError}).`,
    ].join("\n");
    return formatWithTerminal(message);
}

export function formatNetworkFailure(url, cause) {
    const message = [
        "Content API build fetch failed:",
        `GET ${url}`,
        cause && cause.message ? cause.message : "the request failed.",
    ].join("\n");
    return formatWithTerminal(message);
}

export function formatValidationFailure(url, problems) {
    const message = [
        "Content API response failed validation:",
        `GET ${url}`,
        ...problems.map((problem) => `- ${problem}`),
    ].join("\n");
    return formatWithTerminal(message);
}



// =========================================================
// FETCH
// =========================================================

/**
 * GET the content endpoint with a bounded timeout and return the
 * validated payload.
 *
 * Throws:
 *   ContentBuildError     transport, HTTP status, or invalid JSON
 *   ContentValidationError the payload violates the API contract
 *
 * `fetchImpl` defaults to the global fetch and is injectable for
 * tests. The response body is the exact canonical JSON the backend
 * signed (`backend/app/routes/content.py`), so it is consumed as text
 * and parsed here rather than via `res.json()` — identical parsing,
 * but the text is also what a tests/compare tooling can hash.
 */
export async function fetchContent({
    url = resolveContentUrl(),
    timeoutSeconds = contentTimeoutSeconds(),
    fetchImpl = globalThis.fetch,
} = {}) {
    if (typeof fetchImpl !== "function") {
        throw new ContentBuildError(
            formatWithTerminal(
                [
                    "Content API build fetch failed:",
                    `GET ${url}`,
                    "no fetch implementation is available.",
                ].join("\n")
            ),
            { url }
        );
    }

    const timeoutMs = Math.max(1, Math.round(timeoutSeconds * 1000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
        response = await fetchImpl(url, {
            method: "GET",
            headers: { accept: "application/json" },
            signal: controller.signal,
        });
    } catch (cause) {
        if (controller.signal.aborted) {
            throw new ContentBuildError(formatTimeoutFailure(url, timeoutMs), {
                url,
            });
        }
        throw new ContentBuildError(formatNetworkFailure(url, cause), { url });
    } finally {
        clearTimeout(timer);
    }

    if (!response.ok) {
        const detail = await readResponseDetail(response);
        throw new ContentBuildError(
            formatHttpFailure(url, response.status, detail),
            { url, status: response.status, detail }
        );
    }

    const text = await response.text();

    let payload;
    try {
        payload = JSON.parse(text);
    } catch (cause) {
        throw new ContentBuildError(formatInvalidJsonFailure(url, cause.message), {
            url,
        });
    }

    return validateContent(payload, url);
}

async function readResponseDetail(response) {
    try {
        const text = await response.text();
        if (!text) return "";
        try {
            const parsed = JSON.parse(text);
            if (
                parsed &&
                typeof parsed === "object" &&
                typeof parsed.detail === "string" &&
                parsed.detail.trim() !== ""
            ) {
                // The API error contract (docs/API.md §7.2) is a bare
                // `{"detail": "..."}` body. Surface only `detail`, never
                // an arbitrary response body that could carry secrets or
                // framing.
                return parsed.detail.trim();
            }
        } catch {
            // Not JSON — fall through to the raw text.
        }
        return text.slice(0, 500);
    } catch {
        return "";
    }
}



// =========================================================
// VALIDATION
// =========================================================
// Strict client-side validation mirroring the pydantic contract in
// `backend/app/schemas/content.py`. The backend is strict, but this
// build validates again anyway: the build must never trust a remote
// payload it did not re-check, and a contract drift on the server
// must fail the build here rather than ship content the components
// never asked for.
// =========================================================

const PROJECT_STATUSES = new Set(["published", "hidden"]);

const REQUIRED_TOP_KEYS = [
    "profile",
    "about",
    "projects",
    "skills",
    "certifications",
    "seo",
    "meta",
];

const httpUrl = /^https?:\/\/\S+$/i;
const rootPath = /^\//;

function plainObject(value) {
    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
    );
}

function optionalTrimmedString(value) {
    return (
        value === null ||
        value === undefined ||
        typeof value === "string"
    );
}

function stringArray(value) {
    return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function urlOrRootPath(value) {
    if (typeof value !== "string" || value.trim() === "") return false;
    return httpUrl.test(value) || rootPath.test(value);
}

function allHttpUrls(list, { allowEmpty = false } = {}) {
    if (!Array.isArray(list)) return false;
    if (list.length === 0 && !allowEmpty) return false;
    return list.every((url) => typeof url === "string" && httpUrl.test(url));
}

/**
 * Validate a `GET /api/content` payload strict and fail closed.
 * Returns the (unmodified) payload on success; throws
 * ContentValidationError describing every problem otherwise.
 */
export function validateContent(payload, url = "<content endpoint>") {
    const problems = [];

    if (!plainObject(payload)) {
        throw new ContentValidationError(
            formatValidationFailure(url, ["the response body is not a JSON object."]),
            ["the response body is not a JSON object."]
        );
    }

    for (const key of Object.keys(payload)) {
        if (!REQUIRED_TOP_KEYS.includes(key)) {
            problems.push(`unknown top-level key "${key}" is not part of the API contract.`);
        }
    }
    for (const key of REQUIRED_TOP_KEYS) {
        if (!(key in payload)) {
            problems.push(`missing required top-level key "${key}".`);
        }
    }

    if (problems.length > 0) {
        throw new ContentValidationError(formatValidationFailure(url, problems), problems);
    }

    validateProfile(payload.profile, problems);
    validateAbout(payload.about, problems);
    validateProjects(payload.projects, problems);
    validateSkills(payload.skills, problems);
    validateCertifications(payload.certifications, problems);
    validateSeo(payload.seo, problems);
    validateMeta(payload.meta, problems);

    if (problems.length > 0) {
        throw new ContentValidationError(formatValidationFailure(url, problems), problems);
    }

    return payload;
}

function validateProfile(profile, problems) {
    if (!plainObject(profile)) {
        problems.push("profile must be an object.");
        return;
    }

    const p = profile;
    if (typeof p.name !== "string" || p.name.trim() === "") {
        problems.push("profile.name must be a non-empty string.");
    }
    if (typeof p.title !== "string" || p.title.trim() === "") {
        problems.push("profile.title must be a non-empty string.");
    }
    if (!stringArray(p.roles)) {
        problems.push("profile.roles must be an array of strings.");
    } else if (p.roles.some((role) => role.trim() === "")) {
        problems.push("profile.roles must not contain empty strings.");
    }
    if (typeof p.availableForInternship !== "boolean") {
        problems.push("profile.availableForInternship must be a boolean.");
    }
    if (typeof p.resume !== "string" || !urlOrRootPath(p.resume)) {
        problems.push("profile.resume must be an absolute path or absolute URL.");
    }
    for (const key of ["greeting", "internshipText", "description", "location"]) {
        if (!optionalTrimmedString(p[key])) {
            problems.push(`profile.${key} must be a string or null.`);
        }
    }

    const social = p.social;
    if (!plainObject(social)) {
        problems.push("profile.social must be an object.");
    } else {
        for (const key of ["github", "linkedin"]) {
            if (typeof social[key] !== "string" || !httpUrl.test(social[key])) {
                problems.push(`profile.social.${key} must be an absolute http(s) URL.`);
            }
        }
        if (typeof social.email !== "string" || !social.email.includes("@")) {
            problems.push("profile.social.email must be an email address.");
        }
    }

    if (!Array.isArray(p.stats)) {
        problems.push("profile.stats must be an array.");
    } else {
        p.stats.forEach((stat, index) => {
            if (!plainObject(stat)) {
                problems.push(`profile.stats[${index}] must be an object.`);
            } else {
                for (const key of ["label", "value"]) {
                    if (typeof stat[key] !== "string" || stat[key].trim() === "") {
                        problems.push(`profile.stats[${index}].${key} must be a non-empty string.`);
                    }
                }
            }
        });
    }
}

function validateAbout(about, problems) {
    if (!plainObject(about)) {
        problems.push("about must be an object.");
        return;
    }

    for (const key of ["tag", "title", "description", "heading"]) {
        if (typeof about[key] !== "string" || about[key].trim() === "") {
            problems.push(`about.${key} must be a non-empty string.`);
        }
    }
    if (!stringArray(about.paragraphs)) {
        problems.push("about.paragraphs must be an array of strings.");
    }
    if (!Array.isArray(about.cards)) {
        problems.push("about.cards must be an array.");
    } else {
        about.cards.forEach((card, index) => {
            if (!plainObject(card)) {
                problems.push(`about.cards[${index}] must be an object.`);
            } else {
                for (const key of ["icon_key", "title", "description"]) {
                    if (typeof card[key] !== "string" || card[key].trim() === "") {
                        problems.push(`about.cards[${index}].${key} must be a non-empty string.`);
                    }
                }
            }
        });
    }
}

function validateProjects(projects, problems) {
    if (!Array.isArray(projects)) {
        problems.push("projects must be an array.");
        return;
    }

    if (projects.length === 0) {
        // A build must never ship with zero projects; an empty payload
        // is treated as a contract violation, not as "nothing to show".
        problems.push("projects must not be empty — a build cannot ship without projects.");
        return;
    }

    const seenSlugs = new Set();

    projects.forEach((project, index) => {
        if (!plainObject(project)) {
            problems.push(`projects[${index}] must be an object.`);
            return;
        }

        const whereKey = `projects[${index}]`;
        const requiredStrings = [
            "slug",
            "title",
            "description",
            "image",
            "imageAlt",
            "seoTitle",
            "seoDescription",
        ];

        for (const key of requiredStrings) {
            const value = project[key];
            if (typeof value !== "string" || value.trim() === "") {
                problems.push(`${whereKey}.${key} must be a non-empty string.`);
            }
        }

        if (
            typeof project.slug === "string" &&
            project.slug.trim() !== ""
        ) {
            if (seenSlugs.has(project.slug)) {
                problems.push(`${whereKey}.slug "${project.slug}" is duplicated.`);
            }
            seenSlugs.add(project.slug);
        }

        if (
            typeof project.image !== "string" ||
            !urlOrRootPath(project.image)
        ) {
            problems.push(
                `${whereKey}.image must be an absolute path or absolute http(s) URL.`
            );
        }

        if (
            typeof project.image_width !== "number" ||
            !Number.isInteger(project.image_width) ||
            project.image_width <= 0
        ) {
            problems.push(`${whereKey}.image_width must be a positive integer.`);
        }
        if (
            typeof project.image_height !== "number" ||
            !Number.isInteger(project.image_height) ||
            project.image_height <= 0
        ) {
            problems.push(`${whereKey}.image_height must be a positive integer.`);
        }

        if (!stringArray(project.techStack)) {
            problems.push(`${whereKey}.techStack must be an array of strings.`);
        }
        if (!stringArray(project.highlights)) {
            problems.push(`${whereKey}.highlights must be an array of strings.`);
        }
        if (typeof project.featured !== "boolean") {
            problems.push(`${whereKey}.featured must be a boolean.`);
        }
        if (typeof project.indexable !== "boolean") {
            problems.push(`${whereKey}.indexable must be a boolean.`);
        }
        if (
            typeof project.status !== "string" ||
            !PROJECT_STATUSES.has(project.status)
        ) {
            problems.push(
                `${whereKey}.status must be one of: ${[...PROJECT_STATUSES].join(", ")}.`
            );
        }
        if (
            typeof project.display_order !== "number" ||
            !Number.isInteger(project.display_order) ||
            project.display_order < 0
        ) {
            problems.push(`${whereKey}.display_order must be a non-negative integer.`);
        }

        for (const key of ["category"]) {
            const value = project[key];
            if (value !== null && typeof value !== "string") {
                problems.push(`${whereKey}.${key} must be a string or null.`);
            }
        }

        for (const key of ["live", "github"]) {
            const value = project[key];
            const ok =
                value === null ||
                value === undefined ||
                value === "" ||
                value === "#" ||
                (typeof value === "string" && httpUrl.test(value));
            if (!ok) {
                problems.push(
                    `${whereKey}.${key} must be null/empty/"#"/absolute http(s) URL.`
                );
            }
        }
    });
}

function validateSkills(skills, problems) {
    if (!Array.isArray(skills)) {
        problems.push("skills must be an array.");
        return;
    }

    skills.forEach((skill, index) => {
        if (!plainObject(skill)) {
            problems.push(`skills[${index}] must be an object.`);
            return;
        }

        const whereKey = `skills[${index}]`;
        for (const key of ["name", "icon_key"]) {
            if (typeof skill[key] !== "string" || skill[key].trim() === "") {
                problems.push(`${whereKey}.${key} must be a non-empty string.`);
            }
        }
        if (
            typeof skill.display_order !== "number" ||
            !Number.isInteger(skill.display_order) ||
            skill.display_order < 0
        ) {
            problems.push(`${whereKey}.display_order must be a non-negative integer.`);
        }

        const category = skill.category;
        if (!plainObject(category)) {
            problems.push(`${whereKey}.category must be an object.`);
        } else {
            for (const key of ["name", "icon_key"]) {
                if (typeof category[key] !== "string" || category[key].trim() === "") {
                    problems.push(`${whereKey}.category.${key} must be a non-empty string.`);
                }
            }
            if (
                typeof category.display_order !== "number" ||
                !Number.isInteger(category.display_order) ||
                category.display_order < 0
            ) {
                problems.push(
                    `${whereKey}.category.display_order must be a non-negative integer.`
                );
            }
        }
    });
}

function validateCertifications(certifications, problems) {
    if (!Array.isArray(certifications)) {
        problems.push("certifications must be an array.");
        return;
    }

    certifications.forEach((cert, index) => {
        if (!plainObject(cert)) {
            problems.push(`certifications[${index}] must be an object.`);
            return;
        }

        const whereKey = `certifications[${index}]`;
        for (const key of ["title", "issuer"]) {
            if (typeof cert[key] !== "string" || cert[key].trim() === "") {
                problems.push(`${whereKey}.${key} must be a non-empty string.`);
            }
        }
        for (const key of ["icon", "issued_on", "credential_id", "credential_url"]) {
            if (key === "credential_url") {
                const value = cert[key];
                const ok =
                    value === null ||
                    value === undefined ||
                    (typeof value === "string" && httpUrl.test(value));
                if (!ok) {
                    problems.push(
                        `${whereKey}.credential_url must be null or an absolute http(s) URL.`
                    );
                }
            } else if (!optionalTrimmedString(cert[key])) {
                problems.push(`${whereKey}.${key} must be a string or null.`);
            }
        }
        if (
            typeof cert.display_order !== "number" ||
            !Number.isInteger(cert.display_order) ||
            cert.display_order < 0
        ) {
            problems.push(`${whereKey}.display_order must be a non-negative integer.`);
        }
    });
}

function validateSeo(seo, problems) {
    if (!plainObject(seo)) {
        problems.push("seo must be an object.");
        return;
    }

    const whereKey = "seo";
    for (const key of [
        "siteName",
        "title",
        "description",
        "author",
        "image",
        "imageAlt",
        "twitterCard",
        "locale",
        "type",
    ]) {
        if (typeof seo[key] !== "string" || seo[key].trim() === "") {
            problems.push(`${whereKey}.${key} must be a non-empty string.`);
        }
    }

    if (typeof seo.image !== "string" || !httpUrl.test(seo.image)) {
        problems.push(`${whereKey}.image must be an absolute http(s) URL.`);
    }

    if (seo.twitterSite !== null && seo.twitterSite !== undefined && typeof seo.twitterSite !== "string") {
        problems.push(`${whereKey}.twitterSite must be a string or null.`);
    }

    if (!allHttpUrls(seo.sameAs)) {
        problems.push(`${whereKey}.sameAs must be an array of absolute http(s) URLs.`);
    }

    if (!Array.isArray(seo.keywords) || !seo.keywords.every((k) => typeof k === "string")) {
        problems.push(`${whereKey}.keywords must be an array of strings.`);
    }

    const robots = seo.robots;
    if (!plainObject(robots)) {
        problems.push(`${whereKey}.robots must be an object.`);
    } else {
        for (const key of ["index", "follow"]) {
            if (typeof robots[key] !== "boolean") {
                problems.push(`${whereKey}.robots.${key} must be a boolean.`);
            }
        }
        for (const key of Object.keys(robots)) {
            if (!["index", "follow"].includes(key)) {
                problems.push(`${whereKey}.robots has unknown key "${key}".`);
            }
        }
    }

    const person = seo.person;
    if (!plainObject(person)) {
        problems.push(`${whereKey}.person must be an object.`);
    } else {
        if (typeof person.name !== "string" || person.name.trim() === "") {
            problems.push(`${whereKey}.person.name must be a non-empty string.`);
        }
        for (const key of ["alternateName", "jobTitle", "nationality", "credential"]) {
            if (!optionalTrimmedString(person[key])) {
                problems.push(`${whereKey}.person.${key} must be a string or null.`);
            }
        }
        if (person.email !== null && person.email !== undefined && typeof person.email !== "string") {
            problems.push(`${whereKey}.person.email must be a string or null.`);
        }
        if (!stringArray(person.knowsAbout)) {
            problems.push(`${whereKey}.person.knowsAbout must be an array of strings.`);
        }
        const address = person.address;
        if (address !== null && address !== undefined) {
            if (!plainObject(address)) {
                problems.push(`${whereKey}.person.address must be an object, null, or absent.`);
            } else {
                for (const key of ["locality", "region", "country"]) {
                    if (typeof address[key] !== "string" || address[key].trim() === "") {
                        problems.push(`${whereKey}.person.address.${key} must be a non-empty string.`);
                    }
                }
            }
        }
    }
}

function validateMeta(meta, problems) {
    if (!plainObject(meta)) {
        problems.push("meta must be an object.");
        return;
    }

    if (
        typeof meta.generated_at !== "string" ||
        Number.isNaN(Date.parse(meta.generated_at))
    ) {
        problems.push("meta.generated_at must be a parseable ISO date string.");
    }
    if (typeof meta.version !== "number" || !Number.isInteger(meta.version)) {
        problems.push("meta.version must be an integer.");
    }
}