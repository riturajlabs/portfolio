// =========================================================
// 💬 CHAT TRANSPORT — BOUNDED, RETRY-AWARE SSE CLIENT
// =========================================================
// The public chat widget streams answers from the Render-hosted
// `ai_service` (`POST /chat/stream`, with `POST /chat` as a same-shape
// fallback). That service runs on Render's free tier, which suspends an
// idle instance; the first request after a quiet period pays a cold start
// (measured ~25-28 s of Python import alone) and, for the first few seconds
// after boot, answers 503 while the ChromaDB knowledge base ingests.
//
// A single fetch therefore fails intermittently depending only on whether
// the instance happened to be warm. This module owns a *bounded* retry
// policy — the same shape as the build-time `content.js` loader — so a
// transient cold start recovers, while a genuinely broken service still
// fails in a predictable time. It never retries authentication failures or
// permanent 4xx, never retries once answer tokens have started streaming
// (that would duplicate output), and never loops without a ceiling.
//
// Everything here is injectable (`fetchImpl`, `sleep`, `config`) so the
// retry math and error classification are unit-testable without timers or
// a network.
// =========================================================

// Per-attempt ceiling. Sized to the measured cold start: an attempt that
// starts during the boot window may abort here, and the *next* attempt
// (after backoff) lands on the now-warm instance.
export const DEFAULT_REQUEST_TIMEOUT_MS = 25000;
// Hard ceiling on attempts. Three attempts cover a cold start + one retry;
// a fourth would only delay a genuine outage.
export const DEFAULT_MAX_ATTEMPTS = 3;
// Exponential backoff base and per-delay ceiling.
export const DEFAULT_BACKOFF_BASE_MS = 2000;
export const DEFAULT_BACKOFF_MAX_MS = 10000;
// Hard ceiling for one user send across *all* attempts and backoffs, so a
// pathological service can never hold the widget forever.
export const DEFAULT_TOTAL_BUDGET_MS = 90000;

export const CHAT_RETRY_CONFIG = Object.freeze({
    timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    backoffBaseMs: DEFAULT_BACKOFF_BASE_MS,
    backoffMaxMs: DEFAULT_BACKOFF_MAX_MS,
    totalBudgetMs: DEFAULT_TOTAL_BUDGET_MS,
});

// Same retryable set as the build-time content loader: request/rate-limit
// statuses plus every 5xx. 401/403 and other 4xx are deterministic — a
// second attempt cannot fix a rejected key or a malformed request.
export function isRetryableStatus(status) {
    return (
        status === 408 ||
        status === 425 ||
        status === 429 ||
        (status >= 500 && status <= 599)
    );
}

// `Retry-After` is either delta-seconds or an HTTP-date (RFC 9110). Returns
// milliseconds, or null when absent/unparseable. Never negative.
export function parseRetryAfterMs(value) {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (raw === "") return null;
    if (/^\d+(\.\d+)?$/.test(raw)) {
        const seconds = Number(raw);
        return Number.isFinite(seconds) && seconds >= 0
            ? Math.round(seconds * 1000)
            : null;
    }
    const when = Date.parse(raw);
    return Number.isNaN(when) ? null : Math.max(0, when - Date.now());
}

// Exponential backoff, floored by an honoured `Retry-After` and capped so a
// misconfigured server cannot push the widget past its budget. Mirrors the
// no-jitter convention used by `content.js`.
export function computeRetryDelayMs(
    attempt,
    retryAfterMs,
    { backoffBaseMs = DEFAULT_BACKOFF_BASE_MS, backoffMaxMs = DEFAULT_BACKOFF_MAX_MS } = {},
) {
    const safeAttempt = Math.max(1, Math.trunc(attempt) || 1);
    const exponential = Math.min(
        backoffBaseMs * 2 ** (safeAttempt - 1),
        backoffMaxMs,
    );
    const honoured =
        typeof retryAfterMs === "number" && retryAfterMs > 0 ? retryAfterMs : 0;
    return Math.min(Math.max(exponential, honoured), backoffMaxMs);
}

// A sanitized, user-facing sentence for a failed send. Diagnostic detail is
// kept on the error object (and logged by the caller), never rendered raw.
export function describeChatError(error) {
    const status = error?.status;
    if (status === 401 || status === 403) {
        return "The AI assistant could not authenticate. Please refresh the page and try again.";
    }
    if (status === 429) {
        return "The AI assistant is receiving too many requests. Please wait a moment and try again.";
    }
    if (status >= 500 || error?.retryable === true) {
        return "The AI service is waking up or temporarily unavailable. Please try again in a moment.";
    }
    if (error?.detail) {
        return "The AI service returned an error while answering. Please try again.";
    }
    return "The AI service is temporarily unavailable. Please try again.";
}

// Transport/HTTP/stream failure. `retryable` and `aborted` drive the retry
// loop; `detail` and `cause` are for logs only.
export class ChatRequestError extends Error {
    constructor(
        message,
        {
            status = null,
            retryable = false,
            retryAfterMs = null,
            aborted = false,
            detail = null,
            cause = null,
        } = {},
    ) {
        super(message);
        this.name = "ChatRequestError";
        this.status = status;
        this.retryable = retryable;
        this.retryAfterMs = retryAfterMs;
        this.aborted = aborted;
        this.detail = detail;
        if (cause) this.cause = cause;
    }
}

