import { Buffer } from "node:buffer";

import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./state.mjs";

export const PROJECT_ID = "11111111-4111-4111-8111-111111111111";
export const PROJECT_PATH = `/admin/projects/${PROJECT_ID}`;
export const VALID_IMAGE = "/images/projects/webchat-ai.webp";
export const SECOND_IMAGE = "/images/projects/stayora.webp";

const PROJECT_API = `**/api/admin/projects/${PROJECT_ID}`;
const UPLOAD_API = "**/api/admin/uploads";
const UPLOAD_FILE = {
  name: "diagram.webp",
  mimeType: "image/webp",
  buffer: Buffer.from("webp fixture for mocked upload"),
};

export function clone(value) {
  return value === null || value === undefined
    ? value
    : JSON.parse(JSON.stringify(value));
}

export function createProject(caseStudy) {
  return {
    id: PROJECT_ID,
    slug: "e2e-case-study-project",
    title: "E2E Case Study Project",
    status: "published",
    indexable: true,
    featured: false,
    display_order: 0,
    updated_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    short_description: "Fixture project for case-study editor tests.",
    long_description: null,
    image: VALID_IMAGE,
    image_width: 1200,
    image_height: 750,
    image_alt: "E2E case study cover image",
    category: null,
    tech_stack: ["React"],
    case_study: clone(caseStudy),
    live_url: null,
    github_url: null,
    seo_title: "E2E Case Study Project SEO title",
    seo_description: "Fixture SEO description for case-study editor tests.",
  };
}

export function validCaseStudy() {
  return {
    schemaVersion: 1,
    role: "Lead engineer",
    timeline: {
      label: "Initial build",
      start: "2025-01",
      end: "2025-06",
    },
    problem: {
      summary: "Publishing a detailed case study was slow.",
    },
    approach: [],
    architecture: {
      summary: "A static site with a small admin editor.",
      diagram: {
        src: VALID_IMAGE,
        alt: "E2E architecture diagram",
        width: 1200,
        height: 750,
        caption: "",
      },
    },
  };
}

export function invalidCaseStudy() {
  return {
    schemaVersion: 2,
    role: "Legacy case study",
    legacy_notes: "Must survive an unrelated save unchanged.",
  };
}

export function uploadResult(image) {
  return {
    image,
    image_width: 640,
    image_height: 480,
    key: "uploads/e2e-diagram.webp",
    audit_id: "00000000-0000-4000-8000-000000000001",
  };
}

export function validationEnvelope(fields) {
  return {
    error: {
      code: "VALIDATION_ERROR",
      message: "Request validation failed.",
      request_id: "req-e2e-cp5-2",
      fields,
    },
  };
}

export async function fulfillJson(route, status, payload, headers = {}) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers,
    body: JSON.stringify(payload),
  });
}

export async function mockProject(page, caseStudy) {
  const state = {
    project: createProject(caseStudy),
    saves: [],
    uploads: [],
    putResponder: null,
    uploadResponder: null,
  };

  await page.route(PROJECT_API, async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, 200, state.project);
      return;
    }
    if (route.request().method() !== "PUT") {
      await route.abort();
      return;
    }

    const body = route.request().postDataJSON();
    state.saves.push(body);
    if (
      state.putResponder &&
      (await state.putResponder(route, body, state.saves.length))
    ) {
      return;
    }
    if (Object.hasOwn(body, "case_study")) {
      state.project.case_study = clone(body.case_study);
    }
    state.project.short_description = body.short_description;
    state.project.updated_at = new Date(
      Date.now() + state.saves.length * 1000,
    ).toISOString();
    await fulfillJson(route, 200, {
      entity: state.project,
      audit_id: "00000000-0000-4000-8000-000000000002",
    });
  });

  await page.route(UPLOAD_API, async (route) => {
    const request = route.request();
    state.uploads.push(request);
    if (state.uploadResponder && (await state.uploadResponder(route, request))) {
      return;
    }
    await fulfillJson(
      route,
      200,
      uploadResult("https://assets.example.test/uploads/e2e-diagram.webp"),
    );
  });

  return state;
}

export function isUploadResponse(response) {
  return (
    response.request().method() === "POST" &&
    new URL(response.url()).pathname === "/api/admin/uploads"
  );
}

export async function login(page) {
  await page.goto("/admin/login");
  await page.getByLabel(/Email/).fill(ADMIN_EMAIL);
  await page.getByLabel(/Password/).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin\/?$/, { timeout: 15000 });
}
