import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ToastProvider } from "../components/Toast.jsx";
import ProjectEditor from "./ProjectEditor.jsx";

function setupUser() {
  return userEvent.setup({ delay: null });
}

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
      Object.fromEntries(
        (error?.fields || [])
          .map((field) => {
            const path =
              typeof field?.field === "string"
                ? field.field
                    .trim()
                    .replace(/\[([^\]]+)\]/g, ".$1")
                    .replace(/\.{2,}/g, ".")
                    .replace(/^\.+/, "")
                    .replace(/\.+$/, "")
                : "";
            return [path, field?.message];
          })
          .filter(([path]) => path),
      ),
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    uploadImage: vi.fn(),
  };
});

import { ApiError, get, post, put, uploadImage } from "../api/client.js";

function project(changes = {}) {
  return {
    id: "project-1",
    title: "Atlas",
    slug: "atlas",
    short_description: "A project short description.",
    long_description: "",
    image: "/images/projects/atlas.webp",
    image_width: 1200,
    image_height: 800,
    image_alt: "Atlas dashboard",
    category: "Web App",
    tech_stack: ["React"],
    status: "published",
    featured: false,
    indexable: true,
    display_order: 0,
    live_url: "",
    github_url: "",
    seo_title: "Atlas case study",
    seo_description: "Atlas SEO description.",
    updated_at: null,
    case_study: null,
    ...changes,
  };
}

