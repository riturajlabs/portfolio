// @vitest-environment node
/**
 * `scripts/asset-hash.mjs` — hashed-asset normalisation used by the build
 * parity verifier (`scripts/verify-parity.mjs`, `docs/TESTING.md` §10).
 *
 * The verifier compares a fresh `dist/` against a captured pre-migration
 * baseline. Hashed asset filenames are the only nondeterministic part, so they
 * are normalised away; everything else must still compare byte-for-byte. These
 * tests pin both halves of that contract:
 *
 *   - legitimate Vite hashes — including ones that contain a hyphen — collapse
 *     to a stable token (no false DIFFERS on an unchanged rebuild), and
 *   - authorable content, and filenames that are not hashes, are left intact
 *     (a real change is never silently swallowed).
 *
 * The hyphenated case is the regression that motivated the bounded class: a
 * Vite hash of `Hs5-7b6Q` left `main-Hs5-7b6Q.css` un-normalised under the old
 * `[A-Za-z0-9_]{8,}` rule.
 */

import { describe, expect, it } from "vitest";

import { normalize } from "./asset-hash.mjs";

describe("normalize — legitimate hashed asset filenames", () => {
    it("normalises a hashed CSS filename that contains a hyphen", () => {
        expect(normalize('<link rel="stylesheet" href="/assets/main-Hs5-7b6Q.css">')).toBe(
            '<link rel="stylesheet" href="/assets/main-HASH.css">',
        );
    });

    it("normalises a hashed CSS filename without a hyphen", () => {
        expect(normalize("/assets/main-CgWJNKic.css")).toBe("/assets/main-HASH.css");
    });

    it("normalises a hashed JS filename", () => {
        expect(normalize('src="/assets/main-C0mLvLL2.js"')).toBe('src="/assets/main-HASH.js"');
    });

    it("normalises a hash that carries an underscore", () => {
        expect(normalize("/assets/entry-ku271_YJ.css")).toBe("/assets/entry-HASH.css");
    });

    it("normalises only the hash of a multi-segment name", () => {
        // The name part (`preload-helper`) is authored; only the trailing hash
        // may be collapsed — an open-ended hyphen class would eat `helper`.
        expect(normalize("/assets/preload-helper-lbgt0pgl.js")).toBe(
            "/assets/preload-helper-HASH.js",
        );
        expect(normalize("/assets/rolldown-runtime-CNC7AqOf.js")).toBe(
            "/assets/rolldown-runtime-HASH.js",
        );
    });

    it("normalises repeatedly across a manifest of asset references", () => {
        const input =
            'src="/assets/icons-C5O5DAiH.js"\n' +
            'href="/assets/main-Hs5-7b6Q.css"\n' +
            'href="/assets/motion-BA9nQr5x.js"';
        expect(normalize(input)).toBe(
            'src="/assets/icons-HASH.js"\n' +
                'href="/assets/main-HASH.css"\n' +
                'href="/assets/motion-HASH.js"',
        );
    });
});

describe("normalize — fail-closed: non-hashes and content are untouched", () => {
    it("leaves an ordinary non-hashed CSS filename alone", () => {
        expect(normalize("/assets/styles.css")).toBe("/assets/styles.css");
        expect(normalize("/assets/print.css")).toBe("/assets/print.css");
    });

    it("leaves an ordinary non-hashed JS filename alone", () => {
        expect(normalize("/assets/analytics.js")).toBe("/assets/analytics.js");
    });

    it("does not normalise a hand-authored multi-segment filename", () => {
        // The trailing run (11 chars) is not an 8-char Vite hash, so the name
        // must survive verbatim rather than collapse to `foo-HASH.css`.
        expect(normalize("/assets/foo-abc-1234567.css")).toBe(
            "/assets/foo-abc-1234567.css",
        );
    });

    it("preserves authorable content that must still be compared", () => {
        const html =
            '<title>Ritu Raj | Full Stack Developer</title>\n' +
            '<link rel="canonical" href="https://riturajlabs.vercel.app/">\n' +
            '"@id": "https://riturajlabs.vercel.app/#person"';
        expect(normalize(html)).toBe(html);
    });

    it("does not touch a URL that merely contains a dash", () => {
        expect(normalize('href="/projects/orbit-ai/"')).toBe(
            'href="/projects/orbit-ai/"',
        );
    });
});

describe("normalize — a genuine difference still surfaces", () => {
    it("keeps two differing assets distinct after normalisation", () => {
        const a = normalize("/assets/main-CgWJNKic.css");
        const b = normalize("/assets/main-Hs5-7b6Q.css");
        // Same shape (both are `main-<hash>.css`) — as intended.
        expect(a).toBe(b);

        // But a renamed chunk (different authored name) is NOT collapsed away.
        expect(normalize("/assets/other-CgWJNKic.css")).not.toBe(a);
    });

    it("does not collapse a content drift into an equal token", () => {
        const baseline = normalize('<meta name="description" content="Portfolio of Ritu Raj">');
        const drifted = normalize('<meta name="description" content="Portfolio of Someone Else">');
        expect(baseline).not.toBe(drifted);
    });
});
