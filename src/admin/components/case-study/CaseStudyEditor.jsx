import { useEffect, useRef, useState } from "react";

import ConfirmDialog from "../ConfirmDialog.jsx";
import { Field } from "../Form.jsx";
import {
  CASE_STUDY_FIELD,
  CASE_STUDY_SCHEMA_VERSION,
  addCaseStudyDraft,
  canUseStructuredEditor,
  cancelCaseStudyRawRepair,
  cancelCaseStudyRecovery,
  createCaseStudyRowId,
  removeCaseStudyDraft,
  setCaseStudyRawText,
  startCaseStudyRawRepair,
  startCaseStudyRecovery,
  applyRepairedCaseStudy,
} from "../../lib/caseStudy.js";
import CaseStudyErrorSummary from "./CaseStudyErrorSummary.jsx";
import CaseStudySection from "./CaseStudySection.jsx";
import ImageAssetField from "./ImageAssetField.jsx";
import OutcomeFields from "./OutcomeFields.jsx";
import RepeatableGroup from "./RepeatableGroup.jsx";
import {
  caseStudyDomId,
  caseStudyError as errorFor,
  caseStudyInvalid,
  plainObject,
  setIn,
} from "./caseStudyFields.js";

const DIAGRAM_ASSET_KEY = "architecture.diagram";
const QUANTITATIVE_OUTCOME_FIELDS = [
  "metric",
  "value",
  "unit",
  "baseline",
  "direction",
];

function documentBase(value) {
  const base = plainObject(value) ? value : {};
  return { ...base, schemaVersion: CASE_STUDY_SCHEMA_VERSION };
}

function rowIdsFor(rowIds, key) {
  return Array.isArray(rowIds[key]) ? rowIds[key] : [];
}

function hasQuantitativeOutcomeFields(outcome) {
  return QUANTITATIVE_OUTCOME_FIELDS.some(
    (field) => outcome[field] !== undefined && outcome[field] !== null,
  );
}