/**
 * Stream a chat answer with bounded retries.
 *
 * `baseUrl` is the chat root (e.g. `/api/chat`); endpoints tried per attempt
 * are `<baseUrl>/stream` then `<baseUrl>`. `onEvent` receives each decoded
 * SSE payload (`{ event, data }`). `onRetry` fires before each backoff with
 * `{ attempt, maxAttempts, delayMs, error }` so the UI can show a temporary
 * "waking up" state. `signal` cancels the whole send (Stop / unmount).
 *
 * Resolves once an attempt streams successfully. Throws a
 * `ChatRequestError` otherwise — with `aborted: true` for cancellation.
 */
export async function streamChat({
    baseUrl,
    body,
    signal,
    onEvent = () => {},
    onRetry,
    config = {},
    fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
} = {}) {
    const cfg = { ...CHAT_RETRY_CONFIG, ...config };

    if (typeof fetchImpl !== "function") {
        throw new ChatRequestError(
            "No fetch implementation is available.",
            { retryable: false },
        );
    }

    let payloadText;
    try {
        payloadText = JSON.stringify(body ?? {});
    } catch (cause) {
        throw new ChatRequestError("The request could not be serialized.", {
            retryable: false,
            cause,
        });
    }

    const endpoints = [`${baseUrl}/stream`, `${baseUrl}`];
    const deadline = Date.now() + cfg.totalBudgetMs;
    let streamed = false;
    let lastError;

    for (let attempt = 1; attempt <= cfg.maxAttempts; attempt += 1) {
        if (signal?.aborted) {
            throw new ChatRequestError("Request cancelled.", { aborted: true });
        }

        const remaining = deadline - Date.now();
        if (remaining <= 0) break;

        try {
            await runAttempt({
                endpoints,
                payloadText,
                deadline,
                attemptTimeoutMs: cfg.timeoutMs,
                fetchImpl,
                signal,
                onEvent,
                onStream: () => { streamed = true; },
            });
            return;
        } catch (error) {
            lastError = error;

            if (signal?.aborted || error?.aborted) throw error;
            // A partially streamed answer must never be retried: a second
            // attempt would replay tokens the user already saw.
            if (streamed) throw error;
            if (!error?.retryable || attempt >= cfg.maxAttempts) throw error;

            const remainingAfter = deadline - Date.now();
            if (remainingAfter <= 0) throw error;

            // A 429 carries an explicit server window. Honour it up to the
            // remaining budget rather than the normal 10 s backoff cap; if it
            // cannot fit, stop now instead of hammering the endpoint.
            if (error.status === 429 && error.retryAfterMs > 0) {
                if (error.retryAfterMs >= remainingAfter) {
                    throw new ChatRequestError(
                        "The AI assistant is receiving too many requests. " +
                            "Please wait a moment and try again.",
                        {
                            status: 429,
                            retryable: false,
                            retryAfterMs: error.retryAfterMs,
                            detail: error.detail,
                        },
                    );
                }
                onRetry?.({
                    attempt,
                    maxAttempts: cfg.maxAttempts,
                    delayMs: error.retryAfterMs,
                    error,
                });
                await sleep(error.retryAfterMs, signal);
                continue;
            }

            const delayMs = Math.min(
                computeRetryDelayMs(attempt, error.retryAfterMs, cfg),
                remainingAfter,
            );
            onRetry?.({ attempt, maxAttempts: cfg.maxAttempts, delayMs, error });
            await sleep(delayMs, signal);
        }
    }

    // Unreachable in practice (the loop returns or throws), but keep the
    // rethrow so a future edit cannot silently drop the failure.
    throw lastError ?? new ChatRequestError(
        "The AI service is unavailable.",
        { retryable: false },
    );
}

// One attempt = primary `/stream` then the `/chat` fallback. Each channel
// gets its own fetch + AbortController, so a consumed body is never reused.
async function runAttempt({
    endpoints,
    payloadText,
    deadline,
    attemptTimeoutMs,
    fetchImpl,
    signal,
    onEvent,
    onStream,
}) {
    let firstError = null;
    let streamed = false;
    const markStreamed = () => {
        streamed = true;
        onStream?.();
    };
    for (const endpoint of endpoints) {
        // Clamp each request to what is left of the shared deadline, so the
        // budget spans the primary AND the fallback (and every retry), not
        // just the moment an attempt began.
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
            throw (
                firstError ??
                new ChatRequestError(
                    "The AI service did not respond within the time budget.",
                    { retryable: true },
                )
            );
        }
        const requestTimeoutMs = Math.max(
            1,
            Math.min(attemptTimeoutMs, remaining),
        );
        try {
            await fetchSse(endpoint, {
                payloadText,
                timeoutMs: requestTimeoutMs,
                fetchImpl,
                signal,
                onEvent,
                onStream: markStreamed,
            });
            return;
        } catch (error) {
            if (signal?.aborted || error?.aborted) throw error;
            if (!firstError) firstError = error;
            // Once tokens have streamed, the fallback endpoint would replay
            // partial output — never try it. A deterministic failure (auth /
            // permanent 4xx) cannot be fixed by the other endpoint either.
            if (streamed || error?.retryable !== true) throw error;
        }
    }
    throw firstError ?? new ChatRequestError("The AI service is unavailable.", {
        retryable: false,
    });
}

