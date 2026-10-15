// @vitest-environment node
/**
 * `scripts/extract-content.mjs` — Phase 6 snapshot generation.
 *
 * Two properties the seed pipeline depends on:
 *
 * 1. **Determinism** — two runs over the same sources produce byte-identical
 *    snapshots (no timestamps, no unstable ordering), so a git-clean tree
 *    never produces spurious "the snapshot changed" noise.
 * 2. **Contract** — the payload is exactly what `GET /api/content` serves:
 *    the six entities plus `_migration` bookkeeping, no dead keys, no content
 *    with nowhere to migrate.
 *
 * Each run boots a real Vite SSR server, so the suite budget is generous.
 *
 * Determinism needs two *independent* runs, and each `runExtract` boots its own
 * Vite SSR server (~25 s apiece on a developer machine). The setup budget must
 * therefore cover two server startups; 60 s was under that ceiling on a loaded
 * host and flaked when the suite ran in parallel. 120 s leaves headroom for two
 * boots plus load without hiding a genuine hang.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "extract-content.mjs");
const RUN_TIMEOUT = 120_000;

let workDir;
let first;
let second;
let stdout;

const runExtract = (outPath) =>
  execFileSync(process.execPath, [SCRIPT, "--out", outPath], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });

beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "extract-content-"));
  stdout = runExtract(path.join(workDir, "snapshot-1.json"));
  runExtract(path.join(workDir, "snapshot-2.json"));
  first = readFileSync(path.join(workDir, "snapshot-1.json"), "utf8");
  second = readFileSync(path.join(workDir, "snapshot-2.json"), "utf8");
}, RUN_TIMEOUT);

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("extract-content.mjs", () => {
  it("is byte-deterministic across runs", () => {
    expect(second).toBe(first);
    expect(stdout).toContain("5 projects");
    expect(stdout).toContain("0 blog posts");
  });

  it("emits exactly the GET /api/content payload plus _migration", () => {
    const snapshot = JSON.parse(first);
    expect(Object.keys(snapshot).sort()).toEqual(
      ["_migration", "about", "certifications", "profile", "projects", "seo", "skills"].sort()
    );
    expect(snapshot._migration.counts).toMatchObject({
      projects: 5,
      skill_categories: 4,
      skills: 16,
      certifications: 3,
      about_cards: 4,
    });
    expect(snapshot._migration.omitted.length).toBeGreaterThan(0);
    expect(snapshot.profile.resume).toBe("/Ritu_Raj_Full_Stack_Developer_Resume.pdf");
    expect(snapshot.profile).not.toHaveProperty("seo");
    expect(snapshot.profile).not.toHaveProperty("techStack");
    expect(snapshot.profile).not.toHaveProperty("profileImage");
    expect(snapshot.seo).not.toHaveProperty("url");
    expect(snapshot.seo).not.toHaveProperty("verification");
    expect(snapshot.seo.robots).toEqual({ index: true, follow: true });
    expect(snapshot.seo.sameAs).toEqual([
      snapshot.profile.social.github,
      snapshot.profile.social.linkedin,
    ]);
    expect(snapshot.about.cards).toHaveLength(4);
    expect(snapshot.about.paragraphs).toHaveLength(2);
    expect(snapshot.certifications).toHaveLength(3);
    for (const certification of snapshot.certifications) {
      expect(certification).not.toHaveProperty("description");
      expect(certification.credential_url).toMatch(/^https:\/\//);
    }
  });

  it("encodes highlights so the API derives them back byte-for-byte", () => {
    const snapshot = JSON.parse(first);
    for (const project of snapshot.projects) {
      expect(project.longDescription).toBe(project.highlights.map((h) => `- ${h}`).join("\n"));
      expect(project.image).toBe(`/images/projects/${project.slug}.webp`);
      expect(project.image_width).toBeGreaterThan(0);
      expect(project.image_height).toBeGreaterThan(0);
      expect(project.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(project.live).toMatch(/^https:\/\//);
      expect(project.github).toMatch(/^https:\/\//);
    }
  });

  it("flattens skills into 4 categories with registry icon keys", () => {
    const snapshot = JSON.parse(first);
    const categories = new Set();
    const keys = new Set();
    for (const skill of snapshot.skills) {
      categories.add(skill.category.name);
      keys.add(skill.category.icon_key);
      keys.add(skill.icon_key);
    }
    expect(categories.size).toBe(4);
    expect(snapshot.skills).toHaveLength(16);
    expect(keys.size).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).toMatch(/^[A-Z][A-Za-z0-9]+$/);
    }
  });
});
