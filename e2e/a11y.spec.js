// Phase U2 (docs/PORTFOLIO_UPGRADE.md §7 U2, decision Q2): automated
// accessibility regression gate on the public homepage.
//
// AxeBuilder scans the rendered `/` after the same browser sandbox the
// other public specs use (chat/github calls intercepted, so the scan
// never reaches the internet). The page is scanned under an emulated
// `prefers-reduced-motion: reduce`, which U2 makes the app honour for
// CSS motion (and it also exercises the FE-2 behaviour end to end);
// Framer's opacity reveals still run, so `scanHomepage` waits for the
// tree to settle before analysing.
//
// U3 adds a second scan with an explicit light-theme choice: the same
// rules apply, so a new violation introduced only in light
// mode still fails the build.
//
// U4 fixes the first scan, which was silently scanning light: Playwright
// emulates `prefers-color-scheme: light` by default, and with no stored
// choice the app's theme ladder (stored → system → dark) resolved light,
// so "dark theme" and "light theme" scanned the same palette. The dark
// scan now emulates `prefers-color-scheme: dark` and asserts
// `data-theme="dark"`, mirroring the light test's assertion — both
// themes are genuinely gated.
//
// FAIL-CLOSED ON REGRESSIONS: critical/serious violations fail the
// build; only advisory (moderate/minor) violations are reported and
// never fatal. `KNOWN_DEFERRED` is the one sanctioned exception list
// and is currently empty — each entry needs a tracked finding and the
// phase that owns the fix, so this gate catches *new* breakage now.

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { attachBrowserSandbox } from "./intercept.mjs";
import { watchPageErrors } from "./state.mjs";

// Pre-existing critical/serious rules out of scope. Never silently
// widened: adding an id here needs the same finding/phase annotation.
// U4 removed the last entry (`color-contrast`): after the navbar/hero
// repaints at source, a full-page probe under this gate's reduced-motion
// condition reports zero contrast nodes in both themes (desktop and
// mobile), so any contrast regression now fails this gate outright.
const KNOWN_DEFERRED = {};

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
  // Scan the settled tree, not a mid-animation frame. The hero stagger
  // (delayChildren 0.5s + 0.2s/child + 0.5s duration) and the chat fab
  // label fade (delay 1s + 0.5s) finish by ~2s; axe reading a frame in
  // between composites partially-faded text against its background and
  // reports phantom `color-contrast` nodes (`.hero-stat > span`,
  // `.chat-fab-label`) that vary run to run. A full-page probe at this
  // settled state is clean in both themes, so anything axe reports here
  // is real.
  await page.waitForTimeout(3000);

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
      targets: v.nodes.map((n) => n.target),
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
  await page.emulateMedia({ colorScheme: "dark" });

  const { violations, errors } = await scanHomepage(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  expectNoNewDebt({ violations, errors }, "dark theme");
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
