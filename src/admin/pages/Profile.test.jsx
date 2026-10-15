// Profile editor — the resume upload control (Phase 11).
//
// The upload is the save for the resume: the server stores the PDF in the private
// bucket and repoints `site_profile.resume` at `/api/resume` in one audited
// transaction. These tests pin the control's behaviour against that contract:
// selection, a busy/disabled state, success, server and client rejection, and the
// guarantee that a failure leaves the previously active resume in the field.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

import { ToastProvider } from "../components/Toast.jsx";
import Profile from "./Profile.jsx";

vi.mock("../api/client.js", () => {
  class ApiError extends Error {
    constructor(status, payload) {
      super(payload?.message || `Request failed with status ${status}.`);
      this.name = "ApiError";
      this.status = status;
      this.code = payload?.code;
      this.fields = payload?.fields || [];
    }
  }
  return {
    ApiError,
    fieldErrorMap: (error) =>
      Object.fromEntries((error?.fields || []).map((field) => [field.field, field.message])),
    get: vi.fn(),
    put: vi.fn(),
    uploadResume: vi.fn(),
  };
});

import { ApiError, get, uploadResume } from "../api/client.js";

const IN_REPO_RESUME = "/Ritu_Raj_Full_Stack_Developer_Resume.pdf";

const PROFILE = {
  id: "profile-1",
  name: "Ritu Raj",
  title: "Full Stack Developer",
  greeting: "Hi",
  roles: ["Developer"],
  description: "Portfolio description.",
  location: "Earth",
  resume: IN_REPO_RESUME,
  resume_key: null,
  stats: [],
  social: { github: "", linkedin: "", email: "" },
  about: { tag: "", title: "", description: "", heading: "", paragraphs: [], cards: [] },
  seo: { person: {}, robots: {} },
};

const PDF = new File(["%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n"], "cv.pdf", {
  type: "application/pdf",
});

function renderProfile() {
  return render(
    <ToastProvider>
      <Profile />
    </ToastProvider>,
  );
}

async function openBasics(user) {
  const basics = await screen.findByRole("button", { name: /Basics/ });
  await user.click(basics);
  return screen.findByLabelText("Upload resume");
}

beforeEach(() => {
  vi.resetAllMocks();
  get.mockResolvedValue(PROFILE);
});

it("shows the active resume and uploads a PDF, updating the path to the stable route", async () => {
  const user = userEvent.setup();
  uploadResume.mockResolvedValue({ resume: "/api/resume", key: "resumes/new.pdf", audit_id: "a1" });

  renderProfile();
  const input = await openBasics(user);

  // The current (in-repo) resume is the link the site serves until the upload lands.
  expect(screen.getByLabelText(/Resume path/)).toHaveValue(IN_REPO_RESUME);

  await user.upload(input, PDF);

  await waitFor(() => expect(uploadResume).toHaveBeenCalledWith(PDF));
  expect(await screen.findByText("Resume uploaded.")).toBeInTheDocument();
  // The upload *is* the save: the field reflects the returned stable route.
  expect(screen.getByLabelText(/Resume path/)).toHaveValue("/api/resume");
});

it("disables the control while the upload is in flight", async () => {
  const user = userEvent.setup();
  let resolveUpload;
  uploadResume.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveUpload = resolve;
      }),
  );

  renderProfile();
  const input = await openBasics(user);
  await user.upload(input, PDF);

  await waitFor(() => expect(uploadResume).toHaveBeenCalledTimes(1));
  // Duplicate-submission guard: the picker cannot fire a second upload until
  // the first settles.
  expect(input).toBeDisabled();

  resolveUpload({ resume: "/api/resume", key: "resumes/new.pdf", audit_id: "a1" });
  expect(await screen.findByText("Resume uploaded.")).toBeInTheDocument();
  expect(input).not.toBeDisabled();
});

it("surfaces a server rejection and keeps the previous resume in the field", async () => {
  const user = userEvent.setup();
  uploadResume.mockRejectedValue(
    new ApiError(422, {
      code: "VALIDATION_ERROR",
      message: "Only PDF documents are supported.",
      fields: [{ field: "file", message: "Only PDF documents are supported." }],
    }),
  );

  renderProfile();
  const input = await openBasics(user);
  await user.upload(input, PDF);

  await waitFor(() => expect(uploadResume).toHaveBeenCalledTimes(1));
  expect((await screen.findAllByText("Only PDF documents are supported.")).length).toBeGreaterThan(0);
  // The failed upload changed nothing: the old resume is still the active value.
  expect(screen.getByLabelText(/Resume path/)).toHaveValue(IN_REPO_RESUME);
});

it("rejects an obviously non-PDF file before calling the API", async () => {
  const user = userEvent.setup({ applyAccept: false });

  renderProfile();
  const input = await openBasics(user);

  const notPdf = new File(["just some text"], "notes.txt", { type: "text/plain" });
  await user.upload(input, notPdf);

  expect(uploadResume).not.toHaveBeenCalled();
  expect((await screen.findAllByText("Choose a PDF file.")).length).toBeGreaterThan(0);
});
