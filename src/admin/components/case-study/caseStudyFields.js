import { CASE_STUDY_FIELD } from "../../lib/caseStudy.js";

export function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function setIn(documentValue, path, nextValue) {
  const root = { ...documentValue };
  let cursor = root;

  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    const current = cursor[key];
    const next = Array.isArray(current)
      ? [...current]
      : plainObject(current)
        ? { ...current }
        : {};
    cursor[key] = next;
    cursor = next;
  }

  cursor[path[path.length - 1]] = nextValue;
  return root;
}

export function caseStudyError(errors, path) {
  return errors?.[`${CASE_STUDY_FIELD}.${path}`];
}

export function caseStudyInvalid(error) {
  return error ? "true" : undefined;
}

export function caseStudyDomId(path) {
  return `case-study-${String(path).replace(/\./g, "-")}`;
}
