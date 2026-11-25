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
// Secrets are a non-goal: this module reads only `CONTENT_API_URL`,
// `CONTENT_API_TIMEOUT` and `CONTENT_API_ATTEMPTS` (docs/DEPLOYMENT.md §3).
// Nothing here ever knows `DATABASE_URL`, `ADMIN_TOKEN` or an API key.
// =========================================================

// The endpoint CONTENT_API_URL must point AT (verbatim, including the
// trailing path). Docs/DEPLOYMENT.md §3.2 documents the production
// value; this default is the local development backend.
export const DEFAULT_CONTENT_API_URL =
    "http://127.0.0.1:8001/api/content";

export const DEFAULT_CONTENT_TIMEOUT_SECONDS = 10;

// Bounded retries. The production backend is a Render free-tier service that
// spins down when idle; the first request after a quiet period triggers a cold
// start that can outlast a single fetch timeout (measured ~33 s in production —
// the build aborted at 10 s while the instance only finished booting at 33 s).
// A single attempt therefore fails intermittently, depending only on whether the
// backend happened to be warm. Retrying with backoff lets a later attempt land
// once the instance has finished booting, while the bounded attempt count keeps a
// genuinely unreachable endpoint failing closed in a predictable time.
export const DEFAULT_CONTENT_ATTEMPTS = 4;
const MAX_CONTENT_ATTEMPTS = 10;
const CONTENT_RETRY_BACKOFF_MS = 2000;
const CONTENT_RETRY_MAX_BACKOFF_MS = 10000;

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

/**
 * Bounded number of fetch attempts (`CONTENT_API_ATTEMPTS`, docs/DEPLOYMENT.md
 * §1.4). Present so the retry budget can be tuned per environment; values that
 * are missing, non-integer or < 1 fall back to the default, and any value is
 * capped at the hard maximum so a misconfiguration cannot loop forever.
 */
export function contentAttempts(env = process.env) {
    const parsed = Number(env?.CONTENT_API_ATTEMPTS);
    return Number.isInteger(parsed) && parsed >= 1
        ? Math.min(parsed, MAX_CONTENT_ATTEMPTS)
        : DEFAULT_CONTENT_ATTEMPTS;
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
    constructor(message, { url, status = null, detail = null, retryable = false } = {}) {
        super(message);
        this.name = "ContentBuildError";
        this.url = url;
        this.status = status;
        this.detail = detail;
        // Transient (timeout / network / HTTP 5xx) failures may be retried;
        // deterministic ones (other 4xx, invalid JSON) may not. `ContentValidationError`
        // is never retryable: a bad payload will not become good on a second read.
        this.retryable = retryable;
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
 * GET the content endpoint with a bounded timeout and bounded retries, and
 * return the validated payload.
 *
 * The fetch is retried (default: `CONTENT_API_ATTEMPTS`, backoff doubling from
 * 2 s up to 10 s) only for *transient* failures — an aborted/timed-out attempt,
 * a rejected connection, or an HTTP status in `isRetryableStatus`. A 4xx, an
 * invalid-JSON body, or a payload that fails validation is deterministic and
 * fails the build immediately: retrying it would only delay an inevitable
 * failure and could mask a contract drift. After the attempt budget is spent the
 * last error is rethrown, so the build still fails closed — it never falls back
 * to a stale snapshot or an empty listing.
 *
 * Throws:
 *   ContentBuildError     transport, HTTP status, or invalid JSON
 *   ContentValidationError the payload violates the API contract
 *
 * `fetchImpl` defaults to the global fetch and is injectable for tests.
 * `retryBackoffMs` is the exponential base delay and is injectable so tests can
 * run without real waiting. The response body is the exact canonical JSON the
 * backend signed (`backend/app/routes/content.py`), so it is consumed as text
 * and parsed here rather than via `res.json()` — identical parsing, but the text
 * is also what tests/compare tooling can hash.
 */
export async function fetchContent({
    url = resolveContentUrl(),
    timeoutSeconds = contentTimeoutSeconds(),
    attempts = contentAttempts(),
    retryBackoffMs: backoffBaseMs = CONTENT_RETRY_BACKOFF_MS,
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
    const maxAttempts = clampAttempts(attempts);

    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await fetchContentOnce(url, timeoutMs, fetchImpl);
        } catch (error) {
            lastError = error;
            const canRetry =
                error instanceof ContentBuildError && error.retryable === true;
            if (!canRetry || attempt === maxAttempts) {
                throw error;
            }
            const delayMs = retryDelayMs(attempt, backoffBaseMs);
            console.warn(
                `[content] attempt ${attempt}/${maxAttempts} failed: ` +
                `${summarizeError(error)}; retrying in ${delayMs}ms`
            );
            await sleep(delayMs);
        }
    }

    // Unreachable: the loop either returns or throws, but keep the rethrow so a
    // future edit cannot silently drop the error.
    throw lastError;
}

/**
 * A single bounded attempt. Throws a `ContentBuildError` tagged with
 * `retryable` (or a `ContentValidationError`, which is never retryable).
 */
async function fetchContentOnce(url, timeoutMs, fetchImpl) {
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
                retryable: true,
            });
        }
        throw new ContentBuildError(formatNetworkFailure(url, cause), {
            url,
            retryable: true,
        });
    } finally {
        clearTimeout(timer);
    }

    if (!response.ok) {
        const detail = await readResponseDetail(response);
        throw new ContentBuildError(
            formatHttpFailure(url, response.status, detail),
            {
                url,
                status: response.status,
                detail,
                retryable: isRetryableStatus(response.status),
            }
        );
    }

    const text = await response.text();

    let payload;
    try {
        payload = JSON.parse(text);
    } catch (cause) {
        throw new ContentBuildError(formatInvalidJsonFailure(url, cause.message), {
            url,
            retryable: false,
        });
    }

    return validateContent(payload, url);
}

