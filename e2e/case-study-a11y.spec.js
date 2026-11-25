import { Buffer } from "node:buffer";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  fulfillJson,
  invalidCaseStudy,
  login,
  mockProject,
  PROJECT_PATH,
  VALID_IMAGE,
  validCaseStudy,
  validationEnvelope,
} from "./case-study-fixtures.mjs";

const SERIOUS = ["critical", "serious"];

const UPLOAD_FILE = {
  name: "diagram.webp",
  mimeType: "image/webp",
  buffer: Buffer.from("webp fixture for mocked upload"),
};

function richCaseStudy() {
  const value = validCaseStudy();
  return {
    ...value,
    team: {
      size: 4,
      roles: ["Frontend", "Backend"],
      note: "Small cross-functional team.",
    },
    constraints: ["Ship within eight weeks.", "Keep the build static."],
    approach: [
      { heading: "Audit", body: "Measured the slowest publishing steps." },
    ],
    keyDecisions: [
      {
        decision: "Use generated pages.",
        rationale: "Keeps hosting simple.",
        tradeoff: "Rebuilds are required.",
      },
    ],
    challenges: [
      {
        problem: "Legacy markup varied.",
        resolution: "Normalised the content contract.",
        lesson: "Validate at the boundary.",
      },
    ],
    outcomes: [
      {
        kind: "qualitative",
        statement: "Publishing became predictable.",
      },
    ],
    learnings: ["Validate early."],
    links: [
      {
        label: "Demo",
        url: "https://example.test/demo",
        kind: "demo",
      },
    ],
    gallery: [
      {
        src: VALID_IMAGE,
        alt: "E2E gallery screenshot",
        width: 1200,
        height: 750,
        caption: "",
      },
    ],
  };
}

async function assertAxe(page, label) {
  const structure = await page.evaluate(() => {
    const editor = document.querySelector(".case-study-editor");
    return {
      mainCount: document.querySelectorAll("main").length,
      h1Count: document.querySelectorAll("h1").length,
      editorCount: editor ? 1 : 0,
      editorH1Count: editor ? editor.querySelectorAll("h1").length : 0,
      editorH2Count: editor ? editor.querySelectorAll("h2").length : 0,
    };
  });
  expect(structure.mainCount, "one main landmark").toBe(1);
  expect(structure.h1Count, "one page heading").toBe(1);
  expect(structure.editorCount, "case-study editor must be present").toBe(1);
  expect(structure.editorH1Count, "editor must not introduce a second h1").toBe(0);
  expect(structure.editorH2Count, "editor must expose an h2").toBeGreaterThan(0);

  const results = await new AxeBuilder({ page })
    .include(".case-study-editor")
    .analyze();
  const advisory = results.violations.filter((v) => !SERIOUS.includes(v.impact));
  const blocking = results.violations.filter((v) => SERIOUS.includes(v.impact));

  if (advisory.length > 0) {
    console.warn(
      `[case-study a11y ${label}] advisory:`,
      advisory.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s)`),
    );
  }
  if (results.incomplete.length > 0) {
    console.warn(
      `[case-study a11y ${label}] incomplete:`,
      results.incomplete.map((v) => `${v.id}: ${v.nodes.length} node(s)`),
    );
  }

  expect(
    blocking.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      targets: v.nodes.map((n) => n.target),
      summary: v.nodes.map((n) => n.failureSummary),
    })),
    `critical/serious axe violations in ${label}`,
  ).toEqual([]);

  return results.violations;
}

async function focusWithKeyboard(page, locator) {
  for (let index = 0; index < 250; index += 1) {
    await page.keyboard.press("Tab");
    if (await locator.evaluate((element) => element === document.activeElement)) {
      return;
    }
  }
  throw new Error("could not reach locator with Tab");
}

async function expectVisibleKeyboardFocus(locator) {
  await expect(locator).toBeFocused();
  const outline = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      style: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth) || 0,
    };
  });
  expect(outline.style, "keyboard focus must render a visible outline").not.toBe(
    "none",
  );
  expect(outline.width).toBeGreaterThan(0);
}

test.use({ reducedMotion: "reduce" });

test.beforeEach(async ({ page }) => {
  await login(page);
});

for (const colorScheme of ["dark", "light"]) {
  test(`structured case study has no serious axe violations in ${colorScheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await mockProject(page, richCaseStudy());
    await page.goto(PROJECT_PATH);
    await expect(page.getByLabel("Role", { exact: true })).toHaveValue(
      "Lead engineer",
    );

    const background = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    expect(background).toBe(
      colorScheme === "dark" ? "rgb(11, 18, 32)" : "rgb(248, 250, 252)",
    );

    await assertAxe(page, `structured editor (${colorScheme})`);
  });
}

