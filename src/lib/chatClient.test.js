// =========================================================
// 💬 CHAT TRANSPORT TESTS — BOUNDED, RETRY-AWARE SSE CLIENT
// =========================================================
// Focused on the policy that a Render free-tier cold start made necessary:
// transient failures (cold-start timeout, "store still loading" 503) must
// recover, while auth failures / permanent 4xx / user cancellation must not
// be retried, and a partially streamed answer must never restart. All I/O is
// injected (`fetchImpl`, `sleep`) so these are deterministic and fast.

import { describe, expect, it, vi } from "vitest";

import {
    CHAT_RETRY_CONFIG,
    ChatRequestError,
    computeRetryDelayMs,
    describeChatError,
    isRetryableStatus,
    parseRetryAfterMs,
    streamChat,
} from "./chatClient.js";

const encoder = new TextEncoder();

// One SSE frame: `data: <json>\n\n` (the wire shape the backend emits).
function frame(event, data) {
    return encoder.encode(`data: ${JSON.stringify({ event, data })}\n\n`);
}

// A `Response`-shaped object whose body replays `chunks`. A chunk may be a
// `Uint8Array` or a function invoked on read (to simulate a mid-stream drop).
function streamingBody(chunks) {
    let i = 0;
    return {
        getReader: () => ({
            read: async () => {
                if (i >= chunks.length) return { value: undefined, done: true };
                const next = chunks[i];
                i += 1;
                return typeof next === "function"
                    ? next()
                    : { value: next, done: false };
            },
            releaseLock: () => {},
            cancel: async () => {},
        }),
    };
}

function response({ status = 200, retryAfter = null, chunks = [] } = {}) {
    const ok = status >= 200 && status < 300;
    return {
        ok,
        status,
        headers: {
            get: (name) =>
                String(name).toLowerCase() === "retry-after" ? retryAfter : null,
        },
        body: ok ? streamingBody(chunks) : null,
    };
}

// A body reader that never yields and rejects only when its signal aborts,
// modelling a connection that stalled *after* the response headers arrived.
function stallingBody(signal) {
    return {
        getReader: () => ({
            read: () =>
                new Promise((_resolve, reject) => {
                    if (signal.aborted) {
                        reject(abortError());
                        return;
                    }
                    signal.addEventListener(
                        "abort",
                        () => reject(abortError()),
                        { once: true },
                    );
                }),
            releaseLock: () => {},
            cancel: async () => {},
        }),
    };
}

function abortError() {
    return Object.assign(new Error("aborted"), { name: "AbortError" });
}

function stallingResponse(signal) {
    return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: stallingBody(signal),
    };
}

const noSleep = vi.fn(async () => {});

describe("retry policy helpers", () => {
    it("treats 408/425/429 and 5xx as retryable, other 4xx as not", () => {
        for (const s of [408, 425, 429, 500, 502, 503, 504, 599]) {
            expect(isRetryableStatus(s), String(s)).toBe(true);
        }
        for (const s of [400, 401, 403, 404, 409, 422]) {
            expect(isRetryableStatus(s), String(s)).toBe(false);
        }
    });

    it("parses Retry-After as delta-seconds or an HTTP-date", () => {
        expect(parseRetryAfterMs("3")).toBe(3000);
        expect(parseRetryAfterMs("0")).toBe(0);
        expect(parseRetryAfterMs(null)).toBeNull();
        expect(parseRetryAfterMs("")).toBeNull();
        expect(parseRetryAfterMs("garbage")).toBeNull();

        const parsed = parseRetryAfterMs(
            new Date(Date.now() + 5000).toUTCString(),
        );
        expect(parsed).toBeGreaterThan(3000);
        expect(parsed).toBeLessThanOrEqual(6000);
    });

    it("backs off exponentially, honours Retry-After, and stays capped", () => {
        expect(computeRetryDelayMs(1)).toBe(2000);
        expect(computeRetryDelayMs(2)).toBe(4000);
        expect(computeRetryDelayMs(3)).toBe(8000);
        expect(computeRetryDelayMs(12)).toBe(10000);
        expect(computeRetryDelayMs(1, 7500)).toBe(7500);
        expect(computeRetryDelayMs(1, 999999)).toBe(10000);
    });

    it("exposes a frozen default config", () => {
        expect(Object.isFrozen(CHAT_RETRY_CONFIG)).toBe(true);
        expect(CHAT_RETRY_CONFIG).toMatchObject({
            timeoutMs: 25000,
            maxAttempts: 3,
            totalBudgetMs: 90000,
        });
    });

    it("maps failures to non-leaking user messages", () => {
        expect(describeChatError({ status: 401 })).toMatch(/authenticate/i);
        expect(
            describeChatError({ status: 503, retryable: true }),
        ).toMatch(/waking up|temporarily unavailable/i);
        expect(describeChatError({ status: 429 })).toMatch(/too many requests/i);
        expect(describeChatError({ detail: "internal boom: secret" })).not.toContain(
            "boom",
        );
        expect(describeChatError({})).toMatch(/temporarily unavailable/i);
    });
});

