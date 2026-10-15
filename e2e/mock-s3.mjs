// Minimal S3-compatible stand-in for e2e. The disposable backend points
// `AWS_ENDPOINT_URL_S3` here, so resume uploads (and project-image uploads)
// complete end-to-end against real object storage semantics without a cloud
// account.
//
// It models the two facts the resume feature depends on:
//   * objects live under a bucket in the URL path (`/<bucket>/<key>`), matching
//     the path-style addressing the real client is configured for; and
//   * every request must be signed (`Authorization`), so an anonymous GET of a
//     stored object is refused — exactly the private-bucket contract the resume
//     relies on (it is only ever served through `GET /api/resume`).
//
// Operations used by `backend/app/services/storage.py`: put_object (PUT),
// get_object (GET), delete_object (DELETE).

import { createServer } from "node:http";

const PORT = Number(process.env.E2E_S3_PORT || 8903);

// bucket -> (key -> { body: Buffer, contentType: string })
const buckets = new Map();

function xml(res, status, code, message) {
  res.writeHead(status, { "Content-Type": "application/xml" });
  res.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`);
}

// A request is only honoured when it carries an s3v4 signature. There is no
// verification of the signature itself — the point is that *unsigned* access
// (a browser hitting the object directly) can never succeed.
function signed(req) {
  return typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("AWS4-HMAC-SHA256");
}

function parseTarget(url) {
  // Path-style: the first segment is the bucket, the rest is the key.
  const path = decodeURIComponent((url || "/").split("?")[0]);
  const withoutLeadingSlash = path.replace(/^\/+/, "");
  const slash = withoutLeadingSlash.indexOf("/");
  if (slash === -1) return { bucket: withoutLeadingSlash, key: "" };
  return {
    bucket: withoutLeadingSlash.slice(0, slash),
    key: withoutLeadingSlash.slice(slash + 1),
  };
}

function objectFor(bucket, key, create) {
  if (!buckets.has(bucket)) {
    if (!create) return undefined;
    buckets.set(bucket, new Map());
  }
  return buckets.get(bucket).get(key);
}

const server = createServer((req, res) => {
  const target = parseTarget(req.url);

  // Node answers `Expect: 100-continue` automatically (no `checkContinue`
  // listener), so the signed body arrives on the normal `data` path.
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"status":"ok"}');
    return;
  }

  if (!signed(req)) {
    // Drain the body so the client isn't left sending into a closed socket.
    req.resume();
    xml(res, 403, "AccessDenied", "Anonymous or unsigned requests are not permitted.");
    return;
  }

  if (!target.bucket || !target.key) {
    req.resume();
    xml(res, 400, "InvalidRequest", "Expected a path-style /<bucket>/<key> target.");
    return;
  }

  if (req.method === "PUT") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const store = buckets.get(target.bucket) || new Map();
      buckets.set(target.bucket, store);
      store.set(target.key, {
        body,
        contentType: req.headers["content-type"] || "application/octet-stream",
      });
      res.writeHead(200, { ETag: `"${body.length}-e2e"` });
      res.end();
    });
    return;
  }

  if (req.method === "GET") {
    const stored = objectFor(target.bucket, target.key, false);
    if (!stored) {
      xml(res, 404, "NoSuchKey", "The specified key does not exist.");
      return;
    }
    res.writeHead(200, {
      "Content-Type": stored.contentType,
      "Content-Length": stored.body.length,
      ETag: `"${stored.body.length}-e2e"`,
    });
    res.end(stored.body);
    return;
  }

  if (req.method === "DELETE") {
    objectFor(target.bucket, target.key, false);
    const store = buckets.get(target.bucket);
    if (store) store.delete(target.key);
    res.writeHead(204);
    res.end();
    return;
  }

  req.resume();
  xml(res, 405, "MethodNotAllowed", `Method ${req.method} is not supported.`);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-s3] on http://127.0.0.1:${PORT}`);
});