// HTTP statuses worth a second attempt: request/rate-limit (408, 425, 429) and
// any server-side failure (5xx). Everything else is deterministic.
function isRetryableStatus(status) {
    return (
        status === 408 ||
        status === 425 ||
        status === 429 ||
        (status >= 500 && status <= 599)
    );
}

function clampAttempts(value) {
    const parsed = Math.trunc(Number(value));
    if (!Number.isFinite(parsed) || parsed < 1) return 1;
    return Math.min(parsed, MAX_CONTENT_ATTEMPTS);
}

function retryDelayMs(attempt, baseMs) {
    const base = Math.max(0, Number(baseMs) || 0);
    return Math.min(base * 2 ** (attempt - 1), CONTENT_RETRY_MAX_BACKOFF_MS);
}

function sleep(ms) {
    if (!ms) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// A one-line, log-friendly digest of a multi-line build error: the failing
// request line and the specific cause, without the terminal sentence.
function summarizeError(error) {
    return String(error?.message ?? error)
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(" ");
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

const CASE_STUDY_MAX_BYTES = 32 * 1024;
const CASE_STUDY_STATUSES = new Set(["verified", "reported", "unverified"]);
const OUTCOME_KINDS = new Set(["quantitative", "qualitative"]);
const OUTCOME_DIRECTIONS = new Set(["higher", "lower", "neutral"]);
const LINK_KINDS = new Set(["demo", "source", "writeup", "other"]);
const caseStudyDate = /^(?:\d{4}|\d{4}-(?:0[1-9]|1[0-2]))$/;
const flatProjectImage = /^\/images\/projects\/[a-z0-9-]+\.webp$/;
const CASE_STUDY_WHITESPACE = new Set(
    "\u0009\u000a\u000b\u000c\u000d\u0020\u0085\u00a0\u1680" +
        "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a" +
        "\u2028\u2029\u202f\u205f\u3000"
);
const CASE_STUDY_WHITESPACE_CLASS =
    "\\u0009-\\u000D\\u0020\\u0085\\u00A0\\u1680" +
    "\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000";
const caseStudyWhitespace = new RegExp(
    `[${CASE_STUDY_WHITESPACE_CLASS}]`,
    "u"
);
const strictHttpUrl = new RegExp(
    `^https?://[^${CASE_STUDY_WHITESPACE_CLASS}"'<>]+$`,
    "u"
);
const bareHttpUrl = new RegExp(
    `^https?://[^${CASE_STUDY_WHITESPACE_CLASS}]+$`,
    "u"
);

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

function trimCaseStudyText(value) {
    let start = 0;
    let end = value.length;
    while (start < end && CASE_STUDY_WHITESPACE.has(value[start])) {
        start += 1;
    }
    while (end > start && CASE_STUDY_WHITESPACE.has(value[end - 1])) {
        end -= 1;
    }
    return value.slice(start, end);
}

function hasCaseStudyWhitespace(value) {
    return caseStudyWhitespace.test(value);
}

function trimmedString(value) {
    if (typeof value !== "string") return null;
    const trimmed = trimCaseStudyText(value);
    return trimmed === "" ? null : trimmed;
}

function positiveInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function codePointLength(value) {
    return Array.from(value).length;
}

function utf8ByteLength(value) {
    return new TextEncoder().encode(value).byteLength;
}

function checkUnknownKeys(value, allowed, whereKey, problems) {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) {
            problems.push(`${whereKey} has unknown key "${key}".`);
        }
    }
}

