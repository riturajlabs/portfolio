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
// U3 adds a second scan with an explicit light-theme choice: the same
// allowlisted rules apply, so a new violation introduced only in light
// mode still fails the build.
//
// FAIL-CLOSED ON REGRESSIONS, ALLOWLISTED FOR KNOWN DEBT:
// critical/serious violations fail the build unless their rule id is in
// `KNOWN_DEFERRED` below. Each entry names the tracked finding and the
// later phase that owns the fix, so this gate catches *new* breakage now
// without blocking on work the blueprint deliberately deferred.
// Moderate/minor violations are advisory only (reported, never fatal).

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { attachBrowserSandbox } from "./intercept.mjs";
import { watchPageErrors } from "./state.mjs";

// Pre-existing critical/serious rules out of scope. Never silently
// widened: adding an id here needs the same finding/phase annotation.
const KNOWN_DEFERRED = {
  // Brand colours (`--accent` blue / muted slate) still fall below AA.
  // FE-10/FE-15/FE-16 — remaining contrast work is re-verified per
  // section in U4–U6.
  "color-contrast": "FE-10/FE-15/FE-16 (remaining contrast, U4–U6)",
  // react-icons `si` glyphs ship `role="img"` with no accessible name;
  // the skill icons are decorative (the skill name is adjacent text).
  // FE-9 area — Skills markup is U4.
  "svg-img-alt": "FE-9 (Skills section, U4)",
};

const SERIOUS = ["critical", "serious"];

function isSerious(violation) {
  return SERIOUS.includes(violation.impact);
}

function isDeferred(violation) {
  return Object.prototype.hasOwnProperty.call(KNOWN_DEFERRED, violation.id);
}

async function scanHomepage(page) {
  const errors = watchPageErrors(page);
  await attachBrowserSandbox(page);
  await page.goto("/");
  await expect(page.locator("#home")).toBeAttached();
  // Section reveals settle immediately under reduced motion; this wait only
  // covers the lazy chat widget mounting.
  await page.waitForTimeout(300);

  const results = await new AxeBuilder({ page }).analyze();
  return { violations: results.violations, errors };
}

function expectNoNewDebt({ violations, errors }, label) {
  const advisory = violations.filter((v) => !isSerious(v));
  const deferred = violations.filter((v) => isSerious(v) && isDeferred(v));
  const blocking = violations.filter((v) => isSerious(v) && !isDeferred(v));

  if (advisory.length > 0) {
    console.warn(
      `[a11y ${label}] advisory (moderate/minor):`,
      advisory.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s)`)
    );
  }
  if (deferred.length > 0) {
    console.warn(
      `[a11y ${label}] known deferred serious/critical:`,
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
    `critical/serious axe violations on ${label} that are not known, deferred debt`
  ).toEqual([]);

  expect(errors).toEqual([]);
}

test.use({ reducedMotion: "reduce" });

test("homepage has no critical or serious axe violations outside known deferred debt", async ({
  page,
}) => {
  expectNoNewDebt(await scanHomepage(page), "dark theme");
});

test("homepage honours an explicit light-theme choice and stays accessible", async ({
  page,
}) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("theme", "light");
    } catch {
      // storage unavailable: the scan still runs on the default theme
    }
  });

  const { violations, errors } = await scanHomepage(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  expectNoNewDebt({ violations, errors }, "light theme");
});
