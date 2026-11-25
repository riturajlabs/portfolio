// @vitest-environment node

import { describe, expect, it } from "vitest";

import { validateCaseStudyDocument } from "../../lib/content.js";
import {
  addCaseStudyDraft,
  buildCaseStudyPayload,
  canUseStructuredEditor,
  cancelCaseStudyRawRepair,
  cancelCaseStudyRecovery,
  canonicalCaseStudyPath,
  caseStudyFieldErrors,
  formatCaseStudyDocument,
  groupCaseStudyProblems,
  initCaseStudyDraft,
  isCaseStudyErrorPath,
  normalizeCaseStudyPath,
  pruneCaseStudyDocument,
  removeCaseStudyDraft,
  resetCaseStudyDraft,
  setCaseStudyRawText,
  startCaseStudyRawRepair,
  startCaseStudyRecovery,
  timelineOrderingIsInvalid,
  applyRepairedCaseStudy,
} from "./caseStudy.js";

function validCaseStudy(changes = {}) {
  return { schemaVersion: 1, role: "Solo developer", ...changes };
}

function invalidStoredCaseStudy() {
  return {
    schemaVersion: 2,
    role: "Legacy owner",
    futureField: true,
  };
}

function quantitativeCaseStudy() {
  return {
    schemaVersion: 1,
    outcomes: [
      {
        kind: "quantitative",
        statement: "Reduced response time",
        metric: "p95 latency",
        value: "200",
        unit: "ms",
        direction: "lower",
        evidence: {
          status: "verified",
          source: "Production dashboard export",
          url: "https://example.com/evidence",
        },
      },
    ],
  };
}

function bodyWithCaseStudy(payload) {
  const body = { title: "Renamed project" };
  if (payload.include) body.case_study = payload.value;
  return body;
}

describe("canonical validator bridge", () => {
  it("returns the shared validator's existing messages unchanged", () => {
    expect(
      validateCaseStudyDocument({
        schemaVersion: 1,
        role: "x".repeat(121),
      })
    ).toEqual(["caseStudy.role must be 1-120 characters when present."]);

    expect(
      validateCaseStudyDocument({
        schemaVersion: 1,
        role: "Developer",
        extra: true,
      })
    ).toEqual(['caseStudy has unknown key "extra".']);

    expect(
      validateCaseStudyDocument({
        schemaVersion: 1,
        timeline: { label: " ", start: "", end: "", duration: "" },
      })
    ).toEqual(["caseStudy.timeline must contain at least one field."]);
  });

  it("accepts a custom root without changing the rules", () => {
    expect(
      validateCaseStudyDocument(
        { schemaVersion: 2, role: "Developer" },
        "draft"
      )
    ).toEqual(["draft.schemaVersion must be 1."]);
  });

  it("does not mutate or normalize the submitted value", () => {
    const caseStudy = quantitativeCaseStudy();
    const before = structuredClone(caseStudy);

    validateCaseStudyDocument(caseStudy);

    expect(caseStudy).toEqual(before);
  });
});

describe("path normalization and error grouping", () => {
  it("converts bracket indices to dotted admin paths", () => {
    expect(
      normalizeCaseStudyPath(
        "case_study.outcomes[0].evidence.source"
      )
    ).toBe("case_study.outcomes.0.evidence.source");
    expect(normalizeCaseStudyPath("case_study")).toBe("case_study");
    expect(
      normalizeCaseStudyPath("caseStudy.overview[0].title")
    ).toBe("case_study.overview.0.title");
    expect(
      normalizeCaseStudyPath("case_study..outcomes.[0].title")
    ).toBe("case_study.outcomes.0.title");
  });

  it("maps root, unknown and malformed server paths onto the case study", () => {
    expect(canonicalCaseStudyPath(null)).toBe("case_study");
    expect(canonicalCaseStudyPath("title")).toBe("case_study");
    expect(canonicalCaseStudyPath("caseStudy.schemaVersion")).toBe(
      "case_study.schemaVersion",
    );
    expect(canonicalCaseStudyPath("case_study.futureField")).toBe(
      "case_study.futureField",
    );
    expect(isCaseStudyErrorPath("case_study.outcomes.0.title")).toBe(true);
    expect(isCaseStudyErrorPath("title")).toBe(false);
  });

  it("detects timeline ordering structurally without relying on messages", () => {
    expect(
      timelineOrderingIsInvalid({
        timeline: { start: "2025-12", end: "2025-11" },
      }),
    ).toBe(true);
    expect(
      timelineOrderingIsInvalid({ timeline: { start: "2026", end: "2025-12" } }),
    ).toBe(true);
    expect(
      timelineOrderingIsInvalid({ timeline: { start: "2025", end: "2026-01" } }),
    ).toBe(false);
    expect(
      timelineOrderingIsInvalid({ timeline: { start: "", end: "2025-01" } }),
    ).toBe(false);
    expect(
      timelineOrderingIsInvalid({
        timeline: { start: "not-a-date", end: "2025-01" },
      }),
    ).toBe(false);
    expect(timelineOrderingIsInvalid(null)).toBe(false);
  });

  it("maps shared validation problems to dotted field errors", () => {
    const caseStudy = quantitativeCaseStudy();
    caseStudy.outcomes[0].evidence.source = "short";

    expect(caseStudyFieldErrors(caseStudy)).toEqual({
      "case_study.outcomes.0.evidence.source":
        "must be 8-500 characters when present.",
    });
  });

  it("keeps document-level problems under the root", () => {
    expect(caseStudyFieldErrors({ schemaVersion: 1 })).toHaveProperty(
      "case_study",
      "must contain at least one substantive field besides schemaVersion."
    );
  });

  it("does not lose a problem whose path cannot be mapped", () => {
    expect(groupCaseStudyProblems(["something went wrong"])).toEqual({
      case_study: "something went wrong",
    });
  });

  it("combines repeated problems after canonicalizing their paths", () => {
    expect(
      groupCaseStudyProblems([
        "caseStudy.role first",
        "case_study[role] second",
        "case_study.role third",
        "outside the case study",
      ]),
    ).toEqual({
      "case_study.role": "first second third",
      case_study: "outside the case study",
    });
  });
});

