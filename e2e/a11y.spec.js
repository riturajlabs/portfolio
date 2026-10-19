// Phase U2 (docs/PORTFOLIO_UPGRADE.md §7 U2, decision Q2): automated
// accessibility regression gate on the public homepage.
//
// AxeBuilder scans the rendered `/` after the same browser sandbox the
// other public specs use (chat/github calls intercepted, so the scan
// never reaches the internet). The page is scanned under an emulated
// `prefers-reduced-motion: reduce`, which U2 makes the app honour — the
// reduced-motion tree is static, so the scan is deterministic and it also
// exercises the FE-2 behaviour end to end.
//
// FAIL-CLOSED ON REGRESSIONS, ALLOWLISTED FOR KNOWN DEBT:
// critical/serious violations fail the build unless their rule id is in
// `KNOWN_DEFERRED` below. Each entry names the tracked finding and the
// later phase that owns the fix, so this gate catches *new* breakage now
// without blocking U2 on work the blueprint deliberately deferred.
// Moderate/minor violations are advisory only (reported, never fatal).

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { attachBrowserSandbox } from "./intercept.mjs";
import { watchPageErrors } from "./state.mjs";

// Pre-existing critical/serious rules out of U2's scope. Never silently
// widened: adding an id here needs the same finding/phase annotation.
const KNOWN_DEFERRED = {
  // Dark-mode brand colours (`--accent` blue / muted slate on `#0f172a`)
  // fall below AA. FE-10/FE-15/FE-16 — the semantic-token and contrast
  // work is U3, re-verified per section in U4–U6.
  "color-contrast": "FE-10/FE-15/FE-16 (theme tokens, U3/U4–U6)",
  // react-icons `si` glyphs ship `role="img"` with no accessible name;
  // the skill icons are decorative (the skill name is adjacent text).
  // FE-9 area — Skills markup is U4.
  "svg-img-alt": "FE-9 (Skills section, U4)",
};

test.use({ reducedMotion: "reduce" });

test("homepage has no critical or serious axe violations outside known deferred debt", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await attachBrowserSandbox(page);
  await page.goto("/");
  await expect(page.locator("#home")).toBeAttached();
  // Section reveals settle immediately under reduced motion; this wait only
  // covers the lazy chat widget mounting.
  await page.waitForTimeout(300);

  const results = await new AxeBuilder({ page }).analyze();

  const blocking = results.violations.filter(
    (v) =>
      ["critical", "serious"].includes(v.impact) &&
      !Object.prototype.hasOwnProperty.call(KNOWN_DEFERRED, v.id)
  );
  const advisory = results.violations.filter(
    (v) => !["critical", "serious"].includes(v.impact)
  );
  const deferred = results.violations.filter(
    (v) =>
      ["critical", "serious"].includes(v.impact) &&
      Object.prototype.hasOwnProperty.call(KNOWN_DEFERRED, v.id)
  );

  if (advisory.length > 0) {
    console.warn(
      "[a11y] advisory (moderate/minor):",
      advisory.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s)`)
    );
  }
  if (deferred.length > 0) {
    console.warn(
      "[a11y] known deferred serious/critical:",
      deferred.map((v) => `${v.id} — ${KNOWN_DEFERRED[v.id]}`)
    );
  }

  expect(
    blocking.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      help: v.help,
    })),
    "critical/serious axe violations on / that are not known, deferred debt"
  ).toEqual([]);

  expect(errors).toEqual([]);
});
