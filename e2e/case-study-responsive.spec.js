import { Buffer } from "node:buffer";

import { expect, test } from "@playwright/test";

import {
  fulfillJson,
  invalidCaseStudy,
  isUploadResponse,
  login,
  mockProject,
  PROJECT_PATH,
  SECOND_IMAGE,
  validationEnvelope,
  validCaseStudy,
} from "./case-study-fixtures.mjs";

const VIEWPORTS = [320, 360, 390, 768, 1024, 1440];
const NARROW_VIEWPORTS = [320, 360, 390];
const THEMES = ["dark", "light"];
const LONG_MESSAGE =
  "The start date must use YYYY-MM with a four-digit year and a two-digit month, and it must not be later than the end date. Include leading zeros for single-digit months.";

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
        src: SECOND_IMAGE,
        alt: "E2E gallery screenshot",
        width: 1200,
        height: 750,
        caption: "",
      },
    ],
  };
}

async function setViewport(page, width, colorScheme) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme });
}

async function settle(page) {
  await page.evaluate(async () => {
    const end = document.body.scrollHeight;
    for (let y = 0; y <= end; y += 600) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    window.scrollTo(0, 0);
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
}

async function expectNoCaseStudyOverflow(page, label) {
  await settle(page);
  const metrics = await page.evaluate(() => {
    const editor = document.querySelector(".case-study-editor");
    const rect = editor.getBoundingClientRect();
    return {
      overflow: editor.scrollWidth - editor.clientWidth,
      right: rect.right,
      viewport: document.documentElement.clientWidth,
    };
  });
  expect(metrics.overflow, `${label} editor overflow`).toBeLessThanOrEqual(0);
  expect(metrics.right, `${label} editor right edge`).toBeLessThanOrEqual(
    metrics.viewport + 1,
  );
}

async function expectWithinViewport(locator, width, label) {
  const box = await locator.boundingBox();
  expect(box, `${label} must be rendered`).not.toBeNull();
  expect(box.x, `${label} left edge`).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width, `${label} right edge`).toBeLessThanOrEqual(
    width + 1,
  );
}

async function expectTouchTargets(locator, label) {
  const targets = await locator.evaluateAll((elements) =>
    elements
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const text = (element.textContent || "").trim().slice(0, 60);
        return {
          label: element.getAttribute("aria-label") || text || element.tagName,
          width: rect.width,
          height: rect.height,
        };
      }),
  );
  expect(targets.length, `${label} must contain controls`).toBeGreaterThan(0);
  for (const target of targets) {
    expect(target.height, `${label}: ${target.label} height`).toBeGreaterThanOrEqual(
      44,
    );
    expect(target.width, `${label}: ${target.label} width`).toBeGreaterThanOrEqual(
      44,
    );
  }
}