describe("draft initialization", () => {
  it("starts absent when there is no stored case study", () => {
    expect(initCaseStudyDraft(null)).toEqual({
      mode: "absent",
      baseline: null,
      baselineRawText: null,
      baselineProblems: [],
      value: null,
      rawText: null,
      rawParseError: null,
      rawProblems: [],
      unsupportedSchemaVersion: null,
      repairing: false,
      recoveryRawDraft: null,
      rowIds: {
        roles: [],
        constraints: [],
        approach: [],
        architectureComponents: [],
        keyDecisions: [],
        challenges: [],
        outcomes: [],
        learnings: [],
        gallery: [],
        links: [],
      },
      touched: false,
    });
  });

  it("starts structured for a valid document with an isolated copy", () => {
    const loaded = validCaseStudy({ constraints: ["One"] });
    const draft = initCaseStudyDraft(loaded);

    expect(draft.mode).toBe("structured");
    expect(draft.baseline).toEqual(loaded);
    expect(draft.value).toEqual(loaded);
    expect(draft.value).not.toBe(loaded);
    expect(draft.touched).toBe(false);

    draft.value.role = "Changed";
    expect(draft.baseline.role).toBe("Solo developer");
  });

  it("assigns stable UI row IDs without adding them to the document", () => {
    const loaded = validCaseStudy({
      team: { size: null, roles: ["Developer", "Designer"], note: "" },
      constraints: ["One"],
      approach: [{ heading: "Map", body: "Trace the flow" }],
      architecture: {
        summary: "Services",
        components: [{ name: "API", role: "Serve requests" }],
        diagram: null,
      },
      keyDecisions: [{ decision: "Use Postgres", rationale: "Durable" }],
      challenges: [{ problem: "Slow reads", resolution: "Add indexes" }],
      outcomes: [{ kind: "qualitative", statement: "Faster feedback" }],
      learnings: ["Measure first"],
      gallery: [
        {
          src: "/images/projects/example.webp",
          alt: "Example",
          width: 1200,
          height: 800,
        },
      ],
      links: [{ label: "Demo", url: "https://example.com", kind: "demo" }],
    });
    const draft = initCaseStudyDraft(loaded);
    const ids = [
      ...draft.rowIds.roles,
      ...draft.rowIds.constraints,
      ...draft.rowIds.approach,
      ...draft.rowIds.architectureComponents,
      ...draft.rowIds.keyDecisions,
      ...draft.rowIds.challenges,
      ...draft.rowIds.outcomes,
      ...draft.rowIds.learnings,
      ...draft.rowIds.gallery,
      ...draft.rowIds.links,
    ];

    expect(draft.rowIds.roles).toHaveLength(2);
    expect(draft.rowIds.constraints).toHaveLength(1);
    expect(draft.rowIds.approach).toHaveLength(1);
    expect(draft.rowIds.architectureComponents).toHaveLength(1);
    expect(draft.rowIds.keyDecisions).toHaveLength(1);
    expect(draft.rowIds.challenges).toHaveLength(1);
    expect(draft.rowIds.outcomes).toHaveLength(1);
    expect(draft.rowIds.learnings).toHaveLength(1);
    expect(draft.rowIds.gallery).toHaveLength(1);
    expect(draft.rowIds.links).toHaveLength(1);
    expect(new Set(ids).size).toBe(11);
    expect(draft.value).toEqual(loaded);
    expect(draft.value).not.toHaveProperty("rowIds");
  });

  it("starts raw for an invalid document and preserves its text", () => {
    const loaded = invalidStoredCaseStudy();
    const draft = initCaseStudyDraft(loaded);

    expect(draft.mode).toBe("raw");
    expect(draft.baseline).toEqual(loaded);
    expect(draft.baselineRawText).toBe(formatCaseStudyDocument(loaded));
    expect(draft.rawText).toBe(draft.baselineRawText);
    expect(draft.rawProblems).toEqual([
      'case_study has unknown key "futureField".',
      "case_study.schemaVersion must be 1.",
    ]);
    expect(draft.unsupportedSchemaVersion).toBe(2);
    expect(draft.touched).toBe(false);
  });

  it("records an unsupported schema version for recovery", () => {
    const draft = initCaseStudyDraft({ schemaVersion: 9, role: "Legacy" });

    expect(draft.mode).toBe("raw");
    expect(draft.unsupportedSchemaVersion).toBe(9);
    expect(draft.rawProblems).toContain("case_study.schemaVersion must be 1.");
  });

  it("resets a raw draft to its original stored bytes", () => {
    const draft = initCaseStudyDraft(invalidStoredCaseStudy());
    const edited = setCaseStudyRawText(
      draft,
      JSON.stringify(validCaseStudy())
    );

    expect(edited.touched).toBe(true);
    expect(resetCaseStudyDraft(edited)).toMatchObject({
      mode: "raw",
      rawText: draft.baselineRawText,
      rawParseError: null,
      touched: false,
      unsupportedSchemaVersion: 2,
    });
  });

  it("tracks raw JSON parse errors without hiding the original text", () => {
    const draft = initCaseStudyDraft(invalidStoredCaseStudy());
    const edited = setCaseStudyRawText(draft, "{not json");

    expect(edited.rawText).toBe("{not json");
    expect(edited.rawParseError).toEqual(expect.any(String));
    expect(edited.rawProblems).toEqual([]);
    expect(edited.touched).toBe(true);
  });

  it("marks an explicit removal as touched while preserving the baseline", () => {
    const draft = initCaseStudyDraft(validCaseStudy());
    const removed = removeCaseStudyDraft(draft);

    expect(removed).toMatchObject({
      mode: "absent",
      value: null,
      touched: true,
      baseline: validCaseStudy(),
    });
  });

  it("preserves a valid stored baseline through remove, add, remove", () => {
    const original = validCaseStudy({ constraints: ["Stored"] });
    const added = addCaseStudyDraft(
      removeCaseStudyDraft(initCaseStudyDraft(original)),
    );

    expect(added).toMatchObject({
      mode: "structured",
      baseline: original,
      value: { schemaVersion: 1 },
      touched: true,
    });
    expect(added.value).not.toHaveProperty("rowIds");

    const payload = buildCaseStudyPayload({
      draft: removeCaseStudyDraft(added),
      isEditing: true,
    });
    expect(payload).toMatchObject({
      ok: true,
      include: true,
      value: null,
    });
  });

  it("preserves an invalid raw baseline through remove, add, remove", () => {
    const original = invalidStoredCaseStudy();
    const added = addCaseStudyDraft(
      removeCaseStudyDraft(initCaseStudyDraft(original)),
    );

    expect(added).toMatchObject({
      mode: "structured",
      baseline: original,
      baselineRawText: formatCaseStudyDocument(original),
      value: { schemaVersion: 1 },
    });

    const payload = buildCaseStudyPayload({
      draft: removeCaseStudyDraft(added),
      isEditing: true,
    });
    expect(payload).toMatchObject({
      ok: true,
      include: true,
      value: null,
    });
  });

  it("omits add then remove when there was no stored baseline", () => {
    const draft = removeCaseStudyDraft(addCaseStudyDraft(initCaseStudyDraft(null)));

    expect(
      buildCaseStudyPayload({ draft, isEditing: false })
    ).toMatchObject({ ok: true, include: false });
    expect(
      buildCaseStudyPayload({ draft, isEditing: true })
    ).toMatchObject({ ok: true, include: false });
  });
});

