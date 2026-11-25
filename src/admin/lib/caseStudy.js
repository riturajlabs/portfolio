import { validateCaseStudyDocument } from "../../lib/content.js";
import { normalizeFieldPath } from "./validators.js";

export const CASE_STUDY_FIELD = "case_study";
const CASE_STUDY_CAMEL_FIELD = "caseStudy";
export const CASE_STUDY_SCHEMA_VERSION = 1;

const PROBLEM_PATH = /^(\S+)\s+([\s\S]+)$/;
const ASCII_TIMELINE_DATE = /^(?:\d{4}|\d{4}-(?:0[1-9]|1[0-2]))$/;
const CASE_STUDY_BLANK = new Set(
  "\u0009\u000a\u000b\u000c\u000d\u0020\u0085\u00a0\u1680" +
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a" +
    "\u2028\u2029\u202f\u205f\u3000"
);

let caseStudyRowIdSequence = 0;

export function createCaseStudyRowId(prefix = "case-study-row") {
  caseStudyRowIdSequence += 1;
  return `${prefix}-${caseStudyRowIdSequence}`;
}

export function normalizeCaseStudyPath(path) {
  const normalized = normalizeFieldPath(path);
  if (normalized === CASE_STUDY_CAMEL_FIELD) return CASE_STUDY_FIELD;
  if (normalized.startsWith(`${CASE_STUDY_CAMEL_FIELD}.`)) {
    return `${CASE_STUDY_FIELD}.${normalized.slice(
      CASE_STUDY_CAMEL_FIELD.length + 1,
    )}`;
  }
  return normalized;
}

export function canonicalCaseStudyPath(path) {
  const normalized = normalizeCaseStudyPath(path);
  if (!normalized) return CASE_STUDY_FIELD;
  if (normalized === CASE_STUDY_FIELD) return CASE_STUDY_FIELD;
  if (normalized.startsWith(`${CASE_STUDY_FIELD}.`)) return normalized;
  return CASE_STUDY_FIELD;
}

export function isCaseStudyErrorPath(path) {
  const normalized = normalizeCaseStudyPath(path);
  return (
    normalized === CASE_STUDY_FIELD ||
    normalized.startsWith(`${CASE_STUDY_FIELD}.`)
  );
}

export function timelineOrderingIsInvalid(caseStudy) {
  if (!plainObject(caseStudy) || !plainObject(caseStudy.timeline)) return false;

  const start = timelineDatePoint(caseStudy.timeline.start, false);
  const end = timelineDatePoint(caseStudy.timeline.end, true);
  if (!start || !end) return false;

  return (
    start[0] > end[0] ||
    (start[0] === end[0] && start[1] > end[1])
  );
}

function timelineDatePoint(value, isEnd) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!ASCII_TIMELINE_DATE.test(trimmed)) return null;
  if (trimmed.length === 4) return [Number(trimmed), isEnd ? 12 : 1];
  const [year, month] = trimmed.split("-").map(Number);
  return [year, month];
}

export function caseStudyFieldErrors(caseStudy, root = CASE_STUDY_FIELD) {
  return groupCaseStudyProblems(
    validateCaseStudyDocument(caseStudy, root),
    root
  );
}

export function groupCaseStudyProblems(problems, root = CASE_STUDY_FIELD) {
  return groupProblems(problems, root);
}

export function pruneCaseStudyDocument(caseStudy) {
  if (!plainObject(caseStudy)) return cloneJson(caseStudy);

  const next = cloneJson(caseStudy);

  if (plainObject(next.timeline) && timelineIsEmpty(next.timeline)) {
    next.timeline = null;
  }
  if (plainObject(next.team) && teamIsEmpty(next.team)) {
    next.team = null;
  }
  if (plainObject(next.problem) && problemIsEmpty(next.problem)) {
    next.problem = null;
  }
  if (plainObject(next.architecture)) {
    if (
      plainObject(next.architecture.diagram) &&
      imageAssetIsEmpty(next.architecture.diagram)
    ) {
      next.architecture.diagram = null;
    }
    if (architectureIsEmpty(next.architecture)) {
      next.architecture = null;
    }
  }
  if (Array.isArray(next.outcomes)) {
    for (const outcome of next.outcomes) {
      if (
        plainObject(outcome) &&
        plainObject(outcome.evidence) &&
        evidenceIsEmpty(outcome.evidence)
      ) {
        outcome.evidence = null;
      }
    }
  }

  return next;
}

