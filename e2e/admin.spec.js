import { Buffer } from "node:buffer";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { ADMIN_EMAIL, ADMIN_PASSWORD, S3_PORT } from "./state.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Reuse the resume PDF already in the repo as the upload fixture: a real,
// multi-KB document proves the bytes survive the (mock) storage round-trip,
// where an inline stub could pass even if the body were truncated.
const RESUME_PDF = path.join(ROOT, "public", "Ritu_Raj_Full_Stack_Developer_Resume.pdf");
const RESUME_PDF_SIZE = statSync(RESUME_PDF).size;

const EDITOR_LABELS = [
  "Title",
  "Permalink",
  "Short description",
  "Image alt text",
  "SEO title",
  "SEO description",
  /Image width/,
  /Image height/,
  "Image path",
];

test("admin: unauthenticated visits are redirected to login", async ({ page }) => {
  await page.goto("/admin");
  await page.waitForURL("**/admin/login");
  await expect(page.getByRole("heading", { name: "Portfolio Admin" })).toBeVisible();
});

test("admin: wrong password is rejected, correct one opens the dashboard", async ({
  page,
}) => {
  await page.goto("/admin/login");
  await page.getByLabel(/Email/).fill(ADMIN_EMAIL);
  await page.getByLabel(/Password/).fill("definitely-wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("alert")).toContainText("Incorrect email or password.");

  await page.getByLabel(/Password/).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin\/?$/, { timeout: 15000 });
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("admin: create → edit → hide a scratch project, then sign out", async ({
  page,
  context,
}) => {
  // The slug is not authored in the UI (ADR-016): the server derives it from the
  // title on create. Mirror the server's slugify() so the expected slug is known.
  const token = Date.now().toString(36);
  const title = `E2E Scratch Project ${token}`;
  const slug = `e2e-scratch-project-${token}`;
  const image = `/images/projects/${slug}.webp`;

  // --- login ---
  await page.goto("/admin/login");
  await page.getByLabel(/Email/).fill(ADMIN_EMAIL);
  await page.getByLabel(/Password/).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin\/?$/, { timeout: 15000 });

  // --- navigate to the project list and open the editor ---
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.waitForURL("**/admin/projects");
  await page.getByRole("button", { name: "New project" }).click();
  await page.waitForURL("**/admin/projects/new");

  // --- create ---
  await page.getByLabel("Title *", { exact: true }).fill(title);
  // The permalink is a read-only preview of the server-derived slug; it must
  // reflect the slugify() of the title (ADR-016) and must never be an input.
  await expect(page.getByLabel("Permalink")).toHaveValue(
    new RegExp(`/projects/${slug}/$`)
  );
  await page.getByLabel("Short description").fill("Created by the e2e suite.");
  await page.getByLabel("Image path").fill(image);
  await page.getByLabel(/Image width/).fill("1200");
  await page.getByLabel(/Image height/).fill("750");
  await page.getByLabel("Image alt text").fill("E2E scratch project screenshot");
  await page.getByLabel("SEO title").fill(`${title} SEO`);
  await page.getByLabel("SEO description").fill("A disposable e2e project.");
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page.getByText("Project created.")).toBeVisible();
  await page.waitForURL("**/admin/projects");
  await expect(page.locator("tbody")).toContainText(slug);

  // --- edit the short description ---
  await page.getByRole("link", { name: title }).click();
  await page.waitForURL(/\/admin\/projects\/[0-9a-f-]{36}$/);
  await page.getByLabel("Short description").fill("Edited by the e2e suite.");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("Project saved.")).toBeVisible();
  await page.waitForURL("**/admin/projects");
  await expect(page.locator("tbody")).toContainText(slug);

  // --- hide (soft delete) it ---
  const row = page.locator("tbody tr", { hasText: slug });
  await row.getByRole("button", { name: "Hide" }).click();
  await page.getByRole("button", { name: "Hide project" }).click();

  await expect(page.getByText(`"${title}" hidden`)).toBeVisible();
  // Soft-deleted rows stay in the list with their status flipped to "Hidden".
  await expect(
    page.locator("tbody tr", { hasText: slug }).getByText("Hidden", { exact: true })
  ).toBeVisible();

  // --- sign out invalidates the session end to end ---
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/admin/login");

  const afterLogout = await context.request.get("http://127.0.0.1:4173/api/admin/projects");
  expect(afterLogout.status()).toBe(401);
});