async function fetchSse(endpoint, {
    payloadText,
    timeoutMs,
    fetchImpl,
    signal,
    onEvent,
    onStream,
}) {
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    if (signal) {
        if (signal.aborted) {
            throw new ChatRequestError("Request cancelled.", { aborted: true });
        }
        signal.addEventListener("abort", onExternalAbort, { once: true });
    }

    let timedOut = false;
    let emitted = false;
    // Track whether any answer token reached the consumer, so a read failure
    // is only ever classified retryable when nothing has been shown yet.
    const onStreamTracked = () => {
        emitted = true;
        onStream?.();
    };
    // The timer spans the whole attempt (headers *and* stream) so a stalled
    // provider cannot hold the request open indefinitely.
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);

    let response;
    try {
        try {
            response = await fetchImpl(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "text/event-stream",
                },
                body: payloadText,
                signal: controller.signal,
            });
        } catch (cause) {
            if (signal?.aborted) {
                throw new ChatRequestError("Request cancelled.", {
                    aborted: true,
                    cause,
                });
            }
            if (timedOut) {
                throw new ChatRequestError(
                    `The AI service did not respond within ${timeoutMs}ms.`,
                    { retryable: true, cause },
                );
            }
            throw new ChatRequestError("Could not reach the AI service.", {
                retryable: true,
                cause,
            });
        }

        if (!response || !response.ok) {
            const status = response?.status ?? 0;
            const retryAfterMs = parseRetryAfterMs(
                response?.headers?.get?.("Retry-After"),
            );
            throw new ChatRequestError(
                `The AI service responded with HTTP ${status}.`,
                { status, retryable: isRetryableStatus(status), retryAfterMs },
            );
        }

        await consumeSse(response, onEvent, onStreamTracked);
    } catch (cause) {
        // Preserve an intentional protocol error (a server-sent `error` event)
        // or a cancellation exactly as already classified.
        if (cause instanceof ChatRequestError) throw cause;
        if (signal?.aborted) {
            throw new ChatRequestError("Request cancelled.", {
                aborted: true,
                cause,
            });
        }
        // The timer fired while the body was still being read. Retryable —
        // unless tokens already reached the user, where a retry would replay
        // partial output.
        if (timedOut) {
            throw new ChatRequestError(
                `The AI service did not respond within ${timeoutMs}ms.`,
                { retryable: !emitted, cause },
            );
        }
        throw new ChatRequestError("The AI stream was interrupted.", {
            retryable: !emitted,
            cause,
        });
    } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onExternalAbort);
    }
}

// Decode an SSE body and dispatch each payload. A JSON parse failure is the
// *only* thing swallowed (a malformed frame is skipped); a server-sent
// `error` event is re-thrown so it can never be silently dropped.
async function consumeSse(response, onEvent, onStream) {
    const body = response?.body;
    if (!body || typeof body.getReader !== "function") {
        throw new ChatRequestError("The AI response could not be read.", {
            retryable: false,
        });
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let boundary;
            while ((boundary = buffer.indexOf("\n\n")) !== -1) {
                const rawEvent = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);

                const dataLine = rawEvent
                    .split("\n")
                    .find((line) => line.startsWith("data:"));
                if (!dataLine) continue;

                let payload;
                try {
                    payload = JSON.parse(dataLine.slice(5).trim());
                } catch {
                    continue; // malformed frame — skip, don't swallow real errors
                }

                if (payload.event === "error") {
                    const detail =
                        typeof payload.data === "string" ? payload.data : "";
                    if (detail)
                        console.warn("[Chat] AI service error event:", detail);
                    throw new ChatRequestError(
                        "The AI service returned an error while answering.",
                        { retryable: false, detail },
                    );
                }

                if (payload.event === "token" && payload.data) onStream?.();
                onEvent(payload);
            }
        }
    } finally {
        // Release the connection on every exit path (normal end, server `error`
        // event, or an abort that rejected the pending read).
        try {
            await reader.cancel?.();
        } catch {
            /* stream already errored or released */
        }
    }
}

// Abortable delay. Rejects with an `aborted` error so a Stop or unmount
// interrupts a backoff immediately instead of waiting it out.
function defaultSleep(ms, signal) {
    if (!ms) return Promise.resolve();
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new ChatRequestError("Request cancelled.", { aborted: true }));
            return;
        }
        const cleanup = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
        };
        const onAbort = () => {
            cleanup();
            reject(new ChatRequestError("Request cancelled.", { aborted: true }));
        };
        const timer = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