export function formatCaseStudyDocument(caseStudy) {
  if (caseStudy === undefined) return "";
  return JSON.stringify(caseStudy, null, 2);
}

export function unsupportedCaseStudyVersion(caseStudy) {
  if (!plainObject(caseStudy)) return null;
  const version = caseStudy.schemaVersion;
  return Number.isInteger(version) && version !== CASE_STUDY_SCHEMA_VERSION
    ? version
    : null;
}

export function initCaseStudyDraft(loadedCaseStudy = null) {
  const baseline =
    loadedCaseStudy === undefined || loadedCaseStudy === null
      ? null
      : cloneJson(loadedCaseStudy);

  if (baseline === null) {
    return {
      mode: "absent",
      baseline: null,
      baselineRawText: null,
      value: null,
      rawText: null,
      rawParseError: null,
      baselineProblems: [],
      rawProblems: [],
      unsupportedSchemaVersion: null,
      rowIds: emptyCaseStudyRowIds(),
      repairing: false,
      recoveryRawDraft: null,
      touched: false,
    };
  }

  const rawProblems = validateCaseStudyDocument(baseline, CASE_STUDY_FIELD);
  const rawText = formatCaseStudyDocument(baseline);

  if (rawProblems.length === 0) {
    return {
      mode: "structured",
      baseline,
      baselineRawText: null,
      baselineProblems: [],
      value: cloneJson(baseline),
      rawText: null,
      rawParseError: null,
      rawProblems: [],
      unsupportedSchemaVersion: null,
      rowIds: caseStudyRowIdsFor(baseline),
      repairing: false,
      recoveryRawDraft: null,
      touched: false,
    };
  }

  return {
    mode: "raw",
    baseline,
    baselineRawText: rawText,
    baselineProblems: cloneJson(rawProblems),
    value: cloneJson(baseline),
    rawText,
    rawParseError: null,
    rawProblems,
    unsupportedSchemaVersion: unsupportedCaseStudyVersion(baseline),
    rowIds: caseStudyRowIdsFor(baseline),
    repairing: false,
    recoveryRawDraft: null,
    touched: false,
  };
}

export function setCaseStudyRawText(draft, rawText) {
  const text = typeof rawText === "string" ? rawText : "";
  const parsed = parseRawCaseStudy(text);

  return {
    ...draft,
    mode: "raw",
    value: parsed.error ? null : cloneJson(parsed.value),
    rawText: text,
    rawParseError: parsed.error,
    rawProblems: parsed.error
      ? []
      : validateCaseStudyDocument(parsed.value, CASE_STUDY_FIELD),
    unsupportedSchemaVersion: parsed.error
      ? null
      : unsupportedCaseStudyVersion(parsed.value),
    recovering: false,
    recoveryRowIds: null,
    repairing: draft.repairing === true,
    recoveryRawDraft: draft.recoveryRawDraft ?? null,
    touched: text !== draft.baselineRawText,
  };
}

export function startCaseStudyRawRepair(draft) {
  if (
    !draft ||
    draft.mode !== "raw" ||
    draft.baseline === undefined ||
    draft.baseline === null
  ) {
    return draft;
  }

  return {
    ...draft,
    mode: "raw",
    repairing: true,
    recovering: false,
    recoveryRowIds: null,
  };
}

