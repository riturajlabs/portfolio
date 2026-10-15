import { expect, test } from "@playwright/test";

import {
  attachBrowserSandbox,
  MOCK_CHAT_MODEL,
  MOCK_CHAT_SOURCE,
  MOCK_CHAT_TEXT,
} from "./intercept.mjs";
import { watchPageErrors } from "./state.mjs";

test("chat: the FAB opens a dialog, a question streams a full SSE answer", async ({ page }) => {
  const errors = watchPageErrors(page);
  await attachBrowserSandbox(page);
  await page.goto("/");
  // The FAB pulses via an infinite CSS animation, which keeps the element
  // perpetually "unstable" for Playwright; freeze it so the click can land.
  await page.addStyleTag({
    content: ".chat-fab-pulse { animation: none !important; }",
  });

  await page.getByRole("button", { name: "Open AI Chat" }).click();

  const dialog = page.getByRole("dialog", { name: "AI Portfolio Assistant" });
  await expect(dialog).toBeVisible();

  await dialog
    .locator('input[type="text"]')
    .fill("Tell me about Ritu Raj");
  await dialog.getByRole("button", { name: "Send Message" }).click();

  // The answer streams token-by-token and finishes with the full text.
  await expect(dialog).toContainText(MOCK_CHAT_TEXT);

  // RAG sources render as chips under the answer.
  const chip = dialog.locator(".chat-source-chip").first();
  await expect(chip).toContainText(MOCK_CHAT_SOURCE);

  // The `done` event carries the model name (as production's does).
  await expect(dialog.locator(".chat-header-model")).toContainText(MOCK_CHAT_MODEL);

  expect(errors).toEqual([]);
});