function renderEditor({ isNew = false } = {}) {
  const entry = isNew ? "/projects/new" : "/projects/project-1";

  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/projects/new" element={<ProjectEditor />} />
          <Route path="/projects/:id" element={<ProjectEditor />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

async function pasteInto(user, label, text) {
  const field = screen.getByLabelText(label);
  await user.click(field);
  await user.clear(field);
  await user.paste(text);
}

async function fillRequiredProjectFields(user) {
  await pasteInto(user, /^Title/, "Orbit");
  await pasteInto(user, /^Short description/, "An orbit project.");
  await pasteInto(
    user,
    /Image path/,
    "/images/projects/orbit.webp",
  );
  await pasteInto(user, /Image width/, "1200");
  await pasteInto(user, /Image height/, "800");
  await pasteInto(user, /Image alt text/, "Orbit dashboard");
  await pasteInto(user, /SEO title/, "Orbit case study");
  await pasteInto(user, /SEO description/, "Orbit SEO description.");
}

async function openProject(user) {
  await screen.findByDisplayValue("Atlas");
  return user;
}

async function save(user) {
  await user.click(screen.getByRole("button", { name: "Save changes" }));
}

async function removeCaseStudy(user) {
  await user.click(screen.getByRole("button", { name: "Remove case study" }));
  const dialog = screen.getByRole("alertdialog");
  await user.click(
    within(dialog).getByRole("button", { name: "Remove case study" }),
  );
}

async function startStructuredRecovery(user) {
  await user.click(
    screen.getByRole("button", { name: "Create structured replacement" }),
  );
}

async function startRawRepair(user) {
  await user.click(
    screen.getByRole("button", { name: "Repair existing JSON" }),
  );
}

async function enterInvalidTimeline(user) {
  await user.type(screen.getByLabelText("Timeline start"), "2026-01");
  await user.type(screen.getByLabelText("Timeline end"), "2025-01");
}

beforeEach(() => {
  vi.resetAllMocks();
  get.mockResolvedValue(project());
  post.mockResolvedValue({});
  put.mockResolvedValue({});
  vi.stubGlobal(
    "Image",
    class {
      set src(_value) {
        this.onerror?.();
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("creates a project with every basic case-study section", async () => {
  const user = setupUser();
  renderEditor({ isNew: true });

  await fillRequiredProjectFields(user);
  await user.click(screen.getByRole("button", { name: "Add case study" }));

  await pasteInto(user, "Role", "Solo developer");
  await pasteInto(user, "Timeline label", "Launch");
  await pasteInto(user, "Timeline start", "2025-01");
  await pasteInto(user, "Timeline end", "2025-03");
  await pasteInto(user, "Timeline duration", "3 months");
  await pasteInto(user, "Team size", "3");
  await pasteInto(user, "Team note", "Small product team");
  await user.click(screen.getByRole("button", { name: "Add team role" }));
  await pasteInto(user, /Team role 1/, "Designer");
  await pasteInto(user, "Problem summary", "Slow handoffs");
  await pasteInto(user, "Problem context", "Manual triage");
  await user.click(screen.getByRole("button", { name: "Add constraint" }));
  await pasteInto(user, /Constraint 1/, "Fixed budget");
  await user.click(screen.getByRole("button", { name: "Add approach step" }));
  await pasteInto(user, /Approach step 1 heading/, "Map");
  await pasteInto(user, /Approach step 1 body/, "Trace the flow");

  await user.click(screen.getByRole("button", { name: "Create project" }));

  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  const [, body] = post.mock.calls[0];
  expect(body).toMatchObject({
    title: "Orbit",
    case_study: {
      schemaVersion: 1,
      role: "Solo developer",
      timeline: {
        label: "Launch",
        start: "2025-01",
        end: "2025-03",
        duration: "3 months",
      },
      team: {
        size: 3,
        roles: ["Designer"],
        note: "Small product team",
      },
      problem: {
        summary: "Slow handoffs",
        context: "Manual triage",
      },
      constraints: ["Fixed budget"],
      approach: [{ heading: "Map", body: "Trace the flow" }],
    },
  });
});

it("creates a project with advanced sections, evidence, and a gallery upload", async () => {
  const user = setupUser();
  uploadImage.mockResolvedValue({
    image: "https://cdn.example.com/gallery.webp",
    image_width: 1600,
    image_height: 900,
  });
  renderEditor({ isNew: true });

  await fillRequiredProjectFields(user);
  await user.click(screen.getByRole("button", { name: "Add case study" }));

  await pasteInto(user, /Architecture summary/, "Services and workers");
  await user.click(
    screen.getByRole("button", { name: "Add architecture component" }),
  );
  await pasteInto(user, /Architecture component 1 name/, "API");
  await pasteInto(user, /Architecture component 1 role/, "Serve requests");

  await user.click(screen.getByRole("button", { name: "Add key decision" }));
  await pasteInto(user, /Key decision 1 decision/, "Use Postgres");
  await pasteInto(user, /Key decision 1 rationale/, "Durable storage");
  await pasteInto(user, /Key decision 1 tradeoff/, "Operational load");

  await user.click(screen.getByRole("button", { name: "Add challenge" }));
  await pasteInto(user, /Challenge 1 problem/, "Slow reads");
  await pasteInto(user, /Challenge 1 resolution/, "Add indexes");
  await pasteInto(user, /Challenge 1 lesson/, "Measure before tuning");

  await user.click(screen.getByRole("button", { name: "Add outcome" }));
  await user.selectOptions(
    screen.getByLabelText(/Outcome 1 kind/),
    "quantitative",
  );
  await pasteInto(user, /Outcome 1 statement/, "Reduced latency");
  await pasteInto(user, /Outcome 1 metric/, "p95");
  await pasteInto(user, /Outcome 1 value/, "200");
  await pasteInto(user, /Outcome 1 unit/, "ms");
  await user.selectOptions(
    screen.getByLabelText(/Outcome 1 direction/),
    "lower",
  );
  await user.selectOptions(
    screen.getByLabelText(/Outcome 1 evidence status/),
    "verified",
  );
  await pasteInto(
    user,
    /Outcome 1 evidence source/,
    "Production dashboard export",
  );
  await pasteInto(
    user,
    /Outcome 1 evidence URL/,
    "https://example.com/dashboard",
  );

  await user.click(screen.getByRole("button", { name: "Add learning" }));
  await pasteInto(user, /Learning 1/, "Measure first");

  await user.click(screen.getByRole("button", { name: "Add link" }));
  await pasteInto(user, /Link 1 label/, "Live demo");
  await pasteInto(user, /Link 1 URL/, "https://example.com/demo");
  await user.selectOptions(screen.getByLabelText(/Link 1 kind/), "demo");

  await user.click(screen.getByRole("button", { name: "Add gallery image" }));
  await pasteInto(user, /Gallery image 1 alt text/, "Dashboard screenshot");
  await user.upload(
    screen.getByLabelText("Upload image file for gallery image 1"),
    new File(["image"], "gallery.png", { type: "image/png" }),
  );
  await waitFor(() =>
    expect(uploadImage).toHaveBeenCalledTimes(1),
  );
  expect(
    await screen.findByDisplayValue("https://cdn.example.com/gallery.webp"),
  ).toBeInTheDocument();
  expect(await screen.findByText("Image uploaded.")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Create project" }));

  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  const [, body] = post.mock.calls[0];
  expect(body.case_study).toMatchObject({
    schemaVersion: 1,
    architecture: {
      summary: "Services and workers",
      components: [
        { name: "API", role: "Serve requests" },
      ],
    },
    keyDecisions: [
      {
        decision: "Use Postgres",
        rationale: "Durable storage",
        tradeoff: "Operational load",
      },
    ],
    challenges: [
      {
        problem: "Slow reads",
        resolution: "Add indexes",
        lesson: "Measure before tuning",
      },
    ],
    outcomes: [
      {
        kind: "quantitative",
        statement: "Reduced latency",
        metric: "p95",
        value: "200",
        unit: "ms",
        direction: "lower",
        evidence: {
          status: "verified",
          source: "Production dashboard export",
          url: "https://example.com/dashboard",
        },
      },
    ],
    learnings: ["Measure first"],
    links: [
      {
        label: "Live demo",
        url: "https://example.com/demo",
        kind: "demo",
      },
    ],
    gallery: [
      {
        src: "https://cdn.example.com/gallery.webp",
        alt: "Dashboard screenshot",
        width: 1600,
        height: 900,
      },
    ],
  });
});

it("omits an unchanged case study from the update body", async () => {
  const user = setupUser();
  get.mockResolvedValue(
    project({
      case_study: {
        schemaVersion: 1,
        role: "Lead",
        learnings: ["Existing learning"],
      },
    }),
  );

  renderEditor();
  await openProject(user);
  await save(user);

  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  const [, body] = put.mock.calls[0];
  expect(body).not.toHaveProperty("case_study");
});

it("sends a full replacement and preserves advanced sections", async () => {
  const user = setupUser();
  get.mockResolvedValue(
    project({
      case_study: {
        schemaVersion: 1,
        role: "Lead",
        learnings: ["Existing learning"],
      },
    }),
  );

  renderEditor();
  await screen.findByDisplayValue("Lead");
  const role = screen.getByLabelText("Role");
  await user.clear(role);
  await user.type(role, "Principal");
  await save(user);

  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  const [, body] = put.mock.calls[0];
  expect(body.case_study).toEqual({
    schemaVersion: 1,
    role: "Principal",
    learnings: ["Existing learning"],
  });
});

it("removes a saved case study only after confirmation", async () => {
  const user = setupUser();
  get.mockResolvedValue(
    project({ case_study: { schemaVersion: 1, role: "Lead" } }),
  );

  renderEditor();
  await screen.findByDisplayValue("Lead");
  await removeCaseStudy(user);
  expect(
    screen.getByText("No case study is attached to this project."),
  ).toBeInTheDocument();

  await save(user);

  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  const [, body] = put.mock.calls[0];
  expect(body.case_study).toBeNull();
});

it("sends null after removing, adding, and removing a saved case study", async () => {
  const user = setupUser();
  get.mockResolvedValue(
    project({ case_study: { schemaVersion: 1, role: "Lead" } }),
  );

  renderEditor();
  await screen.findByDisplayValue("Lead");
  await removeCaseStudy(user);
  await user.click(screen.getByRole("button", { name: "Add case study" }));
  expect(screen.getByLabelText("Role")).toBeInTheDocument();
  await removeCaseStudy(user);

  await save(user);

  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  const [, body] = put.mock.calls[0];
  expect(body.case_study).toBeNull();
});

it("sends null after removing, adding, and removing an invalid raw case study", async () => {
  const user = setupUser();
  get.mockResolvedValue(
    project({
      case_study: {
        schemaVersion: 2,
        role: "Legacy owner",
        futureField: true,
      },
    }),
  );

  renderEditor();
  await screen.findByText("This stored case study needs repair.");
  await removeCaseStudy(user);
  await user.click(screen.getByRole("button", { name: "Add case study" }));
  expect(screen.getByLabelText("Role")).toBeInTheDocument();
  await removeCaseStudy(user);

  await save(user);

  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  const [, body] = put.mock.calls[0];
  expect(body.case_study).toBeNull();
});

it("omits case_study after adding and removing a new project draft", async () => {
  const user = setupUser();
  renderEditor({ isNew: true });

  await fillRequiredProjectFields(user);
  await user.click(screen.getByRole("button", { name: "Add case study" }));
  await removeCaseStudy(user);
  await user.click(screen.getByRole("button", { name: "Create project" }));

  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  const [, body] = post.mock.calls[0];
  expect(body).not.toHaveProperty("case_study");
});

it("preserves an invalid raw case study when other fields are saved", async () => {
  const user = setupUser();
  get.mockResolvedValue(
    project({
      case_study: {
        schemaVersion: 2,
        role: "Legacy owner",
        futureField: true,
      },
    }),
  );

  renderEditor();
  await screen.findByText("This stored case study needs repair.");
  const title = screen.getByLabelText(/^Title/);
  await user.clear(title);
  await user.type(title, "Atlas updated");
  await save(user);

  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  const [, body] = put.mock.calls[0];
  expect(body.title).toBe("Atlas updated");
  expect(body).not.toHaveProperty("case_study");
});

it("shows stored validation problems before structured recovery", async () => {
  get.mockResolvedValue(
    project({
      case_study: {
        schemaVersion: 2,
        role: "Legacy owner",
        futureField: true,
      },
    }),
  );

  renderEditor();
  await screen.findByText("This stored case study needs repair.");
  expect(
    screen.getByText('case_study has unknown key "futureField".'),
  ).toBeInTheDocument();
  expect(
    screen.getByText("case_study.schemaVersion must be 1."),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/uses schemaVersion 2/),
  ).toBeInTheDocument();
});

it("saves a valid structured replacement for an invalid stored case study", async () => {
  const user = setupUser();
  get.mockResolvedValue(
    project({
      case_study: {
        schemaVersion: 2,
        role: "Legacy owner",
        futureField: true,
      },
    }),
  );

  renderEditor();
  await screen.findByText("This stored case study needs repair.");
  await startStructuredRecovery(user);
  await pasteInto(user, "Role", "Recovered owner");
  await save(user);

  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  const [, body] = put.mock.calls[0];
  expect(body.case_study).toEqual({
    schemaVersion: 1,
    role: "Recovered owner",
  });
});

it("blocks an invalid structured replacement before saving", async () => {
  const user = setupUser();
  get.mockResolvedValue(
    project({
      case_study: {
        schemaVersion: 2,
        role: "Legacy owner",
        futureField: true,
      },
    }),
  );

  renderEditor();
  await screen.findByText("This stored case study needs repair.");
  await startStructuredRecovery(user);
  await save(user);

  expect(put).not.toHaveBeenCalled();
  expect(
    await screen.findByRole("heading", { name: "Case study needs attention" }),
  ).toBeInTheDocument();
  expect(
    screen.getAllByText(/must contain at least one substantive field/).length,
  ).toBeGreaterThan(0);
});

it("preserves an invalid stored case study when recovery is cancelled", async () => {
  const user = setupUser();
  const invalidCaseStudy = {
    schemaVersion: 2,
    role: "Legacy owner",
    futureField: true,
  };
  get.mockResolvedValue(project({ case_study: invalidCaseStudy }));

  renderEditor();
  await screen.findByText("This stored case study needs repair.");
  await startStructuredRecovery(user);
  await pasteInto(user, "Role", "Replacement");
  await user.click(screen.getByRole("button", { name: "Cancel recovery" }));

  expect(
    screen.getByText("This stored case study needs repair."),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Role")).not.toBeInTheDocument();

  await save(user);

  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  const [, body] = put.mock.calls[0];
  expect(body).not.toHaveProperty("case_study");
});

it("sends null after removing an invalid case study from recovery", async () => {
  const user = setupUser();
  get.mockResolvedValue(
    project({
      case_study: {
        schemaVersion: 2,
        role: "Legacy owner",
        futureField: true,
      },
    }),
  );

  renderEditor();
  await screen.findByText("This stored case study needs repair.");
  await startStructuredRecovery(user);
  await removeCaseStudy(user);
  await save(user);

  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  const [, body] = put.mock.calls[0];
  expect(body.case_study).toBeNull();
});

it("saves a valid raw JSON repair as a complete supported document", async () => {
  const user = setupUser();
  get.mockResolvedValue(
    project({
      case_study: {
        schemaVersion: 2,
        role: "Legacy owner",
        futureField: true,
      },
    }),
  );
  const repaired = {
    schemaVersion: 1,
    role: "Repaired owner",
    constraints: ["Recovered from JSON"],
    learnings: ["Untouched supported field"],
  };

  renderEditor();
  await screen.findByText("This stored case study needs repair.");
  await startRawRepair(user);
  await pasteInto(user, "Stored case study JSON", JSON.stringify(repaired));
  await save(user);

  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  const [, body] = put.mock.calls[0];
  expect(body.case_study).toEqual(repaired);
});

it("blocks invalid raw JSON repairs before saving", async () => {
  const user = setupUser();
  get.mockResolvedValue(
    project({
      case_study: {
        schemaVersion: 2,
        role: "Legacy owner",
        futureField: true,
      },
    }),
  );

  renderEditor();
  await screen.findByText("This stored case study needs repair.");
  await startRawRepair(user);
  await pasteInto(user, "Stored case study JSON", "{not json");
  await save(user);

  expect(put).not.toHaveBeenCalled();
  expect(screen.getByText(/JSON syntax error:/)).toBeInTheDocument();
  expect(
    await screen.findByRole("heading", { name: "Case study needs attention" }),
  ).toBeInTheDocument();
});

it("blocks a raw JSON repair with unsupported properties", async () => {
  const user = setupUser();
  get.mockResolvedValue(
    project({
      case_study: {
        schemaVersion: 2,
        role: "Legacy owner",
        futureField: true,
      },
    }),
  );

  renderEditor();
  await screen.findByText("This stored case study needs repair.");
  await startRawRepair(user);
  await pasteInto(
    user,
    "Stored case study JSON",
    JSON.stringify({ schemaVersion: 1, role: "Repaired", futureField: true }),
  );
  await save(user);

  expect(put).not.toHaveBeenCalled();
  const payloadError = screen.getByText(
    "The JSON parses, but the case study payload is invalid.",
  );
  expect(
    within(payloadError.closest("div")).getByText(
      'case_study has unknown key "futureField".',
    ),
  ).toBeInTheDocument();
});

it("omits an untouched invalid raw case study after opening raw repair", async () => {
  const user = setupUser();
  get.mockResolvedValue(
    project({
      case_study: {
        schemaVersion: 2,
        role: "Legacy owner",
        futureField: true,
      },
    }),
  );

  renderEditor();
  await screen.findByText("This stored case study needs repair.");
  await startRawRepair(user);
  const title = screen.getByLabelText(/^Title/);
  await user.clear(title);
  await user.paste("Atlas updated");
  await save(user);

  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  const [, body] = put.mock.calls[0];
  expect(body.title).toBe("Atlas updated");
  expect(body).not.toHaveProperty("case_study");
});

it("sends null after removing an invalid case study from raw repair", async () => {
  const user = setupUser();
  get.mockResolvedValue(
    project({
      case_study: {
        schemaVersion: 2,
        role: "Legacy owner",
        futureField: true,
      },
    }),
  );

  renderEditor();
  await screen.findByText("This stored case study needs repair.");
  await startRawRepair(user);
  await pasteInto(
    user,
    "Stored case study JSON",
    JSON.stringify({ schemaVersion: 1, role: "Repaired" }),
  );
  await removeCaseStudy(user);
  await save(user);

  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  const [, body] = put.mock.calls[0];
  expect(body.case_study).toBeNull();
});

it("blocks an added but empty case study and shows the error summary", async () => {
  const user = setupUser();
  renderEditor();
  await openProject(user);

  await user.click(screen.getByRole("button", { name: "Add case study" }));
  await save(user);

  expect(put).not.toHaveBeenCalled();
  expect(
    await screen.findByRole("heading", { name: "Case study needs attention" }),
  ).toBeInTheDocument();
  expect(
    screen.getAllByText(/must contain at least one substantive field/).length,
  ).toBeGreaterThan(0);
});

it("validates a case-study field on blur", async () => {
  const user = setupUser();
  renderEditor();
  await openProject(user);

  await user.click(screen.getByRole("button", { name: "Add case study" }));
  await user.type(screen.getByLabelText("Problem context"), "Manual triage");
  await user.click(screen.getByLabelText("Problem summary"));
  await user.tab();

  expect(
    (await screen.findAllByText("must be a non-empty string.")).length,
  ).toBeGreaterThan(0);
  expect(
    screen.getByRole("heading", { name: "Case study needs attention" }),
  ).toBeInTheDocument();
  expect(put).not.toHaveBeenCalled();
});

it("shows the timeline relationship error when the start field blurs", async () => {
  const user = setupUser();
  renderEditor();
  await openProject(user);

  await user.click(screen.getByRole("button", { name: "Add case study" }));
  await enterInvalidTimeline(user);
  const start = screen.getByLabelText("Timeline start");
  await user.click(start);
  await user.tab();

  expect(
    (await screen.findAllByText(/must be on or before/)).length,
  ).toBeGreaterThan(0);
  expect(start).toHaveAttribute("aria-invalid", "true");
  expect(start).toHaveAttribute(
    "aria-describedby",
    "case-study-timeline-start-error",
  );
  const end = screen.getByLabelText("Timeline end");
  expect(end).toHaveAttribute("aria-invalid", "true");
  expect(end).toHaveAttribute(
    "aria-describedby",
    "case-study-timeline-end-error",
  );
});

it("shows the timeline relationship error when the end field blurs", async () => {
  const user = setupUser();
  renderEditor();
  await openProject(user);

  await user.click(screen.getByRole("button", { name: "Add case study" }));
  await enterInvalidTimeline(user);
  await user.tab();

  expect(
    (await screen.findAllByText(/must be on or before/)).length,
  ).toBeGreaterThan(0);
  expect(screen.getByLabelText("Timeline start")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(screen.getByLabelText("Timeline end")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

it("clears the timeline relationship error after correcting the dates", async () => {
  const user = setupUser();
  renderEditor();
  await openProject(user);

  await user.click(screen.getByRole("button", { name: "Add case study" }));
  await enterInvalidTimeline(user);
  await user.tab();
  expect(
    (await screen.findAllByText(/must be on or before/)).length,
  ).toBeGreaterThan(0);

  const end = screen.getByLabelText("Timeline end");
  await user.clear(end);
  await user.type(end, "2026-02");
  await user.tab();

  expect(screen.queryByText(/must be on or before/)).not.toBeInTheDocument();
  expect(screen.getByLabelText("Timeline start")).not.toHaveAttribute(
    "aria-invalid",
  );
  expect(end).not.toHaveAttribute("aria-invalid");
  expect(screen.getByLabelText("Timeline start")).toHaveAttribute(
    "aria-describedby",
    "case-study-timeline-start-hint",
  );
  expect(end).toHaveAttribute(
    "aria-describedby",
    "case-study-timeline-end-hint",
  );
});

it("blocks submit when the timeline relationship is invalid", async () => {
  const user = setupUser();
  renderEditor();
  await openProject(user);

  await user.click(screen.getByRole("button", { name: "Add case study" }));
  await enterInvalidTimeline(user);
  await save(user);

  expect(put).not.toHaveBeenCalled();
  expect(
    await screen.findByRole("heading", { name: "Case study needs attention" }),
  ).toBeInTheDocument();
  expect(
    screen.getAllByText(/must be on or before/).length,
  ).toBeGreaterThan(0);
  expect(screen.getByLabelText("Timeline start")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(
    screen.getByRole("alert", { name: "Case study needs attention" }),
  ).toHaveFocus();
});

it("shows server case-study errors in the editor and summary", async () => {
  const user = setupUser();
  get.mockResolvedValue(
    project({ case_study: { schemaVersion: 1, role: "Lead" } }),
  );
  put.mockRejectedValue(
    new ApiError(422, {
      code: "VALIDATION_ERROR",
      message: "Request validation failed.",
      fields: [
        { field: "case_study.role", message: "Role cannot be used." },
      ],
    }),
  );

  renderEditor();
  await screen.findByDisplayValue("Lead");
  await save(user);

  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  expect(
    (await screen.findAllByText("Role cannot be used.")).length,
  ).toBeGreaterThan(0);
  expect(
    screen.getByRole("heading", { name: "Case study needs attention" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Role")).toHaveAttribute("aria-invalid", "true");
  expect(
    screen.getByRole("alert", { name: "Case study needs attention" }),
  ).toHaveFocus();
});

it("shows mixed validation when a client error joins an untouched server error", async () => {
  const user = setupUser();
  get.mockResolvedValue(
    project({
      case_study: {
        schemaVersion: 1,
        role: "Lead",
        timeline: {
          label: "Build",
          start: "2024-01",
          end: "2025-01",
          duration: "1 year",
        },
      },
    }),
  );
  put.mockRejectedValue(
    new ApiError(422, {
      code: "VALIDATION_ERROR",
      message: "Request validation failed.",
      fields: [
        { field: "case_study.role", message: "Role rejected." },
        { field: "case_study.timeline.start", message: "Start rejected." },
      ],
    }),
  );

  renderEditor();
  await screen.findByDisplayValue("Lead");
  await save(user);

  const summary = await screen.findByRole("alert", {
    name: "Case study needs attention",
  });
  expect(within(summary).getByText("Server validation")).toBeInTheDocument();
  expect(within(summary).getByText("Start rejected.")).toBeInTheDocument();

  await pasteInto(user, "Timeline end", "2023-01");
  await user.tab();

  expect(within(summary).getByText("Mixed validation")).toBeInTheDocument();
  expect(within(summary).getByText("Role rejected.")).toBeInTheDocument();
  expect(within(summary).getAllByText(/must be on or before/i).length).toBeGreaterThan(0);

  await pasteInto(user, "Role", "Replacement lead");
  await user.tab();

  expect(within(summary).getByText("Client validation")).toBeInTheDocument();
  expect(within(summary).queryByText("Role rejected.")).not.toBeInTheDocument();
});

it("replaces error sources after an edited field is revalidated and saved", async () => {
  const user = setupUser();
  get.mockResolvedValue(
    project({ case_study: { schemaVersion: 1, role: "Lead" } }),
  );
  const serverRejection = () =>
    new ApiError(422, {
      code: "VALIDATION_ERROR",
      message: "Request validation failed.",
      fields: [{ field: "case_study.role", message: "Role cannot be used." }],
    });
  put.mockRejectedValueOnce(serverRejection()).mockRejectedValueOnce(serverRejection());

  renderEditor();
  await screen.findByDisplayValue("Lead");
  await save(user);

  const firstSummary = await screen.findByRole("alert", {
    name: "Case study needs attention",
  });
  expect(within(firstSummary).getByText("Server validation")).toBeInTheDocument();

  await pasteInto(user, "Role", "Replacement lead");
  await user.tab();

  await waitFor(() => {
    expect(
      screen.queryByRole("alert", { name: "Case study needs attention" }),
    ).not.toBeInTheDocument();
  });

  await save(user);

  const secondSummary = await screen.findByRole("alert", {
    name: "Case study needs attention",
  });
  expect(within(secondSummary).getByText("Server validation")).toBeInTheDocument();
  expect(
    within(secondSummary).getByText("Role cannot be used."),
  ).toBeInTheDocument();
  await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
});

it("maps nested server paths to the matching case-study field", async () => {
  const user = setupUser();
  get.mockResolvedValue(
    project({
      case_study: {
        schemaVersion: 1,
        role: "Lead",
        keyDecisions: [
          {
            decision: "Use Postgres",
            rationale: "Durable storage",
            tradeoff: "Operational load",
          },
        ],
      },
    }),
  );
  put.mockRejectedValue(
    new ApiError(422, {
      code: "VALIDATION_ERROR",
      message: "Request validation failed.",
      fields: [
        {
          field: "case_study.keyDecisions[0].decision",
          message: "Decision cannot be used.",
        },
      ],
    }),
  );

  renderEditor();
  await screen.findByDisplayValue("Use Postgres");
  await save(user);

  const summary = await screen.findByRole("alert", {
    name: "Case study needs attention",
  });
  expect(
    within(summary).getByRole("link", {
      name: /Key decision 1 decision/,
    }),
  ).toHaveAttribute("href", "#case-study-keyDecisions-0-decision");
  expect(
    within(summary).getByText("case_study.keyDecisions.0.decision"),
  ).toBeInTheDocument();
  expect(
    document.getElementById("case-study-keyDecisions-0-decision"),
  ).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByText("Server validation")).toBeInTheDocument();
});

it("maps root, schema and unknown server errors to the case-study heading", async () => {
  const user = setupUser();
  get.mockResolvedValue(
    project({ case_study: { schemaVersion: 1, role: "Lead" } }),
  );
  put.mockRejectedValue(
    new ApiError(422, {
      code: "VALIDATION_ERROR",
      message: "Request validation failed.",
      fields: [
        { field: "case_study", message: "Case study data is invalid." },
        {
          field: "case_study.schemaVersion",
          message: "Unsupported schema version.",
        },
        {
          field: "case_study.futureField",
          message: "Unknown field rejected.",
        },
      ],
    }),
  );

  renderEditor();
  await screen.findByDisplayValue("Lead");
  await save(user);

  const summary = await screen.findByRole("alert", {
    name: "Case study needs attention",
  });
  const links = within(summary).getAllByRole("link");
  expect(links).toHaveLength(3);
  for (const link of links) {
    expect(link).toHaveAttribute("href", "#case-study-heading");
  }
  expect(
    within(summary).getByText("Case study data is invalid."),
  ).toBeInTheDocument();
  expect(
    within(summary).getByText("Unsupported schema version."),
  ).toBeInTheDocument();
  expect(
    within(summary).getByText("Unknown field rejected."),
  ).toBeInTheDocument();
});

it("validates the project image on blur and clears the error once it is valid", async () => {
  const user = setupUser();
  get.mockResolvedValue(project());

  renderEditor();
  await openProject(user);

  const image = screen.getByLabelText(/Image path/);
  await user.clear(image);
  await user.paste("not-an-image");
  expect(
    screen.queryByText(/Upload an image, or use a path like/),
  ).not.toBeInTheDocument();

  await user.tab();
  expect(
    await screen.findByText(/Upload an image, or use a path like/),
  ).toBeInTheDocument();
  expect(image).toHaveAttribute("aria-invalid", "true");

  await user.clear(image);
  await user.paste("/images/projects/corrected.webp");
  await waitFor(() =>
    expect(
      screen.queryByText(/Upload an image, or use a path like/),
    ).not.toBeInTheDocument(),
  );
  expect(image).not.toHaveAttribute("aria-invalid", "true");
});

it("clears a server image error as soon as a valid path replaces it", async () => {
  const user = setupUser();
  get.mockResolvedValue(project());
  put.mockRejectedValue(
    new ApiError(422, {
      code: "VALIDATION_ERROR",
      message: "Request validation failed.",
      fields: [{ field: "image", message: "Image path is not allowed." }],
    }),
  );

  renderEditor();
  await openProject(user);
  await save(user);

  expect(
    await screen.findByText("Image path is not allowed."),
  ).toBeInTheDocument();

  const image = screen.getByLabelText(/Image path/);
  await user.clear(image);
  await user.paste("/images/projects/corrected.webp");
  await waitFor(() =>
    expect(
      screen.queryByText("Image path is not allowed."),
    ).not.toBeInTheDocument(),
  );
});

it("does not focus the error summary during ordinary case-study editing", async () => {
  const user = setupUser();
  renderEditor();
  await openProject(user);

  await user.click(screen.getByRole("button", { name: "Add case study" }));
  const role = screen.getByLabelText("Role");
  role.focus();
  await user.type(role, "Lead");

  expect(role).toHaveFocus();
  expect(
    screen.queryByRole("alert", { name: "Case study needs attention" }),
  ).not.toBeInTheDocument();
});

it("creates a project without a case_study key when none was added", async () => {
  const user = setupUser();
  renderEditor({ isNew: true });

  await fillRequiredProjectFields(user);
  await user.click(screen.getByRole("button", { name: "Create project" }));

  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(post.mock.calls[0][0]).toBe("/projects");
  expect(post.mock.calls[0][1]).not.toHaveProperty("case_study");
});

it("clears a server case-study error when the field is edited", async () => {
  const user = setupUser();
  get.mockResolvedValue(
    project({ case_study: { schemaVersion: 1, role: "Lead" } }),
  );
  put.mockRejectedValue(
    new ApiError(422, {
      code: "VALIDATION_ERROR",
      message: "Request validation failed.",
      fields: [{ field: "case_study.role", message: "Role rejected." }],
    }),
  );

  renderEditor();
  await screen.findByDisplayValue("Lead");
  await save(user);

  await waitFor(() =>
    expect(screen.getAllByText("Role rejected.").length).toBeGreaterThan(0),
  );

  const role = screen.getByLabelText("Role");
  await user.clear(role);
  await user.paste("Lead engineer");

  await waitFor(() =>
    expect(screen.queryByText("Role rejected.")).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByRole("alert", { name: "Case study needs attention" }),
  ).not.toBeInTheDocument();
  expect(role).not.toHaveAttribute("aria-invalid", "true");
});

it("normalizes camelCase and malformed server paths in the summary", async () => {
  const user = setupUser();
  get.mockResolvedValue(
    project({
      case_study: {
        schemaVersion: 1,
        role: "Lead",
        keyDecisions: [
          {
            decision: "Use Postgres",
            rationale: "Durable storage",
            tradeoff: "Operational load",
          },
        ],
      },
    }),
  );
  put.mockRejectedValue(
    new ApiError(422, {
      code: "VALIDATION_ERROR",
      message: "Request validation failed.",
      fields: [
        {
          field: "caseStudy.keyDecisions[0].decision",
          message: "Decision rejected.",
        },
        { field: "case_study..role", message: "Role rejected." },
      ],
    }),
  );

  renderEditor();
  await screen.findByDisplayValue("Use Postgres");
  await save(user);

  const summary = await screen.findByRole("alert", {
    name: "Case study needs attention",
  });
  await waitFor(() => {
    expect(
      within(summary).getByRole("link", { name: /Key decision 1 decision/ }),
    ).toHaveAttribute("href", "#case-study-keyDecisions-0-decision");
    expect(within(summary).getByText("case_study.role")).toBeInTheDocument();
  });
  expect(
    document.getElementById("case-study-keyDecisions-0-decision"),
  ).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Role")).toHaveAttribute("aria-invalid", "true");
});

it("sends If-Unmodified-Since and keeps the draft after a stale write", async () => {
  const user = setupUser();
  const updatedAt = "2026-01-02T03:04:05.000Z";
  get.mockResolvedValue(project({ updated_at: updatedAt }));
  put.mockRejectedValue(
    new ApiError(409, { code: "STALE_WRITE", message: "Version conflict." }),
  );

  renderEditor();
  await openProject(user);
  await save(user);

  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  expect(put.mock.calls[0][2]).toEqual({
    ifUnmodifiedSince: new Date(updatedAt).toUTCString(),
  });
  expect(await screen.findByText(/changed elsewhere/)).toBeInTheDocument();
  expect(screen.getByDisplayValue("Atlas")).toBeInTheDocument();
});

it("shows a field-level upload error instead of the envelope message", async () => {
  const user = setupUser();
  get.mockResolvedValue(project());
  uploadImage.mockRejectedValue(
    new ApiError(422, {
      code: "VALIDATION_ERROR",
      message: "Request validation failed.",
      fields: [{ field: "image", message: "Upload rejected." }],
    }),
  );

  renderEditor();
  await openProject(user);
  await user.upload(
    screen.getByLabelText("Upload image file"),
    new File(["image"], "bad.png", { type: "image/png" }),
  );

  expect(await screen.findByText("Upload rejected.")).toBeInTheDocument();
  expect(
    screen.queryByText("Request validation failed."),
  ).not.toBeInTheDocument();
});

it("fills image dimensions when the browser reports them", async () => {
  const user = setupUser();
  vi.stubGlobal(
    "Image",
    class {
      set src(_value) {
        this.onload?.();
      }
      get naturalWidth() {
        return 1234;
      }
      get naturalHeight() {
        return 567;
      }
    },
  );

  renderEditor();
  await openProject(user);

  const image = screen.getByLabelText(/Image path/);
  await user.clear(image);
  await user.paste("https://cdn.example.com/new.webp");

  expect(await screen.findByDisplayValue("1234")).toBeInTheDocument();
  expect(screen.getByLabelText(/Image width/)).toHaveDisplayValue("1234");
  expect(screen.getByLabelText(/Image height/)).toHaveDisplayValue("567");
});