describe("streamChat", () => {
    it("retries a transient 503 and succeeds on a later attempt", async () => {
        const onRetry = vi.fn();
        const seen = [];
        let call = 0;
        const fetchImpl = vi.fn(async (url) => {
            call += 1;
            seen.push(url);
            if (call <= 2) return response({ status: 503, retryAfter: "2" });
            return response({
                chunks: [frame("token", "Hel"), frame("done", true)],
            });
        });

        await streamChat({
            baseUrl: "/api/chat",
            fetchImpl,
            sleep: noSleep,
            onRetry,
        });

        // attempt 1: /stream then /chat both 503; attempt 2: /stream succeeds.
        expect(seen).toEqual([
            "/api/chat/stream",
            "/api/chat",
            "/api/chat/stream",
        ]);
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(onRetry.mock.calls[0][0]).toMatchObject({
            attempt: 1,
            maxAttempts: CHAT_RETRY_CONFIG.maxAttempts,
        });
    });

    it("stops after the retry ceiling when the service stays down", async () => {
        const onRetry = vi.fn();
        const fetchImpl = vi.fn(async () =>
            response({ status: 503, retryAfter: "1" }),
        );

        await expect(
            streamChat({ baseUrl: "/api/chat", fetchImpl, sleep: noSleep, onRetry }),
        ).rejects.toMatchObject({ status: 503, retryable: true });

        // 3 attempts × 2 endpoints.
        expect(fetchImpl).toHaveBeenCalledTimes(6);
        expect(onRetry).toHaveBeenCalledTimes(2);
    });

    it("does not retry a deterministic 401 (and does not fall back)", async () => {
        const fetchImpl = vi.fn(async () => response({ status: 401 }));

        await expect(
            streamChat({ baseUrl: "/api/chat", fetchImpl, sleep: noSleep }),
        ).rejects.toMatchObject({ status: 401, retryable: false });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("retries a network failure and then succeeds", async () => {
        let call = 0;
        const fetchImpl = vi.fn(async () => {
            call += 1;
            if (call <= 2) throw new Error("network down");
            return response({ chunks: [frame("done", true)] });
        });

        await streamChat({ baseUrl: "/api/chat", fetchImpl, sleep: noSleep });
        expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it("aborts without any request when already cancelled", async () => {
        const controller = new AbortController();
        controller.abort();
        const fetchImpl = vi.fn();

        await expect(
            streamChat({
                baseUrl: "/api/chat",
                fetchImpl,
                sleep: noSleep,
                signal: controller.signal,
            }),
        ).rejects.toMatchObject({ aborted: true });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("surfaces a server-sent error event instead of swallowing it", async () => {
        const fetchImpl = vi.fn(async () =>
            response({ chunks: [frame("error", "boom")] }),
        );

        await expect(
            streamChat({ baseUrl: "/api/chat", fetchImpl, sleep: noSleep }),
        ).rejects.toMatchObject({ retryable: false, detail: "boom" });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("delivers valid frames while skipping malformed ones", async () => {
        const events = [];
        const fetchImpl = vi.fn(async () =>
            response({
                chunks: [
                    encoder.encode("data: not-json\n\n"),
                    frame("token", "ok"),
                    frame("done", true),
                ],
            }),
        );

        await streamChat({
            baseUrl: "/api/chat",
            fetchImpl,
            sleep: noSleep,
            onEvent: (e) => events.push(e),
        });

        expect(events).toEqual([
            { event: "token", data: "ok" },
            { event: "done", data: true },
        ]);
    });

    it("never retries or falls back after tokens have streamed", async () => {
        const boom = new ChatRequestError("stream dropped", { retryable: true });
        const fetchImpl = vi.fn(async () =>
            response({
                chunks: [frame("token", "partial"), () => { throw boom; }],
            }),
        );

        await expect(
            streamChat({ baseUrl: "/api/chat", fetchImpl, sleep: noSleep }),
        ).rejects.toBe(boom);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("treats a per-attempt timeout as retryable", async () => {
        const fetchImpl = vi.fn(
            (_url, { signal }) =>
                new Promise((_resolve, reject) => {
                    signal.addEventListener("abort", () =>
                        reject(new Error("aborted")),
                    );
                }),
        );

        await expect(
            streamChat({
                baseUrl: "/api/chat",
                fetchImpl,
                sleep: noSleep,
                config: { timeoutMs: 5 },
            }),
        ).rejects.toMatchObject({ retryable: true });
    });

    it("retries a stalled body read after successful headers", async () => {
        const onRetry = vi.fn();
        const fetchImpl = vi.fn((_url, { signal }) =>
            Promise.resolve(stallingResponse(signal)),
        );

        await expect(
            streamChat({
                baseUrl: "/api/chat",
                fetchImpl,
                sleep: noSleep,
                onRetry,
                config: { timeoutMs: 5 },
            }),
        ).rejects.toMatchObject({ retryable: true });

        // 3 attempts × (primary + fallback), each stalling until its timeout.
        expect(fetchImpl).toHaveBeenCalledTimes(6);
        expect(onRetry).toHaveBeenCalledTimes(2);
    });

    it("does not retry when the caller aborts during the body read", async () => {
        const controller = new AbortController();
        let signalStarted;
        const started = new Promise((resolve) => {
            signalStarted = resolve;
        });
        const fetchImpl = vi.fn((_url, { signal }) => {
            signalStarted();
            return Promise.resolve(stallingResponse(signal));
        });

        const pending = streamChat({
            baseUrl: "/api/chat",
            fetchImpl,
            sleep: noSleep,
            signal: controller.signal,
            config: { timeoutMs: 1000 },
        });
        await started;
        controller.abort();

        await expect(pending).rejects.toMatchObject({ aborted: true });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("keeps every request inside the shared total budget", async () => {
        const fetchImpl = vi.fn(
            (_url, { signal }) =>
                new Promise((_resolve, reject) => {
                    signal.addEventListener("abort", () => reject(abortError()));
                }),
        );

        const start = Date.now();
        await expect(
            streamChat({
                baseUrl: "/api/chat",
                fetchImpl,
                sleep: noSleep,
                config: { timeoutMs: 80, maxAttempts: 5, totalBudgetMs: 120 },
            }),
        ).rejects.toMatchObject({ retryable: true });
        const elapsed = Date.now() - start;

        // Only the primary + fallback of the first attempt fit the budget; a
        // second attempt must not start, and the fallback must not receive a
        // fresh full timeout that overruns the deadline.
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(elapsed).toBeLessThan(145);
    });

    it("honours a 429 Retry-After beyond the normal backoff cap", async () => {
        const sleeps = [];
        const sleep = vi.fn(async (ms) => {
            sleeps.push(ms);
        });
        const onRetry = vi.fn();
        let call = 0;
        const fetchImpl = vi.fn(async () => {
            call += 1;
            if (call <= 2) return response({ status: 429, retryAfter: "30" });
            return response({ chunks: [frame("done", true)] });
        });

        await streamChat({ baseUrl: "/api/chat", fetchImpl, sleep, onRetry });

        // 30 s — not truncated to the 10 s backoff maximum.
        expect(sleeps).toEqual([30000]);
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(onRetry.mock.calls[0][0]).toMatchObject({ delayMs: 30000 });
    });

    it("stops with a clear rate-limit error when Retry-After exceeds the budget", async () => {
        const sleep = vi.fn(async () => {});
        const fetchImpl = vi.fn(async () =>
            response({ status: 429, retryAfter: "30" }),
        );

        await expect(
            streamChat({
                baseUrl: "/api/chat",
                fetchImpl,
                sleep,
                config: { totalBudgetMs: 20000 },
            }),
        ).rejects.toMatchObject({ status: 429, retryable: false });

        // No honoured wait was attempted, and the endpoint was not hammered
        // again beyond the single attempt's two endpoints.
        expect(sleep).not.toHaveBeenCalled();
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
});

describe("describeChatError", () => {
    it("never leaks the raw detail into the user-facing message", () => {
        const error = new ChatRequestError("internal", { detail: "secret-api" });
        expect(describeChatError(error)).not.toContain("secret-api");
    });
});
