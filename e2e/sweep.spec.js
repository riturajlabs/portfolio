// U8 (docs/PORTFOLIO_UPGRADE.md §7 U8): release-readiness console, network and
// horizontal-overflow sweep over the public surfaces.
//
// The a11y gate (e2e/a11y.spec.js) already sweeps horizontal overflow on the
// five project pages at the four §8 viewports and watches page errors while it
// scans. U8 additionally needs the *homepage* swept at the same widths, in both
// themes, plus an explicit network-failure check on every page — a broken icon,
// font or asset is invisible to axe but shows up here.
//
// FAIL-CLOSED for what it observes: any console error, uncaught page error,
// genuinely failed request (network error or 5xx) to the SITE'S OWN origin, or
// horizontal overflow fails the test.
//
// SCOPE (deliberately narrow): network monitoring covers only requests to
// SITE_ORIGIN (http://127.0.0.1:4173). External origins — Google Fonts
// (fonts.googleapis.com / fonts.gstatic.com) and any cross-origin asset — are
// NOT observed, so a broken external font/asset will NOT be caught here. Requests
// to the sandboxed dev backend (localhost:8000) are likewise out of scope: the
// sandbox never lets them reach the network. Browser-cancelled/aborted requests
// (ERR_ABORTED) are ignored.
//
// This suite therefore does NOT guarantee "no network failures anywhere" — only
// "no same-origin request failures". The a11y gate (e2e/a11y.spec.js) covers the
// overflow sweep on the five project pages; this file adds the homepage widths,
// both themes, and the same-origin network/console checks.

import { expect, test } from "@playwright/test";

import { attachBrowserSandbox } from "./intercept.mjs";

const PROJECT_SLUGS = [
  "webchat-ai",
  "orbit-ai",
  "stayora",
  "zerodha-clone",
  "scientific-calculator",
];

const VIEWPORTS = [390, 768, 1024, 1440];

const SITE_ORIGIN = "http://127.0.0.1:4173";

function isIgnorableRequestFailure(request) {
  // Aborted/cancelled requests (navigation, user-driven stop) carry this text.
  return request.failure()?.errorText?.includes("ERR_ABORTED") ?? false;
}

function collectNetworkFailures(page) {
  const failures = [];
  page.on("requestfailed", (request) => {
    if (isIgnorableRequestFailure(request)) return;
    const url = request.url();
    // Only the site's own origin is this suite's responsibility; external
    // origins (fonts, CDNs) are intentionally NOT monitored.
    if (!url.startsWith(SITE_ORIGIN)) return;
    failures.push(`${request.method()} ${url} — ${request.failure()?.errorText}`);
  });
  page.on("response", (response) => {
    const status = response.status();
    if (status < 500) return;
    const url = response.url();
    if (!url.startsWith(SITE_ORIGIN)) return;
    failures.push(`${response.request().method()} ${url} — HTTP ${status}`);
  });
  return failures;
}

function collectConsoleErrors(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${String(err)}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });
  return errors;
}

async function settle(page) {
  // Same reasoning as the a11y gate: Framer's `whileInView` reveals and the
  // hero stagger need the walk + a quiet frame before measuring overflow.
  await page.evaluate(async () => {
    const step = 600;
    const end = document.body.scrollHeight;
    for (let y = 0; y <= end; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(3000);
}

test.use({ reducedMotion: "reduce" });

for (const width of VIEWPORTS) {
  for (const theme of ["dark", "light"]) {
    test(`homepage: no console errors, failed requests or overflow at ${width}px (${theme})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ colorScheme: theme });
      if (theme === "light") {
        await page.addInitScript(() => {
          try {
            window.localStorage.setItem("theme", "light");
          } catch {
            // storage unavailable: default theme is scanned instead
          }
        });
      }

      const consoleErrors = collectConsoleErrors(page);
      const networkFailures = collectNetworkFailures(page);
      await attachBrowserSandbox(page);

      await page.goto("/");
      await expect(page.locator("#home")).toBeAttached();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await settle(page);

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      );

      expect(
        overflow,
        `/ overflows horizontally by ${overflow}px at ${width}px (${theme})`
      ).toBeLessThanOrEqual(0);
      expect(networkFailures, `failed requests on / at ${width}px`).toEqual([]);
      expect(consoleErrors, `console errors on / at ${width}px`).toEqual([]);
    });
  }
}

for (const slug of PROJECT_SLUGS) {
  test(`project page /projects/${slug}/: no console errors or failed requests`, async ({
    page,
  }) => {
    const consoleErrors = collectConsoleErrors(page);
    const networkFailures = collectNetworkFailures(page);
    await attachBrowserSandbox(page);

    await page.goto(`/projects/${slug}/`);
    await expect(page.locator(".project-page")).toBeAttached();
    await settle(page);

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    );

    expect(overflow, `/projects/${slug}/ overflows horizontally`).toBeLessThanOrEqual(0);
    expect(
      networkFailures,
      `failed requests on /projects/${slug}/`
    ).toEqual([]);
    expect(consoleErrors, `console errors on /projects/${slug}/`).toEqual([]);
  });
}