describe("structured recovery", () => {
  it("opens a structured replacement without changing the stored raw document", () => {
    const original = invalidStoredCaseStudy();
    const raw = initCaseStudyDraft(original);
    const recovery = startCaseStudyRecovery(raw);

    expect(recovery).toMatchObject({
      mode: "structured",
      baseline: original,
      baselineRawText: raw.baselineRawText,
      rawText: raw.baselineRawText,
      rawProblems: raw.rawProblems,
      unsupportedSchemaVersion: 2,
      recovering: true,
    });
    expect(recovery.value).toEqual({ schemaVersion: 1 });
    expect(recovery.value).not.toBe(raw.value);
    expect(recovery.rowIds).not.toBe(raw.rowIds);
    expect(recovery.recoveryRowIds).toEqual(raw.rowIds);

    recovery.value.role = "Changed";
    expect(recovery.baseline.role).toBe("Legacy owner");
    expect(raw.value).toEqual(original);
    expect(raw.rawText).toBe(raw.baselineRawText);
  });

  it("does not open recovery when there is no invalid raw document", () => {
    const absent = initCaseStudyDraft(null);
    const valid = initCaseStudyDraft(validCaseStudy());

    expect(startCaseStudyRecovery(absent)).toBe(absent);
    expect(startCaseStudyRecovery(valid)).toBe(valid);
  });

  it("cancels recovery and restores the original raw editor state", () => {
    const original = invalidStoredCaseStudy();
    const raw = initCaseStudyDraft(original);
    const recovery = startCaseStudyRecovery(raw);
    recovery.value = validCaseStudy({ role: "Replacement" });

    const canceled = cancelCaseStudyRecovery(recovery);

    expect(canceled).toMatchObject({
      mode: "raw",
      baseline: original,
      baselineRawText: raw.baselineRawText,
      value: original,
      rawText: raw.baselineRawText,
      rawParseError: null,
      rawProblems: raw.rawProblems,
      unsupportedSchemaVersion: 2,
      rowIds: raw.rowIds,
      touched: false,
    });
    expect(canceled).not.toHaveProperty("recovering");
    expect(canceled).not.toHaveProperty("recoveryRowIds");
    expect(
      buildCaseStudyPayload({ draft: canceled, isEditing: true })
    ).toMatchObject({ ok: true, include: false });
  });

  it("blocks an invalid replacement and includes a valid replacement", () => {
    const recovery = startCaseStudyRecovery(
      initCaseStudyDraft(invalidStoredCaseStudy()),
    );

    const empty = buildCaseStudyPayload({ draft: recovery, isEditing: true });
    expect(empty).toMatchObject({ ok: false, include: false });
    expect(empty.errors).toHaveProperty("case_study");

    const partial = {
      ...recovery,
      value: { schemaVersion: 1, problem: { summary: "", context: "Manual" } },
    };
    expect(
      buildCaseStudyPayload({ draft: partial, isEditing: true })
    ).toMatchObject({ ok: false, include: false });

    const replacement = validCaseStudy({ constraints: ["Recovered"] });
    expect(
      buildCaseStudyPayload({
        draft: { ...recovery, value: replacement },
        isEditing: true,
      })
    ).toMatchObject({
      ok: true,
      include: true,
      value: replacement,
      problems: [],
      errors: {},
    });
  });

  it("sends an explicit null when recovery is removed", () => {
    const recovery = startCaseStudyRecovery(
      initCaseStudyDraft(invalidStoredCaseStudy()),
    );
    const removed = removeCaseStudyDraft(recovery);

    expect(removed).toMatchObject({
      mode: "absent",
      value: null,
      recovering: false,
      recoveryRowIds: null,
      touched: true,
    });
    expect(
      buildCaseStudyPayload({ draft: removed, isEditing: true })
    ).toMatchObject({ ok: true, include: true, value: null });
  });

  it("handles malformed and null stored values through recovery and cancel", () => {
    const storedValues = [
      42,
      "broken",
      [1, 2],
      { schemaVersion: null, role: null, timeline: null },
    ];

    for (const stored of storedValues) {
      const raw = initCaseStudyDraft(stored);
      expect(raw.mode).toBe("raw");

      const recovery = startCaseStudyRecovery(raw);
      expect(recovery.mode).toBe("structured");
      expect(recovery.value).toEqual({ schemaVersion: 1 });
      expect(
        buildCaseStudyPayload({ draft: recovery, isEditing: true }).ok
      ).toBe(false);

      const canceled = cancelCaseStudyRecovery(recovery);
      expect(canceled).toMatchObject({
        mode: "raw",
        baseline: stored,
        value: stored,
        touched: false,
      });
    }
  });
});