function checkRequiredString(
    value,
    whereKey,
    problems,
    { maxLength, minLength = 1 } = {}
) {
    if (typeof value !== "string") {
        problems.push(`${whereKey} must be a non-empty string.`);
        return false;
    }
    const trimmed = trimCaseStudyText(value);
    if (trimmed === "") {
        problems.push(`${whereKey} must be a non-empty string.`);
        return false;
    }
    const length = codePointLength(trimmed);
    if (length < minLength || (maxLength !== undefined && length > maxLength)) {
        problems.push(
            maxLength === undefined
                ? `${whereKey} must be at least ${minLength} characters.`
                : `${whereKey} must be ${minLength}-${maxLength} characters.`
        );
        return false;
    }
    return true;
}

function checkOptionalString(
    value,
    whereKey,
    problems,
    { maxLength, minLength = 1 } = {}
) {
    if (value === null || value === undefined) return;
    if (typeof value !== "string") {
        problems.push(`${whereKey} must be a string or null.`);
        return;
    }
    const length = codePointLength(trimCaseStudyText(value));
    if (length === 0) return;
    if (length < minLength || (maxLength !== undefined && length > maxLength)) {
        problems.push(
            maxLength === undefined
                ? `${whereKey} must be at least ${minLength} characters when present.`
                : `${whereKey} must be ${minLength}-${maxLength} characters when present.`
        );
    }
}

function checkStringList(
    value,
    whereKey,
    problems,
    { maxItems, maxLength } = {}
) {
    if (value === undefined) return;
    if (!Array.isArray(value)) {
        problems.push(`${whereKey} must be an array of strings.`);
        return;
    }
    if (maxItems !== undefined && value.length > maxItems) {
        problems.push(`${whereKey} must contain at most ${maxItems} items.`);
    }
    value.forEach((item, index) => {
        checkRequiredString(item, `${whereKey}[${index}]`, problems, { maxLength });
    });
}

function checkOptionalHttpUrl(value, whereKey, problems) {
    if (value === null || value === undefined) return;
    if (typeof value !== "string") {
        problems.push(`${whereKey} must be a string or null.`);
        return;
    }
    if (value === "") return;
    if (hasCaseStudyWhitespace(value) || !strictHttpUrl.test(value)) {
        problems.push(`${whereKey} must be an absolute http(s) URL.`);
    }
}

