// `icon_key` → component resolution — ADR-008 (ARCHITECTURE.md).
//
// The registry ADR-008 assigns Phase 5: a closed, exhaustive map from the keys in
// `iconKeys.js` to the `react-icons` components the site already renders. The
// map must not silently render blank for an unknown key — DESIIGN_SYSTEM §1.10
// says an unknown key fails loudly, so `resolveIcon` returns a visible `?`
// placeholder and logs the miss.
//
// Since Phase 7 the public skill/category sections resolve their `icon_key`
// strings through this registry (via `src/lib/publicContent.js`); the admin
// dropdown and the backend validator share the same key vocabulary
// (`backend/app/registry.py`).

import {
  FaBrain,
  FaCode,
  FaDatabase,
  FaGitAlt,
  FaGraduationCap,
  FaLinux,
  FaNodeJs,
  FaPython,
  FaReact,
  FaRocket,
} from "react-icons/fa";

import {
  SiBootstrap,
  SiExpress,
  SiFastapi,
  SiJavascript,
  SiLangchain,
  SiMongodb,
  SiPostgresql,
  SiPytorch,
} from "react-icons/si";

import { ICON_KEYS } from "./iconKeys.js";

const ICON_BY_KEY = {
  FaBrain,
  FaCode,
  FaDatabase,
  FaGitAlt,
  FaGraduationCap,
  FaLinux,
  FaNodeJs,
  FaPython,
  FaReact,
  FaRocket,
  SiBootstrap,
  SiExpress,
  SiFastapi,
  SiJavascript,
  SiLangchain,
  SiMongodb,
  SiPostgresql,
  SiPytorch,
};

function UnknownIcon({ size }) {
  return (
    <span
      role="img"
      aria-label="unknown icon"
      style={{ fontSize: size, lineHeight: 1 }}
      data-icon-unknown
    >
      ?
    </span>
  );
}

/**
 * Resolve an `icon_key` to a component, or to a loud placeholder.
 * Unknown keys are console-errors so a mismatch surfaces in development and in
 * E2E rather than as a silently blank badge.
 */
export function resolveIcon(iconKey) {
  const Icon = ICON_BY_KEY[iconKey];
  if (!Icon) {
    console.error(`Unknown icon_key "${iconKey}". Add it to iconKeys.js.`);
    return UnknownIcon;
  }
  return Icon;
}

export { ICON_KEYS };