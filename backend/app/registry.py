"""The `icon_key` registry — the closed set of icon keys an admin may store.

`ARCHITECTURE.md` ADR-008: icons are code, so the database stores a *key* and the
frontend maps it to a component. The map is exhaustive and closed, and an unknown
key must fail loudly rather than render blank (`DESIGN_SYSTEM.md` §1.10).

That contract has two halves, and this module is the server's half:

* **`POST`/`PUT` with an `icon_key` outside the set is `422`.** A typo saved today
  becomes a broken badge on the next build, and nothing downstream would notice —
  the public entry renders a placeholder at runtime instead of failing the build.
* **The set is mirrored, not duplicated.** `src/components/iconKeys.js` holds the
  same list for the frontend, and `tests/test_admin_content.py::test_icon_registry_matches_frontend`
  reads that file and fails if the two ever drift.

The keys are the union of the three icon sites `ADR-008` names: the four About
cards, the four skill categories and the sixteen skills in `src/data/skills.js`.
"""

from __future__ import annotations

# About cards (`src/components/sections/About.jsx`).
ABOUT_ICON_KEYS = ("FaGraduationCap", "FaCode", "FaBrain", "FaRocket")

# Skill categories (`src/data/skills.js`, `title` + `icon`).
CATEGORY_ICON_KEYS = ("FaReact", "FaNodeJs", "FaPython", "FaDatabase")

# Every skill icon in `src/data/skills.js`.
SKILL_ICON_KEYS = (
    "FaReact",
    "SiJavascript",
    "FaCode",
    "SiBootstrap",
    "FaNodeJs",
    "SiExpress",
    "SiFastapi",
    "FaPython",
    "SiPytorch",
    "SiLangchain",
    "FaDatabase",
    "SiMongodb",
    "SiPostgresql",
    "FaGitAlt",
    "FaLinux",
)

ICON_KEYS: frozenset[str] = frozenset(
    ABOUT_ICON_KEYS + CATEGORY_ICON_KEYS + SKILL_ICON_KEYS
)

# Ordered, deduplicated, for an `<option>` list.
ICON_KEY_CHOICES: tuple[str, ...] = tuple(sorted(ICON_KEYS))

UNKNOWN_ICON_KEY = "Unknown icon key."