export function cancelCaseStudyRawRepair(draft) {
  if (!draft || draft.mode !== "raw" || draft.repairing !== true) return draft;

  const baseline =
    draft.baseline === undefined || draft.baseline === null
      ? null
      : cloneJson(draft.baseline);
  const rawText =
    typeof draft.baselineRawText === "string"
      ? draft.baselineRawText
      : formatCaseStudyDocument(baseline);
  const storedProblems = Array.isArray(draft.baselineProblems)
    ? cloneJson(draft.baselineProblems)
    : baseline === null
      ? []
      : validateCaseStudyDocument(baseline, CASE_STUDY_FIELD);

  return {
    ...draft,
    mode: "raw",
    baseline,
    baselineRawText: rawText,
    baselineProblems: storedProblems,
    value: cloneJson(baseline),
    rawText,
    rawParseError: null,
    rawProblems: storedProblems,
    unsupportedSchemaVersion: unsupportedCaseStudyVersion(baseline),
    rowIds: draft.rowIds ?? caseStudyRowIdsFor(baseline),
    recovering: false,
    recoveryRowIds: null,
    repairing: false,
    recoveryRawDraft: null,
    touched: false,
  };
}

export function canUseStructuredEditor(draft) {
  return Boolean(
    draft &&
      draft.mode === "raw" &&
      draft.repairing === true &&
      !draft.rawParseError &&
      Array.isArray(draft.rawProblems) &&
      draft.rawProblems.length === 0 &&
      draft.unsupportedSchemaVersion === null &&
      plainObject(draft.value),
  );
}

export function applyRepairedCaseStudy(draft) {
  if (!canUseStructuredEditor(draft)) return draft;

  const value = cloneJson(draft.value);
  return {
    ...draft,
    mode: "structured",
    value,
    rowIds: caseStudyRowIdsFor(value),
    recovering: false,
    recoveryRowIds: null,
    repairing: false,
    recoveryRawDraft: null,
    touched: true,
  };
}

export function startCaseStudyRecovery(draft) {
  if (
    !draft ||
    draft.mode !== "raw" ||
    draft.baseline === undefined ||
    draft.baseline === null
  ) {
    return draft;
  }

  const recoveryRawDraft =
    typeof draft.rawText === "string" &&
    draft.rawText !== draft.baselineRawText
      ? {
          value: cloneJson(draft.value),
          rawText: draft.rawText,
          rawParseError: draft.rawParseError ?? null,
          rawProblems: cloneJson(draft.rawProblems ?? []),
          unsupportedSchemaVersion: draft.unsupportedSchemaVersion ?? null,
          rowIds: cloneJson(draft.rowIds ?? emptyCaseStudyRowIds()),
          repairing: draft.repairing === true,
          touched: draft.touched === true,
        }
      : null;

  return {
    ...draft,
    mode: "structured",
    value: { schemaVersion: CASE_STUDY_SCHEMA_VERSION },
    rowIds: emptyCaseStudyRowIds(),
    recovering: true,
    recoveryRowIds: cloneJson(draft.rowIds ?? emptyCaseStudyRowIds()),
    repairing: false,
    recoveryRawDraft,
    touched: true,
  };
}

export function cancelCaseStudyRecovery(draft) {
  if (!draft || draft.mode !== "structured" || draft.recovering !== true) {
    return draft;
  }

  const baseline =
    draft.baseline === undefined || draft.baseline === null
      ? null
      : cloneJson(draft.baseline);
  const rawText =
    typeof draft.baselineRawText === "string"
      ? draft.baselineRawText
      : formatCaseStudyDocument(baseline);
  const rest = { ...draft };
  const recoveryRowIds = rest.recoveryRowIds;
  const recoveryRawDraft = rest.recoveryRawDraft;
  delete rest.recovering;
  delete rest.recoveryRowIds;
  delete rest.recoveryRawDraft;

  if (recoveryRawDraft && typeof recoveryRawDraft === "object") {
    return {
      ...rest,
      mode: baseline === null ? "absent" : "raw",
      baseline,
      baselineRawText: baseline === null ? null : rawText,
      baselineProblems: Array.isArray(draft.baselineProblems)
        ? cloneJson(draft.baselineProblems)
        : [],
      value: cloneJson(recoveryRawDraft.value),
      rawText: recoveryRawDraft.rawText,
      rawParseError: recoveryRawDraft.rawParseError ?? null,
      rawProblems: cloneJson(recoveryRawDraft.rawProblems ?? []),
      unsupportedSchemaVersion: recoveryRawDraft.unsupportedSchemaVersion ?? null,
      rowIds: cloneJson(recoveryRawDraft.rowIds ?? emptyCaseStudyRowIds()),
      repairing: recoveryRawDraft.repairing === true,
      touched: recoveryRawDraft.touched === true,
    };
  }

  return {
    ...rest,
    mode: baseline === null ? "absent" : "raw",
    baseline,
    baselineRawText: baseline === null ? null : rawText,
    baselineProblems: Array.isArray(draft.baselineProblems)
      ? cloneJson(draft.baselineProblems)
      : [],
    value: cloneJson(baseline),
    rawText: baseline === null ? null : rawText,
    rawParseError: null,
    rawProblems:
      baseline === null
        ? []
        : validateCaseStudyDocument(baseline, CASE_STUDY_FIELD),
    unsupportedSchemaVersion: unsupportedCaseStudyVersion(baseline),
    rowIds:
      baseline === null
        ? emptyCaseStudyRowIds()
        : recoveryRowIds ?? caseStudyRowIdsFor(baseline),
    repairing: false,
    touched: false,
  };
}

