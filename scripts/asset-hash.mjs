// =========================================================
// 🔑 HASHED-ASSET NORMALISATION
// =========================================================
// Shared by `scripts/verify-parity.mjs`: replaces Vite/Rolldown's
// content-derived hashed asset filenames with a stable `-HASH.<ext>`
// token so a rebuilt bundle compares equal to the baseline while any
// authorable content difference still shows through as DIFFERS.
//
// Vite/Rolldown asset hashes are base64url, so they can carry `_` and `-`
// (observed: `entry-ku271_YJ.css`, and `main-Hs5-7b6Q.css` — a hash that
// itself contains a hyphen). A pure-alnum class let `_` hashes slip through
// un-normalised; excluding `-` likewise left hyphen-bearing hashes
// un-normalised, both reporting a false DIFFERS.
//
// The class now includes `-`, but the run is pinned two ways so it can never
// swallow a preceding name segment:
//   1. a lookahead requires the *entire* trailing hash run to be exactly 8
//      base64url characters (Vite's default `hashCharacters`), and
//   2. the captured hash is a single base64url token with at most one internal
//      hyphen.
// An open, unbounded hyphen class is leftmost-greedy and would instead eat a
// name segment (`preload-helper-lbgt0pgl.js` → `preload-HASH.js`,
// `rolldown-runtime-CNC7AqOf.js` → `rolldown-HASH.js`), silently widening the
// token. The 8-char pin keeps `[name]-[hash]` normalising only the hash
// (`preload-helper-HASH.js`) and leaves a longer, hand-authored multi-segment
// name (`foo-abc-1234567.css`) intact — so a hash that changes length (or a
// filename that is not really a hash) fails closed as DIFFERS for inspection
// rather than being normalised away.
export const HASHED_ASSET =
    /-(?=[A-Za-z0-9_-]{8}\.(?:js|css)\b)([A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)?)\.(js|css)\b/g;

export function normalize(text) {
    return text.replace(HASHED_ASSET, "-HASH.$2");
}
