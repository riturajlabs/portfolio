// Icon resolution for the admin UI — ADR-008.
//
// The admin never imports the *public* resolver (`src/components/icons.jsx`) —
// DESIGN_SYSTEM.md §4 forbids importing public components. It may consume the
// pure-data key list (`src/components/iconKeys.js`), which is what the icon
// dropdown must offer, and it resolves those keys with its own `react-icons`
// map. Same vocabulary, no shared component.

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

import { ICON_KEYS } from "../../components/iconKeys.js";

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
      data-admin-icon-unknown
    >
      ?
    </span>
  );
}

export function AdminIcon({ iconKey, size = "1.25em" }) {
  const Icon = ICON_BY_KEY[iconKey];
  if (!Icon) {
    console.error(`Unknown icon_key "${iconKey}". Add it to iconKeys.js.`);
    return <UnknownIcon size={size} />;
  }
  return <Icon aria-hidden="true" size={size} />;
}

export { ICON_KEYS };