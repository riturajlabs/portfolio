import { Buffer } from "node:buffer";

import { expect, test } from "@playwright/test";

import {
  fulfillJson,
  isUploadResponse,
  login,
  mockProject,
  PROJECT_PATH,
  SECOND_IMAGE,
  uploadResult,
  VALID_IMAGE,
  validationEnvelope,
  validCaseStudy,
  invalidCaseStudy,
} from "./case-study-fixtures.mjs";

const SECTION_IDS = [
  "#case-study-overview",
  "#case-study-timeline",
  "#case-study-team",
  "#case-study-problem",
  "#case-study-constraints-section",
  "#case-study-approach-section",
  "#case-study-architecture-section",
  "#case-study-keyDecisions-section",
  "#case-study-challenges-section",
  "#case-study-outcomes-section",
  "#case-study-learnings-section",
  "#case-study-links-section",
  "#case-study-gallery-section",
];

const UPLOAD_FILE = {
  name: "diagram.webp",
  mimeType: "image/webp",
  buffer: Buffer.from("webp fixture for mocked upload"),
};

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("case study: create, reload, and edit a valid document", async ({ page }) => {
  const state = await mockProject(page, null);
  await page.goto(PROJECT_PATH);

  await expect(page.getByText("No case study is attached to this project.")).toBeVisible();
  await page.getByRole("button", { name: "Add case study" }).click();
  await expect(page.getByLabel("Role", { exact: true })).toBeFocused();
  for (const selector of SECTION_IDS) {
    await expect(page.locator(selector)).toBeAttached();
  }

  await page.getByLabel("Role", { exact: true }).fill("Created in browser");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => state.saves.length).toBe(1);
  expect(state.saves[0].case_study).toEqual({
    schemaVersion: 1,
    role: "Created in browser",
  });
  await page.waitForURL("**/admin/projects");

  await page.goto(PROJECT_PATH);
  await expect(page.getByLabel("Role", { exact: true })).toHaveValue(
    "Created in browser",
  );
  await page.getByLabel("Role", { exact: true }).fill("Edited in browser");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => state.saves.length).toBe(2);
  expect(state.saves[1].case_study).toEqual({
    schemaVersion: 1,
    role: "Edited in browser",
  });
});

test("case study: unchanged document is omitted from an unrelated save", async ({
  page,
}) => {
  const state = await mockProject(page, validCaseStudy());
  await page.goto(PROJECT_PATH);

  await expect(page.getByLabel("Role", { exact: true })).toHaveValue(
    "Lead engineer",
  );
  await page
    .getByLabel("Short description", { exact: false })
    .fill("Changed only the project summary.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => state.saves.length).toBe(1);
  expect(state.saves[0]).not.toHaveProperty("case_study");
  expect(state.saves[0].short_description).toBe(
    "Changed only the project summary.",
  );
});

test("case study: invalid stored data can be repaired through recovery", async ({
  page,
}) => {
  const state = await mockProject(page, invalidCaseStudy());
  await page.goto(PROJECT_PATH);

  const warning = page.getByRole("status").filter({
    hasText: "This stored case study needs repair.",
  });
  await expect(warning).toContainText("schemaVersion 2");
  await page.getByRole("button", { name: "Create structured replacement" }).click();
  await expect(
    page.getByText("You are creating a replacement."),
  ).toBeVisible();
  await expect(page.getByLabel("Role", { exact: true })).toBeFocused();

  await page.getByLabel("Role", { exact: true }).fill("Repaired in browser");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => state.saves.length).toBe(1);
  expect(state.saves[0].case_study).toEqual({
    schemaVersion: 1,
    role: "Repaired in browser",
  });
});

