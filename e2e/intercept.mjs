// Browser-layer sandbox for the public services in the built bundle.
//
// The local `.env` pins `VITE_BACKEND_URL=http://localhost:8000`, so the built
// prod bundle's chat, contact and github code call `http://localhost:8000`
// directly instead of same-origin `/api/*`. During e2e we must guarantee two
// things: nothing from the browser ever reaches the real docker `webchat-api`
// service (or the internet), and chat "AI" output is deterministic.
//
// So every `http://localhost:8000/**` request is intercepted:
//   * `/chat` and `/chat/stream`  → a canned SSE stream matching the protocol
//   * `/api/contact`              → relayed to the disposable :8901 backend so
//                                   the row is really persisted
//   * everything else (github…)   → a benign empty payload or 404
//
// These are cross-origin (page is on :4173), so preflights and responses carry
// the CORS headers the browser would otherwise enforce.

import { fail } from "node:assert";

const BACKEND = `http://127.0.0.1:${process.env.E2E_BACKEND_PORT || 8901}`;
const ALLOW_ORIGIN = "http://127.0.0.1:4173";

const MODEL_NAME = "Mock AI";
const TOKENS = ["Hello from the", " e2e mock assistant!", " It works."];
const SOURCE = "webchat-docs";

function sse(event, data) {
  return `data: ${JSON.stringify({ event, data })}\n\n`;
}

export function chatSseBody() {
  const chunks = [];
  chunks.push(sse("meta", { model: MODEL_NAME }));
  chunks.push(sse("sources", [{ source: SOURCE, score: 0.91 }]));
  for (const token of TOKENS) chunks.push(sse("token", token));
  chunks.push(sse("done", MODEL_NAME));
  return chunks.join("");
}

export const MOCK_CHAT_TEXT = TOKENS.join("");
export const MOCK_CHAT_SOURCE = SOURCE;
export const MOCK_CHAT_MODEL = MODEL_NAME;

function cors(response) {
  if (!response.headers) response.headers = {};
  response.headers["Access-Control-Allow-Origin"] = ALLOW_ORIGIN;
  response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS";
  response.headers["Access-Control-Allow-Headers"] = "Content-Type, Accept";
  return response;
}

export async function attachBrowserSandbox(page) {
  await page.route("http://localhost:8000/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());

    if (request.method() === "OPTIONS") {
      await route.fulfill(cors({ status: 204, body: "" }));
      return;
    }

    if (pathname === "/chat" || pathname === "/chat/stream") {
      await route.fulfill(
        cors({
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store",
          },
          body: chatSseBody(),
        })
      );
      return;
    }

    if (pathname === "/api/contact") {
      const upstream = await fetch(`${BACKEND}/api/contact`, {
        method: request.method(),
        headers: { "Content-Type": "application/json" },
        body: request.postData(),
      });
      await route.fulfill(
        cors({
          status: upstream.status,
          headers: { "Content-Type": "application/json" },
          body: await upstream.text(),
        })
      );
      return;
    }

    if (pathname.startsWith("/api/github") || pathname === "/github") {
      await route.fulfill(cors({ status: 200, json: {} }));
      return;
    }

    // Hard catch-all: nothing escapes the sandbox.
    fail(`[sandbox] unexpected localhost:8000 request reached the spec: ${request.method()} ${pathname}`);
  });
}