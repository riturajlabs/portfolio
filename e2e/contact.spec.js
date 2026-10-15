import { expect, test } from "@playwright/test";

import { attachBrowserSandbox } from "./intercept.mjs";
import { ADMIN_EMAIL, ADMIN_PASSWORD, watchPageErrors } from "./state.mjs";

test("contact: client validation rejects a bad email", async ({ page }) => {
  const status = page.locator(".contact-status");
  await attachBrowserSandbox(page);
  await page.goto("/");

  await page.locator('#contact input[name="name"]').fill("E2E Tester");
  await page.locator('#contact input[name="email"]').fill("not-an-email");
  await page.locator('#contact textarea[name="message"]').fill("This message is long enough to pass.");

  await page.locator('#contact button[type="submit"]').click();

  await expect(page.locator('#contact [id="contact-error-email"]')).toContainText(
    "valid email"
  );
  await expect(status).toContainText("fix the highlighted fields");
});

test("contact: a valid submission succeeds and is persisted in the admin inbox", async ({
  page,
  context,
}) => {
  const errors = watchPageErrors(page);
  await attachBrowserSandbox(page);
  await page.goto("/");

  const email = `e2e.user.${Date.now()}@example.com`;
  await page.locator('#contact input[name="name"]').fill("E2E Contact User");
  await page.locator('#contact input[name="email"]').fill(email);
  await page
    .locator('#contact textarea[name="message"]')
    .fill("This is a real end-to-end contact message for the e2e inbox.");

  await page.locator('#contact button[type="submit"]').click();

  await expect(page.locator(".contact-status")).toContainText("Message sent successfully");
  expect(errors).toEqual([]);

  // The row really landed in the e2e backend (via the sandbox relay), not just
  // in the UI: log in through the same cookie jar and read the inbox.
  const login = await context.request.post("http://127.0.0.1:4173/api/admin/auth/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(login.status()).toBe(200);

  const inbox = await context.request.get(
    "http://127.0.0.1:4173/api/admin/messages?page=1&page_size=10"
  );
  expect(inbox.status()).toBe(200);
  expect(await inbox.text()).toContain(email);
});