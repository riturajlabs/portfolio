import { forwardRef } from "react";

import {
  CASE_STUDY_FIELD,
  isCaseStudyErrorPath,
  normalizeCaseStudyPath,
} from "../../lib/caseStudy.js";
import { caseStudyDomId } from "./caseStudyFields.js";

const SIMPLE_LABELS = {
  "": "Case study",
  schemaVersion: "Schema version",
  role: "Role",
  timeline: "Timeline",
  "timeline.label": "Timeline label",
  "timeline.start": "Timeline start",
  "timeline.end": "Timeline end",
  "timeline.duration": "Timeline duration",
  team: "Team",
  "team.size": "Team size",
  "team.roles": "Team roles",
  "team.note": "Team note",
  problem: "Problem",
  "problem.summary": "Problem summary",
  "problem.context": "Problem context",
  constraints: "Constraints",
  approach: "Approach steps",
  architecture: "Architecture",
  "architecture.summary": "Architecture summary",
  "architecture.components": "Architecture components",
  "architecture.diagram": "Architecture diagram",
  keyDecisions: "Key decisions",
  challenges: "Challenges",
  outcomes: "Outcomes",
  learnings: "Learnings",
  links: "Links",
  gallery: "Gallery",
};

const FIELD_NAMES = {
  src: "source",
  alt: "alt text",
  width: "width",
  height: "height",
  caption: "caption",
  name: "name",
  role: "role",
  technology: "technology",
  decision: "decision",
  rationale: "rationale",
  tradeoff: "tradeoff",
  problem: "problem",
  resolution: "resolution",
  lesson: "lesson",
  kind: "kind",
  statement: "statement",
  metric: "metric",
  value: "value",
  unit: "unit",
  baseline: "baseline",
  direction: "direction",
  status: "status",
  source: "source",
  url: "URL",
  note: "note",
  label: "label",
};

const NAVIGABLE_SECTIONS = new Set([
  "role",
  "timeline",
  "team",
  "problem",
  "constraints",
  "approach",
  "architecture",
  "keyDecisions",
  "challenges",
  "outcomes",
  "learnings",
  "links",
  "gallery",
]);

function relativePath(path) {
  if (path === CASE_STUDY_FIELD) return "";
  if (!path.startsWith(`${CASE_STUDY_FIELD}.`)) return path;
  return path.slice(CASE_STUDY_FIELD.length + 1);
}

function targetIdForPath(path, mode = "structured") {
  if (mode !== "structured") return "case-study-heading";

  const relative = relativePath(normalizeCaseStudyPath(path));
  if (!relative || relative === "schemaVersion") return "case-study-heading";

  const parts = relative.split(".");
  const section = parts[0];
  if (!NAVIGABLE_SECTIONS.has(section)) return "case-study-heading";
  if (relative === "architecture") return `${caseStudyDomId(relative)}-section`;

  if (section === "approach" && parts.length === 2) {
    return caseStudyDomId(`${relative}.heading`);
  }
  if (
    section === "architecture" &&
    parts[1] === "components" &&
    parts.length === 3
  ) {
    return caseStudyDomId(`${relative}.name`);
  }
  if (section === "keyDecisions" && parts.length === 2) {
    return caseStudyDomId(`${relative}.decision`);
  }
  if (section === "challenges" && parts.length === 2) {
    return caseStudyDomId(`${relative}.problem`);
  }
  if (section === "outcomes" && parts.length === 2) {
    return caseStudyDomId(`${relative}.kind`);
  }
  if (section === "links" && parts.length === 2) {
    return caseStudyDomId(`${relative}.label`);
  }
  if (section === "gallery" && parts.length === 2) {
    return `${caseStudyDomId(relative)}-src`;
  }

  return caseStudyDomId(relative);
}

function focusTarget(id) {
  const target = typeof document !== "undefined" ? document.getElementById(id) : null;
  if (target && typeof target.focus === "function") target.focus();
}

function withField(base, field) {
  const name = FIELD_NAMES[field];
  return name ? `${base} ${name}` : base;
}

