// @vitest-environment node
/**
 * `scripts/compare-content.mjs` — snapshot ↔ API parity.
 *
 * `TESTING.md` §5.2 requires all three behaviours to be observable without a
 * live backend: exit 0 when the API serves the snapshot, exit 1 when any
 * field differs (either direction), exit 2 when the API cannot be reached or
 * does not return the contract payload. The API here is a stub HTTP server
 * serving a canned payload, so the script's contract is tested in isolation
 * from PostgreSQL; the real end-to-end pass is `npm run seed:verify` and
 * `backend/tests/test_seed.py`.
 */

import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "compare-content.mjs");
const RUN_TIMEOUT = 20_000;

const SNAPSHOT = {
  profile: {
    name: "Ritu Raj",
    resume: "/Ritu_Raj_Full_Stack_Developer_Resume.pdf",
    roles: ["Developer"],
    stats: [{ label: "Projects", value: "5+" }],
    social: { github: "https://github.com/x", linkedin: "https://linkedin.com/in/x", email: "x@example.com" },
  },
  about: { paragraphs: ["one", "two"], cards: [{ icon_key: "FaCode", title: "Code", description: "d" }] },
  projects: [
    {
      slug: "sample",
      title: "Sample",
      description: "A sample project",
      image: "/images/projects/sample.webp",
      techStack: ["React"],
      status: "published",
      display_order: 0,
      live: "https://example.com",
      github: "https://github.com/x/sample",
      seoTitle: "Sample | Ritu Raj",
      seoDescription: "A sample project page",
    },
  ],
  skills: [{ name: "React", icon_key: "FaReact", display_order: 0, category: { name: "Frontend", icon_key: "FaReact", display_order: 0 } }],
  certifications: [{ title: "Cert", issuer: "Issuer", icon: "x", credential_url: "https://example.com/c" }],
  seo: { robots: { index: true, follow: true }, locale: "en_US" },
  _migration: { counts: { projects: 1 }, omitted: ["certifications[].description"] },
};

const META = { generated_at: "2026-01-01T00:00:00Z", version: 1 };

/** What the real API serves: the six entities plus `meta`, never `_migration`. */
const apiPayload = (overrides = {}) => {
  const { _migration, ...entities } = SNAPSHOT;
  return { ...entities, ...overrides, meta: META };
};

let workDir;
let snapshotPath;

const startServer = (payload) =>
  new Promise((resolve) => {
    const server = createServer((request, response) => {
      if (request.url === "/api/content") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(payload));
        return;
      }
      response.statusCode = 404;
      response.end("not found");
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });

const runCompare = async (contentApiUrl, snapshot = snapshotPath) =>
  execFileAsync(process.execPath, [SCRIPT, snapshot], {
    cwd: REPO_ROOT,
    env: { ...process.env, CONTENT_API_URL: contentApiUrl },
  })
    .then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }))
    .catch((error) => ({ code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" }));

beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "compare-content-"));
  snapshotPath = path.join(workDir, "snapshot.json");
  writeFileSync(snapshotPath, `${JSON.stringify(SNAPSHOT, null, 2)}\n`);
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("compare-content.mjs", () => {
  it("exits 0 when the API serves the snapshot (plus per-request meta)", async () => {
    const api = await startServer(apiPayload());
    try {
      const result = await runCompare(api.url);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("6 entities match");
    } finally {
      await api.close();
    }
  }, RUN_TIMEOUT);

  it("exits 1 and names the field when a single value differs", async () => {
    const tampered = apiPayload({
      projects: [{ ...SNAPSHOT.projects[0], title: "TAMPERED" }],
    });
    const api = await startServer(tampered);
    try {
      const result = await runCompare(api.url);
      expect(result.code).toBe(1);
      expect(result.stdout).toContain("projects[0].title");
      expect(result.stdout).toContain("TAMPERED");
      expect(result.stderr).toContain("FAILED");
    } finally {
      await api.close();
    }
  }, RUN_TIMEOUT);

  it("exits 1 when the snapshot has content the API lacks (either direction)", async () => {
    const api = await startServer(apiPayload());
    try {
      const withExtraPath = path.join(workDir, "snapshot-with-blog-posts.json");
      writeFileSync(
        withExtraPath,
        `${JSON.stringify({ ...SNAPSHOT, blog_posts: [] }, null, 2)}\n`
      );
      const result = await runCompare(api.url, withExtraPath);
      expect(result.code).toBe(1);
      expect(result.stdout).toContain("blog_posts");
    } finally {
      await api.close();
    }
  }, RUN_TIMEOUT);

  it("exits 2 when the API omits an entity of the contract", async () => {
    const served = apiPayload();
    delete served.seo;
    const api = await startServer(served);
    try {
      const result = await runCompare(api.url);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('missing "seo"');
    } finally {
      await api.close();
    }
  }, RUN_TIMEOUT);

  it("exits 2 when nothing is listening", async () => {
    const api = await startServer(apiPayload());
    const url = api.url;
    await api.close();
    const result = await runCompare(url);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("cannot reach");
  }, RUN_TIMEOUT);

  it("exits 1 when the snapshot file does not exist", async () => {
    const api = await startServer(apiPayload());
    try {
      const result = await runCompare(api.url, path.join(workDir, "does-not-exist.json"));
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("run `npm run seed:extract`");
    } finally {
      await api.close();
    }
  }, RUN_TIMEOUT);
});
