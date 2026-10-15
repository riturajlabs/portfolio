// The `icon_key` vocabulary — `ADR-008` (ARCHITECTURE.md).
//
// Icons are code, not data, so the database stores a *key* and the frontend maps
// it to a component. This file is the authoritative list of keys that exist; it
// is a pure-data module with no imports, so:
//
//   * the public entry imports it without pulling `react-icons` into the first
//     paint, and
//   * the admin entry uses it to populate the icon-key dropdown (`SOURCE OF
//     TRUTH` for the server too — `backend/app/registry.py` keeps an identical
//     set and a backend test refuses to let the two drift).
//
// The keys are the union of the three icon sites ADR-008 names: the four About
// cards, the four skill categories and the skills in `src/data/skills.js`.
// `src/components/icons.jsx` resolves each key to a component and renders a
// visible `?` placeholder for anything absent from this list — an unknown key
// must fail loudly, never render blank (DESIGN_SYSTEM.md §1.10).

export const ICON_KEYS = [
  "FaBrain",
  "FaCode",
  "FaDatabase",
  "FaGitAlt",
  "FaGraduationCap",
  "FaLinux",
  "FaNodeJs",
  "FaPython",
  "FaReact",
  "FaRocket",
  "SiBootstrap",
  "SiExpress",
  "SiFastapi",
  "SiJavascript",
  "SiLangchain",
  "SiMongodb",
  "SiPostgresql",
  "SiPytorch",
];