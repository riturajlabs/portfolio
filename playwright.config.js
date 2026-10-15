// Playwright e2e for Phase 10.
//
// Three servers back the run:
//   1. `e2e/serve.mjs`    — serves the built `dist/` on :4173 and proxies
//                           `/api/admin/*` to the e2e backend.
//   2. `e2e/start-backend.mjs` — provisions the disposable `portfolio_e2e`
//                           database and runs the real FastAPI backend on :8901.
//   3. `e2e/mock-resend.mjs`    — stands in for Resend on :8902 so contact
//                           submissions complete end-to-end.
//   4. `e2e/mock-s3.mjs`        — an S3-compatible store on :8903 so resume
//                           (and image) uploads complete end-to-end.
//
// The built bundle's chat/contact/github calls are pinned to
// `http://localhost:8000` by the local `.env` and are intercepted per-page by
// `e2e/intercept.mjs` (never reaching the real docker backend).

import { defineConfig } from "@playwright/test";

const SITE_PORT = Number(process.env.E2E_SITE_PORT || 4173);
const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT || 8901);
const RESEND_PORT = Number(process.env.E2E_RESEND_PORT || 8902);
const S3_PORT = Number(process.env.E2E_S3_PORT || 8903);

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  outputDir: "test-results",
  use: {
    baseURL: `http://127.0.0.1:${SITE_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    serviceWorkers: "block",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      command: `node e2e/serve.mjs`,
      url: `http://127.0.0.1:${SITE_PORT}/`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        E2E_SITE_PORT: String(SITE_PORT),
        E2E_BACKEND_PORT: String(BACKEND_PORT),
      },
    },
    {
      command: `node e2e/start-backend.mjs`,
      url: `http://127.0.0.1:${BACKEND_PORT}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        E2E_BACKEND_PORT: String(BACKEND_PORT),
        E2E_RESEND_PORT: String(RESEND_PORT),
        E2E_S3_PORT: String(S3_PORT),
      },
    },
    {
      command: `node e2e/mock-resend.mjs`,
      url: `http://127.0.0.1:${RESEND_PORT}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { E2E_RESEND_PORT: String(RESEND_PORT) },
    },
    {
      command: `node e2e/mock-s3.mjs`,
      url: `http://127.0.0.1:${S3_PORT}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { E2E_S3_PORT: String(S3_PORT) },
    },
  ],
});