export function resetCaseStudyDraft(draft) {
  const baseline =
    draft && draft.baseline !== undefined && draft.baseline !== null
      ? draft.baseline
      : null;
  return initCaseStudyDraft(baseline);
}

export function addCaseStudyDraft(draft = null) {
  const baseline =
    draft && draft.baseline !== undefined && draft.baseline !== null
      ? cloneJson(draft.baseline)
      : null;
  const baselineRawText =
    typeof draft?.baselineRawText === "string" ? draft.baselineRawText : null;

  return {
    mode: "structured",
    baseline,
    baselineRawText,
    baselineProblems: Array.isArray(draft?.baselineProblems)
      ? cloneJson(draft.baselineProblems)
      : [],
    value: { schemaVersion: CASE_STUDY_SCHEMA_VERSION },
    rawText: null,
    rawParseError: null,
    rawProblems: [],
    unsupportedSchemaVersion: null,
    rowIds: emptyCaseStudyRowIds(),
    recovering: false,
    recoveryRowIds: null,
    repairing: false,
    recoveryRawDraft: null,
    touched: true,
  };
}

export function removeCaseStudyDraft(draft) {
  return {
    ...draft,
    mode: "absent",
    value: null,
    rawText: "",
    rawParseError: null,
    rawProblems: [],
    unsupportedSchemaVersion: null,
    recovering: false,
    recoveryRowIds: null,
    repairing: false,
    recoveryRawDraft: null,
    touched: true,
  };
}

export function buildCaseStudyPayload({ draft, isEditing = false } = {}) {
  if (!draft || typeof draft !== "object") {
    throw new TypeError("buildCaseStudyPayload requires a case-study draft.");
  }

  if (draft.mode === "absent") {
    if (
      isEditing &&
      draft.baseline !== undefined &&
      draft.baseline !== null &&
      draft.touched
    ) {
      return payloadResult({ include: true, value: null });
    }
    return payloadResult({});
  }

  if (draft.mode === "structured") {
    const prepared = pruneCaseStudyDocument(
      draft.value ?? { schemaVersion: CASE_STUDY_SCHEMA_VERSION }
    );
    const problems = validateCaseStudyDocument(prepared, CASE_STUDY_FIELD);
    if (problems.length > 0) {
      return payloadResult({ ok: false, problems });
    }
    if (isEditing && deepEqual(prepared, draft.baseline)) {
      return payloadResult({});
    }
    return payloadResult({ include: true, value: prepared });
  }

  if (draft.mode === "raw") {
    if (
      isEditing &&
      draft.baselineRawText !== null &&
      draft.rawText === draft.baselineRawText
    ) {
      return payloadResult({});
    }

    const parsed = parseRawCaseStudy(draft.rawText);
    if (parsed.error) {
      return payloadResult({
        ok: false,
        problems: [
          `${CASE_STUDY_FIELD} is not valid JSON: ${parsed.error}`,
        ],
      });
    }

    const problems = validateCaseStudyDocument(parsed.value, CASE_STUDY_FIELD);
    if (problems.length > 0) {
      return payloadResult({ ok: false, problems });
    }
    if (isEditing && deepEqual(parsed.value, draft.baseline)) {
      return payloadResult({});
    }
    return payloadResult({ include: true, value: parsed.value });
  }

  throw new TypeError(`Unknown case-study draft mode: ${String(draft.mode)}`);
}