test("raw, recovery, and cancelled-recovery states have no serious axe violations", async ({
  page,
}) => {
  await mockProject(page, invalidCaseStudy());
  await page.goto(PROJECT_PATH);
  await expect(page.getByText("This stored case study needs repair.")).toBeVisible();

  await assertAxe(page, "raw stored case study");

  const repairButton = page.getByRole("button", {
    name: "Repair existing JSON",
  });
  await focusWithKeyboard(page, repairButton);
  await expectVisibleKeyboardFocus(repairButton);
  await page.keyboard.press("Enter");
  const raw = page.getByLabel("Stored case study JSON");
  await expect(raw).toBeFocused();
  await assertAxe(page, "raw JSON repair state");

  await raw.fill("{not json");
  await expect(raw).toHaveAttribute("aria-invalid", "true");
  await assertAxe(page, "raw JSON syntax error state");

  await page.getByRole("button", { name: "Cancel repair" }).click();
  await expect(repairButton).toBeFocused();
  await assertAxe(page, "cancelled raw repair");

  await page.getByRole("button", { name: "Create structured replacement" }).click();
  await expect(page.getByText("You are creating a replacement.")).toBeVisible();
  await assertAxe(page, "recovery mode");

  await page.getByRole("button", { name: "Cancel recovery" }).click();
  await expect(page.getByText("This stored case study needs repair.")).toBeVisible();
  await assertAxe(page, "cancelled recovery");
});

test("client and server validation states have no serious axe violations", async ({
  page,
}) => {
  await mockProject(page, invalidCaseStudy());
  await page.goto(PROJECT_PATH);
  await page.getByRole("button", { name: "Create structured replacement" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();

  const clientSummary = page.getByRole("alert", {
    name: "Case study needs attention",
  });
  await expect(clientSummary).toContainText("Client validation");
  await assertAxe(page, "client validation");

  const serverState = await mockProject(page, validCaseStudy());
  await page.goto(PROJECT_PATH);
  let putCount = 0;
  serverState.putResponder = async (route) => {
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
  await page.getByRole("button", { name: "Save changes" }).click();
  const serverSummary = page.getByRole("alert", {
    name: "Case study needs attention",
  });
  await expect(serverSummary).toContainText("Server validation");
  await assertAxe(page, "server validation");
});

test("repeatable, dialog, and image error states have no serious axe violations", async ({
  page,
}) => {
  const state = await mockProject(page, richCaseStudy());
  await page.goto(PROJECT_PATH);

  const steps = page.getByRole("group", { name: "Approach steps" });
  await steps.getByRole("button", { name: "Add approach step" }).click();
  await assertAxe(page, "repeatable rows");

  await page.getByRole("button", { name: "Remove case study" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Remove case study?" });
  await expect(dialog).toBeVisible();
  await assertAxe(page, "remove confirmation dialog");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  state.uploadResponder = async (route) => {
    await fulfillJson(route, 422, validationEnvelope([
      { field: "file", message: "Only WebP images are supported." },
    ]));
    return true;
  };
  const diagram = page.locator("#case-study-architecture-diagram");
  await diagram
    .getByLabel("Upload image file for architecture diagram")
    .setInputFiles(UPLOAD_FILE);
  await expect(diagram).toContainText("Only WebP images are supported.");
  await assertAxe(page, "upload error");

  await diagram.getByLabel(/^Architecture diagram source/).fill("not-an-image");
  await diagram.getByLabel(/^Architecture diagram source/).press("Tab");
  await expect(diagram).toContainText(
    "must be an absolute http(s) URL or /images/projects/<slug>.webp.",
  );
  await assertAxe(page, "manual image validation error");
});

test("keyboard workflows expose visible focus and restore it to useful targets", async ({
  page,
}) => {
  const state = await mockProject(page, null);
  await page.goto(PROJECT_PATH);

  const addButton = page.getByRole("button", { name: "Add case study" });
  await focusWithKeyboard(page, addButton);
  await expectVisibleKeyboardFocus(addButton);
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Role", { exact: true })).toBeFocused();

  await page.keyboard.type("Keyboard-created case study");
  const saveButton = page.getByRole("button", { name: "Save changes" });
  await focusWithKeyboard(page, saveButton);
  await expectVisibleKeyboardFocus(saveButton);

  state.project.case_study = validCaseStudy();
  await page.goto(PROJECT_PATH);
  const steps = page.getByRole("group", { name: "Approach steps" });
  const addStep = steps.getByRole("button", { name: "Add approach step" });
  await focusWithKeyboard(page, addStep);
  await expectVisibleKeyboardFocus(addStep);
  await page.keyboard.press("Enter");
  const firstHeading = steps.getByLabel(/^Approach step 1 heading/);
  await expect(firstHeading).toBeFocused();
  await page.keyboard.type("Keyboard step");
  await expect(firstHeading).toHaveValue("Keyboard step");

  const removeButton = page.getByRole("button", { name: "Remove case study" });
  await focusWithKeyboard(page, removeButton);
  await expectVisibleKeyboardFocus(removeButton);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog", { name: "Remove case study?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(removeButton).toBeFocused();
});

test("error links are keyboard reachable and focus their fields", async ({
  page,
}) => {
  const state = await mockProject(page, validCaseStudy());
  await page.goto(PROJECT_PATH);
  state.putResponder = async (route) => {
    await fulfillJson(route, 422, validationEnvelope([
      {
        field: "caseStudy.timeline.start",
        message: "Use YYYY-MM for the start date.",
      },
    ]));
    return true;
  };

  const saveButton = page.getByRole("button", { name: "Save changes" });
  await focusWithKeyboard(page, saveButton);
  await page.keyboard.press("Enter");

  const summary = page.getByRole("alert", {
    name: "Case study needs attention",
  });
  await expect(summary).toBeFocused();
  const link = summary.getByRole("link", { name: /Timeline start/ });
  await focusWithKeyboard(page, link);
  await expectVisibleKeyboardFocus(link);
  await page.keyboard.press("Enter");
  await expect(page.locator("#case-study-timeline-start")).toBeFocused();
});