describe("raw JSON repair", () => {
  it("opens the original raw document for repair without changing it", () => {
    const original = invalidStoredCaseStudy();
    const raw = initCaseStudyDraft(original);
    const editing = startCaseStudyRawRepair(raw);

    expect(editing).toMatchObject({
      mode: "raw",
      repairing: true,
      baseline: original,
      baselineRawText: raw.baselineRawText,
      rawText: raw.baselineRawText,
      value: original,
      touched: false,
    });
    expect(canUseStructuredEditor(editing)).toBe(false);
    expect(
      buildCaseStudyPayload({ draft: editing, isEditing: true })
    ).toMatchObject({ ok: true, include: false });
  });

  it("validates a repaired document with the shared validator and transfers it without loss", () => {
    const raw = startCaseStudyRawRepair(
      initCaseStudyDraft(invalidStoredCaseStudy()),
    );
    const repaired = validCaseStudy({
      constraints: ["Recovered from JSON"],
      learnings: ["Untouched supported field"],
    });
    const edited = setCaseStudyRawText(raw, JSON.stringify(repaired));

    expect(edited.rawParseError).toBeNull();
    expect(edited.rawProblems).toEqual([]);
    expect(edited.unsupportedSchemaVersion).toBeNull();
    expect(edited.baseline).toEqual(invalidStoredCaseStudy());
    expect(canUseStructuredEditor(edited)).toBe(true);
    expect(
      buildCaseStudyPayload({ draft: edited, isEditing: true })
    ).toMatchObject({ ok: true, include: true, value: repaired });

    const structured = applyRepairedCaseStudy(edited);
    expect(structured).toMatchObject({
      mode: "structured",
      value: repaired,
      baseline: invalidStoredCaseStudy(),
      repairing: false,
      recovering: false,
      touched: true,
    });
    expect(structured.rowIds.constraints).toHaveLength(1);
    expect(structured.rowIds.learnings).toHaveLength(1);
  });

  it("separates syntax errors from payload errors and blocks both", () => {
    const raw = startCaseStudyRawRepair(
      initCaseStudyDraft(invalidStoredCaseStudy()),
    );

    const syntax = setCaseStudyRawText(raw, "{not json");
    expect(syntax.rawParseError).toEqual(expect.any(String));
    expect(syntax.rawProblems).toEqual([]);
    expect(canUseStructuredEditor(syntax)).toBe(false);
    expect(
      buildCaseStudyPayload({ draft: syntax, isEditing: true })
    ).toMatchObject({ ok: false, include: false });

    const schema = setCaseStudyRawText(
      raw,
      JSON.stringify({ schemaVersion: 2, role: "Legacy" }),
    );
    expect(schema.rawParseError).toBeNull();
    expect(schema.rawProblems).toEqual([
      "case_study.schemaVersion must be 1.",
    ]);
    expect(schema.unsupportedSchemaVersion).toBe(2);
    expect(canUseStructuredEditor(schema)).toBe(false);
    expect(
      buildCaseStudyPayload({ draft: schema, isEditing: true })
    ).toMatchObject({ ok: false, include: false });

    const unsupported = setCaseStudyRawText(
      raw,
      JSON.stringify({ schemaVersion: 1, role: "Solo", futureField: true }),
    );
    expect(unsupported.rawProblems).toEqual([
      'case_study has unknown key "futureField".',
    ]);
    expect(canUseStructuredEditor(unsupported)).toBe(false);
    expect(
      buildCaseStudyPayload({ draft: unsupported, isEditing: true })
    ).toMatchObject({ ok: false, include: false });
  });

  it("cancels raw repair by restoring the exact original text", () => {
    const original = invalidStoredCaseStudy();
    const raw = startCaseStudyRawRepair(initCaseStudyDraft(original));
    const edited = setCaseStudyRawText(raw, JSON.stringify(validCaseStudy()));
    const canceled = cancelCaseStudyRawRepair(edited);

    expect(canceled).toMatchObject({
      mode: "raw",
      repairing: false,
      baseline: original,
      baselineRawText: raw.baselineRawText,
      rawText: raw.baselineRawText,
      rawParseError: null,
      value: original,
      touched: false,
    });
    expect(canceled.baselineProblems).toEqual(raw.baselineProblems);
    expect(canUseStructuredEditor(canceled)).toBe(false);
    expect(
      buildCaseStudyPayload({ draft: canceled, isEditing: true })
    ).toMatchObject({ ok: true, include: false });
  });

  it("keeps repaired JSON when switching to replacement and back", () => {
    const raw = startCaseStudyRawRepair(
      initCaseStudyDraft(invalidStoredCaseStudy()),
    );
    const repaired = validCaseStudy({ role: "Repaired before switch" });
    const edited = setCaseStudyRawText(raw, JSON.stringify(repaired));
    const replacement = startCaseStudyRecovery(edited);

    expect(replacement.recoveryRawDraft).toMatchObject({
      rawText: edited.rawText,
      value: repaired,
      repairing: true,
      touched: true,
    });

    const canceled = cancelCaseStudyRecovery(replacement);
    expect(canceled).toMatchObject({
      mode: "raw",
      repairing: true,
      baseline: invalidStoredCaseStudy(),
      rawText: edited.rawText,
      value: repaired,
      touched: true,
    });
    expect(canUseStructuredEditor(canceled)).toBe(true);
  });
});

