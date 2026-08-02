/**
 * Email service.
 *
 * Sends form submissions to the FastAPI backend at `/api/contact`.
 * The base URL comes from the Vercel env var `VITE_BACKEND_URL`
 * (e.g. `https://portfolio-lxdx.onrender.com`).
 *
 * For local dev, set `VITE_BACKEND_URL=http://localhost:8000` in `.env`.
 */

const BACKEND_URL =
    import.meta.env.VITE_BACKEND_URL ||
    import.meta.env.VITE_API_URL ||
    "http://localhost:8000";

export async function sendEmail(formData) {
    const response = await fetch(`${BACKEND_URL}/api/contact`, {
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
    });

    if (!response.ok) {
        // Try to surface the server's error message; fall back to status.
        let detail = `HTTP ${response.status}`;
        try {
            const data = await response.json();
            detail = data?.detail || data?.message || detail;
        } catch {
            // ignore — response wasn't JSON
        }
        throw new Error(detail);
    }

    return response.json().catch(() => ({}));
}