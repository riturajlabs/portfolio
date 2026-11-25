/**
 * Email service.
 *
 * Sends form submissions to the FastAPI backend at `/api/contact`.
 *
 * In production (`VITE_BACKEND_URL` unset) the call is SAME-ORIGIN so it
 * routes through Vercel's edge middleware (see `middleware.js` at the repo
 * root), which injects the shared `X-API-Key` header before the rewrite
 * forwards the request to the Render backend.
 *
 * For local dev, set `VITE_BACKEND_URL=http://localhost:8000` in `.env`
 * to bypass the rewrite and hit FastAPI directly.
 */

const BACKEND_URL =
    (import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

export const CONTACT_TIMEOUT_MS = 12000;

function requestError(name, message) {
    return Object.assign(new Error(message), { name });
}

export async function sendEmail(
    formData,
    { signal, timeoutMs = CONTACT_TIMEOUT_MS } = {},
) {
    if (signal?.aborted) {
        throw requestError("AbortError", "Message sending was cancelled.");
    }

    const controller = new AbortController();
    const timeoutError = requestError("TimeoutError", "The request timed out.");
    const cancelError = requestError("AbortError", "Message sending was cancelled.");
    let abortError = timeoutError;
    let removeAbortListener = () => {};

    const forwardAbort = () => {
        abortError = cancelError;
        controller.abort();
    };

    if (signal) {
        signal.addEventListener("abort", forwardAbort, { once: true });
        removeAbortListener = () => signal.removeEventListener("abort", forwardAbort);
    }

    const abortPromise = new Promise((_, reject) => {
        const onAbort = () => reject(abortError);
        controller.signal.addEventListener("abort", onAbort, { once: true });
    });

    const timer = setTimeout(() => {
        abortError = timeoutError;
        controller.abort();
    }, timeoutMs);

    try {
        const response = await Promise.race([
            fetch(`${BACKEND_URL}/api/contact`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                },
                body: JSON.stringify({
                    name: formData.name,
                    email: formData.email,
                    message: formData.message,
                }),
                signal: controller.signal,
            }),
            abortPromise,
        ]);

        if (!response.ok) {
            let detail = `HTTP ${response.status}`;
            try {
                const data = await response.json();
                detail = data?.detail || data?.message || detail;
            } catch {
                detail = `HTTP ${response.status}`;
            }
            throw new Error(detail);
        }

        return response.json().catch(() => ({}));
    } catch (error) {
        if (controller.signal.aborted) throw abortError;
        throw error;
    } finally {
        clearTimeout(timer);
        removeAbortListener();
    }
}
