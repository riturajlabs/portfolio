/**
 * Vercel Edge Middleware.
 *
 * Injects the shared `X-API-Key` header on requests that the rewrite
 * routes to the Render backend. The value comes from a server-only
 * env var (`BACKEND_API_KEY`) — it is never bundled into the JS or
 * exposed to the browser, because this middleware runs at the edge
 * before the response is sent back to the client.
 *
 * Only `/api/chat/*` and `/api/contact` need the header. `/api/github`
 * is public because the backend proxies GitHub anonymously unless a
 * separate `GITHUB_TOKEN` is configured on Render.
 *
 * Why a middleware and not a headers proxy?
 *   - Vercel `vercel.json` rewrites pass through the inbound request
 *     unchanged. To mutate headers, you need middleware (or a custom
 *     serverless function as the destination).
 *   - The middleware runs at the edge — sub-millisecond cost.
 *
 * Required env (configured in Vercel project settings, NOT in `VITE_*`):
 *   BACKEND_API_KEY  — same value as Render's AI_SERVICE_KEY.
 *
 * Reject on the edge if the env is missing in production so a misconfigured
 * deploy can't accidentally let unkeyed traffic through.
 */

const PROTECTED_PATHS = ["/api/chat", "/api/contact"];

export const config = {
  // Run on every request that matches a rewrite destination. Vercel
  // matches this against the inbound URL, not the rewrite destination.
  matcher: ["/api/chat/:path*", "/api/contact", "/api/github"],
};

export default function middleware(request) {
  const url = new URL(request.url);
  const needsKey = PROTECTED_PATHS.some((p) => url.pathname.startsWith(p));

  if (!needsKey) {
    // Pass through unchanged (e.g. /api/github).
    return undefined;
  }

  const key =
    typeof process !== "undefined" && process.env
      ? process.env.BACKEND_API_KEY
      : "";
  if (!key) {
    // Fail closed: in production a missing key is a deploy error.
    // On Vercel preview branches without the env set, the visitor sees
    // a 503 so we don't silently leak unkeyed requests.
    return jsonResponse({ error: "API key not configured on proxy." }, 503);
  }

  try {
    // Clone the request and inject the header. The original request
    // body is a ReadableStream that we re-wrap for the rewrite.
    //
    // ⚠️ `duplex: "half"` is only allowed when a body is present —
    // passing it alongside a null body throws `TypeError:
    // RequestInit.duplex is only allowed when body is present`, which
    // surfaces as `MIDDLEWARE_INVOCATION_FAILED` (HTTP 500) on every
    // protected request, including bodyless GETs. Use the conditional
    // spread so GETs (no body) stay valid.
    const headers = new Headers(request.headers);
    headers.set("X-API-Key", key);

    const init = { method: request.method, headers };
    if (request.body) {
      init.body = request.body;
      init.duplex = "half";
    }
    return new Request(request.url, init);
  } catch (err) {
    console.error("[middleware] failed to forward protected request:", err);
    return jsonResponse(
      { error: "Proxy failed to forward the request." },
      502
    );
  }
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
