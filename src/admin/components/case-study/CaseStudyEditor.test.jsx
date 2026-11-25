import { createRef, useState } from "react";
import {
  act,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import {
  buildCaseStudyPayload,
  initCaseStudyDraft,
} from "../../lib/caseStudy.js";
import CaseStudyEditor from "./CaseStudyEditor.jsx";

function setupUser() {
  return userEvent.setup({ delay: null });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function payloadForDraft(value, baseline = null) {
  return buildCaseStudyPayload({
    draft: {
      mode: "structured",
      baseline,
      touched: true,
      value,
    },
    isEditing: true,
  });
}

function Harness({
  initial = null,
  errors = {},
  errorSource = null,
  errorSummaryRef,
  onUploadImage,
  onClearPath = () => {},
}) {
  const [draft, setDraft] = useState(() => initCaseStudyDraft(initial));

  return (
    <>
      <CaseStudyEditor
        draft={draft}
        onChange={setDraft}
        errors={errors}
        errorSource={errorSource}
        errorSummaryRef={errorSummaryRef}
        onBlurPath={() => {}}
        onClearPath={onClearPath}
        onUploadImage={onUploadImage}
      />
      <output data-testid="draft-value">{JSON.stringify(draft.value)}</output>
      <output data-testid="draft-row-ids">{JSON.stringify(draft.rowIds)}</output>
    </>
  );
}

function draftValue() {
  return JSON.parse(screen.getByTestId("draft-value").textContent);
}

function draftRowIds() {
  return JSON.parse(screen.getByTestId("draft-row-ids").textContent);
}

it("adds an absent case study as an empty structured draft", async () => {
  const user = setupUser();
  render(<Harness />);

  expect(
    screen.getByText("No case study is attached to this project."),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Role")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Add case study" }));

  expect(screen.getByLabelText("Role")).toBeInTheDocument();
  expect(screen.getByText("Edit the case study sections below.")).toBeInTheDocument();
  expect(draftValue()).toEqual({ schemaVersion: 1 });
});