function labelForPath(path) {
  const relative = relativePath(path);
  if (Object.prototype.hasOwnProperty.call(SIMPLE_LABELS, relative)) {
    return SIMPLE_LABELS[relative];
  }

  const parts = relative.split(".");

  if (parts[0] === "constraints") {
    return parts[1] === undefined
      ? SIMPLE_LABELS.constraints
      : `Constraint ${Number(parts[1]) + 1}`;
  }

  if (parts[0] === "approach" && parts[1] !== undefined) {
    return withField(
      `Approach step ${Number(parts[1]) + 1}`,
      parts[2],
    );
  }

  if (parts[0] === "team" && parts[1] === "roles" && parts[2] !== undefined) {
    return `Team role ${Number(parts[2]) + 1}`;
  }

  if (parts[0] === "architecture" && parts[1] === "components") {
    if (parts[2] === undefined) return SIMPLE_LABELS["architecture.components"];
    return withField(
      `Architecture component ${Number(parts[2]) + 1}`,
      parts[3],
    );
  }

  if (parts[0] === "architecture" && parts[1] === "diagram") {
    if (parts[2] === undefined) return SIMPLE_LABELS["architecture.diagram"];
    return withField("Architecture diagram", parts[2]);
  }

  if (parts[0] === "keyDecisions" && parts[1] !== undefined) {
    return withField(`Key decision ${Number(parts[1]) + 1}`, parts[2]);
  }

  if (parts[0] === "challenges" && parts[1] !== undefined) {
    return withField(`Challenge ${Number(parts[1]) + 1}`, parts[2]);
  }

  if (parts[0] === "outcomes" && parts[1] !== undefined) {
    const base = `Outcome ${Number(parts[1]) + 1}`;
    if (parts[2] === "evidence") {
      if (parts[3] === undefined) return `${base} evidence`;
      return withField(`${base} evidence`, parts[3]);
    }
    return withField(base, parts[2]);
  }

  if (parts[0] === "learnings" && parts[1] !== undefined) {
    return `Learning ${Number(parts[1]) + 1}`;
  }

  if (parts[0] === "links" && parts[1] !== undefined) {
    return withField(`Link ${Number(parts[1]) + 1}`, parts[2]);
  }

  if (parts[0] === "gallery" && parts[1] !== undefined) {
    return withField(`Gallery image ${Number(parts[1]) + 1}`, parts[2]);
  }

  return path;
}

function caseStudyErrorEntries(errors) {
  return Object.entries(errors || {})
    .filter(([path]) => isCaseStudyErrorPath(path))
    .sort(([left], [right]) => left.localeCompare(right));
}

const CaseStudyErrorSummary = forwardRef(function CaseStudyErrorSummary(
  { errors, source = null, mode = "structured" },
  ref,
) {
  const entries = caseStudyErrorEntries(errors);
  if (entries.length === 0) return null;

  return (
    <div
      ref={ref}
      id="case-study-error-summary"
      className="case-study-error-summary"
      role="alert"
      tabIndex={-1}
      aria-labelledby="case-study-error-summary-title"
    >
      <h3 id="case-study-error-summary-title">Case study needs attention</h3>
      {source ? (
        <span
          className={`case-study-error-source case-study-error-source--${source}`}
        >
          {source === "server"
            ? "Server validation"
            : source === "mixed"
              ? "Mixed validation"
              : "Client validation"}
        </span>
      ) : null}
      <ul>
        {entries.map(([path, message]) => {
          const normalizedPath = normalizeCaseStudyPath(path);
          const targetId = targetIdForPath(normalizedPath, mode);
          return (
            <li key={path}>
              <a
                className="case-study-error-link"
                href={`#${targetId}`}
                onClick={() => focusTarget(targetId)}
              >
                <span className="case-study-error-label">
                  {labelForPath(normalizedPath)}
                </span>
                <code className="case-study-error-path">{normalizedPath}</code>
              </a>
              <span>{message}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
});

export default CaseStudyErrorSummary;