test("provider guard: the editor still loads only with label-backed fields", async ({
  page,
}) => {
  // A light sanity pass that the editor renders every field the build contract
  // says is mandatory (covers accidental JSX regressions in the forms).
  await page.goto("/admin/login");
  await page.getByLabel(/Email/).fill(ADMIN_EMAIL);
  await page.getByLabel(/Password/).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin\/?$/, { timeout: 15000 });
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "New project" }).click();
  await page.waitForURL("**/admin/projects/new");
  for (const label of EDITOR_LABELS) {
    await expect(page.getByLabel(label).first()).toBeVisible();
  }
});
test("admin: upload a resume, serve it at /api/resume, keep the bucket private", async ({
  page,
  request,
}) => {
  // --- login ---
  await page.goto("/admin/login");
  await page.getByLabel(/Email/).fill(ADMIN_EMAIL);
  await page.getByLabel(/Password/).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin\/?$/, { timeout: 15000 });

  // --- open the profile editor ---
  await page.goto("/admin/profile");
  // The profile row comes from the seeded content snapshot; if a run has no
  // snapshot there is nothing to edit, and this test cannot assert anything.
  // Skip visibly rather than fail on an environment the suite was never given.
  const basics = page.getByRole("button", { name: /Basics/ });
  await Promise.race([
    basics.waitFor({ state: "visible", timeout: 15000 }),
    page.locator('.admin-empty[role="alert"]').waitFor({ state: "visible", timeout: 15000 }),
  ]).catch(() => {});
  if (!(await basics.isVisible().catch(() => false))) {
    test.skip(true, "no seeded profile row (content snapshot missing)");
  }

  // The editor is an accordion (one section open at a time); the resume fields
  // are mounted only once Basics is expanded.
  await basics.click();
  await expect(page.getByLabel("Resume path")).toBeVisible();

  // --- upload the PDF ---
  await page.getByLabel("Upload resume").setInputFiles(RESUME_PDF);

  await expect(page.getByText("Resume uploaded.")).toBeVisible();

  // The upload *is* the save for the resume: the server repoints the profile at
  // the stable public route, and the form reflects it immediately.
  await expect(page.getByLabel("Resume path")).toHaveValue("/api/resume");

  // --- the stable route serves the uploaded bytes ---
  const download = await request.get("/api/resume");
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toContain("application/pdf");
  expect(download.headers()["content-disposition"]).toContain("resume.pdf");
  const etag = download.headers()["etag"];
  expect(etag).toBeTruthy();
  // The stored object is the exact file that was uploaded, not a re-encoding:
  // same length, same `%PDF-` header.
  const body = await download.body();
  expect(body.length).toBe(RESUME_PDF_SIZE);
  expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");

  // Conditional re-fetch: the ETag round-trips to a 304 (the link is cheap to
  // re-validate even though it must not be cached blindly).
  const revalidated = await request.get("/api/resume", {
    headers: { "If-None-Match": etag },
  });
  expect(revalidated.status()).toBe(304);

  // --- the bucket itself stays private: unsigned object access is refused ---
  const anonymous = await request.get(
    `http://127.0.0.1:${S3_PORT}/uploads/resumes/probe.pdf`,
  );
  expect(anonymous.status()).toBe(403);

  // --- replacement: a second upload swaps the active resume with no rebuild ---
  const replacement = Buffer.from("%PDF-1.7\nreplacement resume body\n%%EOF\n");
  // Register the wait *before* triggering the upload so the response cannot be
  // missed. Matching the method and exact path resolves only on this endpoint,
  // and the toast is deliberately not the completion signal: a first-upload toast
  // may still be on screen and a `.last()` locator could satisfy early.
  const replacementResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/admin/profile/resume",
  );
  await page.getByLabel("Upload resume").setInputFiles({
    name: "resume-v2.pdf",
    mimeType: "application/pdf",
    buffer: replacement,
  });
  const replacementUpload = await replacementResponse;
  // The endpoint documents `201 Created` on success
  // (`backend/app/routes/admin_content.py`, `ResumeUploadOut`).
  expect(replacementUpload.status()).toBe(201);
  // Inspect the actual response schema before reading fields: `ResumeUploadOut`
  // is `{ resume, key, audit_id }`, so `key` is the server-generated object key.
  const replacementJson = await replacementUpload.json();
  expect(replacementJson.resume).toBe("/api/resume");
  expect(replacementJson.key.startsWith("resumes/")).toBe(true);

  // The upload *is* the save: the profile now points at the stable public route.
  await expect(page.getByLabel("Resume path")).toHaveValue("/api/resume");
  // Retained as a UI confirmation; the awaited response above is the real signal.
  await expect(page.getByText("Resume uploaded.").last()).toBeVisible();

  // Fetch only after the replacement response has completed.
  const replaced = await request.get("/api/resume");
  expect(replaced.status()).toBe(200);
  expect((await replaced.body()).equals(replacement)).toBe(true);
  // The ETag is `"<object key>"`, so a replacement changes it and it matches the
  // new server-generated object key the second upload returned.
  expect(replaced.headers()["etag"]).not.toBe(etag);
  expect(replaced.headers()["etag"]).toBe(`"${replacementJson.key}"`);

  // --- a failed upload preserves the currently active resume ---
  await page.getByLabel("Upload resume").setInputFiles({
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("this is not a pdf"),
  });
  // The editor renders the admin envelope's message; the byte-level detail
  // ("Only PDF documents are supported.") rides on `error.fields[].message`.
  await expect(page.getByText("Request validation failed.").first()).toBeVisible();

  const stillActive = await request.get("/api/resume");
  expect(stillActive.status()).toBe(200);
  expect((await stillActive.body()).equals(replacement)).toBe(true);
});