test("case study: raw JSON repair validates before saving the replacement", async ({
  page,
}) => {
  const state = await mockProject(page, invalidCaseStudy());
  await page.goto(PROJECT_PATH);

  await page.getByRole("button", { name: "Repair existing JSON" }).click();
  const raw = page.getByLabel("Stored case study JSON");
  await expect(raw).toBeFocused();
  await expect(raw).toHaveValue(JSON.stringify(invalidCaseStudy(), null, 2));

  await raw.fill("{not json");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/JSON syntax error:/)).toBeVisible();
  await expect(
    page.getByRole("alert", { name: "Case study needs attention" }),
  ).toBeVisible();
  expect(state.saves).toHaveLength(0);

  const repaired = validCaseStudy();
  await raw.fill(JSON.stringify(repaired));
  await expect(
    page.getByRole("button", { name: "Use structured editor" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => state.saves.length).toBe(1);
  expect(state.saves[0].case_study).toEqual(repaired);
});

test("case study: cancelling recovery keeps raw data intact", async ({ page }) => {
  const state = await mockProject(page, invalidCaseStudy());
  await page.goto(PROJECT_PATH);

  await page.getByRole("button", { name: "Create structured replacement" }).click();
  await page.getByLabel("Role", { exact: true }).fill("Discarded repair");
  await page.getByRole("button", { name: "Cancel recovery" }).click();

  await expect(page.getByText("This stored case study needs repair.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create structured replacement" }),
  ).toBeFocused();

  await page
    .getByLabel("Short description", { exact: false })
    .fill("Unrelated change after cancelling recovery.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => state.saves.length).toBe(1);
  expect(state.saves[0]).not.toHaveProperty("case_study");

  await page.goto(PROJECT_PATH);
  await expect(page.getByText("This stored case study needs repair.")).toBeVisible();
  await expect(page.getByText(/schemaVersion 2/)).toBeVisible();
});