function payloadResult({
  ok = true,
  include = false,
  value = null,
  problems = [],
}) {
  return {
    ok,
    include,
    value: include ? value : null,
    problems,
    errors: groupProblems(problems, CASE_STUDY_FIELD),
  };
}

function groupProblems(problems, root) {
  const errors = {};

  for (const problem of problems) {
    const text = String(problem);
    const match = text.match(PROBLEM_PATH);
    const matchedPath = match ? normalizeCaseStudyPath(match[1]) : null;
    const knownPath =
      matchedPath === root ||
      (matchedPath !== null && matchedPath.startsWith(`${root}.`));
    const path = knownPath ? matchedPath : root;
    const message = knownPath ? match[2] : text;

    errors[path] = errors[path] ? `${errors[path]} ${message}` : message;
  }

  return errors;
}

function parseRawCaseStudy(rawText) {
  try {
    return { value: JSON.parse(rawText), error: null };
  } catch (error) {
    return {
      value: null,
      error: error instanceof Error ? error.message : "Invalid JSON.",
    };
  }
}

function timelineIsEmpty(timeline) {
  return ["label", "start", "end", "duration"].every((key) =>
    isBlank(timeline[key])
  );
}

function teamIsEmpty(team) {
  const hasRoles = Array.isArray(team.roles)
    ? team.roles.length > 0
    : isPresent(team.roles);
  return isBlank(team.size) && !hasRoles && isBlank(team.note);
}

function problemIsEmpty(problem) {
  return isBlank(problem.summary) && isBlank(problem.context);
}

function architectureIsEmpty(architecture) {
  const hasComponents = Array.isArray(architecture.components)
    ? architecture.components.length > 0
    : isPresent(architecture.components);
  return (
    isBlank(architecture.summary) &&
    !hasComponents &&
    (architecture.diagram === undefined || architecture.diagram === null)
  );
}

function imageAssetIsEmpty(image) {
  return ["src", "alt", "width", "height", "caption"].every((key) =>
    isBlank(image[key])
  );
}

function evidenceIsEmpty(evidence) {
  return ["status", "source", "url", "note"].every((key) =>
    isBlank(evidence[key])
  );
}

function isBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false;
  return Array.from(value).every((character) =>
    CASE_STUDY_BLANK.has(character)
  );
}

function isPresent(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return !isBlank(value);
  return true;
}

function emptyCaseStudyRowIds() {
  return {
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
  };
}

function caseStudyRowIdsFor(value) {
  const documentValue = plainObject(value) ? value : {};
  const team = plainObject(documentValue.team) ? documentValue.team : {};
  const architecture = plainObject(documentValue.architecture)
    ? documentValue.architecture
    : {};
  return {
    roles: arrayValue(team.roles).map(() => createCaseStudyRowId("role")),
    constraints: arrayValue(documentValue.constraints).map(() =>
      createCaseStudyRowId("constraint")
    ),
    approach: arrayValue(documentValue.approach).map(() =>
      createCaseStudyRowId("approach")
    ),
    architectureComponents: arrayValue(architecture.components).map(() =>
      createCaseStudyRowId("component")
    ),
    keyDecisions: arrayValue(documentValue.keyDecisions).map(() =>
      createCaseStudyRowId("decision")
    ),
    challenges: arrayValue(documentValue.challenges).map(() =>
      createCaseStudyRowId("challenge")
    ),
    outcomes: arrayValue(documentValue.outcomes).map(() =>
      createCaseStudyRowId("outcome")
    ),
    learnings: arrayValue(documentValue.learnings).map(() =>
      createCaseStudyRowId("learning")
    ),
    gallery: arrayValue(documentValue.gallery).map(() =>
      createCaseStudyRowId("gallery")
    ),
    links: arrayValue(documentValue.links).map(() =>
      createCaseStudyRowId("link")
    ),
  };
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((value, index) => deepEqual(value, right[index]));
  }
  if (plainObject(left) && plainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        deepEqual(left[key], right[key])
    );
  }
  return false;
}