describe("optional-section pruning", () => {
  it("normalizes completely empty wrappers to null", () => {
    const source = {
      schemaVersion: 1,
      timeline: { label: " ", start: "", end: null, duration: "" },
      team: { size: null, roles: [], note: " " },
      problem: { summary: "", context: " " },
      architecture: {
        summary: "",
        components: [],
        diagram: {
          src: "",
          alt: "",
          width: null,
          height: "",
          caption: " ",
        },
      },
    };
    const before = structuredClone(source);

    expect(pruneCaseStudyDocument(source)).toEqual({
      schemaVersion: 1,
      timeline: null,
      team: null,
      problem: null,
      architecture: null,
    });
    expect(source).toEqual(before);
  });

  it("prunes fully empty optional outcome evidence wrappers", () => {
    const pruned = pruneCaseStudyDocument({
      schemaVersion: 1,
      outcomes: [
        {
          kind: "qualitative",
          statement: "Faster feedback",
          evidence: { status: "", source: " ", url: "", note: "" },
        },
        {
          kind: "quantitative",
          statement: "Reduced latency",
          metric: "p95",
          value: "200",
          evidence: {},
        },
      ],
    });

    expect(pruned.outcomes[0].evidence).toBeNull();
    expect(pruned.outcomes[1].evidence).toBeNull();
    expect(caseStudyFieldErrors(pruned)).toHaveProperty(
      "case_study.outcomes.1.evidence",
      "is required for quantitative outcomes."
    );
  });

  it("keeps partially populated or complete outcome evidence wrappers", () => {
    const pruned = pruneCaseStudyDocument({
      schemaVersion: 1,
      outcomes: [
        {
          kind: "qualitative",
          statement: "Faster feedback",
          evidence: {
            status: "",
            source: "Release notes from the v2 launch",
          },
        },
        {
          kind: "qualitative",
          statement: "Clearer reporting",
          evidence: { status: "unverified", source: "", url: "", note: "" },
        },
      ],
    });

    expect(pruned.outcomes[0].evidence).toEqual({
      status: "",
      source: "Release notes from the v2 launch",
    });
    expect(pruned.outcomes[1].evidence).toEqual({
      status: "unverified",
      source: "",
      url: "",
      note: "",
    });
    expect(caseStudyFieldErrors(pruned)).toHaveProperty(
      "case_study.outcomes.0.evidence.status",
      "must be one of: verified, reported, unverified."
    );
    expect(caseStudyFieldErrors(pruned)).not.toHaveProperty(
      "case_study.outcomes.1.evidence"
    );
  });

  it("keeps a problem with context but no summary", () => {
    const pruned = pruneCaseStudyDocument({
      schemaVersion: 1,
      problem: { summary: " ", context: "The incident lasted two days." },
    });

    expect(pruned.problem).toEqual({
      summary: " ",
      context: "The incident lasted two days.",
    });
    expect(caseStudyFieldErrors(pruned)).toHaveProperty(
      "case_study.problem.summary",
      "must be a non-empty string."
    );
  });

  it("keeps blank repeatable rows and reports their errors", () => {
    const pruned = pruneCaseStudyDocument({
      schemaVersion: 1,
      constraints: [""],
      approach: [{ heading: "", body: "" }],
      keyDecisions: [{ decision: "", rationale: "" }],
      challenges: [{ problem: "", resolution: "" }],
      outcomes: [{}],
      learnings: [""],
      gallery: [{}],
      links: [{ label: "", url: "", kind: "" }],
    });

    expect(pruned.constraints).toHaveLength(1);
    expect(pruned.approach).toHaveLength(1);
    expect(pruned.keyDecisions).toHaveLength(1);
    expect(pruned.challenges).toHaveLength(1);
    expect(pruned.outcomes).toHaveLength(1);
    expect(pruned.learnings).toHaveLength(1);
    expect(pruned.gallery).toHaveLength(1);
    expect(pruned.links).toHaveLength(1);

    const errors = caseStudyFieldErrors(pruned);
    expect(errors).toHaveProperty("case_study.constraints.0");
    expect(errors).toHaveProperty("case_study.approach.0.heading");
    expect(errors).toHaveProperty("case_study.keyDecisions.0.decision");
    expect(errors).toHaveProperty("case_study.challenges.0.problem");
    expect(errors).toHaveProperty("case_study.outcomes.0.kind");
    expect(errors).toHaveProperty("case_study.learnings.0");
    expect(errors).toHaveProperty("case_study.gallery.0.src");
    expect(errors).toHaveProperty("case_study.links.0.label");
  });

  it("keeps a team with a blank role row", () => {
    const pruned = pruneCaseStudyDocument({
      schemaVersion: 1,
      team: { size: null, roles: [""], note: "" },
    });

    expect(pruned.team).toEqual({ size: null, roles: [""], note: "" });
    expect(caseStudyFieldErrors(pruned)).toHaveProperty(
      "case_study.team.roles.0",
      "must be a non-empty string."
    );
  });

  it("keeps architecture with a component row or partial diagram", () => {
    const withComponent = pruneCaseStudyDocument({
      schemaVersion: 1,
      architecture: {
        summary: "",
        components: [{ name: "", role: "", technology: "" }],
        diagram: null,
      },
    });
    const withDiagram = pruneCaseStudyDocument({
      schemaVersion: 1,
      architecture: {
        summary: "",
        components: [],
        diagram: {
          src: "/images/projects/example.webp",
          alt: "",
          width: null,
          height: null,
          caption: "",
        },
      },
    });

    expect(withComponent.architecture).not.toBeNull();
    expect(withComponent.architecture.components).toHaveLength(1);
    expect(withDiagram.architecture).not.toBeNull();
    expect(withDiagram.architecture.diagram).toEqual({
      src: "/images/projects/example.webp",
      alt: "",
      width: null,
      height: null,
      caption: "",
    });
    expect(caseStudyFieldErrors(withComponent)).toHaveProperty(
      "case_study.architecture.components.0.name"
    );
    expect(caseStudyFieldErrors(withDiagram)).toHaveProperty(
      "case_study.architecture.summary"
    );
  });

  it("does not discard text the canonical validator treats as content", () => {
    const pruned = pruneCaseStudyDocument({
      schemaVersion: 1,
      timeline: {
        label: "\uFEFF",
        start: "",
        end: "",
        duration: "",
      },
    });

    expect(pruned.timeline).toEqual({
      label: "\uFEFF",
      start: "",
      end: "",
      duration: "",
    });
    expect(caseStudyFieldErrors(pruned)).toEqual({});
  });

  it("leaves empty arrays empty", () => {
    expect(
      pruneCaseStudyDocument({
        schemaVersion: 1,
        constraints: [],
        approach: [],
        outcomes: [],
      })
    ).toEqual({
      schemaVersion: 1,
      constraints: [],
      approach: [],
      outcomes: [],
    });
  });

  it("does not prune raw documents", () => {
    const draft = initCaseStudyDraft(invalidStoredCaseStudy());
    draft.rawText = JSON.stringify({
      schemaVersion: 2,
      role: "Legacy",
      timeline: { label: "", start: "", end: "", duration: "" },
    });

    const payload = buildCaseStudyPayload({ draft, isEditing: true });

    expect(payload.ok).toBe(false);
    expect(payload.include).toBe(false);
    expect(payload.problems).toContain(
      "case_study.timeline must contain at least one field."
    );
  });
});

