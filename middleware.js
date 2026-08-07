import { next } from "@vercel/functions";


export const config = {
    matcher: [
        "/api/chat/:path*",
        "/api/contact",
    ],
};


export default function middleware(request) {
    const apiKey = process.env.BACKEND_API_KEY;

    if (!apiKey) {
        return new Response(
            JSON.stringify({ error: "Missing BACKEND_API_KEY" }),
            {
                status: 503,
                headers: {
                    "content-type": "application/json",
                },
            }
        );
    }

    // Clone the request headers and inject the shared secret. Returning
    // `next({ request: { headers } })` forwards the modified headers to
    // the rewritten origin (the Render backend) — the secret never
    // reaches the browser bundle.
    const headers = new Headers(request.headers);
    headers.set("X-API-Key", apiKey);

    return next({ request: { headers } });
}