it("preserves invalid stored content and only removes it after confirmation", async () => {
  const user = setupUser();
  render(
    <Harness
      initial={{ schemaVersion: 2, role: "Legacy owner", futureField: true }}
    />,
  );

  expect(screen.getByText("This stored case study needs repair.")).toBeInTheDocument();
  expect(screen.getByText(/uses schemaVersion 2/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Role")).not.toBeInTheDocument();
  expect(draftValue()).toEqual({
    schemaVersion: 2,
    role: "Legacy owner",
    futureField: true,
  });

  await user.click(screen.getByRole("button", { name: "Remove case study" }));
  const dialog = screen.getByRole("alertdialog");
  expect(within(dialog).getByText("Remove case study?")).toBeInTheDocument();
  await user.click(
    within(dialog).getByRole("button", { name: "Remove case study" }),
  );

  expect(
    screen.getByText("No case study is attached to this project."),
  ).toBeInTheDocument();
  expect(draftValue()).toBeNull();
});

it("shows stored validation problems and opens structured recovery", async () => {
  const user = setupUser();
  render(
    <Harness
      initial={{ schemaVersion: 2, role: "Legacy owner", futureField: true }}
    />,
  );

  expect(
    screen.getByText('case_study has unknown key "futureField".'),
  ).toBeInTheDocument();
  expect(
    screen.getByText("case_study.schemaVersion must be 1."),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Role")).not.toBeInTheDocument();

  await user.click(
    screen.getByRole("button", { name: "Create structured replacement" }),
  );

  expect(screen.getByLabelText("Role")).toHaveValue("");
  expect(
    screen.getByText("Create a valid replacement for the stored case study."),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Cancel recovery" }),
  ).toBeInTheDocument();
  expect(draftValue()).toEqual({ schemaVersion: 1 });
});

it("cancels structured recovery and restores the invalid stored document", async () => {
  const user = setupUser();
  const initial = {
    schemaVersion: 2,
    role: "Legacy owner",
    futureField: true,
  };
  render(<Harness initial={initial} />);

  await user.click(
    screen.getByRole("button", { name: "Create structured replacement" }),
  );
  await user.type(screen.getByLabelText("Role"), "Replacement");
  expect(draftValue()).toEqual({ schemaVersion: 1, role: "Replacement" });

  await user.click(screen.getByRole("button", { name: "Cancel recovery" }));

  expect(
    screen.getByText("This stored case study needs repair."),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Role")).not.toBeInTheDocument();
  expect(draftValue()).toEqual(initial);
});

it("repairs the original JSON and transfers a valid document to structured editing", async () => {
  const user = setupUser();
  const original = {
    schemaVersion: 2,
    role: "Legacy owner",
    futureField: true,
  };
  const repaired = {
    schemaVersion: 1,
    role: "Repaired owner",
    constraints: ["Recovered from JSON"],
    learnings: ["Untouched supported field"],
  };
  render(<Harness initial={original} />);

  await user.click(
    screen.getByRole("button", { name: "Repair existing JSON" }),
  );
  const raw = screen.getByLabelText("Stored case study JSON");
  expect(raw).toHaveValue(JSON.stringify(original, null, 2));
  expect(raw).toHaveFocus();
  expect(
    screen.getByRole("button", { name: "Use structured editor" }),
  ).toBeDisabled();

  await user.clear(raw);
  await user.paste(JSON.stringify(repaired));
  expect(raw).not.toHaveAttribute("aria-invalid");
  expect(
    screen.getByRole("button", { name: "Use structured editor" }),
  ).toBeEnabled();

  await user.click(
    screen.getByRole("button", { name: "Use structured editor" }),
  );
  expect(screen.getByLabelText("Role")).toHaveValue("Repaired owner");
  expect(screen.getByLabelText("Role")).toHaveFocus();
  expect(draftValue()).toEqual(repaired);
});

it("distinguishes raw JSON syntax errors from payload validation errors", async () => {
  const user = setupUser();
  render(
    <Harness
      initial={{ schemaVersion: 2, role: "Legacy owner", futureField: true }}
    />,
  );

  await user.click(
    screen.getByRole("button", { name: "Repair existing JSON" }),
  );
  const raw = screen.getByLabelText("Stored case study JSON");
  const useStructured = screen.getByRole("button", {
    name: "Use structured editor",
  });

  await user.clear(raw);
  await user.paste("{not json");
  expect(screen.getByText(/JSON syntax error:/)).toBeInTheDocument();
  expect(raw).toHaveAttribute("aria-invalid", "true");
  expect(useStructured).toBeDisabled();

  await user.clear(raw);
  await user.paste(
    JSON.stringify({ schemaVersion: 2, role: "Legacy owner" }),
  );
  const payloadError = screen.getByText(
    "The JSON parses, but the case study payload is invalid.",
  );
  expect(payloadError).toBeInTheDocument();
  expect(
    within(payloadError.closest("div")).getByText(
      "case_study.schemaVersion must be 1.",
    ),
  ).toBeInTheDocument();
  expect(useStructured).toBeDisabled();
});

it("cancels raw repair by restoring the original JSON and focus", async () => {
  const user = setupUser();
  const original = {
    schemaVersion: 2,
    role: "Legacy owner",
    futureField: true,
  };
  render(<Harness initial={original} />);

  const repairButton = screen.getByRole("button", {
    name: "Repair existing JSON",
  });
  await user.click(repairButton);
  const raw = screen.getByLabelText("Stored case study JSON");
  await user.clear(raw);
  await user.paste(JSON.stringify({ schemaVersion: 1, role: "Edited" }));

  await user.click(
    screen.getByRole("button", { name: "Cancel repair" }),
  );
  expect(
    screen.queryByLabelText("Stored case study JSON"),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Repair existing JSON" }),
  ).toHaveFocus();
  expect(draftValue()).toEqual(original);
});

it("keeps repaired raw JSON when switching to replacement and back", async () => {
  const user = setupUser();
  const repaired = JSON.stringify({
    schemaVersion: 1,
    role: "Repaired before switch",
  });
  render(
    <Harness
      initial={{ schemaVersion: 2, role: "Legacy owner", futureField: true }}
    />,
  );

  await user.click(
    screen.getByRole("button", { name: "Repair existing JSON" }),
  );
  const raw = screen.getByLabelText("Stored case study JSON");
  await user.clear(raw);
  await user.paste(repaired);

  await user.click(
    screen.getByRole("button", { name: "Create structured replacement" }),
  );
  expect(screen.getByLabelText("Role")).toHaveValue("");

  await user.click(
    screen.getByRole("button", { name: "Cancel recovery" }),
  );
  expect(screen.getByLabelText("Stored case study JSON")).toHaveValue(repaired);
  expect(
    screen.getByRole("button", { name: "Use structured editor" }),
  ).toBeEnabled();
});

it("edits advanced sections while keeping the rest of the document", async () => {
  const user = setupUser();
  render(
    <Harness
      initial={{
        schemaVersion: 1,
        role: "Lead",
        learnings: ["Existing learning"],
      }}
    />,
  );

  expect(screen.getByLabelText(/Learning 1/)).toHaveValue("Existing learning");

  const role = screen.getByLabelText("Role");
  await user.clear(role);
  await user.type(role, "Principal");
  const learning = screen.getByLabelText(/Learning 1/);
  await user.clear(learning);
  await user.type(learning, "Measure first");

  expect(draftValue()).toMatchObject({
    role: "Principal",
    learnings: ["Measure first"],
  });
});

it("adds, reorders, and bounds repeatable rows", async () => {
  const user = setupUser();
  render(<Harness initial={{ schemaVersion: 1, role: "Lead" }} />);

  const addRole = screen.getByRole("button", { name: "Add team role" });
  for (let index = 0; index < 10; index += 1) {
    await user.click(addRole);
  }
  expect(addRole).toBeDisabled();
  expect(screen.getAllByLabelText(/Team role \d+/)).toHaveLength(10);
  expect(draftRowIds().roles).toHaveLength(10);
  expect(new Set(draftRowIds().roles).size).toBe(10);

  await user.click(screen.getByRole("button", { name: "Add approach step" }));
  await user.click(screen.getByRole("button", { name: "Add approach step" }));
  const approachIds = draftRowIds().approach;
  expect(approachIds).toHaveLength(2);
  expect(new Set(approachIds).size).toBe(2);

  await user.type(screen.getByLabelText(/Approach step 1 heading/), "First");
  await user.type(screen.getByLabelText(/Approach step 1 body/), "First body");
  await user.type(screen.getByLabelText(/Approach step 2 heading/), "Second");
  await user.type(screen.getByLabelText(/Approach step 2 body/), "Second body");

  await user.click(
    screen.getByRole("button", { name: "Move approach step 2 up" }),
  );

  expect(draftRowIds().approach).toEqual([approachIds[1], approachIds[0]]);
  expect(screen.getByLabelText(/Approach step 1 heading/)).toHaveValue("Second");
  expect(screen.getByLabelText(/Approach step 2 heading/)).toHaveValue("First");
});

it("keeps stable row identities when removing a middle row", async () => {
  const user = setupUser();
  render(
    <Harness
      initial={{
        schemaVersion: 1,
        role: "Lead",
        constraints: ["One", "Two", "Three"],
      }}
    />,
  );

  const third = screen.getByLabelText(/Constraint 3/);
  const constraintIds = draftRowIds().constraints;
  await user.click(screen.getByRole("button", { name: "Remove constraint 2" }));

  expect(draftRowIds().constraints).toEqual([
    constraintIds[0],
    constraintIds[2],
  ]);
  expect(screen.getByLabelText(/Constraint 2/)).toBe(third);
  expect(third).toHaveValue("Three");
  expect(screen.getByLabelText(/Constraint 1/)).toHaveValue("One");

  await user.click(screen.getByRole("button", { name: "Remove constraint 2" }));
  expect(screen.getAllByLabelText(/Constraint \d+/)).toHaveLength(1);
  expect(screen.getByLabelText(/Constraint 1/)).toHaveValue("One");
});

it("keeps row identity and focus when moving a row", async () => {
  const user = setupUser();
  render(
    <Harness
      initial={{
        schemaVersion: 1,
        role: "Lead",
        approach: [
          { heading: "First", body: "First body" },
          { heading: "Second", body: "Second body" },
          { heading: "Third", body: "Third body" },
        ],
      }}
    />,
  );

  const secondHeading = screen.getByLabelText(/Approach step 2 heading/);
  const moveUp = screen.getByRole("button", {
    name: "Move approach step 2 up",
  });
  await user.click(moveUp);

  expect(screen.getByLabelText(/Approach step 1 heading/)).toBe(secondHeading);
  expect(secondHeading).toHaveValue("Second");
  expect(moveUp).toHaveFocus();
  expect(screen.getByRole("button", { name: "Move approach step 1 up" })).toBe(
    moveUp,
  );

  await user.click(
    screen.getByRole("button", { name: "Move approach step 1 down" }),
  );
  expect(screen.getByLabelText(/Approach step 2 heading/)).toBe(secondHeading);
  expect(screen.getByLabelText(/Approach step 1 heading/)).toHaveValue("First");
});

it("edits architecture components and an optional diagram", async () => {
  const user = setupUser();
  render(<Harness initial={{ schemaVersion: 1, role: "Lead" }} />);

  await user.type(screen.getByLabelText(/Architecture summary/), "Services");
  await user.click(
    screen.getByRole("button", { name: "Add architecture component" }),
  );
  await user.type(
    screen.getByLabelText(/Architecture component 1 name/),
    "API",
  );
  await user.type(
    screen.getByLabelText(/Architecture component 1 role/),
    "Serve requests",
  );
  await user.type(
    screen.getByLabelText(/Architecture component 1 technology/),
    "FastAPI",
  );

  await user.click(
    screen.getByRole("button", { name: "Add architecture diagram" }),
  );
  await user.type(
    screen.getByLabelText(/Architecture diagram source/),
    "/images/projects/architecture.webp",
  );
  await user.type(
    screen.getByLabelText(/Architecture diagram alt text/),
    "Architecture overview",
  );
  await user.type(
    screen.getByLabelText(/Architecture diagram width/),
    "1600",
  );
  await user.type(
    screen.getByLabelText(/Architecture diagram height/),
    "900",
  );

  expect(draftValue()).toMatchObject({
    architecture: {
      summary: "Services",
      components: [
        { name: "API", role: "Serve requests", technology: "FastAPI" },
      ],
      diagram: {
        src: "/images/projects/architecture.webp",
        alt: "Architecture overview",
        width: 1600,
        height: 900,
      },
    },
  });
  expect(draftRowIds().architectureComponents).toHaveLength(1);

  await user.click(
    screen.getByRole("button", { name: "Remove architecture diagram" }),
  );
  expect(draftValue().architecture.diagram).toBeNull();
});

it("reorders key decisions and challenges with stable row identities", async () => {
  const user = setupUser();
  render(
    <Harness
      initial={{
        schemaVersion: 1,
        keyDecisions: [
          { decision: "First", rationale: "First rationale" },
          { decision: "Second", rationale: "Second rationale" },
        ],
        challenges: [
          { problem: "First problem", resolution: "First resolution" },
          { problem: "Second problem", resolution: "Second resolution" },
        ],
      }}
    />,
  );

  const decisionIds = draftRowIds().keyDecisions;
  await user.click(
    screen.getByRole("button", { name: "Move key decision 2 up" }),
  );
  expect(draftRowIds().keyDecisions).toEqual([
    decisionIds[1],
    decisionIds[0],
  ]);
  expect(screen.getByLabelText(/Key decision 1 decision/)).toHaveValue(
    "Second",
  );

  const challengeIds = draftRowIds().challenges;
  await user.click(
    screen.getByRole("button", { name: "Move challenge 2 up" }),
  );
  expect(draftRowIds().challenges).toEqual([
    challengeIds[1],
    challengeIds[0],
  ]);
  expect(screen.getByLabelText(/Challenge 1 problem/)).toHaveValue(
    "Second problem",
  );

  await user.click(
    screen.getByRole("button", { name: "Remove key decision 2" }),
  );
  expect(draftValue().keyDecisions).toEqual([
    { decision: "Second", rationale: "Second rationale" },
  ]);
  expect(draftRowIds().keyDecisions).toEqual([decisionIds[1]]);

  await user.click(
    screen.getByRole("button", { name: "Remove challenge 2" }),
  );
  expect(draftValue().challenges).toEqual([
    {
      problem: "Second problem",
      resolution: "Second resolution",
    },
  ]);
  expect(draftRowIds().challenges).toEqual([challengeIds[1]]);
});

it("captures quantitative outcomes with evidence", async () => {
  const user = setupUser();
  render(<Harness initial={{ schemaVersion: 1, role: "Lead" }} />);

  await user.click(screen.getByRole("button", { name: "Add outcome" }));
  expect(screen.getByRole("button", { name: "Remove outcome 1" })).toBeInTheDocument();

  await user.selectOptions(
    screen.getByLabelText(/Outcome 1 kind/),
    "quantitative",
  );
  await user.type(
    screen.getByLabelText(/Outcome 1 statement/),
    "Reduced latency",
  );
  await user.type(screen.getByLabelText(/Outcome 1 metric/), "p95");
  await user.type(screen.getByLabelText(/Outcome 1 value/), "200");
  await user.type(screen.getByLabelText(/Outcome 1 unit/), "ms");
  await user.selectOptions(
    screen.getByLabelText(/Outcome 1 direction/),
    "lower",
  );
  await user.selectOptions(
    screen.getByLabelText(/Outcome 1 evidence status/),
    "verified",
  );
  await user.type(
    screen.getByLabelText(/Outcome 1 evidence source/),
    "Production dashboard export",
  );
  await user.type(
    screen.getByLabelText(/Outcome 1 evidence URL/),
    "https://example.com/dashboard",
  );

  expect(draftValue().outcomes[0]).toMatchObject({
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
  });
});

it("adds optional evidence to a qualitative outcome and removes it", async () => {
  const user = setupUser();
  render(
    <Harness
      initial={{
        schemaVersion: 1,
        outcomes: [
          { kind: "qualitative", statement: "Faster feedback" },
        ],
      }}
    />,
  );

  await user.click(
    screen.getByRole("button", { name: "Add evidence for outcome 1" }),
  );
  await user.selectOptions(
    screen.getByLabelText(/Outcome 1 evidence status/),
    "unverified",
  );
  await user.type(
    screen.getByLabelText(/Outcome 1 evidence note/),
    "Gathered from interviews",
  );

  expect(draftValue().outcomes[0].evidence).toEqual({
    status: "unverified",
    source: "",
    url: "",
    note: "Gathered from interviews",
  });

  await user.click(
    screen.getByRole("button", { name: "Remove outcome 1 evidence" }),
  );
  expect(draftValue().outcomes[0].evidence).toBeNull();
});

it("clears quantitative fields when switching to qualitative", async () => {
  const user = setupUser();
  render(
    <Harness
      initial={{
        schemaVersion: 1,
        outcomes: [
          {
            kind: "quantitative",
            statement: "Reduced latency",
            metric: "p95",
            value: "200",
            unit: "ms",
            baseline: "500",
            direction: "lower",
            evidence: {
              status: "reported",
              source: "Performance report",
            },
          },
        ],
      }}
    />,
  );

  await user.selectOptions(
    screen.getByLabelText(/Outcome 1 kind/),
    "qualitative",
  );

  expect(screen.queryByLabelText(/Outcome 1 metric/)).not.toBeInTheDocument();
  expect(draftValue().outcomes[0]).toEqual({
    kind: "qualitative",
    statement: "Reduced latency",
    evidence: {
      status: "reported",
      source: "Performance report",
    },
  });
  expect(
    screen.getByText(/switched to qualitative/),
  ).toBeInTheDocument();
});

it("clears quantitative fields through the blank kind and validates the payload", async () => {
  const user = setupUser();
  const initial = {
    schemaVersion: 1,
    outcomes: [
      {
        kind: "quantitative",
        statement: "Reduced latency",
        metric: "p95",
        value: "200",
        unit: "ms",
        baseline: "500",
        direction: "lower",
        evidence: {
          status: "reported",
          source: "Performance report",
        },
      },
      {
        kind: "qualitative",
        statement: "Faster feedback",
        evidence: {
          status: "unverified",
          note: "Gathered from interviews",
        },
      },
    ],
  };
  render(<Harness initial={initial} />);

  await user.selectOptions(
    screen.getByLabelText(/Outcome 1 kind/),
    "",
  );
  await user.selectOptions(
    screen.getByLabelText(/Outcome 1 kind/),
    "qualitative",
  );

  const cleaned = {
    kind: "qualitative",
    statement: "Reduced latency",
    evidence: {
      status: "reported",
      source: "Performance report",
    },
  };
  expect(draftValue().outcomes[0]).toEqual(cleaned);
  expect(draftValue().outcomes[1]).toEqual(initial.outcomes[1]);
  expect(screen.queryByLabelText(/Outcome 1 metric/)).not.toBeInTheDocument();
  expect(
    screen.getByText(/switched to qualitative/),
  ).toBeInTheDocument();

  await user.selectOptions(
    screen.getByLabelText(/Outcome 1 kind/),
    "qualitative",
  );
  expect(draftValue().outcomes[0]).toEqual(cleaned);

  const payload = payloadForDraft(draftValue(), initial);
  expect(payload.ok).toBe(true);
  expect(payload.value.outcomes[0]).toEqual(cleaned);
  expect(payload.value.outcomes[1]).toEqual(initial.outcomes[1]);
});

it("keeps quantitative fields when switching back through the blank kind", async () => {
  const user = setupUser();
  const initial = {
    schemaVersion: 1,
    outcomes: [
      {
        kind: "quantitative",
        statement: "Reduced latency",
        metric: "p95",
        value: "200",
        unit: "ms",
        baseline: "500",
        direction: "lower",
        evidence: {
          status: "reported",
          source: "Performance report",
        },
      },
    ],
  };
  render(<Harness initial={initial} />);

  await user.selectOptions(
    screen.getByLabelText(/Outcome 1 kind/),
    "",
  );
  await user.selectOptions(
    screen.getByLabelText(/Outcome 1 kind/),
    "quantitative",
  );

  expect(draftValue().outcomes[0]).toEqual(initial.outcomes[0]);
});

it("uploads a gallery image and locks the server dimensions", async () => {
  const user = setupUser();
  const onUploadImage = vi.fn().mockResolvedValue({
    image: "https://cdn.example.com/gallery.webp",
    image_width: 1600,
    image_height: 900,
  });
  render(
    <Harness
      initial={{ schemaVersion: 1, role: "Lead" }}
      onUploadImage={onUploadImage}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Add gallery image" }));
  await user.type(
    screen.getByLabelText(/Gallery image 1 alt text/),
    "Dashboard screenshot",
  );
  await user.upload(
    screen.getByLabelText("Upload image file for gallery image 1"),
    new File(["image"], "gallery.png", { type: "image/png" }),
  );

  await waitFor(() =>
    expect(draftValue().gallery[0]).toMatchObject({
      src: "https://cdn.example.com/gallery.webp",
      alt: "Dashboard screenshot",
      width: 1600,
      height: 900,
    }),
  );
  expect(onUploadImage).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText(/Gallery image 1 width/)).toHaveAttribute(
    "readonly",
  );
  expect(screen.getByLabelText(/Gallery image 1 height/)).toHaveAttribute(
    "readonly",
  );

  await user.click(
    screen.getByRole("button", { name: "Remove gallery image 1" }),
  );
  expect(draftValue().gallery).toEqual([]);
});

it("applies a gallery upload to its row after the row moves", async () => {
  const user = setupUser();
  const pending = deferred();
  const onUploadImage = vi.fn(() => pending.promise);
  const first = {
    src: "/images/projects/first.webp",
    alt: "First",
    width: 10,
    height: 10,
  };
  const second = {
    src: "/images/projects/second.webp",
    alt: "Second",
    width: 20,
    height: 20,
  };
  render(
    <Harness
      initial={{ schemaVersion: 1, gallery: [first, second] }}
      onUploadImage={onUploadImage}
    />,
  );

  await user.upload(
    screen.getByLabelText("Upload image file for gallery image 1"),
    new File(["image"], "first.png", { type: "image/png" }),
  );
  await waitFor(() => expect(onUploadImage).toHaveBeenCalledTimes(1));

  await user.click(
    screen.getByRole("button", { name: "Move gallery image 2 up" }),
  );

  await act(async () => {
    pending.resolve({
      image: "https://cdn.example.com/new.webp",
      image_width: 30,
      image_height: 40,
    });
    await pending.promise;
  });

  expect(draftValue().gallery).toEqual([
    second,
    {
      src: "https://cdn.example.com/new.webp",
      alt: "First",
      width: 30,
      height: 40,
    },
  ]);
  expect(
    screen.getByLabelText(/Gallery image 2 width/),
  ).toHaveAttribute("readonly");
});

it("ignores a gallery upload after its row is removed", async () => {
  const user = setupUser();
  const pending = deferred();
  const onUploadImage = vi.fn(() => pending.promise);
  const one = {
    src: "/images/projects/one.webp",
    alt: "One",
    width: 10,
    height: 10,
  };
  const two = {
    src: "/images/projects/two.webp",
    alt: "Two",
    width: 20,
    height: 20,
  };
  render(
    <Harness
      initial={{ schemaVersion: 1, gallery: [one, two] }}
      onUploadImage={onUploadImage}
    />,
  );

  await user.upload(
    screen.getByLabelText("Upload image file for gallery image 1"),
    new File(["image"], "one.png", { type: "image/png" }),
  );
  await waitFor(() => expect(onUploadImage).toHaveBeenCalledTimes(1));

  await user.click(
    screen.getByRole("button", { name: "Remove gallery image 1" }),
  );
  await act(async () => {
    pending.resolve({
      image: "https://cdn.example.com/new.webp",
      image_width: 30,
      image_height: 40,
    });
    await pending.promise;
  });

  expect(draftValue().gallery).toEqual([two]);
});

it("ignores a gallery upload after its source is edited manually", async () => {
  const user = setupUser();
  const pending = deferred();
  const onUploadImage = vi.fn(() => pending.promise);
  const existing = {
    src: "/images/projects/existing.webp",
    alt: "Existing",
    width: 10,
    height: 10,
  };
  render(
    <Harness
      initial={{ schemaVersion: 1, gallery: [existing] }}
      onUploadImage={onUploadImage}
    />,
  );

  await user.upload(
    screen.getByLabelText("Upload image file for gallery image 1"),
    new File(["image"], "existing.png", { type: "image/png" }),
  );
  await waitFor(() => expect(onUploadImage).toHaveBeenCalledTimes(1));

  const source = screen.getByLabelText(/Gallery image 1 source/);
  await user.clear(source);
  await user.type(source, "/images/projects/manual.webp");

  await act(async () => {
    pending.resolve({
      image: "https://cdn.example.com/new.webp",
      image_width: 30,
      image_height: 40,
    });
    await pending.promise;
  });

  expect(draftValue().gallery[0]).toEqual({
    src: "/images/projects/manual.webp",
    alt: "Existing",
    width: "",
    height: "",
  });
});

it("ignores a diagram upload after the diagram is replaced", async () => {
  const user = setupUser();
  const pending = deferred();
  const onUploadImage = vi.fn(() => pending.promise);
  render(
    <Harness
      initial={{
        schemaVersion: 1,
        architecture: {
          summary: "Services",
          diagram: {
            src: "/images/projects/old-diagram.webp",
            alt: "Old diagram",
            width: 10,
            height: 10,
          },
        },
      }}
      onUploadImage={onUploadImage}
    />,
  );

  await user.upload(
    screen.getByLabelText("Upload image file for architecture diagram"),
    new File(["image"], "diagram.png", { type: "image/png" }),
  );
  await waitFor(() => expect(onUploadImage).toHaveBeenCalledTimes(1));

  await user.click(
    screen.getByRole("button", { name: "Remove architecture diagram" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Add architecture diagram" }),
  );

  await act(async () => {
    pending.resolve({
      image: "https://cdn.example.com/new-diagram.webp",
      image_width: 30,
      image_height: 40,
    });
    await pending.promise;
  });

  expect(draftValue().architecture.diagram).toEqual({
    src: "",
    alt: "",
    width: "",
    height: "",
    caption: "",
  });
});

it("ignores an upload after the case study is removed", async () => {
  const user = setupUser();
  const pending = deferred();
  const onUploadImage = vi.fn(() => pending.promise);
  render(
    <Harness
      initial={{
        schemaVersion: 1,
        gallery: [
          {
            src: "/images/projects/one.webp",
            alt: "One",
            width: 10,
            height: 10,
          },
        ],
      }}
      onUploadImage={onUploadImage}
    />,
  );

  await user.upload(
    screen.getByLabelText("Upload image file for gallery image 1"),
    new File(["image"], "one.png", { type: "image/png" }),
  );
  await waitFor(() => expect(onUploadImage).toHaveBeenCalledTimes(1));

  await user.click(screen.getByRole("button", { name: "Remove case study" }));
  const dialog = screen.getByRole("alertdialog");
  await user.click(
    within(dialog).getByRole("button", { name: "Remove case study" }),
  );

  await act(async () => {
    pending.resolve({
      image: "https://cdn.example.com/new.webp",
      image_width: 30,
      image_height: 40,
    });
    await pending.promise;
  });

  expect(draftValue()).toBeNull();
});

it("preserves a gallery image when its upload fails", async () => {
  const user = setupUser();
  const existing = {
    src: "/images/projects/existing.webp",
    alt: "Existing image",
    width: 1200,
    height: 800,
  };
  const onUploadImage = vi
    .fn()
    .mockRejectedValue(new Error("Image is too large."));
  render(
    <Harness
      initial={{ schemaVersion: 1, gallery: [existing] }}
      onUploadImage={onUploadImage}
    />,
  );

  await user.upload(
    screen.getByLabelText("Upload image file for gallery image 1"),
    new File(["image"], "too-large.png", { type: "image/png" }),
  );

  expect(await screen.findByText("Image is too large.")).toBeInTheDocument();
  expect(draftValue().gallery[0]).toEqual(existing);
});

it("adds links with a label, URL, and kind", async () => {
  const user = setupUser();
  render(<Harness initial={{ schemaVersion: 1, role: "Lead" }} />);

  await user.click(screen.getByRole("button", { name: "Add link" }));
  await user.type(screen.getByLabelText(/Link 1 label/), "Live demo");
  await user.type(
    screen.getByLabelText(/Link 1 URL/),
    "https://example.com/demo",
  );
  await user.selectOptions(screen.getByLabelText(/Link 1 kind/), "demo");

  expect(draftValue().links).toEqual([
    {
      label: "Live demo",
      url: "https://example.com/demo",
      kind: "demo",
    },
  ]);

  await user.click(screen.getByRole("button", { name: "Remove link 1" }));
  expect(draftValue().links).toEqual([]);
});

it("renders a readable, path-aware error summary", () => {
  render(
    <Harness
      initial={{ schemaVersion: 1, role: "Lead" }}
      errors={{
        "case_study": "must contain at least one substantive field.",
        "case_study.team.roles.0": "must be a non-empty string.",
        "case_study.outcomes.0.evidence.source": "must be 8-500 characters.",
        "case_study.gallery.1.alt": "must be a non-empty string.",
      }}
    />,
  );

  expect(
    screen.getByRole("heading", { name: "Case study needs attention" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Team role 1")).toBeInTheDocument();
  expect(screen.getByText("Outcome 1 evidence source")).toBeInTheDocument();
  expect(screen.getByText("Gallery image 2 alt text")).toBeInTheDocument();
  expect(screen.getByText("case_study.team.roles.0")).toBeInTheDocument();
  expect(
    screen.getAllByText("must be a non-empty string.").length,
  ).toBeGreaterThan(0);
});

it("navigates from an error summary link to the associated field", async () => {
  const user = setupUser();
  render(
    <Harness
      initial={{
        schemaVersion: 1,
        role: "Lead",
        outcomes: [
          {
            kind: "qualitative",
            statement: "Faster feedback",
            evidence: {
              status: "unverified",
              source: "",
              url: "",
              note: "",
            },
          },
        ],
      }}
      errors={{
        "case_study.outcomes.0.evidence.source": "Source is required.",
      }}
    />,
  );

  const link = screen.getByRole("link", {
    name: /Outcome 1 evidence source/,
  });
  expect(link).toHaveAttribute(
    "href",
    "#case-study-outcomes-0-evidence-source",
  );

  await user.click(link);

  expect(screen.getByLabelText(/Outcome 1 evidence source/)).toHaveFocus();
});

it("points every structured error link at an existing focusable target", () => {
  const initial = {
    schemaVersion: 1,
    role: "Lead",
    timeline: {
      label: "Build",
      start: "2024",
      end: "2025",
      duration: "1 year",
    },
    team: {
      size: 2,
      roles: ["Engineer"],
      note: "Small team",
    },
    problem: {
      summary: "Slow feedback",
      context: "Manual checks",
    },
    constraints: ["Time limit"],
    approach: [{ heading: "Automate", body: "Added checks" }],
    architecture: {
      summary: "Simple service",
      components: [{ name: "API", role: "Serves data", technology: "Node" }],
      diagram: {
        src: "/images/projects/example.webp",
        alt: "Diagram",
        width: 640,
        height: 480,
        caption: "Overview",
      },
    },
    keyDecisions: [
      { decision: "Automate", rationale: "Faster", tradeoff: "Setup cost" },
    ],
    challenges: [
      { problem: "Flaky tests", resolution: "Stabilized", lesson: "Verify" },
    ],
    outcomes: [
      {
        kind: "quantitative",
        statement: "Faster feedback",
        metric: "Minutes",
        value: "10",
        unit: "minutes",
        baseline: "30",
        direction: "lower",
        evidence: {
          status: "verified",
          source: "CI performance report",
          url: "https://example.com/report",
          note: "Tracked weekly",
        },
      },
    ],
    learnings: ["Automate earlier"],
    links: [{ label: "Demo", url: "https://example.com", kind: "demo" }],
    gallery: [
      {
        src: "/images/projects/example.webp",
        alt: "Screenshot",
        width: 640,
        height: 480,
        caption: "Result",
      },
    ],
  };
  const paths = [
    "case_study",
    "case_study.schemaVersion",
    "case_study.role",
    "case_study.timeline",
    "case_study.timeline.label",
    "case_study.timeline.start",
    "case_study.timeline.end",
    "case_study.timeline.duration",
    "case_study.team",
    "case_study.team.size",
    "case_study.team.roles",
    "case_study.team.roles.0",
    "case_study.team.note",
    "case_study.problem",
    "case_study.problem.summary",
    "case_study.problem.context",
    "case_study.constraints",
    "case_study.constraints.0",
    "case_study.approach",
    "case_study.approach.0",
    "case_study.approach.0.heading",
    "case_study.approach.0.body",
    "case_study.architecture",
    "case_study.architecture.summary",
    "case_study.architecture.components",
    "case_study.architecture.components.0",
    "case_study.architecture.components.0.name",
    "case_study.architecture.components.0.role",
    "case_study.architecture.components.0.technology",
    "case_study.architecture.diagram",
    "case_study.architecture.diagram.src",
    "case_study.architecture.diagram.alt",
    "case_study.architecture.diagram.width",
    "case_study.architecture.diagram.height",
    "case_study.architecture.diagram.caption",
    "case_study.keyDecisions",
    "case_study.keyDecisions.0",
    "case_study.keyDecisions.0.decision",
    "case_study.keyDecisions.0.rationale",
    "case_study.keyDecisions.0.tradeoff",
    "case_study.challenges",
    "case_study.challenges.0",
    "case_study.challenges.0.problem",
    "case_study.challenges.0.resolution",
    "case_study.challenges.0.lesson",
    "case_study.outcomes",
    "case_study.outcomes.0",
    "case_study.outcomes.0.kind",
    "case_study.outcomes.0.statement",
    "case_study.outcomes.0.metric",
    "case_study.outcomes.0.value",
    "case_study.outcomes.0.unit",
    "case_study.outcomes.0.baseline",
    "case_study.outcomes.0.direction",
    "case_study.outcomes.0.evidence",
    "case_study.outcomes.0.evidence.status",
    "case_study.outcomes.0.evidence.source",
    "case_study.outcomes.0.evidence.url",
    "case_study.outcomes.0.evidence.note",
    "case_study.learnings",
    "case_study.learnings.0",
    "case_study.links",
    "case_study.links.0",
    "case_study.links.0.label",
    "case_study.links.0.url",
    "case_study.links.0.kind",
    "case_study.gallery",
    "case_study.gallery.0",
    "case_study.gallery.0.src",
    "case_study.gallery.0.alt",
    "case_study.gallery.0.width",
    "case_study.gallery.0.height",
    "case_study.gallery.0.caption",
  ];
  const errors = Object.fromEntries(
    paths.map((path) => [path, "Needs attention."]),
  );
  const { container } = render(<Harness initial={initial} errors={errors} />);

  const links = within(
    screen.getByRole("alert", { name: "Case study needs attention" }),
  ).getAllByRole("link");
  expect(links).toHaveLength(paths.length);

  for (const link of links) {
    const href = link.getAttribute("href");
    expect(href).toMatch(/^#[^#]+$/);
    const target = container.querySelector(href);
    expect(target).not.toBeNull();
    target.focus();
    expect(target).toHaveFocus();
  }
});

it("falls back to the case-study heading when structured fields are not rendered", () => {
  render(
    <Harness
      initial={{ schemaVersion: 2, role: "Legacy owner" }}
      errors={{
        "case_study.schemaVersion": "Must be 1.",
        "case_study.role": "Role cannot be used.",
      }}
    />,
  );

  const links = within(
    screen.getByRole("alert", { name: "Case study needs attention" }),
  ).getAllByRole("link");
  expect(links).toHaveLength(2);

  for (const link of links) {
    expect(link).toHaveAttribute("href", "#case-study-heading");
  }

  const heading = document.getElementById("case-study-heading");
  heading.focus();
  expect(heading).toHaveFocus();
});

it("marks only invalid fields as invalid and describes their errors", () => {
  render(
    <Harness
      initial={{ schemaVersion: 1, role: "Lead" }}
      errors={{ "case_study.role": "Role cannot be used." }}
    />,
  );

  const role = screen.getByLabelText("Role");
  expect(role).toHaveAttribute("aria-invalid", "true");
  expect(role).toHaveAttribute("aria-describedby", "case-study-role-error");

  const start = screen.getByLabelText("Timeline start");
  expect(start).not.toHaveAttribute("aria-invalid");
  expect(start).toHaveAttribute(
    "aria-describedby",
    "case-study-timeline-start-hint",
  );
});

it("restores focus after adding and removing repeatable rows", async () => {
  const user = setupUser();
  render(<Harness initial={{ schemaVersion: 1, role: "Lead" }} />);

  await user.click(screen.getByRole("button", { name: "Add team role" }));
  expect(screen.getByLabelText(/Team role 1/)).toHaveFocus();

  await user.click(
    screen.getByRole("button", { name: "Remove team role 1" }),
  );
  expect(screen.getByRole("button", { name: "Add team role" })).toHaveFocus();
});

it("moves focus through structured recovery controls", async () => {
  const user = setupUser();
  render(
    <Harness
      initial={{ schemaVersion: 2, role: "Legacy owner", futureField: true }}
    />,
  );

  await user.click(
    screen.getByRole("button", { name: "Create structured replacement" }),
  );
  expect(screen.getByLabelText("Role")).toHaveFocus();

  await user.type(screen.getByLabelText("Role"), "Replacement");
  await user.click(screen.getByRole("button", { name: "Cancel recovery" }));

  expect(
    screen.getByRole("button", { name: "Create structured replacement" }),
  ).toHaveFocus();
});

it("does not move focus during ordinary case-study editing", async () => {
  const user = setupUser();
  render(<Harness initial={{ schemaVersion: 1, role: "Lead" }} />);

  const role = screen.getByLabelText("Role");
  role.focus();
  await user.type(role, " engineer");

  expect(role).toHaveFocus();
  expect(
    screen.queryByRole("alert", { name: "Case study needs attention" }),
  ).not.toBeInTheDocument();
});

it("cancels case-study removal and returns focus to the remove button", async () => {
  const user = setupUser();
  render(<Harness initial={{ schemaVersion: 1, role: "Lead" }} />);

  const removeButton = screen.getByRole("button", { name: "Remove case study" });
  await user.click(removeButton);
  const dialog = screen.getByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(removeButton).toHaveFocus();
  expect(screen.getByLabelText("Role")).toHaveValue("Lead");
  expect(draftValue().role).toBe("Lead");
});

it("describes a repeatable group with its group-level error", () => {
  render(
    <Harness
      initial={{ schemaVersion: 1, role: "Lead" }}
      errors={{ "case_study.constraints": "Group invalid." }}
    />,
  );

  const group = screen.getByRole("group", { name: "Constraint rows" });
  const describedBy = group.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();

  const error = document.getElementById(describedBy);
  expect(error).toHaveTextContent("Group invalid.");
  expect(error).toHaveAttribute("role", "alert");
});

it("renders a mixed validation label", () => {
  render(
    <Harness
      initial={{ schemaVersion: 1, role: "Lead" }}
      errors={{
        "case_study.role": "Role rejected.",
        "case_study.timeline.start": "Start rejected.",
      }}
      errorSource="mixed"
    />,
  );

  const summary = screen.getByRole("alert", {
    name: "Case study needs attention",
  });
  expect(within(summary).getByText("Mixed validation")).toHaveClass(
    "case-study-error-source--mixed",
  );
});

it("shows the client source and focuses the case-study heading from a root error link", async () => {
  const user = setupUser();
  const summaryRef = createRef();
  render(
    <Harness
      initial={{ schemaVersion: 1, role: "Lead" }}
      errors={{ case_study: "Root problem." }}
      errorSource="client"
      errorSummaryRef={summaryRef}
    />,
  );

  const summary = screen.getByRole("alert", {
    name: "Case study needs attention",
  });
  expect(summaryRef.current).toBe(summary);
  expect(within(summary).getByText("Client validation")).toBeInTheDocument();

  await user.click(within(summary).getByRole("link"));
  expect(
    screen.getByRole("heading", { name: "Case study", level: 2 }),
  ).toHaveFocus();
});

it("unlocks diagram dimensions and ignores a pending upload after a manual source edit", async () => {
  const user = setupUser();
  const pending = deferred();
  const onUploadImage = vi.fn(() => pending.promise);
  render(
    <Harness
      initial={{
        schemaVersion: 1,
        role: "Lead",
        architecture: {
          summary: "Services",
          diagram: {
            src: "/images/projects/old-diagram.webp",
            alt: "Old diagram",
            width: 10,
            height: 10,
          },
        },
      }}
      onUploadImage={onUploadImage}
    />,
  );

  await user.upload(
    screen.getByLabelText("Upload image file for architecture diagram"),
    new File(["image"], "diagram.png", { type: "image/png" }),
  );
  await waitFor(() => expect(onUploadImage).toHaveBeenCalledTimes(1));

  const source = screen.getByLabelText(/^Architecture diagram source/);
  await user.clear(source);
  await user.paste("/images/projects/manual.webp");

  expect(draftValue().architecture.diagram.src).toBe(
    "/images/projects/manual.webp",
  );
  expect(draftValue().architecture.diagram.width).toBe("");
  expect(
    screen.getByLabelText(/^Architecture diagram width/),
  ).not.toHaveAttribute("readonly");

  await act(async () => {
    pending.resolve({
      image: "https://cdn.example.com/new-diagram.webp",
      image_width: 30,
      image_height: 40,
    });
    await pending.promise;
  });

  expect(draftValue().architecture.diagram.src).toBe(
    "/images/projects/manual.webp",
  );
});

it("keeps a field error visible when a stale upload succeeds", async () => {
  const user = setupUser();
  const pending = deferred();
  const onUploadImage = vi.fn(() => pending.promise);
  render(
    <Harness
      initial={{
        schemaVersion: 1,
        role: "Lead",
        architecture: {
          summary: "Services",
          diagram: {
            src: "/images/projects/old-diagram.webp",
            alt: "Old diagram",
            width: 10,
            height: 10,
          },
        },
      }}
      errors={{
        "case_study.architecture.diagram.src": "Server rejected this source.",
      }}
      onUploadImage={onUploadImage}
    />,
  );

  await user.upload(
    screen.getByLabelText("Upload image file for architecture diagram"),
    new File(["image"], "diagram.png", { type: "image/png" }),
  );
  await waitFor(() => expect(onUploadImage).toHaveBeenCalledTimes(1));

  const source = screen.getByLabelText(/^Architecture diagram source/);
  await user.clear(source);
  await user.paste("/images/projects/manual.webp");

  await act(async () => {
    pending.resolve({
      image: "https://cdn.example.com/new-diagram.webp",
      image_width: 30,
      image_height: 40,
    });
    await pending.promise;
  });

  expect(draftValue().architecture.diagram.src).toBe(
    "/images/projects/manual.webp",
  );
  expect(screen.getAllByText("Server rejected this source.").length).toBeGreaterThan(0);
});