describe("case-study payload truth table", () => {
  it("omits the field on create when never added", () => {
    expect(
      buildCaseStudyPayload({
        draft: initCaseStudyDraft(null),
        isEditing: false,
      })
    ).toMatchObject({
      ok: true,
      include: false,
      value: null,
      problems: [],
      errors: {},
    });
  });

  it("includes a valid document on create", () => {
    const draft = {
      ...initCaseStudyDraft(null),
      mode: "structured",
      value: validCaseStudy({ constraints: ["One"] }),
      touched: true,
    };

    expect(
      buildCaseStudyPayload({ draft, isEditing: false })
    ).toMatchObject({
      ok: true,
      include: true,
      value: validCaseStudy({ constraints: ["One"] }),
      problems: [],
      errors: {},
    });
  });

  it("blocks an empty structured document on create", () => {
    const draft = {
      ...initCaseStudyDraft(null),
      mode: "structured",
      value: { schemaVersion: 1 },
      touched: true,
    };

    const payload = buildCaseStudyPayload({ draft, isEditing: false });

    expect(payload.ok).toBe(false);
    expect(payload.include).toBe(false);
    expect(payload.problems).toEqual([
      "case_study must contain at least one substantive field besides schemaVersion.",
    ]);
  });

  it("omits an unchanged valid document on update", () => {
    const draft = initCaseStudyDraft(validCaseStudy());

    expect(
      buildCaseStudyPayload({ draft, isEditing: true })
    ).toMatchObject({
      ok: true,
      include: false,
      value: null,
      problems: [],
      errors: {},
    });
  });

  it("recognizes unchanged values regardless of object key order", () => {
    const baseline = {
      schemaVersion: 1,
      role: "Developer",
      constraints: ["One"],
    };
    const reordered = {
      constraints: ["One"],
      role: "Developer",
      schemaVersion: 1,
    };
    const draft = {
      ...initCaseStudyDraft(baseline),
      value: reordered,
    };

    expect(
      buildCaseStudyPayload({ draft, isEditing: true })
    ).toMatchObject({ ok: true, include: false });
  });

  it("does not put UI row IDs into the payload", () => {
    const draft = initCaseStudyDraft({
      schemaVersion: 1,
      role: "Lead",
      constraints: ["One"],
    });
    const payload = buildCaseStudyPayload({ draft, isEditing: true });

    expect(payload.include).toBe(false);
    expect(draft.rowIds.constraints).toHaveLength(1);

    draft.value.role = "Principal";
    const changed = buildCaseStudyPayload({ draft, isEditing: true });
    expect(changed.include).toBe(true);
    expect(changed.value).toEqual({
      schemaVersion: 1,
      role: "Principal",
      constraints: ["One"],
    });
    expect(changed.value).not.toHaveProperty("rowIds");
    expect(JSON.stringify(changed.value)).not.toContain(
      draft.rowIds.constraints[0]
    );
  });

  it("includes the complete replacement document on update", () => {
    const draft = initCaseStudyDraft(
      validCaseStudy({ constraints: ["One"] })
    );
    draft.value = {
      schemaVersion: 1,
      role: "Lead developer",
      constraints: ["One"],
    };

    const payload = buildCaseStudyPayload({ draft, isEditing: true });

    expect(payload).toMatchObject({
      ok: true,
      include: true,
      value: {
        schemaVersion: 1,
        role: "Lead developer",
        constraints: ["One"],
      },
    });
  });

  it("prunes empty optional wrappers before building a payload", () => {
    const draft = {
      ...initCaseStudyDraft(validCaseStudy()),
      value: {
        schemaVersion: 1,
        role: "Lead developer",
        timeline: { label: "", start: "", end: "", duration: "" },
      },
    };

    expect(
      buildCaseStudyPayload({ draft, isEditing: true }).value
    ).toEqual({
      schemaVersion: 1,
      role: "Lead developer",
      timeline: null,
    });
  });

  it("omits the field on update when the baseline was absent", () => {
    expect(
      buildCaseStudyPayload({
        draft: initCaseStudyDraft(null),
        isEditing: true,
      })
    ).toMatchObject({ ok: true, include: false });
  });

  it("sends an explicit null after a confirmed removal", () => {
    const draft = removeCaseStudyDraft(
      initCaseStudyDraft(validCaseStudy())
    );

    const payload = buildCaseStudyPayload({ draft, isEditing: true });

    expect(payload).toMatchObject({
      ok: true,
      include: true,
      value: null,
      problems: [],
      errors: {},
    });
    expect(payload.value).not.toBeUndefined();
  });

  it("does not submit an empty structured draft on update", () => {
    const draft = {
      ...initCaseStudyDraft(validCaseStudy()),
      value: { schemaVersion: 1 },
    };

    const payload = buildCaseStudyPayload({ draft, isEditing: true });

    expect(payload.ok).toBe(false);
    expect(payload.include).toBe(false);
  });

  it("omits an untouched invalid raw document from an unrelated update", () => {
    const draft = initCaseStudyDraft(invalidStoredCaseStudy());

    const payload = buildCaseStudyPayload({ draft, isEditing: true });

    expect(payload).toMatchObject({
      ok: true,
      include: false,
      value: null,
      problems: [],
      errors: {},
    });
    expect(bodyWithCaseStudy(payload)).toEqual({
      title: "Renamed project",
    });
  });

  it("blocks edited raw JSON that is still invalid", () => {
    const draft = initCaseStudyDraft(invalidStoredCaseStudy());
    const edited = setCaseStudyRawText(
      draft,
      JSON.stringify({ schemaVersion: 2, role: "Legacy" })
    );

    const payload = buildCaseStudyPayload({
      draft: edited,
      isEditing: true,
    });

    expect(payload.ok).toBe(false);
    expect(payload.include).toBe(false);
    expect(payload.problems).toEqual([
      "case_study.schemaVersion must be 1.",
    ]);
    expect(payload.errors).toEqual({
      "case_study.schemaVersion": "must be 1.",
    });
  });

  it("blocks edited raw JSON with a syntax error", () => {
    const draft = initCaseStudyDraft(invalidStoredCaseStudy());
    const edited = setCaseStudyRawText(draft, "{not json");

    const payload = buildCaseStudyPayload({
      draft: edited,
      isEditing: true,
    });

    expect(payload.ok).toBe(false);
    expect(payload.include).toBe(false);
    expect(payload.errors.case_study).toMatch(/^is not valid JSON:/);
  });

  it("includes a repaired raw document as a complete replacement", () => {
    const draft = initCaseStudyDraft(invalidStoredCaseStudy());
    const repaired = validCaseStudy({
      constraints: ["Recovered"],
      timeline: { label: "2025", start: "2025", end: "2025", duration: "" },
    });
    const edited = setCaseStudyRawText(draft, JSON.stringify(repaired));

    const payload = buildCaseStudyPayload({
      draft: edited,
      isEditing: true,
    });

    expect(payload).toMatchObject({
      ok: true,
      include: true,
      value: repaired,
      problems: [],
      errors: {},
    });
  });

  it("sends an explicit null after removing an invalid raw document", () => {
    const draft = removeCaseStudyDraft(
      initCaseStudyDraft(invalidStoredCaseStudy())
    );

    const payload = buildCaseStudyPayload({ draft, isEditing: true });

    expect(payload).toMatchObject({
      ok: true,
      include: true,
      value: null,
    });
  });

  it("keeps an unsupported-version document untouched until it is edited or removed", () => {
    const draft = initCaseStudyDraft({ schemaVersion: 9, role: "Legacy" });

    expect(
      buildCaseStudyPayload({ draft, isEditing: true })
    ).toMatchObject({ ok: true, include: false });
    expect(
      buildCaseStudyPayload({
        draft: removeCaseStudyDraft(draft),
        isEditing: true,
      })
    ).toMatchObject({ ok: true, include: true, value: null });
    expect(
      buildCaseStudyPayload({
        draft: setCaseStudyRawText(
          draft,
          JSON.stringify(validCaseStudy())
        ),
        isEditing: true,
      })
    ).toMatchObject({
      ok: true,
      include: true,
      value: validCaseStudy(),
    });
  });

  it("rejects programmer errors instead of producing a partial payload", () => {
    expect(() => buildCaseStudyPayload()).toThrow(TypeError);
    expect(() =>
      buildCaseStudyPayload({ draft: { mode: "unknown" } })
    ).toThrow(TypeError);
  });
});