async function expectGridColumns(page, selector, expected, label) {
  const count = await page.locator(selector).first().evaluate((element) =>
    getComputedStyle(element)
      .gridTemplateColumns.split(/\s+/)
      .filter(Boolean).length,
  );
  expect(count, label).toBe(expected);
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

for (const width of VIEWPORTS) {
  for (const colorScheme of THEMES) {
    test(`case-study editor fits ${width}px in ${colorScheme} theme`, async ({
      page,
    }) => {
      await setViewport(page, width, colorScheme);
      await mockProject(page, richCaseStudy());
      await page.goto(PROJECT_PATH);
      await expect(page.getByLabel("Role", { exact: true })).toBeVisible();
      await expect(page.locator("#case-study-timeline-start")).toBeVisible();

      const columns = width <= 900 ? 1 : 2;
      await expectGridColumns(
        page,
        ".case-study-grid--two",
        columns,
        `two-column fields at ${width}px`,
      );
      await expectGridColumns(
        page,
        ".case-study-repeatable-row",
        columns,
        `repeatable row at ${width}px`,
      );

      const sections = await page
        .locator(".case-study-editor fieldset[id]")
        .evaluateAll((elements) =>
          elements.map((element) => ({
            id: element.id,
            tabIndex: element.tabIndex,
          })),
        );
      expect(sections.length, "case-study sections").toBeGreaterThan(5);
      for (const section of sections) {
        expect(section.tabIndex, `${section.id} focus target`).toBe(-1);
      }

      await expectWithinViewport(
        page.getByRole("button", { name: "Remove case study" }),
        width,
        `remove button at ${width}px`,
      );
      await expectWithinViewport(
        page.getByRole("button", { name: "Save changes" }),
        width,
        `save button at ${width}px`,
      );
      await expectWithinViewport(
        page.getByRole("button", { name: "Cancel" }),
        width,
        `cancel button at ${width}px`,
      );
      await expectNoCaseStudyOverflow(page, `${width}px ${colorScheme}`);

      if (NARROW_VIEWPORTS.includes(width)) {
        await expectTouchTargets(
          page.locator(".case-study-editor button"),
          `case-study buttons at ${width}px ${colorScheme}`,
        );
        await expectTouchTargets(
          page.locator('.case-study-editor input[type="file"]'),
          `case-study file inputs at ${width}px ${colorScheme}`,
        );
      }
    });
  }
}

for (const width of [320, 390]) {
  for (const colorScheme of THEMES) {
    test(`validation summary and long messages fit ${width}px in ${colorScheme} theme`, async ({
      page,
    }) => {
      await setViewport(page, width, colorScheme);
      const state = await mockProject(page, validCaseStudy());
      await page.goto(PROJECT_PATH);
      state.putResponder = async (route) => {
        await fulfillJson(
          route,
          422,
          validationEnvelope([
            {
              field: "caseStudy.timeline.start",
              message: LONG_MESSAGE,
            },
          ]),
        );
        return true;
      };

      await page.getByRole("button", { name: "Save changes" }).click();
      const summary = page.getByRole("alert", {
        name: "Case study needs attention",
      });
      await expect(summary).toBeVisible();
      await expect(summary).toContainText("Server validation");
      await expect(summary).toContainText(LONG_MESSAGE.slice(0, 48));
      await expectWithinViewport(summary, width, `error summary at ${width}px`);
      await expectNoCaseStudyOverflow(page, `validation ${width}px ${colorScheme}`);

      const link = summary.getByRole("link", { name: /Timeline start/ });
      await expectWithinViewport(link, width, `error link at ${width}px`);
      await link.click();
      await expect(page.locator("#case-study-timeline-start")).toBeFocused();
    });
  }
}

test("raw recovery and recovery banner fit narrow screens in both themes", async ({
  page,
}) => {
  await mockProject(page, invalidCaseStudy());
  await page.goto(PROJECT_PATH);
  const warning = page.locator(".case-study-warning");
  await expect(warning).toBeVisible();

  for (const width of NARROW_VIEWPORTS) {
    for (const colorScheme of THEMES) {
      await setViewport(page, width, colorScheme);
      await expect(warning).toBeVisible();
      await expectWithinViewport(warning, width, `raw banner at ${width}px`);
      await expectTouchTargets(
        warning.locator("button"),
        `raw recovery button at ${width}px ${colorScheme}`,
      );
      await expectNoCaseStudyOverflow(page, `raw ${width}px ${colorScheme}`);

      await page.getByRole("button", { name: "Create structured replacement" }).click();
      const recovery = page.locator(".case-study-recovery");
      await expect(recovery).toBeVisible();
      await expectWithinViewport(
        recovery,
        width,
        `recovery banner at ${width}px`,
      );
      await expectTouchTargets(
        recovery.locator("button"),
        `cancel recovery button at ${width}px ${colorScheme}`,
      );
      await expectNoCaseStudyOverflow(
        page,
        `recovery ${width}px ${colorScheme}`,
      );

      await page.getByRole("button", { name: "Cancel recovery" }).click();
      await expect(warning).toBeVisible();
    }
  }
});

test("dialog, ImagePicker, and upload errors fit narrow screens in both themes", async ({
  page,
}) => {
  const state = await mockProject(page, richCaseStudy());
  await page.goto(PROJECT_PATH);
  state.uploadResponder = async (route) => {
    await fulfillJson(
      route,
      422,
      validationEnvelope([
        {
          field: "file",
          message:
            "Only WebP images are supported. Choose a small WebP file and try again.",
        },
      ]),
    );
    return true;
  };

  for (const width of NARROW_VIEWPORTS) {
    for (const colorScheme of THEMES) {
      await setViewport(page, width, colorScheme);
      const diagram = page.locator("#case-study-architecture-diagram");
      const file = diagram.getByLabel(
        "Upload image file for architecture diagram",
      );
      const source = diagram.getByLabel(/^Architecture diagram source/);
      await expectWithinViewport(file, width, `upload input at ${width}px`);
      await expectWithinViewport(source, width, `source input at ${width}px`);
      await expectTouchTargets(
        file,
        `file input at ${width}px ${colorScheme}`,
      );
      await expectNoCaseStudyOverflow(
        page,
        `image picker ${width}px ${colorScheme}`,
      );

      await page.getByRole("button", { name: "Remove case study" }).click();
      const dialog = page.getByRole("alertdialog", {
        name: "Remove case study?",
      });
      await expect(dialog).toBeVisible();
      await expectWithinViewport(dialog, width, `dialog at ${width}px`);
      const box = await dialog.boundingBox();
      expect(box.y, `dialog top at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(
        box.y + box.height,
        `dialog bottom at ${width}px`,
      ).toBeLessThanOrEqual(901);
      await expectTouchTargets(
        dialog.locator("button"),
        `dialog buttons at ${width}px ${colorScheme}`,
      );
      await expectNoCaseStudyOverflow(
        page,
        `dialog ${width}px ${colorScheme}`,
      );
      await dialog.getByRole("button", { name: "Cancel" }).click();

      const responsePromise = page.waitForResponse(isUploadResponse);
      await file.setInputFiles({
        name: "diagram.webp",
        mimeType: "image/webp",
        buffer: Buffer.from(`webp fixture ${width} ${colorScheme}`),
      });
      await responsePromise;
      await expect(diagram).toContainText("Only WebP images are supported.");
      await expectNoCaseStudyOverflow(
        page,
        `upload error ${width}px ${colorScheme}`,
      );
    }
  }
});
