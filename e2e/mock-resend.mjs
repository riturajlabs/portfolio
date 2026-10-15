// Minimal Resend stand-in for e2e. The disposable backend points
// `RESEND_API_URL` here, so a contact submission succeeds end-to-end with real
// storage without any real email being sent.

import { createServer } from "node:http";

const PORT = Number(process.env.E2E_RESEND_PORT || 8902);

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"status":"ok"}');
      return;
    }
    if (req.url === "/resend" && req.method === "POST") {
      const id = `e2e-${Date.now()}`;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id, delivered_to: [] }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end('{"error":"not found"}');
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-resend] on http://127.0.0.1:${PORT}`);
});