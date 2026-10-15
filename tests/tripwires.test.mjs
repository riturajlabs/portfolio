// Phase 10 (docs/MIGRATION.md Phase 10, docs/TESTING.md §10 checks 10–11):
// the migration tripwires, automated. Two claims have held since Phase 0 and
// must keep holding through Phase 11:
//
//   * `src/data/**` never changes — it is the legacy migration input, not a
//     runtime authority, and an edit there means someone re-introduced it.
//   * `src/styles/**` never changes — the public CSS is byte-identical to the
//     pre-migration site, so a non-empty diff is a visual change no test
//     reviewed.
//
// `git diff` only sees tracked modifications, so untracked additions are
// checked separately — a new file under those trees would be just as
// violating as an edit to an existing one.
//
// These run in CI on a clean checkout (where the working tree is trivially
// clean); the PR-level diff check lives in .github/workflows/ci.yml, which
// compares the branch against the merge base instead.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(args) {
    return execFileSync("git", args, {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}

describe("migration tripwires", () => {
    it("src/data has no tracked modifications", () => {
        const changed = git(["diff", "--name-only", "--", "src/data"]);
        expect(changed, `src/data was modified:\n${changed}`).toBe("");
    });

    it("src/data has no untracked additions", () => {
        const added = git([
            "ls-files",
            "--others",
            "--exclude-standard",
            "--",
            "src/data",
        ]);
        expect(added, `src/data gained untracked files:\n${added}`).toBe("");
    });

    it("src/styles has no tracked modifications", () => {
        const changed = git(["diff", "--name-only", "--", "src/styles"]);
        expect(changed, `src/styles was modified:\n${changed}`).toBe("");
    });

    it("src/styles has no untracked additions", () => {
        const added = git([
            "ls-files",
            "--others",
            "--exclude-standard",
            "--",
            "src/styles",
        ]);
        expect(added, `src/styles gained untracked files:\n${added}`).toBe("");
    });
});

// ---------------------------------------------------------------------------
// Resume-storage configuration guard.
//
// The admin-uploaded resume lives in a *private* bucket that is deliberately
// separate from the public `media` bucket (`neon.ts`): a resume is a document,
// read only through `GET /api/resume`, never a public `<img src>`. `render.yaml`
// declares both values explicitly so a platform drift cannot silently fall back
// to a wrong bucket. If either declaration disappears, this fails.
//
// This is a structured, service-scoped check rather than a whole-file string
// match: it finds the `portfolio-api` service block by indentation and reads the
// `- key:`/`value:` env entries out of it. No YAML parser ships in the Node
// toolchain here, so the extraction is small and limited to the block-mapping
// shape this Blueprint uses.
// ---------------------------------------------------------------------------

function serviceBlock(text, serviceName) {
    const lines = text.split(/\r?\n/);
    const namePattern = new RegExp(`^\\s*name:\\s*${serviceName}\\s*$`);
    const nameIndex = lines.findIndex((line) => namePattern.test(line));
    if (nameIndex === -1) return null;

    const nameIndent =
        lines[nameIndex].length - lines[nameIndex].trimStart().length;
    const itemIndent = Math.max(0, nameIndent - 2);

    // Walk up to the list item that opens this service (`- type: web`).
    let start = nameIndex;
    while (start > 0) {
        const line = lines[start];
        const indent = line.length - line.trimStart().length;
        if (indent === itemIndent && line.trimStart().startsWith("- ")) break;
        start -= 1;
    }

    // Collect every line more indented than the list item, until the next item.
    const block = [lines[start]];
    for (let i = start + 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (line.trim() === "" || line.trimStart().startsWith("#")) {
            block.push(line);
            continue;
        }
        const indent = line.length - line.trimStart().length;
        if (indent <= itemIndent) break;
        block.push(line);
    }
    return block.join("\n");
}

function envValue(block, key) {
    const lines = block
        .split(/\r?\n/)
        .filter(
            (line) => line.trim() !== "" && !line.trimStart().startsWith("#"),
        );
    for (let i = 0; i < lines.length; i += 1) {
        const entry = lines[i].match(/^\s*-\s*key:\s*(\S+)\s*$/);
        if (!entry || entry[1] !== key) continue;
        for (let j = i + 1; j < lines.length; j += 1) {
            if (/^\s*-\s*key:\s*\S+/.test(lines[j])) break;
            const value = lines[j].match(/^\s*value:\s*(.*?)\s*$/);
            if (value) return value[1].replace(/^["']|["']$/g, "");
        }
        return null;
    }
    return null;
}

describe("resume storage configuration", () => {
    const yaml = readFileSync(path.join(repoRoot, "render.yaml"), "utf8");

    it("render.yaml declares the private resume bucket under portfolio-api", () => {
        const block = serviceBlock(yaml, "portfolio-api");
        expect(block, "render.yaml has no portfolio-api service").not.toBeNull();
        expect(envValue(block, "S3_RESUME_BUCKET")).toBe("uploads");
        expect(envValue(block, "S3_RESUME_MAX_BYTES")).toBe("10000000");
    });

    it("the resume bucket stays distinct from the public media bucket", () => {
        const block = serviceBlock(yaml, "portfolio-api");
        expect(block, "render.yaml has no portfolio-api service").not.toBeNull();
        expect(envValue(block, "S3_BUCKET")).toBe("media");
        expect(envValue(block, "S3_RESUME_BUCKET")).not.toBe(
            envValue(block, "S3_BUCKET"),
        );
    });
});