/**
 * Validate a `GET /api/content` payload strict and fail closed.
 * Returns the payload with missing `project.caseStudy` values normalized to
 * `null`; throws ContentValidationError describing every problem otherwise.
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

        if (project.caseStudy === undefined) {
            project.caseStudy = null;
        } else if (project.caseStudy !== null) {
            validateCaseStudy(
                project.caseStudy,
                `${whereKey}.caseStudy`,
                problems
            );
        }
    });
}

function caseStudyDatePoint(value, isEnd) {
    if (value.length === 4) {
        return [Number(value), isEnd ? 12 : 1];
    }
    const [year, month] = value.split("-").map(Number);
    return [year, month];
}

function validateTimeline(timeline, whereKey, problems) {
    if (!plainObject(timeline)) {
        problems.push(`${whereKey} must be an object or null.`);
        return;
    }

    checkUnknownKeys(
        timeline,
        ["label", "start", "end", "duration"],
        whereKey,
        problems
    );
    checkOptionalString(timeline.label, `${whereKey}.label`, problems, {
        maxLength: 80,
    });
    for (const key of ["start", "end"]) {
        checkOptionalString(timeline[key], `${whereKey}.${key}`, problems, {
            maxLength: 10,
        });
        const value = trimmedString(timeline[key]);
        if (value !== null && !caseStudyDate.test(value)) {
            problems.push(`${whereKey}.${key} must be YYYY or YYYY-MM.`);
        }
    }
    checkOptionalString(timeline.duration, `${whereKey}.duration`, problems, {
        maxLength: 40,
    });

    const start = trimmedString(timeline.start);
    const end = trimmedString(timeline.end);
    if (
        start !== null &&
        end !== null &&
        caseStudyDate.test(start) &&
        caseStudyDate.test(end)
    ) {
        const [startYear, startMonth] = caseStudyDatePoint(start, false);
        const [endYear, endMonth] = caseStudyDatePoint(end, true);
        if (
            startYear > endYear ||
            (startYear === endYear && startMonth > endMonth)
        ) {
            problems.push(
                `${whereKey}.start must be on or before ${whereKey}.end.`
            );
        }
    }

    const hasField = [
        timeline.label,
        timeline.start,
        timeline.end,
        timeline.duration,
    ].some((value) => trimmedString(value) !== null);
    if (!hasField) {
        problems.push(`${whereKey} must contain at least one field.`);
    }
}

function validateTeam(team, whereKey, problems) {
    if (!plainObject(team)) {
        problems.push(`${whereKey} must be an object or null.`);
        return;
    }

    checkUnknownKeys(team, ["size", "roles", "note"], whereKey, problems);
    if (
        team.size !== undefined &&
        team.size !== null &&
        (!Number.isInteger(team.size) || team.size < 1 || team.size > 1000)
    ) {
        problems.push(`${whereKey}.size must be an integer from 1 to 1000.`);
    }
    checkStringList(team.roles, `${whereKey}.roles`, problems, {
        maxItems: 10,
        maxLength: 60,
    });
    checkOptionalString(team.note, `${whereKey}.note`, problems, {
        maxLength: 200,
    });

    const hasField =
        positiveInteger(team.size) ||
        (Array.isArray(team.roles) && team.roles.length > 0) ||
        trimmedString(team.note) !== null;
    if (!hasField) {
        problems.push(`${whereKey} must contain at least one field.`);
    }
}

function validateProblem(problem, whereKey, problems) {
    if (!plainObject(problem)) {
        problems.push(`${whereKey} must be an object or null.`);
        return;
    }

    checkUnknownKeys(problem, ["summary", "context"], whereKey, problems);
    checkRequiredString(problem.summary, `${whereKey}.summary`, problems, {
        maxLength: 1200,
    });
    checkOptionalString(problem.context, `${whereKey}.context`, problems, {
        maxLength: 2000,
    });
}

function validateApproach(approach, whereKey, problems) {
    if (approach === undefined) return;
    if (!Array.isArray(approach)) {
        problems.push(`${whereKey} must be an array.`);
        return;
    }
    if (approach.length > 12) {
        problems.push(`${whereKey} must contain at most 12 items.`);
    }
    approach.forEach((section, index) => {
        const itemKey = `${whereKey}[${index}]`;
        if (!plainObject(section)) {
            problems.push(`${itemKey} must be an object.`);
            return;
        }
        checkUnknownKeys(section, ["heading", "body"], itemKey, problems);
        checkRequiredString(section.heading, `${itemKey}.heading`, problems, {
            maxLength: 120,
        });
        checkRequiredString(section.body, `${itemKey}.body`, problems, {
            maxLength: 2000,
        });
    });
}

function validateImageAsset(image, whereKey, problems) {
    if (!plainObject(image)) {
        problems.push(`${whereKey} must be an object or null.`);
        return;
    }

    checkUnknownKeys(
        image,
        ["src", "alt", "width", "height", "caption"],
        whereKey,
        problems
    );
    const hasSrc = checkRequiredString(
        image.src,
        `${whereKey}.src`,
        problems
    );
    if (hasSrc) {
        const src = trimCaseStudyText(image.src);
        if (
            hasCaseStudyWhitespace(image.src) ||
            (!flatProjectImage.test(src) && !strictHttpUrl.test(src))
        ) {
            problems.push(
                `${whereKey}.src must be an absolute http(s) URL or ` +
                    "/images/projects/<slug>.webp."
            );
        }
    }
    checkRequiredString(image.alt, `${whereKey}.alt`, problems, {
        maxLength: 300,
    });
    if (!positiveInteger(image.width)) {
        problems.push(`${whereKey}.width must be a positive integer.`);
    }
    if (!positiveInteger(image.height)) {
        problems.push(`${whereKey}.height must be a positive integer.`);
    }
    checkOptionalString(image.caption, `${whereKey}.caption`, problems, {
        maxLength: 300,
    });
}

function validateArchitecture(architecture, whereKey, problems) {
    if (!plainObject(architecture)) {
        problems.push(`${whereKey} must be an object or null.`);
        return;
    }

    checkUnknownKeys(
        architecture,
        ["summary", "components", "diagram"],
        whereKey,
        problems
    );
    checkRequiredString(architecture.summary, `${whereKey}.summary`, problems, {
        maxLength: 2000,
    });

    if (architecture.components !== undefined) {
        if (!Array.isArray(architecture.components)) {
            problems.push(`${whereKey}.components must be an array.`);
        } else {
            if (architecture.components.length > 20) {
                problems.push(
                    `${whereKey}.components must contain at most 20 items.`
                );
            }
            architecture.components.forEach((component, index) => {
                const itemKey = `${whereKey}.components[${index}]`;
                if (!plainObject(component)) {
                    problems.push(`${itemKey} must be an object.`);
                    return;
                }
                checkUnknownKeys(
                    component,
                    ["name", "role", "technology"],
                    itemKey,
                    problems
                );
                checkRequiredString(component.name, `${itemKey}.name`, problems, {
                    maxLength: 80,
                });
                checkRequiredString(component.role, `${itemKey}.role`, problems, {
                    maxLength: 240,
                });
                checkOptionalString(
                    component.technology,
                    `${itemKey}.technology`,
                    problems,
                    { maxLength: 120 }
                );
            });
        }
    }

    if (architecture.diagram !== undefined && architecture.diagram !== null) {
        validateImageAsset(
            architecture.diagram,
            `${whereKey}.diagram`,
            problems
        );
    }
}

function validateKeyDecisions(keyDecisions, whereKey, problems) {
    if (keyDecisions === undefined) return;
    if (!Array.isArray(keyDecisions)) {
        problems.push(`${whereKey} must be an array.`);
        return;
    }
    if (keyDecisions.length > 10) {
        problems.push(`${whereKey} must contain at most 10 items.`);
    }
    keyDecisions.forEach((decision, index) => {
        const itemKey = `${whereKey}[${index}]`;
        if (!plainObject(decision)) {
            problems.push(`${itemKey} must be an object.`);
            return;
        }
        checkUnknownKeys(
            decision,
            ["decision", "rationale", "tradeoff"],
            itemKey,
            problems
        );
        checkRequiredString(decision.decision, `${itemKey}.decision`, problems, {
            maxLength: 240,
        });
        checkRequiredString(
            decision.rationale,
            `${itemKey}.rationale`,
            problems,
            { maxLength: 1200 }
        );
        checkOptionalString(decision.tradeoff, `${itemKey}.tradeoff`, problems, {
            maxLength: 800,
        });
    });
}

function validateChallenges(challenges, whereKey, problems) {
    if (challenges === undefined) return;
    if (!Array.isArray(challenges)) {
        problems.push(`${whereKey} must be an array.`);
        return;
    }
    if (challenges.length > 10) {
        problems.push(`${whereKey} must contain at most 10 items.`);
    }
    challenges.forEach((challenge, index) => {
        const itemKey = `${whereKey}[${index}]`;
        if (!plainObject(challenge)) {
            problems.push(`${itemKey} must be an object.`);
            return;
        }
        checkUnknownKeys(
            challenge,
            ["problem", "resolution", "lesson"],
            itemKey,
            problems
        );
        checkRequiredString(challenge.problem, `${itemKey}.problem`, problems, {
            maxLength: 600,
        });
        checkRequiredString(
            challenge.resolution,
            `${itemKey}.resolution`,
            problems,
            { maxLength: 1200 }
        );
        checkOptionalString(challenge.lesson, `${itemKey}.lesson`, problems, {
            maxLength: 600,
        });
    });
}

function validateEvidence(evidence, whereKey, problems) {
    if (!plainObject(evidence)) {
        problems.push(`${whereKey} must be an object or null.`);
        return;
    }

    checkUnknownKeys(
        evidence,
        ["status", "source", "url", "note"],
        whereKey,
        problems
    );
    if (!CASE_STUDY_STATUSES.has(evidence.status)) {
        problems.push(
            `${whereKey}.status must be one of: verified, reported, unverified.`
        );
    }
    checkOptionalString(evidence.source, `${whereKey}.source`, problems, {
        minLength: 8,
        maxLength: 500,
    });
    const source = trimmedString(evidence.source);
    if (
        (evidence.status === "verified" || evidence.status === "reported") &&
        source === null
    ) {
        problems.push(
            `${whereKey}.source is required when status is ${evidence.status}.`
        );
    }
    if (source !== null && bareHttpUrl.test(source)) {
        problems.push(
            `${whereKey}.source must describe the artifact, not just a URL.`
        );
    }
    checkOptionalHttpUrl(evidence.url, `${whereKey}.url`, problems);
    checkOptionalString(evidence.note, `${whereKey}.note`, problems, {
        maxLength: 500,
    });
}

function validateOutcomes(outcomes, whereKey, problems) {
    if (outcomes === undefined) return;
    if (!Array.isArray(outcomes)) {
        problems.push(`${whereKey} must be an array.`);
        return;
    }
    if (outcomes.length > 12) {
        problems.push(`${whereKey} must contain at most 12 items.`);
    }
    outcomes.forEach((outcome, index) => {
        const itemKey = `${whereKey}[${index}]`;
        if (!plainObject(outcome)) {
            problems.push(`${itemKey} must be an object.`);
            return;
        }
        checkUnknownKeys(
            outcome,
            [
                "kind",
                "statement",
                "metric",
                "value",
                "unit",
                "baseline",
                "direction",
                "evidence",
            ],
            itemKey,
            problems
        );
        if (!OUTCOME_KINDS.has(outcome.kind)) {
            problems.push(
                `${itemKey}.kind must be one of: quantitative, qualitative.`
            );
        }
        checkRequiredString(outcome.statement, `${itemKey}.statement`, problems, {
            maxLength: 400,
        });
        checkOptionalString(outcome.metric, `${itemKey}.metric`, problems, {
            maxLength: 120,
        });
        checkOptionalString(outcome.value, `${itemKey}.value`, problems, {
            maxLength: 60,
        });
        checkOptionalString(outcome.unit, `${itemKey}.unit`, problems, {
            maxLength: 30,
        });
        checkOptionalString(outcome.baseline, `${itemKey}.baseline`, problems, {
            maxLength: 120,
        });
        if (
            outcome.direction !== undefined &&
            outcome.direction !== null &&
            !OUTCOME_DIRECTIONS.has(outcome.direction)
        ) {
            problems.push(
                `${itemKey}.direction must be one of: higher, lower, neutral.`
            );
        }
        if (outcome.evidence !== undefined && outcome.evidence !== null) {
            validateEvidence(outcome.evidence, `${itemKey}.evidence`, problems);
        }

        if (outcome.kind === "quantitative") {
            if (trimmedString(outcome.metric) === null) {
                problems.push(
                    `${itemKey}.metric is required for quantitative outcomes.`
                );
            }
            if (trimmedString(outcome.value) === null) {
                problems.push(
                    `${itemKey}.value is required for quantitative outcomes.`
                );
            }
            if (outcome.evidence === undefined || outcome.evidence === null) {
                problems.push(
                    `${itemKey}.evidence is required for quantitative outcomes.`
                );
            }
        } else if (outcome.kind === "qualitative") {
            if (
                trimmedString(outcome.metric) !== null ||
                trimmedString(outcome.value) !== null ||
                trimmedString(outcome.unit) !== null ||
                trimmedString(outcome.baseline) !== null ||
                (outcome.direction !== undefined &&
                    outcome.direction !== null)
            ) {
                problems.push(
                    `${itemKey} qualitative outcomes must not include metric, ` +
                        "value, unit, baseline, or direction."
                );
            }
        }
    });
}

function validateLinks(links, whereKey, problems) {
    if (links === undefined) return;
    if (!Array.isArray(links)) {
        problems.push(`${whereKey} must be an array.`);
        return;
    }
    if (links.length > 10) {
        problems.push(`${whereKey} must contain at most 10 items.`);
    }
    const seenUrls = new Set();
    links.forEach((link, index) => {
        const itemKey = `${whereKey}[${index}]`;
        if (!plainObject(link)) {
            problems.push(`${itemKey} must be an object.`);
            return;
        }
        checkUnknownKeys(link, ["label", "url", "kind"], itemKey, problems);
        checkRequiredString(link.label, `${itemKey}.label`, problems, {
            maxLength: 80,
        });
        const hasUrl = checkRequiredString(
            link.url,
            `${itemKey}.url`,
            problems
        );
        if (hasUrl) {
            const url = trimCaseStudyText(link.url);
            if (hasCaseStudyWhitespace(link.url) || !strictHttpUrl.test(url)) {
                problems.push(`${itemKey}.url must be an absolute http(s) URL.`);
            } else if (seenUrls.has(url)) {
                problems.push(`${itemKey}.url duplicates an earlier link.`);
            }
            seenUrls.add(url);
        }
        if (!LINK_KINDS.has(link.kind)) {
            problems.push(
                `${itemKey}.kind must be one of: demo, source, writeup, other.`
            );
        }
    });
}

function canonicalOptionalText(value) {
    return trimmedString(value);
}

function canonicalRequiredText(value) {
    return trimCaseStudyText(value);
}

function canonicalImage(image) {
    return {
        src: trimCaseStudyText(image.src),
        alt: trimCaseStudyText(image.alt),
        width: image.width,
        height: image.height,
        caption: canonicalOptionalText(image.caption),
    };
}

function canonicalCaseStudy(caseStudy) {
    return {
        schemaVersion: caseStudy.schemaVersion,
        role: canonicalOptionalText(caseStudy.role),
        timeline:
            caseStudy.timeline === undefined || caseStudy.timeline === null
                ? null
                : {
                      label: canonicalOptionalText(caseStudy.timeline.label),
                      start: canonicalOptionalText(caseStudy.timeline.start),
                      end: canonicalOptionalText(caseStudy.timeline.end),
                      duration: canonicalOptionalText(
                          caseStudy.timeline.duration
                      ),
                  },
        team:
            caseStudy.team === undefined || caseStudy.team === null
                ? null
                : {
                      size: caseStudy.team.size ?? null,
                      roles: (caseStudy.team.roles ?? []).map(
                          canonicalRequiredText
                      ),
                      note: canonicalOptionalText(caseStudy.team.note),
                  },
        problem:
            caseStudy.problem === undefined || caseStudy.problem === null
                ? null
                : {
                      summary: canonicalRequiredText(
                          caseStudy.problem.summary
                      ),
                      context: canonicalOptionalText(
                          caseStudy.problem.context
                      ),
                  },
        constraints: (caseStudy.constraints ?? []).map(
            canonicalRequiredText
        ),
        approach: (caseStudy.approach ?? []).map((section) => ({
            heading: canonicalRequiredText(section.heading),
            body: canonicalRequiredText(section.body),
        })),
        architecture:
            caseStudy.architecture === undefined ||
            caseStudy.architecture === null
                ? null
                : {
                      summary: canonicalRequiredText(
                          caseStudy.architecture.summary
                      ),
                      components: (
                          caseStudy.architecture.components ?? []
                      ).map((component) => ({
                          name: canonicalRequiredText(component.name),
                          role: canonicalRequiredText(component.role),
                          technology: canonicalOptionalText(
                              component.technology
                          ),
                      })),
                      diagram:
                          caseStudy.architecture.diagram === undefined ||
                          caseStudy.architecture.diagram === null
                              ? null
                              : canonicalImage(
                                    caseStudy.architecture.diagram
                                ),
                  },
        keyDecisions: (caseStudy.keyDecisions ?? []).map((decision) => ({
            decision: canonicalRequiredText(decision.decision),
            rationale: canonicalRequiredText(decision.rationale),
            tradeoff: canonicalOptionalText(decision.tradeoff),
        })),
        challenges: (caseStudy.challenges ?? []).map((challenge) => ({
            problem: canonicalRequiredText(challenge.problem),
            resolution: canonicalRequiredText(challenge.resolution),
            lesson: canonicalOptionalText(challenge.lesson),
        })),
        outcomes: (caseStudy.outcomes ?? []).map((outcome) => ({
            kind: outcome.kind,
            statement: canonicalRequiredText(outcome.statement),
            metric: canonicalOptionalText(outcome.metric),
            value: canonicalOptionalText(outcome.value),
            unit: canonicalOptionalText(outcome.unit),
            baseline: canonicalOptionalText(outcome.baseline),
            direction: outcome.direction ?? null,
            evidence:
                outcome.evidence === undefined || outcome.evidence === null
                    ? null
                    : {
                          status: outcome.evidence.status,
                          source: canonicalOptionalText(
                              outcome.evidence.source
                          ),
                          url: canonicalOptionalText(outcome.evidence.url),
                          note: canonicalOptionalText(outcome.evidence.note),
                      },
        })),
        learnings: (caseStudy.learnings ?? []).map(canonicalRequiredText),
        gallery: (caseStudy.gallery ?? []).map(canonicalImage),
        links: (caseStudy.links ?? []).map((link) => ({
            label: canonicalRequiredText(link.label),
            url: trimCaseStudyText(link.url),
            kind: link.kind,
        })),
    };
}

function validateCaseStudy(caseStudy, whereKey, problems) {
    if (!plainObject(caseStudy)) {
        problems.push(`${whereKey} must be an object or null.`);
        return;
    }

    const problemsBefore = problems.length;

    checkUnknownKeys(
        caseStudy,
        [
            "schemaVersion",
            "role",
            "timeline",
            "team",
            "problem",
            "constraints",
            "approach",
            "architecture",
            "keyDecisions",
            "challenges",
            "outcomes",
            "learnings",
            "gallery",
            "links",
        ],
        whereKey,
        problems
    );

    if (caseStudy.schemaVersion !== 1) {
        problems.push(`${whereKey}.schemaVersion must be 1.`);
    }

    checkOptionalString(caseStudy.role, `${whereKey}.role`, problems, {
        maxLength: 120,
    });

    if (caseStudy.timeline !== undefined && caseStudy.timeline !== null) {
        validateTimeline(caseStudy.timeline, `${whereKey}.timeline`, problems);
    }
    if (caseStudy.team !== undefined && caseStudy.team !== null) {
        validateTeam(caseStudy.team, `${whereKey}.team`, problems);
    }
    if (caseStudy.problem !== undefined && caseStudy.problem !== null) {
        validateProblem(caseStudy.problem, `${whereKey}.problem`, problems);
    }

    checkStringList(caseStudy.constraints, `${whereKey}.constraints`, problems, {
        maxItems: 12,
        maxLength: 240,
    });
    validateApproach(caseStudy.approach, `${whereKey}.approach`, problems);

    if (
        caseStudy.architecture !== undefined &&
        caseStudy.architecture !== null
    ) {
        validateArchitecture(
            caseStudy.architecture,
            `${whereKey}.architecture`,
            problems
        );
    }

    validateKeyDecisions(
        caseStudy.keyDecisions,
        `${whereKey}.keyDecisions`,
        problems
    );
    validateChallenges(caseStudy.challenges, `${whereKey}.challenges`, problems);
    validateOutcomes(caseStudy.outcomes, `${whereKey}.outcomes`, problems);
    checkStringList(caseStudy.learnings, `${whereKey}.learnings`, problems, {
        maxItems: 12,
        maxLength: 300,
    });

    if (caseStudy.gallery !== undefined) {
        if (!Array.isArray(caseStudy.gallery)) {
            problems.push(`${whereKey}.gallery must be an array.`);
        } else {
            if (caseStudy.gallery.length > 12) {
                problems.push(
                    `${whereKey}.gallery must contain at most 12 items.`
                );
            }
            caseStudy.gallery.forEach((image, index) => {
                validateImageAsset(
                    image,
                    `${whereKey}.gallery[${index}]`,
                    problems
                );
            });
        }
    }

    validateLinks(caseStudy.links, `${whereKey}.links`, problems);

    const hasSubstantiveField =
        trimmedString(caseStudy.role) !== null ||
        (caseStudy.timeline !== undefined && caseStudy.timeline !== null) ||
        (caseStudy.team !== undefined && caseStudy.team !== null) ||
        (caseStudy.problem !== undefined && caseStudy.problem !== null) ||
        (caseStudy.architecture !== undefined &&
            caseStudy.architecture !== null) ||
        [
            caseStudy.constraints,
            caseStudy.approach,
            caseStudy.keyDecisions,
            caseStudy.challenges,
            caseStudy.outcomes,
            caseStudy.learnings,
            caseStudy.gallery,
            caseStudy.links,
        ].some((value) => Array.isArray(value) && value.length > 0);

    if (!hasSubstantiveField) {
        problems.push(
            `${whereKey} must contain at least one substantive field ` +
                "besides schemaVersion."
        );
    }

    if (problems.length === problemsBefore) {
        const canonical = canonicalCaseStudy(caseStudy);
        if (
            utf8ByteLength(JSON.stringify(canonical)) > CASE_STUDY_MAX_BYTES
        ) {
            problems.push(
                `${whereKey} must be ${CASE_STUDY_MAX_BYTES} bytes or fewer ` +
                    "when serialized."
            );
        }
    }
}

export function validateCaseStudyDocument(caseStudy, whereKey = "caseStudy") {
    const problems = [];
    validateCaseStudy(caseStudy, whereKey, problems);
    return problems;
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