test("case study: an empty replacement blocks save and focuses the error summary", async ({
  page,
}) => {
  const state = await mockProject(page, invalidCaseStudy());
  await page.goto(PROJECT_PATH);

  await page.getByRole("button", { name: "Create structured replacement" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();

  const summary = page.getByRole("alert", {
    name: "Case study needs attention",
  });
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("Client validation");
  await expect(summary).toBeFocused();
  expect(state.saves).toHaveLength(0);
});

test("case study: repeatable rows can be added, edited, reordered, and removed", async ({
  page,
}) => {
  const state = await mockProject(page, validCaseStudy());
  await page.goto(PROJECT_PATH);

  const steps = page.getByRole("group", { name: "Approach steps" });
  await steps.getByRole("button", { name: "Add approach step" }).click();
  const firstHeading = steps.getByLabel(/^Approach step 1 heading/);
  await expect(firstHeading).toBeFocused();
  await firstHeading.fill("First step");
  await steps.getByLabel(/^Approach step 1 body/).fill("First body");

  await steps.getByRole("button", { name: "Add approach step" }).click();
  const secondHeading = steps.getByLabel(/^Approach step 2 heading/);
  await expect(secondHeading).toBeFocused();
  await secondHeading.fill("Second step");
  await steps.getByLabel(/^Approach step 2 body/).fill("Second body");

  await steps
    .getByRole("button", { name: "Move approach step 1 down" })
    .click();
  await expect(steps.getByLabel(/^Approach step 1 heading/)).toHaveValue(
    "Second step",
  );
  await expect(steps.getByLabel(/^Approach step 2 heading/)).toHaveValue(
    "First step",
  );

  await steps
    .getByRole("button", { name: "Remove approach step 2" })
    .click();
  await expect(steps.getByLabel(/^Approach step 1 heading/)).toHaveValue(
    "Second step",
  );
  await expect(
    steps.getByRole("button", { name: "Remove approach step 1" }),
  ).toBeFocused();

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => state.saves.length).toBe(1);
  expect(state.saves[0].case_study.approach).toEqual([
    { heading: "Second step", body: "Second body" },
  ]);
});

test("case study: explicit removal is confirmed and persisted as null", async ({
  page,
}) => {
  const state = await mockProject(page, validCaseStudy());
  await page.goto(PROJECT_PATH);

  const removeButton = page.getByRole("button", { name: "Remove case study" });
  await removeButton.click();
  const dialog = page.getByRole("alertdialog", { name: "Remove case study?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(removeButton).toBeFocused();
  await expect(page.getByLabel("Role", { exact: true })).toHaveValue(
    "Lead engineer",
  );

  await removeButton.click();
  await dialog.getByRole("button", { name: "Remove case study" }).click();
  await expect(page.getByText("No case study is attached to this project.")).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect.poll(() => state.saves.length).toBe(1);
  expect(state.saves[0].case_study).toBeNull();
});

test("case study: server validation errors link to the offending field", async ({
  page,
}) => {
  const state = await mockProject(page, validCaseStudy());
  let putCount = 0;
  state.putResponder = async (route) => {
    putCount += 1;
    if (putCount !== 1) return false;
    await fulfillJson(route, 422, validationEnvelope([
      {
        field: "caseStudy.timeline.start",
        message: "Use YYYY-MM for the start date.",
      },
    ]));
    return true;
  };
  await page.goto(PROJECT_PATH);

  await page.getByRole("button", { name: "Save changes" }).click();
  const summary = page.getByRole("alert", {
    name: "Case study needs attention",
  });
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("Server validation");
  await expect(summary).toBeFocused();
  await summary
    .getByRole("link", { name: /Timeline start/ })
    .click();
  await expect(page.locator("#case-study-timeline-start")).toBeFocused();

  await page.getByLabel(/^Timeline start/).fill("2025-02");
  await page.getByLabel(/^Timeline start/).press("Tab");
  await expect(summary).toBeHidden();

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => state.saves.length).toBe(2);
  expect(state.saves[0]).not.toHaveProperty("case_study");
  expect(state.saves[1].case_study.timeline.start).toBe("2025-02");
});

test("case study: ImagePicker validates a manual URL on blur", async ({ page }) => {
  await mockProject(page, validCaseStudy());
  await page.goto(PROJECT_PATH);

  const diagram = page.locator("#case-study-architecture-diagram");
  const source = diagram.getByLabel(/^Architecture diagram source/);
  await source.fill("not-an-image");
  await source.press("Tab");
  await expect(source).toHaveAttribute("aria-invalid", "true");
  await expect(diagram).toContainText(
    "must be an absolute http(s) URL or /images/projects/<slug>.webp.",
  );

  await source.fill("/images/projects/stayora.webp");
  await source.press("Tab");
  await expect(source).not.toHaveAttribute("aria-invalid", "true");
});

test("case study: upload errors surface and stale uploads do not overwrite edits", async ({
  page,
}) => {
  const state = await mockProject(page, validCaseStudy());
  await page.goto(PROJECT_PATH);

  const diagram = page.locator("#case-study-architecture-diagram");
  const source = diagram.getByLabel(/^Architecture diagram source/);
  const width = diagram.getByLabel(/^Architecture diagram width/);
  const file = diagram.getByLabel("Upload image file for architecture diagram");

  state.uploadResponder = async (route) => {
    await fulfillJson(route, 422, validationEnvelope([
      { field: "file", message: "Only WebP images are supported." },
    ]));
    return true;
  };
  let responsePromise = page.waitForResponse(isUploadResponse);
  await file.setInputFiles(UPLOAD_FILE);
  await responsePromise;
  await expect(diagram).toContainText("Only WebP images are supported.");
  await expect(source).toHaveValue(VALID_IMAGE);

  let releaseUpload;
  let notifyStarted;
  const uploadStarted = new Promise((resolve) => {
    notifyStarted = resolve;
  });
  state.uploadResponder = async (route) => {
    notifyStarted();
    await new Promise((resolve) => {
      releaseUpload = resolve;
    });
    await fulfillJson(
      route,
      200,
      uploadResult("https://assets.example.test/uploads/stale.webp"),
    );
    return true;
  };

  responsePromise = page.waitForResponse(isUploadResponse);
  await file.setInputFiles(UPLOAD_FILE);
  await uploadStarted;
  await source.fill(SECOND_IMAGE);
  releaseUpload();
  await responsePromise;

  await expect(source).toHaveValue(SECOND_IMAGE);
  await expect(width).toHaveValue("");
  expect(state.uploads).toHaveLength(2);
});
