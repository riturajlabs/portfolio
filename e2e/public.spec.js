import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { attachBrowserSandbox } from "./intercept.mjs";
import { watchPageErrors } from "./state.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const NAV_ANCHORS = ["home", "about", "skills", "projects", "certifications", "blog", "contact"];

test("homepage: hero, seven nav anchors, seven sections, footer", async ({ page }) => {
  const errors = watchPageErrors(page);
  await attachBrowserSandbox(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Ritu Raj" })).toBeVisible();

  for (const id of NAV_ANCHORS) {
    const link = page.locator(`.nav-links a[href="#${id}"]`).first();
    await expect(link, `nav anchor #${id}`).toBeVisible();
  }

  for (const id of NAV_ANCHORS) {
    await expect(page.locator(`#${id}`), `section #${id}`).toBeAttached();
  }

  const resume = page.locator('a[href="/Ritu_Raj_Full_Stack_Developer_Resume.pdf"]').first();
  await expect(resume).toBeVisible();

  await expect(page.locator("footer")).toBeAttached();
  expect(errors).toEqual([]);
});

test("resume file downloads as application/pdf", async ({ request }) => {
  const response = await request.get("/Ritu_Raj_Full_Stack_Developer_Resume.pdf");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/pdf");
});

for (const slug of readdirSync(path.join(ROOT, "dist", "projects"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)) {
  test(`project page /projects/${slug}/ renders its title and metadata`, async ({ page }) => {
    const errors = watchPageErrors(page);
    await attachBrowserSandbox(page);
    await page.goto(`/projects/${slug}/`);

    const title = await page.locator("h1.project-page-title").textContent();
    expect(title, `h1 on /projects/${slug}/`).toBeTruthy();
    expect(await page.title()).toBeTruthy();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`/projects/${slug}/$`)
    );
    expect(errors).toEqual([]);
  });
}