export default function CaseStudyEditor({
  draft,
  onChange,
  errors = {},
  errorSource = null,
  errorSummaryRef,
  onBlurPath,
  onClearPath,
  onUploadImage,
}) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [uploadedAssets, setUploadedAssets] = useState(() => new Set());
  const [outcomeNotice, setOutcomeNotice] = useState("");
  const removeButtonRef = useRef(null);
  const draftRef = useRef(draft);
  const assetEpoch = useRef(0);
  const assetVersionSequence = useRef(0);
  const assetVersions = useRef(new Map());

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const pendingFocusRef = useRef(null);

  useEffect(() => {
    const targetId = pendingFocusRef.current;
    if (!targetId || typeof document === "undefined") return;
    pendingFocusRef.current = null;
    document.getElementById(targetId)?.focus();
  }, [draft]);

  function requestFocus(id) {
    pendingFocusRef.current = id;
  }

  const value = plainObject(draft.value) ? draft.value : {};
  const timeline = plainObject(value.timeline) ? value.timeline : {};
  const team = plainObject(value.team) ? value.team : {};
  const problem = plainObject(value.problem) ? value.problem : {};
  const architecture = plainObject(value.architecture)
    ? value.architecture
    : {};
  const diagram = plainObject(architecture.diagram)
    ? architecture.diagram
    : null;
  const roles = Array.isArray(team.roles) ? team.roles : [];
  const constraints = Array.isArray(value.constraints) ? value.constraints : [];
  const approach = Array.isArray(value.approach) ? value.approach : [];
  const components = Array.isArray(architecture.components)
    ? architecture.components
    : [];
  const keyDecisions = Array.isArray(value.keyDecisions)
    ? value.keyDecisions
    : [];
  const challenges = Array.isArray(value.challenges) ? value.challenges : [];
  const outcomes = Array.isArray(value.outcomes) ? value.outcomes : [];
  const learnings = Array.isArray(value.learnings) ? value.learnings : [];
  const links = Array.isArray(value.links) ? value.links : [];
  const gallery = Array.isArray(value.gallery) ? value.gallery : [];
  const rowIds = draft.rowIds ?? {};
  const roleIds = rowIdsFor(rowIds, "roles");
  const constraintIds = rowIdsFor(rowIds, "constraints");
  const approachIds = rowIdsFor(rowIds, "approach");
  const componentIds = rowIdsFor(rowIds, "architectureComponents");
  const decisionIds = rowIdsFor(rowIds, "keyDecisions");
  const challengeIds = rowIdsFor(rowIds, "challenges");
  const outcomeIds = rowIdsFor(rowIds, "outcomes");
  const learningIds = rowIdsFor(rowIds, "learnings");
  const galleryIds = rowIdsFor(rowIds, "gallery");
  const linkIds = rowIdsFor(rowIds, "links");

  function galleryAssetKey(index) {
    return galleryIds[index] ?? `gallery-${index}`;
  }

  function currentAssetVersion(assetKey) {
    return assetVersions.current.get(assetKey) ?? 0;
  }

  function bumpAssetVersion(assetKey) {
    assetVersionSequence.current += 1;
    const version = assetVersionSequence.current;
    assetVersions.current.set(assetKey, version);
    return version;
  }

  function beginAssetUpload(assetKey) {
    return {
      epoch: assetEpoch.current,
      version: bumpAssetVersion(assetKey),
    };
  }

  function assetUploadIsCurrent(upload, assetKey) {
    return (
      upload.epoch === assetEpoch.current &&
      upload.version === currentAssetVersion(assetKey)
    );
  }

  function invalidateAsset(assetKey) {
    bumpAssetVersion(assetKey);
  }

  function invalidateAllAssets() {
    assetEpoch.current += 1;
    assetVersions.current = new Map();
  }

  function resolveAssetPath(documentValue, documentRowIds, assetKey) {
    if (assetKey === DIAGRAM_ASSET_KEY) {
      const architectureValue = plainObject(documentValue?.architecture)
        ? documentValue.architecture
        : {};
      return plainObject(architectureValue.diagram)
        ? ["architecture", "diagram"]
        : null;
    }

    const galleryValue = Array.isArray(documentValue?.gallery)
      ? documentValue.gallery
      : [];
    const index = rowIdsFor(documentRowIds ?? {}, "gallery").indexOf(assetKey);
    return index >= 0 && index < galleryValue.length
      ? ["gallery", index]
      : null;
  }

  function updatePath(
    path,
    nextValue,
    errorPath = path.join("."),
    updateRowIds,
  ) {
    onChange((current) => ({
      ...current,
      mode: "structured",
      value: setIn(documentBase(current.value), path, nextValue),
      ...(updateRowIds
        ? { rowIds: updateRowIds(current.rowIds ?? {}) }
        : {}),
      touched: true,
    }));
    onClearPath?.(`${CASE_STUDY_FIELD}.${errorPath}`);
  }

  function handleAdd() {
    invalidateAllAssets();
    onClearPath?.(CASE_STUDY_FIELD);
    requestFocus(caseStudyDomId("role"));
    onChange((current) => addCaseStudyDraft(current));
  }

  function handleRemoveConfirmed() {
    invalidateAllAssets();
    requestFocus("case-study-add-case-study");
    onChange((current) => removeCaseStudyDraft(current));
    onClearPath?.(CASE_STUDY_FIELD);
    setConfirmingRemove(false);
  }

  function handleRemoveCancelled() {
    setConfirmingRemove(false);
    removeButtonRef.current?.focus();
  }

  function handleStartRecovery() {
    invalidateAllAssets();
    setOutcomeNotice("");
    onClearPath?.(CASE_STUDY_FIELD);
    requestFocus(caseStudyDomId("role"));
    onChange((current) => startCaseStudyRecovery(current));
  }

  function handleCancelRecovery() {
    invalidateAllAssets();
    setOutcomeNotice("");
    onClearPath?.(CASE_STUDY_FIELD);
    requestFocus("case-study-start-recovery");
    onChange((current) => cancelCaseStudyRecovery(current));
  }

  function handleStartRawRepair() {
    invalidateAllAssets();
    setOutcomeNotice("");
    onClearPath?.(CASE_STUDY_FIELD);
    requestFocus("case-study-raw-json");
    onChange((current) => startCaseStudyRawRepair(current));
  }

  function handleCancelRawRepair() {
    invalidateAllAssets();
    setOutcomeNotice("");
    onClearPath?.(CASE_STUDY_FIELD);
    requestFocus("case-study-repair-json");
    onChange((current) => cancelCaseStudyRawRepair(current));
  }

  function handleUseStructuredEditor() {
    invalidateAllAssets();
    setOutcomeNotice("");
    onClearPath?.(CASE_STUDY_FIELD);
    requestFocus(caseStudyDomId("role"));
    onChange((current) => applyRepairedCaseStudy(current));
  }

  function handleRawTextChange(event) {
    onClearPath?.(CASE_STUDY_FIELD);
    onChange((current) => setCaseStudyRawText(current, event.target.value));
  }

  function updateRole(nextValue) {
    updatePath(["role"], nextValue);
  }

  function updateTimelineField(key, nextValue) {
    updatePath(["timeline", key], nextValue);
    if (key === "start" || key === "end") {
      const other = key === "start" ? "end" : "start";
      onClearPath?.(`${CASE_STUDY_FIELD}.timeline.${other}`);
    }
  }

  function updateTeamField(key, nextValue) {
    updatePath(["team", key], nextValue);
  }

  function addRole() {
    addCollectionRow(["team", "roles"], roles, "", "roles", "role");
  }

  function updateRoleRow(index, nextValue) {
    const nextRoles = [...roles];
    nextRoles[index] = nextValue;
    updatePath(
      ["team", "roles"],
      nextRoles,
      `team.roles.${index}`,
    );
  }

  function removeRoleRow(index) {
    removeCollectionRow(["team", "roles"], roles, index, "roles");
  }

  function updateProblemField(key, nextValue) {
    updatePath(["problem", key], nextValue);
  }

  function addConstraint() {
    addCollectionRow(["constraints"], constraints, "", "constraints", "constraint");
  }

  function updateConstraint(index, nextValue) {
    const nextConstraints = [...constraints];
    nextConstraints[index] = nextValue;
    updatePath(
      ["constraints"],
      nextConstraints,
      `constraints.${index}`,
    );
  }

  function removeConstraint(index) {
    removeCollectionRow(["constraints"], constraints, index, "constraints");
  }

  function addApproachStep() {
    addCollectionRow(
      ["approach"],
      approach,
      { heading: "", body: "" },
      "approach",
      "approach",
      "heading",
    );
  }

  function updateApproachField(index, key, nextValue) {
    updatePath(
      ["approach", index, key],
      nextValue,
      `approach.${index}.${key}`,
    );
  }

  function removeApproachStep(index) {
    removeCollectionRow(["approach"], approach, index, "approach");
  }

  function moveApproachStep(from, to) {
    if (to < 0 || to >= approach.length) return;
    const nextApproach = [...approach];
    const [moved] = nextApproach.splice(from, 1);
    nextApproach.splice(to, 0, moved);
    updatePath(["approach"], nextApproach, "approach", (current) => {
      const ids = Array.isArray(current.approach) ? [...current.approach] : [];
      const [movedId] = ids.splice(from, 1);
      ids.splice(to, 0, movedId);
      return { ...current, approach: ids };
    });
  }

  function addCollectionRow(path, items, entry, rowIdKey, idPrefix, firstField) {
    const id = createCaseStudyRowId(idPrefix);
    const focusPath = [...path, items.length, ...(firstField ? [firstField] : [])];
    requestFocus(caseStudyDomId(focusPath.join(".")));
    updatePath(path, [...items, entry], path.join("."), (current) => ({
      ...current,
      [rowIdKey]: [...rowIdsFor(current, rowIdKey), id],
    }));
    return id;
  }

  function removeCollectionRow(path, items, index, rowIdKey) {
    const remainingIds = rowIdsFor(rowIds, rowIdKey).filter(
      (_, itemIndex) => itemIndex !== index,
    );
    if (remainingIds.length === 0) {
      requestFocus(`${caseStudyDomId(path.join("."))}-add`);
    } else {
      requestFocus(`${remainingIds[Math.min(index, remainingIds.length - 1)]}-remove`);
    }
    updatePath(
      path,
      items.filter((_, itemIndex) => itemIndex !== index),
      path.join("."),
      (current) => ({
        ...current,
        [rowIdKey]: rowIdsFor(current, rowIdKey).filter(
          (_, itemIndex) => itemIndex !== index,
        ),
      }),
    );
  }

  function moveCollectionRow(path, items, from, to, rowIdKey) {
    if (to < 0 || to >= items.length) return;
    const nextItems = [...items];
    const [moved] = nextItems.splice(from, 1);
    nextItems.splice(to, 0, moved);
    updatePath(path, nextItems, path.join("."), (current) => {
      const ids = [...rowIdsFor(current, rowIdKey)];
      if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) {
        return current;
      }
      const [movedId] = ids.splice(from, 1);
      ids.splice(to, 0, movedId);
      return { ...current, [rowIdKey]: ids };
    });
  }

  function updateAssetFields(path, changes, assetKey) {
    onChange((current) => {
      const currentPath = resolveAssetPath(
        current.value ?? {},
        current.rowIds ?? {},
        assetKey,
      );
      if (!currentPath) return current;

      let nextValue = documentBase(current.value);
      for (const [key, value] of Object.entries(changes)) {
        nextValue = setIn(nextValue, [...currentPath, key], value);
      }
      return {
        ...current,
        mode: "structured",
        value: nextValue,
        touched: true,
      };
    });
    for (const key of Object.keys(changes)) {
      onClearPath?.(
        `${CASE_STUDY_FIELD}.${[...path, key].join(".")}`,
      );
    }
    setUploadedAssets((current) => {
      if (current.has(assetKey)) return current;
      const next = new Set(current);
      next.add(assetKey);
      return next;
    });
  }

  function updateAssetField(path, nextValue, assetKey) {
    const field = path[path.length - 1];
    if (field !== "src") {
      updatePath(path, nextValue, path.join("."));
      return;
    }

    const assetPath = path.slice(0, -1);
    if (assetKey) invalidateAsset(assetKey);
    onChange((current) => {
      let nextDocument = documentBase(current.value);
      nextDocument = setIn(nextDocument, path, nextValue);
      nextDocument = setIn(nextDocument, [...assetPath, "width"], "");
      nextDocument = setIn(nextDocument, [...assetPath, "height"], "");
      return {
        ...current,
        mode: "structured",
        value: nextDocument,
        touched: true,
      };
    });
    onClearPath?.(`${CASE_STUDY_FIELD}.${path.join(".")}`);
    onClearPath?.(
      `${CASE_STUDY_FIELD}.${[...assetPath, "width"].join(".")}`,
    );
    onClearPath?.(
      `${CASE_STUDY_FIELD}.${[...assetPath, "height"].join(".")}`,
    );
    setUploadedAssets((current) => {
      if (!current.has(assetKey)) return current;
      const next = new Set(current);
      next.delete(assetKey);
      return next;
    });
  }

  async function uploadAsset(assetKey, file) {
    if (!onUploadImage) {
      throw new Error("Image upload is not available.");
    }
    const upload = beginAssetUpload(assetKey);
    const result = await onUploadImage(file);
    if (!assetUploadIsCurrent(upload, assetKey)) {
      return result;
    }

    const path = resolveAssetPath(
      draftRef.current.value ?? {},
      draftRef.current.rowIds ?? {},
      assetKey,
    );
    if (!path) return result;

    updateAssetFields(
      path,
      {
        src: result.image,
        width: result.image_width,
        height: result.image_height,
      },
      assetKey,
    );
    return result;
  }

  function markAssetUnlocked(assetKey) {
    setUploadedAssets((current) => {
      if (!current.has(assetKey)) return current;
      const next = new Set(current);
      next.delete(assetKey);
      return next;
    });
  }

  function addDiagram() {
    invalidateAsset(DIAGRAM_ASSET_KEY);
    markAssetUnlocked(DIAGRAM_ASSET_KEY);
    requestFocus(caseStudyDomId("architecture.diagram.src"));
    updatePath(
      ["architecture", "diagram"],
      { src: "", alt: "", width: "", height: "", caption: "" },
      DIAGRAM_ASSET_KEY,
    );
  }

  function removeDiagram() {
    invalidateAsset(DIAGRAM_ASSET_KEY);
    markAssetUnlocked(DIAGRAM_ASSET_KEY);
    requestFocus("case-study-architecture-diagram-add");
    updatePath(["architecture", "diagram"], null, DIAGRAM_ASSET_KEY);
  }

  function addOutcome() {
    setOutcomeNotice("");
    addCollectionRow(
      ["outcomes"],
      outcomes,
      { kind: "", statement: "" },
      "outcomes",
      "outcome",
      "kind",
    );
  }

  function removeOutcome(index) {
    setOutcomeNotice("");
    removeCollectionRow(["outcomes"], outcomes, index, "outcomes");
  }

  function updateOutcomeKind(index, nextKind) {
    const outcome = plainObject(outcomes[index]) ? outcomes[index] : {};
    if (
      nextKind === "qualitative" &&
      (outcome.kind === "quantitative" ||
        hasQuantitativeOutcomeFields(outcome))
    ) {
      const nextOutcome = {
        kind: "qualitative",
        statement: outcome.statement ?? "",
      };
      if (outcome.evidence !== undefined && outcome.evidence !== null) {
        nextOutcome.evidence = outcome.evidence;
      }
      updatePath(["outcomes", index], nextOutcome, `outcomes.${index}`);
      setOutcomeNotice(
        `Outcome ${index + 1} switched to qualitative. Metric, value, unit, baseline, and direction were cleared.`,
      );
      return;
    }

    updatePath(
      ["outcomes", index, "kind"],
      nextKind,
      `outcomes.${index}.kind`,
    );
    setOutcomeNotice(
      nextKind === "quantitative" && outcome.kind === "qualitative"
        ? `Outcome ${index + 1} switched to quantitative. Add a metric, value, and evidence.`
        : "",
    );
  }

  function addOutcomeEvidence(index) {
    requestFocus(caseStudyDomId(`outcomes.${index}.evidence.status`));
    updatePath(
      ["outcomes", index, "evidence"],
      { status: "", source: "", url: "", note: "" },
      `outcomes.${index}.evidence`,
    );
  }

  function removeOutcomeEvidence(index) {
    requestFocus(caseStudyDomId(`outcomes.${index}.evidence.add`));
    updatePath(
      ["outcomes", index, "evidence"],
      null,
      `outcomes.${index}.evidence`,
    );
  }

  function addGalleryItem() {
    addCollectionRow(
      ["gallery"],
      gallery,
      { src: "", alt: "", width: "", height: "", caption: "" },
      "gallery",
      "gallery",
      "src",
    );
  }

  function removeGalleryItem(index) {
    const assetKey = galleryAssetKey(index);
    invalidateAsset(assetKey);
    markAssetUnlocked(assetKey);
    removeCollectionRow(["gallery"], gallery, index, "gallery");
  }

  function addLink() {
    addCollectionRow(
      ["links"],
      links,
      { label: "", url: "", kind: "" },
      "links",
      "link",
      "label",
    );
  }

  function addComponent() {
    addCollectionRow(
      ["architecture", "components"],
      components,
      { name: "", role: "", technology: "" },
      "architectureComponents",
      "component",
      "name",
    );
  }

  function addDecision() {
    addCollectionRow(
      ["keyDecisions"],
      keyDecisions,
      { decision: "", rationale: "", tradeoff: "" },
      "keyDecisions",
      "decision",
      "decision",
    );
  }

  function addChallenge() {
    addCollectionRow(
      ["challenges"],
      challenges,
      { problem: "", resolution: "", lesson: "" },
      "challenges",
      "challenge",
      "problem",
    );
  }

  function addLearning() {
    addCollectionRow(["learnings"], learnings, "", "learnings", "learning");
  }

  const hasCaseStudy = draft.mode !== "absent";
  const recovering = draft.mode === "structured" && draft.recovering === true;
  const repairing = draft.mode === "raw" && draft.repairing === true;
  const canUseStructured = canUseStructuredEditor(draft);
  const status =
    draft.mode === "absent"
      ? "No case study is attached to this project."
      : repairing
        ? "Repair the stored JSON below, or create a structured replacement."
        : draft.mode === "raw"
          ? "The stored case study cannot be edited directly."
          : recovering
            ? "Create a valid replacement for the stored case study."
            : "Edit the case study sections below.";

  function storedProblemsList() {
    const problems = Array.isArray(draft.baselineProblems)
      ? draft.baselineProblems
      : Array.isArray(draft.rawProblems)
        ? draft.rawProblems
        : [];
    if (problems.length === 0) return null;

    return (
      <ul className="case-study-stored-problems">
        {problems.map((problem, index) => (
          <li key={index}>{problem}</li>
        ))}
      </ul>
    );
  }

  function rawDiagnostics() {
    if (draft.rawParseError) {
      return (
        <p className="admin-field-error case-study-raw-error" role="alert">
          JSON syntax error: {draft.rawParseError}
        </p>
      );
    }

    const problems = Array.isArray(draft.rawProblems) ? draft.rawProblems : [];
    if (problems.length === 0) return null;

    return (
      <div className="case-study-raw-error" role="alert">
        <p className="admin-field-error">
          The JSON parses, but the case study payload is invalid.
        </p>
        <ul className="case-study-stored-problems">
          {problems.map((problem, index) => (
            <li key={index}>{problem}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <section
      className="admin-card case-study-editor"
      aria-labelledby="case-study-heading"
    >
      <div className="case-study-header">
        <div>
          <h2 id="case-study-heading" tabIndex={-1}>
            Case study
          </h2>
          <p className="case-study-status">{status}</p>
        </div>
        {hasCaseStudy ? (
          <button
            ref={removeButtonRef}
            type="button"
            className="admin-btn admin-btn--danger"
            onClick={() => setConfirmingRemove(true)}
          >
            Remove case study
          </button>
        ) : null}
      </div>

      <p className="admin-field-hint case-study-privacy">
        Case study content is public. Do not include private client data or
        credentials.
      </p>

      <CaseStudyErrorSummary
        errors={errors}
        source={errorSource}
        mode={draft.mode}
        ref={errorSummaryRef}
      />

      {draft.mode === "absent" ? (
        <div className="case-study-empty">
          <p>
            Add the story, architecture, outcomes, evidence, links, and gallery
            for this project.
          </p>
          <button
            type="button"
            id="case-study-add-case-study"
            className="admin-btn"
            onClick={handleAdd}
          >
            Add case study
          </button>
        </div>
      ) : null}

      {draft.mode === "raw" ? (
        <div className="case-study-warning" role="status">
          <strong>This stored case study needs repair.</strong>
          <p>
            It is preserved unchanged when you save other project fields.
            Repair the original JSON, create a structured replacement, or
            remove it.
          </p>
          {storedProblemsList()}
          {draft.unsupportedSchemaVersion !== null &&
          draft.unsupportedSchemaVersion !== undefined ? (
            <p>
              This case study uses schemaVersion{" "}
              {draft.unsupportedSchemaVersion}. This editor supports
              schemaVersion {CASE_STUDY_SCHEMA_VERSION}.
            </p>
          ) : null}
          <div className="case-study-recovery-actions">
            {!repairing ? (
              <button
                type="button"
                id="case-study-repair-json"
                className="admin-btn admin-btn--secondary admin-btn--sm"
                onClick={handleStartRawRepair}
              >
                Repair existing JSON
              </button>
            ) : null}
            <button
              type="button"
              id="case-study-start-recovery"
              className="admin-btn admin-btn--secondary admin-btn--sm"
              onClick={handleStartRecovery}
            >
              Create structured replacement
            </button>
          </div>
        </div>
      ) : null}

      {repairing ? (
        <div className="case-study-raw-repair">
          <Field
            label="Stored case study JSON"
            htmlFor="case-study-raw-json"
            hint="Edit the original JSON. A valid document is sent as a complete replacement; an invalid document is never saved."
            error={
              draft.rawParseError
                ? "JSON syntax error."
                : Array.isArray(draft.rawProblems) && draft.rawProblems.length > 0
                  ? "Case study payload is invalid."
                  : undefined
            }
          >
            {(fieldId, linked) => (
              <textarea
                id={fieldId}
                className="admin-textarea case-study-raw-textarea"
                value={draft.rawText ?? ""}
                onChange={handleRawTextChange}
                aria-invalid={
                  draft.rawParseError ||
                  (Array.isArray(draft.rawProblems) &&
                    draft.rawProblems.length > 0)
                    ? "true"
                    : undefined
                }
                aria-describedby={linked.errorId ?? linked.hintId}
                spellCheck={false}
              />
            )}
          </Field>
          {rawDiagnostics()}
          <div className="case-study-recovery-actions">
            <button
              type="button"
              id="case-study-use-structured"
              className="admin-btn admin-btn--sm"
              disabled={!canUseStructured}
              onClick={handleUseStructuredEditor}
            >
              Use structured editor
            </button>
            <button
              type="button"
              id="case-study-cancel-raw-repair"
              className="admin-btn admin-btn--secondary admin-btn--sm"
              onClick={handleCancelRawRepair}
            >
              Cancel repair
            </button>
          </div>
        </div>
      ) : null}

      {recovering ? (
        <div className="case-study-warning case-study-recovery" role="status">
          <strong>You are creating a replacement.</strong>
          <p>
            The invalid stored case study is preserved until you save. The
            replacement must pass validation before it can be saved.
          </p>
          {storedProblemsList()}
          <div className="case-study-recovery-actions">
            <button
              type="button"
              id="case-study-cancel-recovery"
              className="admin-btn admin-btn--secondary admin-btn--sm"
              onClick={handleCancelRecovery}
            >
              Cancel recovery
            </button>
          </div>
        </div>
      ) : null}

      {draft.mode === "structured" ? (
        <>
          <CaseStudySection
            id="case-study-overview"
            title="Overview"
            description="Describe your role, the timeline, and the team behind the work."
          >
            <Field
              label="Role"
              htmlFor={caseStudyDomId("role")}
              hint="Optional. For example, lead full-stack developer."
              error={errorFor(errors, "role")}
            >
              {(fieldId, linked) => (
                <input
                  id={fieldId}
                  className="admin-input"
                  value={value.role ?? ""}
                  onChange={(event) => updateRole(event.target.value)}
                  onBlur={() => onBlurPath?.(`${CASE_STUDY_FIELD}.role`)}
                  aria-invalid={caseStudyInvalid(errorFor(errors, "role"))}
                  aria-describedby={linked.errorId || linked.hintId}
                />
              )}
            </Field>

            <fieldset
              id="case-study-timeline"
              tabIndex={-1}
              className="admin-fieldset case-study-subsection"
            >
              <legend>Timeline</legend>
              <p className="admin-field-hint case-study-section-description">
                Leave every timeline field blank to omit the timeline.
              </p>
              <div className="case-study-grid case-study-grid--two">
                <Field
                  label="Timeline label"
                  htmlFor={caseStudyDomId("timeline.label")}
                  error={errorFor(errors, "timeline.label")}
                >
                  {(fieldId, linked) => (
                    <input
                      id={fieldId}
                      className="admin-input"
                      value={timeline.label ?? ""}
                      onChange={(event) =>
                        updateTimelineField("label", event.target.value)
                      }
                      onBlur={() =>
                        onBlurPath?.(`${CASE_STUDY_FIELD}.timeline.label`)
                      }
                      aria-invalid={caseStudyInvalid(
                        errorFor(errors, "timeline.label"),
                      )}
                      aria-describedby={linked.errorId}
                    />
                  )}
                </Field>

                <Field
                  label="Timeline start"
                  htmlFor={caseStudyDomId("timeline.start")}
                  hint="YYYY or YYYY-MM"
                  error={errorFor(errors, "timeline.start")}
                >
                  {(fieldId, linked) => (
                    <input
                      id={fieldId}
                      className="admin-input"
                      inputMode="numeric"
                      placeholder="YYYY or YYYY-MM"
                      value={timeline.start ?? ""}
                      onChange={(event) =>
                        updateTimelineField("start", event.target.value)
                      }
                      onBlur={() =>
                        onBlurPath?.(`${CASE_STUDY_FIELD}.timeline.start`)
                      }
                      aria-invalid={caseStudyInvalid(
                        errorFor(errors, "timeline.start"),
                      )}
                      aria-describedby={linked.errorId || linked.hintId}
                    />
                  )}
                </Field>

                <Field
                  label="Timeline end"
                  htmlFor={caseStudyDomId("timeline.end")}
                  hint="YYYY or YYYY-MM"
                  error={errorFor(errors, "timeline.end")}
                >
                  {(fieldId, linked) => (
                    <input
                      id={fieldId}
                      className="admin-input"
                      inputMode="numeric"
                      placeholder="YYYY or YYYY-MM"
                      value={timeline.end ?? ""}
                      onChange={(event) =>
                        updateTimelineField("end", event.target.value)
                      }
                      onBlur={() =>
                        onBlurPath?.(`${CASE_STUDY_FIELD}.timeline.end`)
                      }
                      aria-invalid={caseStudyInvalid(errorFor(errors, "timeline.end"))}
                      aria-describedby={linked.errorId || linked.hintId}
                    />
                  )}
                </Field>

                <Field
                  label="Timeline duration"
                  htmlFor={caseStudyDomId("timeline.duration")}
                  error={errorFor(errors, "timeline.duration")}
                >
                  {(fieldId, linked) => (
                    <input
                      id={fieldId}
                      className="admin-input"
                      value={timeline.duration ?? ""}
                      onChange={(event) =>
                        updateTimelineField("duration", event.target.value)
                      }
                      onBlur={() =>
                        onBlurPath?.(`${CASE_STUDY_FIELD}.timeline.duration`)
                      }
                      aria-invalid={caseStudyInvalid(
                        errorFor(errors, "timeline.duration"),
                      )}
                      aria-describedby={linked.errorId}
                    />
                  )}
                </Field>
              </div>
            </fieldset>

            <fieldset
              id="case-study-team"
              tabIndex={-1}
              className="admin-fieldset case-study-subsection"
            >
              <legend>Team</legend>
              <p className="admin-field-hint case-study-section-description">
                Leave every team field blank to omit the team.
              </p>
              <div className="case-study-grid case-study-grid--two">
                <Field
                  label="Team size"
                  htmlFor={caseStudyDomId("team.size")}
                  error={errorFor(errors, "team.size")}
                >
                  {(fieldId, linked) => (
                    <input
                      id={fieldId}
                      className="admin-input"
                      type="number"
                      min="1"
                      step="1"
                      value={team.size ?? ""}
                      onChange={(event) =>
                        updateTeamField(
                          "size",
                          event.target.value === ""
                            ? null
                            : Number(event.target.value),
                        )
                      }
                      onBlur={() =>
                        onBlurPath?.(`${CASE_STUDY_FIELD}.team.size`)
                      }
                      aria-invalid={caseStudyInvalid(errorFor(errors, "team.size"))}
                      aria-describedby={linked.errorId}
                    />
                  )}
                </Field>

                <Field
                  label="Team note"
                  htmlFor={caseStudyDomId("team.note")}
                  error={errorFor(errors, "team.note")}
                >
                  {(fieldId, linked) => (
                    <textarea
                      id={fieldId}
                      className="admin-textarea"
                      value={team.note ?? ""}
                      onChange={(event) =>
                        updateTeamField("note", event.target.value)
                      }
                      onBlur={() =>
                        onBlurPath?.(`${CASE_STUDY_FIELD}.team.note`)
                      }
                      aria-invalid={caseStudyInvalid(errorFor(errors, "team.note"))}
                      aria-describedby={linked.errorId}
                    />
                  )}
                </Field>
              </div>

              <RepeatableGroup
                id={caseStudyDomId("team.roles")}
                title="Team roles"
                description="Add each team role separately. Up to 10."
                addLabel="Add team role"
                itemName="team role"
                items={roles}
                itemIds={roleIds}
                maxItems={10}
                onAdd={addRole}
                onRemove={removeRoleRow}
                groupError={errorFor(errors, "team.roles")}
                emptyText="No team roles added yet."
                renderItem={(role, index) => (
                  <Field
                    label={`Team role ${index + 1}`}
                    htmlFor={caseStudyDomId(`team.roles.${index}`)}
                    required
                    error={errorFor(errors, `team.roles.${index}`)}
                  >
                    {(fieldId, linked) => (
                      <input
                        id={fieldId}
                        className="admin-input"
                        value={role ?? ""}
                        onChange={(event) =>
                          updateRoleRow(index, event.target.value)
                        }
                        onBlur={() =>
                          onBlurPath?.(
                            `${CASE_STUDY_FIELD}.team.roles.${index}`,
                          )
                        }
                        aria-invalid={caseStudyInvalid(
                          errorFor(errors, `team.roles.${index}`),
                        )}
                        aria-describedby={linked.errorId}
                      />
                    )}
                  </Field>
                )}
              />
            </fieldset>
          </CaseStudySection>

          <CaseStudySection
            id={caseStudyDomId("problem")}
            title="Problem"
            description="Explain the problem and the context around it. Leave both fields blank to omit this section."
          >
            <Field
              label="Problem summary"
              htmlFor={caseStudyDomId("problem.summary")}
              hint="Required when problem details are present."
              error={errorFor(errors, "problem.summary")}
            >
              {(fieldId, linked) => (
                <textarea
                  id={fieldId}
                  className="admin-textarea"
                  value={problem.summary ?? ""}
                  onChange={(event) =>
                    updateProblemField("summary", event.target.value)
                  }
                  onBlur={() =>
                    onBlurPath?.(`${CASE_STUDY_FIELD}.problem.summary`)
                  }
                  aria-invalid={caseStudyInvalid(
                    errorFor(errors, "problem.summary"),
                  )}
                  aria-describedby={linked.errorId || linked.hintId}
                />
              )}
            </Field>

            <Field
              label="Problem context"
              htmlFor={caseStudyDomId("problem.context")}
              error={errorFor(errors, "problem.context")}
            >
              {(fieldId, linked) => (
                <textarea
                  id={fieldId}
                  className="admin-textarea"
                  value={problem.context ?? ""}
                  onChange={(event) =>
                    updateProblemField("context", event.target.value)
                  }
                  onBlur={() =>
                    onBlurPath?.(`${CASE_STUDY_FIELD}.problem.context`)
                  }
                  aria-invalid={caseStudyInvalid(
                    errorFor(errors, "problem.context"),
                  )}
                  aria-describedby={linked.errorId}
                />
              )}
            </Field>
          </CaseStudySection>

          <CaseStudySection
            id={`${caseStudyDomId("constraints")}-section`}
            title="Constraints"
            description="Add the constraints that shaped the work. Up to 12."
          >
            <RepeatableGroup
              id={caseStudyDomId("constraints")}
              title="Constraint rows"
              addLabel="Add constraint"
              itemName="constraint"
              items={constraints}
              itemIds={constraintIds}
              maxItems={12}
              onAdd={addConstraint}
              onRemove={removeConstraint}
              groupError={errorFor(errors, "constraints")}
              emptyText="No constraints added yet."
              renderItem={(constraint, index) => (
                <Field
                  label={`Constraint ${index + 1}`}
                  htmlFor={caseStudyDomId(`constraints.${index}`)}
                  required
                  error={errorFor(errors, `constraints.${index}`)}
                >
                  {(fieldId, linked) => (
                    <input
                      id={fieldId}
                      className="admin-input"
                      value={constraint ?? ""}
                      onChange={(event) =>
                        updateConstraint(index, event.target.value)
                      }
                      onBlur={() =>
                        onBlurPath?.(
                          `${CASE_STUDY_FIELD}.constraints.${index}`,
                        )
                      }
                      aria-invalid={caseStudyInvalid(
                        errorFor(errors, `constraints.${index}`),
                      )}
                      aria-describedby={linked.errorId}
                    />
                  )}
                </Field>
              )}
            />
          </CaseStudySection>

          <CaseStudySection
            id={`${caseStudyDomId("approach")}-section`}
            title="Approach"
            description="Summarize the approach as ordered steps. Up to 12."
          >
            <RepeatableGroup
              id={caseStudyDomId("approach")}
              title="Approach steps"
              addLabel="Add approach step"
              itemName="approach step"
              items={approach}
              itemIds={approachIds}
              maxItems={12}
              onAdd={addApproachStep}
              onRemove={removeApproachStep}
              onMove={moveApproachStep}
              groupError={errorFor(errors, "approach")}
              emptyText="No approach steps added yet."
              renderItem={(step, index) => (
                <>
                  <Field
                    label={`Approach step ${index + 1} heading`}
                    htmlFor={caseStudyDomId(`approach.${index}.heading`)}
                    required
                    error={errorFor(errors, `approach.${index}.heading`)}
                  >
                    {(fieldId, linked) => (
                      <input
                        id={fieldId}
                        className="admin-input"
                        value={step?.heading ?? ""}
                        onChange={(event) =>
                          updateApproachField(
                            index,
                            "heading",
                            event.target.value,
                          )
                        }
                        onBlur={() =>
                          onBlurPath?.(
                            `${CASE_STUDY_FIELD}.approach.${index}.heading`,
                          )
                        }
                        aria-invalid={caseStudyInvalid(
                          errorFor(errors, `approach.${index}.heading`),
                        )}
                        aria-describedby={linked.errorId}
                      />
                    )}
                  </Field>

                  <Field
                    label={`Approach step ${index + 1} body`}
                    htmlFor={caseStudyDomId(`approach.${index}.body`)}
                    required
                    error={errorFor(errors, `approach.${index}.body`)}
                  >
                    {(fieldId, linked) => (
                      <textarea
                        id={fieldId}
                        className="admin-textarea"
                        value={step?.body ?? ""}
                        onChange={(event) =>
                          updateApproachField(
                            index,
                            "body",
                            event.target.value,
                          )
                        }
                        onBlur={() =>
                          onBlurPath?.(
                            `${CASE_STUDY_FIELD}.approach.${index}.body`,
                          )
                        }
                        aria-invalid={caseStudyInvalid(
                          errorFor(errors, `approach.${index}.body`),
                        )}
                        aria-describedby={linked.errorId}
                      />
                    )}
                  </Field>
                </>
              )}
            />
          </CaseStudySection>

          <CaseStudySection
            id={`${caseStudyDomId("architecture")}-section`}
            title="Architecture"
            description="Explain how the system fits together and list its main components. Leave the section blank to omit it."
          >
            <Field
              label="Architecture summary"
              htmlFor={caseStudyDomId("architecture.summary")}
              hint="Required when architecture details are present."
              error={errorFor(errors, "architecture.summary")}
            >
              {(fieldId, linked) => (
                <textarea
                  id={fieldId}
                  className="admin-textarea"
                  value={architecture.summary ?? ""}
                  onChange={(event) =>
                    updatePath(
                      ["architecture", "summary"],
                      event.target.value,
                    )
                  }
                  onBlur={() =>
                    onBlurPath?.(
                      `${CASE_STUDY_FIELD}.architecture.summary`,
                    )
                  }
                  aria-invalid={caseStudyInvalid(
                    errorFor(errors, "architecture.summary"),
                  )}
                  aria-describedby={linked.errorId || linked.hintId}
                />
              )}
            </Field>

            <RepeatableGroup
              id={caseStudyDomId("architecture.components")}
              title="Architecture components"
              description="Add each component separately. Up to 20."
              addLabel="Add architecture component"
              itemName="architecture component"
              items={components}
              itemIds={componentIds}
              maxItems={20}
              onAdd={addComponent}
              onRemove={(index) =>
                removeCollectionRow(
                  ["architecture", "components"],
                  components,
                  index,
                  "architectureComponents",
                )
              }
              onMove={(from, to) =>
                moveCollectionRow(
                  ["architecture", "components"],
                  components,
                  from,
                  to,
                  "architectureComponents",
                )
              }
              groupError={errorFor(errors, "architecture.components")}
              emptyText="No architecture components added yet."
              renderItem={(component, index) => (
                <>
                  <Field
                    label={`Architecture component ${index + 1} name`}
                    htmlFor={caseStudyDomId(`architecture.components.${index}.name`)}
                    required
                    error={errorFor(
                      errors,
                      `architecture.components.${index}.name`,
                    )}
                  >
                    {(fieldId, linked) => (
                      <input
                        id={fieldId}
                        className="admin-input"
                        value={component?.name ?? ""}
                        onChange={(event) =>
                          updatePath(
                            [
                              "architecture",
                              "components",
                              index,
                              "name",
                            ],
                            event.target.value,
                          )
                        }
                        onBlur={() =>
                          onBlurPath?.(
                            `${CASE_STUDY_FIELD}.architecture.components.${index}.name`,
                          )
                        }
                        aria-invalid={caseStudyInvalid(
                          errorFor(
                            errors,
                            `architecture.components.${index}.name`,
                          ),
                        )}
                        aria-describedby={linked.errorId}
                      />
                    )}
                  </Field>

                  <Field
                    label={`Architecture component ${index + 1} role`}
                    htmlFor={caseStudyDomId(`architecture.components.${index}.role`)}
                    required
                    error={errorFor(
                      errors,
                      `architecture.components.${index}.role`,
                    )}
                  >
                    {(fieldId, linked) => (
                      <input
                        id={fieldId}
                        className="admin-input"
                        value={component?.role ?? ""}
                        onChange={(event) =>
                          updatePath(
                            [
                              "architecture",
                              "components",
                              index,
                              "role",
                            ],
                            event.target.value,
                          )
                        }
                        onBlur={() =>
                          onBlurPath?.(
                            `${CASE_STUDY_FIELD}.architecture.components.${index}.role`,
                          )
                        }
                        aria-invalid={caseStudyInvalid(
                          errorFor(
                            errors,
                            `architecture.components.${index}.role`,
                          ),
                        )}
                        aria-describedby={linked.errorId}
                      />
                    )}
                  </Field>

                  <Field
                    label={`Architecture component ${index + 1} technology`}
                    htmlFor={caseStudyDomId(`architecture.components.${index}.technology`)}
                    error={errorFor(
                      errors,
                      `architecture.components.${index}.technology`,
                    )}
                  >
                    {(fieldId, linked) => (
                      <input
                        id={fieldId}
                        className="admin-input"
                        value={component?.technology ?? ""}
                        onChange={(event) =>
                          updatePath(
                            [
                              "architecture",
                              "components",
                              index,
                              "technology",
                            ],
                            event.target.value,
                          )
                        }
                        onBlur={() =>
                          onBlurPath?.(
                            `${CASE_STUDY_FIELD}.architecture.components.${index}.technology`,
                          )
                        }
                        aria-invalid={caseStudyInvalid(
                          errorFor(
                            errors,
                            `architecture.components.${index}.technology`,
                          ),
                        )}
                        aria-describedby={linked.errorId}
                      />
                    )}
                  </Field>
                </>
              )}
            />

            <fieldset
              id={caseStudyDomId("architecture.diagram")}
              tabIndex={-1}
              className="admin-fieldset case-study-subsection"
            >
              <legend>Architecture diagram</legend>
              <p className="admin-field-hint case-study-section-description">
                Optional. Upload an image or use a project image path.
              </p>
              {diagram ? (
                <>
                  <ImageAssetField
                    label="Architecture diagram"
                    path={["architecture", "diagram"]}
                    value={diagram}
                    errors={errors}
                    onFieldChange={(path, nextValue) =>
                      updateAssetField(path, nextValue, DIAGRAM_ASSET_KEY)
                    }
                    onUpload={
                      onUploadImage
                        ? (file) => uploadAsset(DIAGRAM_ASSET_KEY, file)
                        : undefined
                    }
                    onBlur={(path) =>
                      onBlurPath?.(`${CASE_STUDY_FIELD}.${path}`)
                    }
                    dimensionsLocked={uploadedAssets.has(DIAGRAM_ASSET_KEY)}
                    uploadFileLabel="Upload image file for architecture diagram"
                  />
                  <button
                    type="button"
                    className="admin-btn admin-btn--danger admin-btn--sm"
                    onClick={removeDiagram}
                  >
                    Remove architecture diagram
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  id={caseStudyDomId("architecture.diagram.add")}
                  className="admin-btn admin-btn--secondary admin-btn--sm"
                  onClick={addDiagram}
                >
                  Add architecture diagram
                </button>
              )}
            </fieldset>
          </CaseStudySection>

          <CaseStudySection
            id={`${caseStudyDomId("keyDecisions")}-section`}
            title="Key decisions"
            description="Record the important choices, why you made them, and what you traded off. Up to 10."
          >
            <RepeatableGroup
              id={caseStudyDomId("keyDecisions")}
              title="Decision rows"
              addLabel="Add key decision"
              itemName="key decision"
              items={keyDecisions}
              itemIds={decisionIds}
              maxItems={10}
              onAdd={addDecision}
              onRemove={(index) =>
                removeCollectionRow(
                  ["keyDecisions"],
                  keyDecisions,
                  index,
                  "keyDecisions",
                )
              }
              onMove={(from, to) =>
                moveCollectionRow(
                  ["keyDecisions"],
                  keyDecisions,
                  from,
                  to,
                  "keyDecisions",
                )
              }
              groupError={errorFor(errors, "keyDecisions")}
              emptyText="No key decisions added yet."
              renderItem={(decision, index) => (
                <>
                  <Field
                    label={`Key decision ${index + 1} decision`}
                    htmlFor={caseStudyDomId(`keyDecisions.${index}.decision`)}
                    required
                    error={errorFor(
                      errors,
                      `keyDecisions.${index}.decision`,
                    )}
                  >
                    {(fieldId, linked) => (
                      <input
                        id={fieldId}
                        className="admin-input"
                        value={decision?.decision ?? ""}
                        onChange={(event) =>
                          updatePath(
                            ["keyDecisions", index, "decision"],
                            event.target.value,
                          )
                        }
                        onBlur={() =>
                          onBlurPath?.(
                            `${CASE_STUDY_FIELD}.keyDecisions.${index}.decision`,
                          )
                        }
                        aria-invalid={caseStudyInvalid(
                          errorFor(
                            errors,
                            `keyDecisions.${index}.decision`,
                          ),
                        )}
                        aria-describedby={linked.errorId}
                      />
                    )}
                  </Field>

                  <Field
                    label={`Key decision ${index + 1} rationale`}
                    htmlFor={caseStudyDomId(`keyDecisions.${index}.rationale`)}
                    required
                    error={errorFor(
                      errors,
                      `keyDecisions.${index}.rationale`,
                    )}
                  >
                    {(fieldId, linked) => (
                      <textarea
                        id={fieldId}
                        className="admin-textarea"
                        value={decision?.rationale ?? ""}
                        onChange={(event) =>
                          updatePath(
                            ["keyDecisions", index, "rationale"],
                            event.target.value,
                          )
                        }
                        onBlur={() =>
                          onBlurPath?.(
                            `${CASE_STUDY_FIELD}.keyDecisions.${index}.rationale`,
                          )
                        }
                        aria-invalid={caseStudyInvalid(
                          errorFor(
                            errors,
                            `keyDecisions.${index}.rationale`,
                          ),
                        )}
                        aria-describedby={linked.errorId}
                      />
                    )}
                  </Field>

                  <Field
                    label={`Key decision ${index + 1} tradeoff`}
                    htmlFor={caseStudyDomId(`keyDecisions.${index}.tradeoff`)}
                    error={errorFor(
                      errors,
                      `keyDecisions.${index}.tradeoff`,
                    )}
                  >
                    {(fieldId, linked) => (
                      <textarea
                        id={fieldId}
                        className="admin-textarea"
                        value={decision?.tradeoff ?? ""}
                        onChange={(event) =>
                          updatePath(
                            ["keyDecisions", index, "tradeoff"],
                            event.target.value,
                          )
                        }
                        onBlur={() =>
                          onBlurPath?.(
                            `${CASE_STUDY_FIELD}.keyDecisions.${index}.tradeoff`,
                          )
                        }
                        aria-invalid={caseStudyInvalid(
                          errorFor(
                            errors,
                            `keyDecisions.${index}.tradeoff`,
                          ),
                        )}
                        aria-describedby={linked.errorId}
                      />
                    )}
                  </Field>
                </>
              )}
            />
          </CaseStudySection>

          <CaseStudySection
            id={`${caseStudyDomId("challenges")}-section`}
            title="Challenges"
            description="Describe the hardest problems, how you resolved them, and what you learned. Up to 10."
          >
            <RepeatableGroup
              id={caseStudyDomId("challenges")}
              title="Challenge rows"
              addLabel="Add challenge"
              itemName="challenge"
              items={challenges}
              itemIds={challengeIds}
              maxItems={10}
              onAdd={addChallenge}
              onRemove={(index) =>
                removeCollectionRow(
                  ["challenges"],
                  challenges,
                  index,
                  "challenges",
                )
              }
              onMove={(from, to) =>
                moveCollectionRow(
                  ["challenges"],
                  challenges,
                  from,
                  to,
                  "challenges",
                )
              }
              groupError={errorFor(errors, "challenges")}
              emptyText="No challenges added yet."
              renderItem={(challenge, index) => (
                <>
                  <Field
                    label={`Challenge ${index + 1} problem`}
                    htmlFor={caseStudyDomId(`challenges.${index}.problem`)}
                    required
                    error={errorFor(
                      errors,
                      `challenges.${index}.problem`,
                    )}
                  >
                    {(fieldId, linked) => (
                      <textarea
                        id={fieldId}
                        className="admin-textarea"
                        value={challenge?.problem ?? ""}
                        onChange={(event) =>
                          updatePath(
                            ["challenges", index, "problem"],
                            event.target.value,
                          )
                        }
                        onBlur={() =>
                          onBlurPath?.(
                            `${CASE_STUDY_FIELD}.challenges.${index}.problem`,
                          )
                        }
                        aria-invalid={caseStudyInvalid(
                          errorFor(
                            errors,
                            `challenges.${index}.problem`,
                          ),
                        )}
                        aria-describedby={linked.errorId}
                      />
                    )}
                  </Field>

                  <Field
                    label={`Challenge ${index + 1} resolution`}
                    htmlFor={caseStudyDomId(`challenges.${index}.resolution`)}
                    required
                    error={errorFor(
                      errors,
                      `challenges.${index}.resolution`,
                    )}
                  >
                    {(fieldId, linked) => (
                      <textarea
                        id={fieldId}
                        className="admin-textarea"
                        value={challenge?.resolution ?? ""}
                        onChange={(event) =>
                          updatePath(
                            ["challenges", index, "resolution"],
                            event.target.value,
                          )
                        }
                        onBlur={() =>
                          onBlurPath?.(
                            `${CASE_STUDY_FIELD}.challenges.${index}.resolution`,
                          )
                        }
                        aria-invalid={caseStudyInvalid(
                          errorFor(
                            errors,
                            `challenges.${index}.resolution`,
                          ),
                        )}
                        aria-describedby={linked.errorId}
                      />
                    )}
                  </Field>

                  <Field
                    label={`Challenge ${index + 1} lesson`}
                    htmlFor={caseStudyDomId(`challenges.${index}.lesson`)}
                    error={errorFor(
                      errors,
                      `challenges.${index}.lesson`,
                    )}
                  >
                    {(fieldId, linked) => (
                      <textarea
                        id={fieldId}
                        className="admin-textarea"
                        value={challenge?.lesson ?? ""}
                        onChange={(event) =>
                          updatePath(
                            ["challenges", index, "lesson"],
                            event.target.value,
                          )
                        }
                        onBlur={() =>
                          onBlurPath?.(
                            `${CASE_STUDY_FIELD}.challenges.${index}.lesson`,
                          )
                        }
                        aria-invalid={caseStudyInvalid(
                          errorFor(
                            errors,
                            `challenges.${index}.lesson`,
                          ),
                        )}
                        aria-describedby={linked.errorId}
                      />
                    )}
                  </Field>
                </>
              )}
            />
          </CaseStudySection>

          <CaseStudySection
            id={`${caseStudyDomId("outcomes")}-section`}
            title="Outcomes and evidence"
            description="Record what changed and back it with evidence. Quantitative outcomes need a metric, value, and evidence."
          >
            {outcomeNotice ? (
              <p className="admin-field-hint" role="status">
                {outcomeNotice}
              </p>
            ) : null}

            <RepeatableGroup
              id={caseStudyDomId("outcomes")}
              title="Outcome rows"
              addLabel="Add outcome"
              itemName="outcome"
              items={outcomes}
              itemIds={outcomeIds}
              maxItems={12}
              onAdd={addOutcome}
              onRemove={removeOutcome}
              onMove={(from, to) =>
                moveCollectionRow(
                  ["outcomes"],
                  outcomes,
                  from,
                  to,
                  "outcomes",
                )
              }
              groupError={errorFor(errors, "outcomes")}
              emptyText="No outcomes added yet."
              renderItem={(outcome, index) => (
                <OutcomeFields
                  outcome={outcome}
                  index={index}
                  errors={errors}
                  onFieldChange={(path, nextValue) =>
                    updatePath(path, nextValue, path.join("."))
                  }
                  onKindChange={(kind) =>
                    updateOutcomeKind(index, kind)
                  }
                  onAddEvidence={addOutcomeEvidence}
                  onRemoveEvidence={removeOutcomeEvidence}
                  onBlur={(path) =>
                    onBlurPath?.(`${CASE_STUDY_FIELD}.${path}`)
                  }
                />
              )}
            />
          </CaseStudySection>

          <CaseStudySection
            id={`${caseStudyDomId("learnings")}-section`}
            title="Learnings"
            description="Capture the lessons you would carry into the next project. Up to 12."
          >
            <RepeatableGroup
              id={caseStudyDomId("learnings")}
              title="Learning rows"
              addLabel="Add learning"
              itemName="learning"
              items={learnings}
              itemIds={learningIds}
              maxItems={12}
              onAdd={addLearning}
              onRemove={(index) =>
                removeCollectionRow(
                  ["learnings"],
                  learnings,
                  index,
                  "learnings",
                )
              }
              onMove={(from, to) =>
                moveCollectionRow(
                  ["learnings"],
                  learnings,
                  from,
                  to,
                  "learnings",
                )
              }
              groupError={errorFor(errors, "learnings")}
              emptyText="No learnings added yet."
              renderItem={(learning, index) => (
                <Field
                  label={`Learning ${index + 1}`}
                  htmlFor={caseStudyDomId(`learnings.${index}`)}
                  required
                  error={errorFor(errors, `learnings.${index}`)}
                >
                  {(fieldId, linked) => (
                    <textarea
                      id={fieldId}
                      className="admin-textarea"
                      value={learning ?? ""}
                      onChange={(event) =>
                        updatePath(
                          ["learnings", index],
                          event.target.value,
                        )
                      }
                      onBlur={() =>
                        onBlurPath?.(
                          `${CASE_STUDY_FIELD}.learnings.${index}`,
                        )
                      }
                      aria-invalid={caseStudyInvalid(
                        errorFor(errors, `learnings.${index}`),
                      )}
                      aria-describedby={linked.errorId}
                    />
                  )}
                </Field>
              )}
            />
          </CaseStudySection>

          <CaseStudySection
            id={`${caseStudyDomId("links")}-section`}
            title="Links"
            description="Add demos, source repositories, and writeups. Up to 10 unique URLs."
          >
            <RepeatableGroup
              id={caseStudyDomId("links")}
              title="Link rows"
              addLabel="Add link"
              itemName="link"
              items={links}
              itemIds={linkIds}
              maxItems={10}
              onAdd={addLink}
              onRemove={(index) =>
                removeCollectionRow(["links"], links, index, "links")
              }
              onMove={(from, to) =>
                moveCollectionRow(["links"], links, from, to, "links")
              }
              groupError={errorFor(errors, "links")}
              emptyText="No links added yet."
              renderItem={(link, index) => (
                <>
                  <Field
                    label={`Link ${index + 1} label`}
                    htmlFor={caseStudyDomId(`links.${index}.label`)}
                    required
                    error={errorFor(errors, `links.${index}.label`)}
                  >
                    {(fieldId, linked) => (
                      <input
                        id={fieldId}
                        className="admin-input"
                        value={link?.label ?? ""}
                        onChange={(event) =>
                          updatePath(
                            ["links", index, "label"],
                            event.target.value,
                          )
                        }
                        onBlur={() =>
                          onBlurPath?.(
                            `${CASE_STUDY_FIELD}.links.${index}.label`,
                          )
                        }
                        aria-invalid={caseStudyInvalid(
                          errorFor(errors, `links.${index}.label`),
                        )}
                        aria-describedby={linked.errorId}
                      />
                    )}
                  </Field>

                  <Field
                    label={`Link ${index + 1} URL`}
                    htmlFor={caseStudyDomId(`links.${index}.url`)}
                    hint="Required absolute http(s) URL."
                    required
                    error={errorFor(errors, `links.${index}.url`)}
                  >
                    {(fieldId, linked) => (
                      <input
                        id={fieldId}
                        className="admin-input"
                        value={link?.url ?? ""}
                        onChange={(event) =>
                          updatePath(
                            ["links", index, "url"],
                            event.target.value,
                          )
                        }
                        onBlur={() =>
                          onBlurPath?.(
                            `${CASE_STUDY_FIELD}.links.${index}.url`,
                          )
                        }
                        aria-invalid={caseStudyInvalid(
                          errorFor(errors, `links.${index}.url`),
                        )}
                        aria-describedby={linked.errorId || linked.hintId}
                      />
                    )}
                  </Field>

                  <Field
                    label={`Link ${index + 1} kind`}
                    htmlFor={caseStudyDomId(`links.${index}.kind`)}
                    required
                    error={errorFor(errors, `links.${index}.kind`)}
                  >
                    {(fieldId, linked) => (
                      <select
                        id={fieldId}
                        className="admin-input"
                        value={link?.kind ?? ""}
                        onChange={(event) =>
                          updatePath(
                            ["links", index, "kind"],
                            event.target.value,
                          )
                        }
                        onBlur={() =>
                          onBlurPath?.(
                            `${CASE_STUDY_FIELD}.links.${index}.kind`,
                          )
                        }
                        aria-invalid={caseStudyInvalid(
                          errorFor(errors, `links.${index}.kind`),
                        )}
                        aria-describedby={linked.errorId}
                      >
                        <option value="">Choose a kind</option>
                        <option value="demo">Demo</option>
                        <option value="source">Source</option>
                        <option value="writeup">Writeup</option>
                        <option value="other">Other</option>
                      </select>
                    )}
                  </Field>
                </>
              )}
            />
          </CaseStudySection>

          <CaseStudySection
            id={`${caseStudyDomId("gallery")}-section`}
            title="Gallery"
            description="Add screenshots or supporting images. Up to 12."
          >
            <RepeatableGroup
              id={caseStudyDomId("gallery")}
              title="Gallery images"
              addLabel="Add gallery image"
              itemName="gallery image"
              items={gallery}
              itemIds={galleryIds}
              maxItems={12}
              onAdd={addGalleryItem}
              onRemove={removeGalleryItem}
              onMove={(from, to) =>
                moveCollectionRow(
                  ["gallery"],
                  gallery,
                  from,
                  to,
                  "gallery",
                )
              }
              groupError={errorFor(errors, "gallery")}
              emptyText="No gallery images added yet."
              renderItem={(image, index) => {
                const assetKey = galleryAssetKey(index);
                return (
                  <ImageAssetField
                    label={`Gallery image ${index + 1}`}
                    path={["gallery", index]}
                    value={image}
                    errors={errors}
                    onFieldChange={(path, nextValue) =>
                      updateAssetField(path, nextValue, assetKey)
                    }
                    onUpload={
                      onUploadImage
                        ? (file) => uploadAsset(assetKey, file)
                        : undefined
                    }
                    onBlur={(path) =>
                      onBlurPath?.(`${CASE_STUDY_FIELD}.${path}`)
                    }
                    dimensionsLocked={uploadedAssets.has(assetKey)}
                    uploadFileLabel={`Upload image file for gallery image ${index + 1}`}
                  />
                );
              }}
            />
          </CaseStudySection>
        </>
      ) : null}

      <ConfirmDialog
        open={confirmingRemove}
        title="Remove case study?"
        message="This removes the entire case study when you save the project. This cannot be undone."
        confirmLabel="Remove case study"
        onCancel={handleRemoveCancelled}
        onConfirm={handleRemoveConfirmed}
      />
    </section>
  );
}
