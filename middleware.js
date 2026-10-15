import { ipAddress, next } from "@vercel/functions";


export const config = {
    // `/api/chat/*` only. `/api/contact` is served by the backend, which does
    // not verify `X-API-Key`; keeping it here made contact depend on the chat
    // secret and return 503 whenever `BACKEND_API_KEY` was unset.
    matcher: [
        "/api/chat",
        "/api/chat/:path*",
    ],
};

// The ai_service trusts a client IP only when these agree: the address in the
// IP header signed with the shared secret. `ipAddress()` reads Vercel's
// authoritative `x-real-ip`, and `headers.set` replaces any value a browser
// tried to smuggle in under the same name, so a caller cannot select their own
// bucket. A direct caller to the Render host cannot forge the signature.
const CLIENT_IP_HEADER = "x-vercel-client-ip";
const CLIENT_IP_SIGNATURE_HEADER = "x-vercel-client-ip-signature";

async function signHex(secret, value) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
    return [...new Uint8Array(mac)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

export default async function middleware(request) {
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

    // Stamp and sign the real client IP so the AI service can bucket its rate
    // limit per client instead of per shared proxy address. `set` overwrites,
    // so an inbound spoof of either header never survives to the origin.
    const clientIp = ipAddress(request);
    if (clientIp) {
        headers.set(CLIENT_IP_HEADER, clientIp);
        headers.set(
            CLIENT_IP_SIGNATURE_HEADER,
            await signHex(apiKey, clientIp)
        );
    } else {
        headers.delete(CLIENT_IP_HEADER);
        headers.delete(CLIENT_IP_SIGNATURE_HEADER);
    }

    return next({ request: { headers } });
}
