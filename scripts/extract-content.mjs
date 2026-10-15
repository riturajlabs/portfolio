// =========================================================
// 📦 CONTENT EXTRACTOR — Phase 6 (`docs/MIGRATION.md`)
// =========================================================
// Produces the deterministic seed snapshot:
//
//   src/data/{projects,profile,skills,certificates,blogs,socials}.js
//   + src/components/sections/About.jsx constants
//   + src/config/seo.js (§5.1.3 split)
//   + real WebP headers from public/images/projects/
//        ↓
//   .cache/content-snapshot.json   (byte-stable across runs)
//
// The snapshot is shaped like the `GET /api/content` payload
// (`docs/API.md` §5.1.2) so `scripts/compare-content.mjs` can
// diff it field-by-field against the live API. It carries an
// extra `_migration` bookkeeping key (not part of the payload)
// recording counts and the source fields that were deliberately
// not migrated — see `docs/CONTENT_MAPPING.md`.
//
// Everything is validated HERE, before any database is touched:
// a slug, URL, image, icon, count or key-set problem fails this
// script with a non-zero exit and never reaches `db.seed`.
// =========================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as faIcons from "react-icons/fa";
import * as siIcons from "react-icons/si";
import { createServer } from "vite";

import { ICON_KEYS } from "../src/components/iconKeys.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

const EXPECTED_RESUME = "/Ritu_Raj_Full_Stack_Developer_Resume.pdf";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMAGE_PATTERN = /^\/images\/projects\/[a-z0-9-]+\.webp$/;
const HTTP_PATTERN = /^https?:\/\//;

// `project` CHECKs from `alembic/versions/0001_initial.py`.
const SLUG_MAX = 80;
const SEO_TITLE_MAX = 70;
const SEO_DESCRIPTION_MAX = 185;
const CATEGORY_MAX = 60;
const SKILL_NAME_MAX = 60;

const PROFILE_KEYS = [
  "name", "title", "greeting", "roles", "availableForInternship",
  "internshipText", "description", "location", "resume", "stats", "social",
];
const SOCIAL_KEYS = ["github", "linkedin", "email"];
const PROJECT_KEYS = [
  "slug", "title", "description", "longDescription", "image",
  "image_width", "image_height", "imageAlt", "category", "techStack",
  "highlights", "featured", "indexable", "status", "display_order",
  "live", "github", "seoTitle", "seoDescription",
];
const SKILL_KEYS = ["name", "icon_key", "display_order", "category"];
const SKILL_CATEGORY_KEYS = ["name", "icon_key", "display_order"];
const CERTIFICATION_KEYS = [
  "title", "issuer", "icon", "issued_on", "credential_id",
  "credential_url", "display_order",
];
const ABOUT_KEYS = ["tag", "title", "description", "heading", "paragraphs", "cards"];
const ABOUT_CARD_KEYS = ["icon_key", "title", "description"];
const SEO_KEYS = [
  "siteName", "title", "description", "keywords", "author", "image",
  "imageAlt", "twitterCard", "twitterSite", "locale", "type", "robots",
  "person", "sameAs",
];
const PERSON_KEYS = [
  "name", "alternateName", "jobTitle", "email", "address", "nationality",
  "credential", "knowsAbout",
];
const ADDRESS_KEYS = ["locality", "region", "country"];
const ROBOTS_KEYS = ["index", "follow"];

// Acceptance: no `knowledge_base.json` fact enters public content
// (`DATABASE.md` §14.1 rule 6).
const FORBIDDEN_FACT_PATTERNS = [
  [/\bcgpa\b/i, "CGPA"],
  [/\bgpa\b/i, "GPA"],
  [/\bsemester\b/i, "semester"],
  [/\bgraduat(?:ed|ion|es)\b/i, "graduation"],
  [/\bclass of\b/i, "graduation year"],
];

function fail(message) {
  console.error(`\n[extract] FAILED: ${message}\n`);
  process.exit(1);
}

function say(message) {
  console.log(`[extract] ${message}`);
}

function assertExactKeys(object, expected, where) {
  const actual = Object.keys(object);
  const missing = expected.filter((key) => !actual.includes(key));
  const unexpected = actual.filter((key) => !expected.includes(key));
  if (missing.length > 0 || unexpected.length > 0) {
    fail(
      `${where}: key set does not match the API contract — ` +
      `missing [${missing.join(", ")}], unexpected [${unexpected.join(", ")}]. ` +
      "Update the extractor and the contract together, or remove the field."
    );
  }
}

function assertNonEmptyString(value, where) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${where}: expected a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value;
}

function assertHttpUrl(value, where) {
  if (value != null && value !== "" && !HTTP_PATTERN.test(value)) {
    fail(`${where}: must start with http:// or https:// — got ${JSON.stringify(value)}`);
  }
  return value ?? null;
}

// Enough of the WebP container spec to recover the canvas size, identical to
// the reader in `scripts/generate-project-pages.mjs` (that script is a build
// artifact consumer and is deliberately not modified).
function readWebpSize(buffer, where) {
  if (buffer.length < 30) throw new Error(`${where}: file too small to be a WebP image`);
  if (buffer.subarray(0, 4).toString("ascii") !== "RIFF") {
    throw new Error(`${where}: missing RIFF signature`);
  }
  if (buffer.subarray(8, 12).toString("ascii") !== "WEBP") {
    throw new Error(`${where}: missing WEBP signature`);
  }
  const chunk = buffer.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X") {
    return {
      width: 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)),
      height: 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)),
    };
  }
  if (chunk === "VP8L") {
    if (buffer[20] !== 0x2f) throw new Error(`${where}: bad VP8L signature byte`);
    const bits = buffer.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  if (chunk === "VP8 ") {
    if (buffer.subarray(23, 26).toString("ascii") !== "\x9d\x01\x2a") {
      throw new Error(`${where}: bad VP8 frame start code`);
    }
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  throw new Error(`${where}: unsupported WebP chunk "${chunk}"`);
}

// ------------------------------------------------------------------
// Icon registry — identity match against the closed vocabulary
// ------------------------------------------------------------------

const ICON_BY_KEY = {};
for (const key of ICON_KEYS) {
  const component = faIcons[key] ?? siIcons[key];
  if (!component) {
    fail(`iconKeys.js lists "${key}" but react-icons exports no such component`);
  }
  ICON_BY_KEY[key] = component;
}

function iconKeyOf(component, where) {
  if (typeof component !== "function" && typeof component !== "object") {
    fail(`${where}: expected an icon component, got ${typeof component}`);
  }
  for (const key of ICON_KEYS) {
    if (Object.is(ICON_BY_KEY[key], component)) return key;
  }
  fail(
    `${where}: icon component is not in the icon registry ` +
    "(src/components/iconKeys.js). Add it there first — an unknown icon " +
    "must not be seeded."
  );
}

// ------------------------------------------------------------------
// About.jsx — walk the rendered element tree
// ------------------------------------------------------------------

function isElement(node) {
  return Boolean(node) && typeof node === "object" && node["$$typeof"] !== undefined;
}

function childElements(node) {
  const out = [];
  const visit = (value) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (isElement(value)) out.push(value);
  };
  visit(node.props?.children);
  return out;
}

function walkElements(root, visit) {
  const visitNode = (node, parent) => {
    if (!isElement(node)) return;
    visit(node, parent);
    for (const child of childElements(node)) visitNode(child, node);
  };
  visitNode(root, null);
}

function textOf(node, where) {
  const collect = (value) => {
    if (value == null) return "";
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(collect).join("");
    fail(`${where}: JSX children are not plain text`);
  };
  const text = collect(node.props?.children).trim();
  if (text === "") fail(`${where}: empty text`);
  return text;
}

function extractAbout(AboutElement) {
  const found = { sectionTitles: [], headings: [], paragraphs: [], cards: [] };

  walkElements(AboutElement, (node, parent) => {
    const type = node.type;
    if (typeof type === "function" && type.name === "SectionTitle") {
      found.sectionTitles.push(node);
      return;
    }
    if (type === "h3") {
      found.headings.push(node);
      return;
    }
    if (type === "p") {
      const parentClass = typeof parent?.type === "object"
        ? String(parent.props?.className ?? "")
        : "";
      const hostParentClass = typeof parent?.type === "string"
        ? String(parent.props?.className ?? "")
        : "";
      const className = `${parentClass} ${hostParentClass}`;
      if (className.includes("about-text")) found.paragraphs.push(node);
      return;
    }
    const className = typeof type === "object" ? String(node.props?.className ?? "") : "";
    if (className === "about-card") found.cards.push(node);
  });

  if (found.sectionTitles.length !== 1) {
    fail(`About.jsx: expected exactly 1 <SectionTitle>, found ${found.sectionTitles.length}`);
  }
  if (found.headings.length !== 1) {
    fail(`About.jsx: expected exactly 1 <h3>, found ${found.headings.length}`);
  }
  if (found.paragraphs.length !== 2) {
    fail(`About.jsx: expected exactly 2 journey paragraphs, found ${found.paragraphs.length}`);
  }
  if (found.cards.length !== 4) {
    fail(`About.jsx: expected exactly 4 about cards, found ${found.cards.length}`);
  }

  const sectionTitle = found.sectionTitles[0];
  for (const prop of ["tag", "title", "description"]) {
    const value = sectionTitle.props[prop];
    if (typeof value !== "string" || value.trim() === "") {
      fail(`About.jsx: SectionTitle.${prop} must be a non-empty string`);
    }
  }

  const cards = found.cards.map((cardNode, index) => {
    let iconComponent = null;
    let title = null;
    let description = null;

    walkElements(cardNode, (node, parent) => {
      if (node.type === "h4") title = textOf(node, `About.jsx card ${index} <h4>`);
      if (node.type === "p" && typeof parent?.type === "string" &&
          String(parent.props?.className ?? "") === "about-card-info") {
        description = textOf(node, `About.jsx card ${index} <p>`);
      }
      if (typeof parent?.type === "string" &&
          String(parent.props?.className ?? "") === "about-icon" &&
          typeof node.type !== "string") {
        iconComponent = node.type;
      }
    });

    if (iconComponent === null) fail(`About.jsx card ${index}: no icon element found`);
    if (title === null) fail(`About.jsx card ${index}: no title (h4) found`);
    if (description === null) fail(`About.jsx card ${index}: no description found`);

    return {
      icon_key: iconKeyOf(iconComponent, `About.jsx card "${title}"`),
      title,
      description,
    };
  });

  return {
    tag: sectionTitle.props.tag,
    title: sectionTitle.props.title,
    description: sectionTitle.props.description,
    heading: textOf(found.headings[0], "About.jsx <h3>"),
    paragraphs: found.paragraphs.map((node, i) =>
      textOf(node, `About.jsx paragraph ${i + 1}`)
    ),
    cards,
  };
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------

const outFlagIndex = process.argv.indexOf("--out");
const outPath = outFlagIndex !== -1 && process.argv[outFlagIndex + 1]
  ? path.resolve(process.cwd(), process.argv[outFlagIndex + 1])
  : path.join(rootDir, ".cache", "content-snapshot.json");

const vite = await createServer({
  root: rootDir,
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: "custom",
  logLevel: "error",
});

let payload;
try {
  const load = (id) => vite.ssrLoadModule(id);

  const projectsMod = await load("/src/data/projects.js");
  const profileMod = await load("/src/data/profile.js");
  const skillsMod = await load("/src/data/skills.js");
  const certificatesMod = await load("/src/data/certificates.js");
  const blogsMod = await load("/src/data/blogs.js");
  const socialsMod = await load("/src/data/socials.js");
  const seoMod = await load("/src/config/seo.js");
  const projectPagesMod = await load("/src/lib/projectPages.js");
  const aboutMod = await load("/src/components/sections/About.jsx");

  // ---- profile ------------------------------------------------
  const profile = profileMod.default;
  if (typeof profile.resume !== "string" || profile.resume !== EXPECTED_RESUME) {
    fail(
      `profile.resume must be exactly "${EXPECTED_RESUME}", got ` +
      `${JSON.stringify(profile.resume)}`
    );
  }
  const resumeFile = path.join(rootDir, "public", profile.resume);
  if (!fs.existsSync(resumeFile)) {
    fail(`profile.resume points at ${profile.resume} but public/ has no such file`);
  }
  for (const key of SOCIAL_KEYS) {
    assertNonEmptyString(profile.social?.[key], `profile.social.${key}`);
  }
  if (!Array.isArray(profile.stats) || profile.stats.length === 0) {
    fail("profile.stats must be a non-empty array");
  }
  profile.stats.forEach((stat, i) => assertExactKeys(stat, ["label", "value"], `profile.stats[${i}]`));
  for (const key of ["label", "value"]) {
    profile.stats.forEach((stat, i) =>
      assertNonEmptyString(stat[key], `profile.stats[${i}].${key}`)
    );
  }
  if (!Array.isArray(profile.roles) || profile.roles.length === 0) {
    fail("profile.roles must be a non-empty array");
  }

  const social = { github: profile.social.github, linkedin: profile.social.linkedin, email: profile.social.email };

  const profilePayload = {
    name: assertNonEmptyString(profile.name, "profile.name"),
    title: assertNonEmptyString(profile.title, "profile.title"),
    greeting: profile.greeting ?? null,
    roles: profile.roles,
    availableForInternship: Boolean(profile.availableForInternship),
    internshipText: profile.internshipText ?? null,
    description: profile.description ?? null,
    location: profile.location ?? null,
    resume: profile.resume,
    stats: profile.stats,
    social,
  };
  // Dead keys from `profile.js` must never reappear in the payload
  // (`API.md` §5.1.3, acceptance criterion).
  assertExactKeys(profilePayload, PROFILE_KEYS, "snapshot profile");

  // ---- socials.js (derived — drift tripwire only) ---------------
  const socials = socialsMod.default;
  if (socials.length !== SOCIAL_KEYS.length) {
    fail(`socials.js: expected ${SOCIAL_KEYS.length} entries, found ${socials.length}`);
  }
  if (socials[0]?.url !== social.github) fail("socials.js GitHub URL drifted from profile.social.github");
  if (socials[1]?.url !== social.linkedin) fail("socials.js LinkedIn URL drifted from profile.social.linkedin");
  if (socials[2]?.url !== `mailto:${social.email}`) fail("socials.js email drifted from profile.social.email");

  // ---- about (About.jsx constants) -----------------------------
  const about = extractAbout(aboutMod.default());
  assertExactKeys(about, ABOUT_KEYS, "snapshot about");
  about.cards.forEach((card, i) => assertExactKeys(card, ABOUT_CARD_KEYS, `snapshot about.cards[${i}]`));
  if (about.cards.length !== 4) fail(`about.cards: expected 4, found ${about.cards.length}`);
  if (about.paragraphs.length !== 2) fail(`about.paragraphs: expected 2, found ${about.paragraphs.length}`);

  // ---- projects ------------------------------------------------
  const projects = projectsMod.default;
  if (projects.length !== 5) {
    fail(`projects.js: acceptance requires exactly 5 projects, found ${projects.length}`);
  }
  const dimensions = projectPagesMod.PROJECT_IMAGE_DIMENSIONS;
  const seenSlugs = new Set();

  const projectPayloads = projects.map((project, index) => {
    const where = `projects.js[${index}] ("${project.slug ?? project.title ?? "?"}")`;
    const slug = assertNonEmptyString(project.slug, `${where}.slug`);
    if (slug.length > SLUG_MAX) fail(`${where}: slug longer than ${SLUG_MAX} characters`);
    if (!SLUG_PATTERN.test(slug)) fail(`${where}: slug must match ${SLUG_PATTERN}`);
    if (seenSlugs.has(slug)) fail(`${where}: duplicate slug "${slug}"`);
    seenSlugs.add(slug);

    const image = assertNonEmptyString(project.image, `${where}.image`);
    if (!IMAGE_PATTERN.test(image)) fail(`${where}: image must match /images/projects/<slug>.webp`);
    if (image !== `/images/projects/${slug}.webp`) {
      fail(`${where}: image "${image}" does not match the slug-derived path`);
    }

    const imagePath = path.join(rootDir, "public", "images", "projects", `${slug}.webp`);
    if (!fs.existsSync(imagePath)) fail(`${where}: missing image file public${image}`);
    let actual;
    try {
      actual = readWebpSize(fs.readFileSync(imagePath), where);
    } catch (error) {
      fail(`${where}: ${error.message}`);
    }
    const declared = dimensions[slug];
    if (!declared) {
      fail(`${where}: PROJECT_IMAGE_DIMENSIONS has no entry for this slug`);
    }
    if (declared.width !== actual.width || declared.height !== actual.height) {
      fail(
        `${where}: WebP header says ${actual.width}x${actual.height} but ` +
        `PROJECT_IMAGE_DIMENSIONS declares ${declared.width}x${declared.height} — ` +
        "file and constants disagree; fix one before seeding."
      );
    }

    const seoTitle = assertNonEmptyString(project.seoTitle, `${where}.seoTitle`);
    const seoDescription = assertNonEmptyString(project.seoDescription, `${where}.seoDescription`);
    if (seoTitle.length > SEO_TITLE_MAX) fail(`${where}: seoTitle longer than ${SEO_TITLE_MAX}`);
    if (seoDescription.length > SEO_DESCRIPTION_MAX) {
      fail(`${where}: seoDescription longer than ${SEO_DESCRIPTION_MAX}`);
    }
    if (project.category != null && project.category.length > CATEGORY_MAX) {
      fail(`${where}: category longer than ${CATEGORY_MAX}`);
    }
    if (!Array.isArray(project.highlights) || project.highlights.length === 0) {
      fail(`${where}: highlights must be a non-empty array (source of long_description)`);
    }
    project.highlights.forEach((line, i) =>
      assertNonEmptyString(line, `${where}.highlights[${i}]`)
    );
    if (!Array.isArray(project.techStack)) fail(`${where}: techStack must be an array`);
    project.techStack.forEach((tech, i) =>
      assertNonEmptyString(tech, `${where}.techStack[${i}]`)
    );
    assertHttpUrl(project.live, `${where}.live`);
    assertHttpUrl(project.github, `${where}.github`);

    const item = {
      slug,
      title: assertNonEmptyString(project.title, `${where}.title`),
      description: assertNonEmptyString(project.description, `${where}.description`),
      longDescription: project.highlights.map((line) => `- ${line}`).join("\n"),
      image,
      image_width: actual.width,
      image_height: actual.height,
      imageAlt: assertNonEmptyString(project.imageAlt, `${where}.imageAlt`),
      category: project.category ?? null,
      techStack: project.techStack,
      highlights: project.highlights,
      featured: Boolean(project.featured),
      indexable: project.indexable !== false,
      status: "published",
      display_order: index,
      live: project.live ?? null,
      github: project.github ?? null,
      seoTitle,
      seoDescription,
    };
    assertExactKeys(item, PROJECT_KEYS, `snapshot project "${slug}"`);
    return item;
  });

  // ---- skills (flatten) ---------------------------------------
  const categories = skillsMod.default;
  if (categories.length !== 4) {
    fail(`skills.js: acceptance requires exactly 4 categories, found ${categories.length}`);
  }
  const skillPayloads = [];
  categories.forEach((category, categoryIndex) => {
    const where = `skills.js category "${category.title}"`;
    const categoryName = assertNonEmptyString(category.title, `${where}.title`);
    if (categoryName.length > SKILL_NAME_MAX) fail(`${where}: name longer than ${SKILL_NAME_MAX}`);
    const categoryIconKey = iconKeyOf(category.icon, where);
    if (!Array.isArray(category.skills) || category.skills.length === 0) {
      fail(`${where}: skills must be a non-empty array`);
    }
    category.skills.forEach((skill, skillIndex) => {
      const skillWhere = `${where} skill "${skill.name}"`;
      const skillName = assertNonEmptyString(skill.name, `${skillWhere}.name`);
      if (skillName.length > SKILL_NAME_MAX) fail(`${skillWhere}: name longer than ${SKILL_NAME_MAX}`);
      const item = {
        name: skillName,
        icon_key: iconKeyOf(skill.icon, skillWhere),
        display_order: skillIndex,
        category: {
          name: categoryName,
          icon_key: categoryIconKey,
          display_order: categoryIndex,
        },
      };
      assertExactKeys(item, SKILL_KEYS, `snapshot skill "${skillName}"`);
      assertExactKeys(item.category, SKILL_CATEGORY_KEYS, `snapshot skill "${skillName}".category`);
      skillPayloads.push(item);
    });
  });
  if (skillPayloads.length !== 16) {
    fail(`skills.js: acceptance requires exactly 16 skills, found ${skillPayloads.length}`);
  }

  // ---- certifications ------------------------------------------
  const certificates = certificatesMod.default;
  if (certificates.length !== 3) {
    fail(`certificates.js: acceptance requires exactly 3 certifications, found ${certificates.length}`);
  }
  const certificationPayloads = certificates.map((certificate, index) => {
    const where = `certificates.js[${index}] ("${certificate.title ?? "?"}")`;
    if (typeof certificate.description !== "string" || certificate.description.trim() === "") {
      fail(`${where}: expected a description (it is documented as omitted, not absent)`);
    }
    const item = {
      title: assertNonEmptyString(certificate.title, `${where}.title`),
      issuer: assertNonEmptyString(certificate.issuer, `${where}.issuer`),
      icon: certificate.icon ?? null,
      issued_on: null,
      credential_id: null,
      credential_url: assertHttpUrl(certificate.credential, `${where}.credential`),
      display_order: index,
    };
    assertExactKeys(item, CERTIFICATION_KEYS, `snapshot certification "${item.title}"`);
    return item;
  });

  // ---- seo (src/config/seo.js split) ---------------------------
  const seo = seoMod.default;
  for (const key of ["siteName", "title", "description", "author", "image", "imageAlt",
                     "twitterCard", "locale", "type"]) {
    assertNonEmptyString(seo[key], `seo.js ${key}`);
  }
  if (!Array.isArray(seo.keywords) || seo.keywords.length === 0) fail("seo.js keywords must be non-empty");
  if (!Array.isArray(seo.person?.knowsAbout) || seo.person.knowsAbout.length === 0) {
    fail("seo.js person.knowsAbout must be non-empty");
  }
  assertExactKeys(seo.person, PERSON_KEYS, "seo.js person");
  assertExactKeys(seo.person.address, ADDRESS_KEYS, "seo.js person.address");

  const robotTokens = String(seo.robots ?? "").split(",").map((token) => token.trim());
  if (!robotTokens.includes("index") && !robotTokens.includes("noindex")) {
    fail("seo.js robots directive contains neither index nor noindex");
  }
  if (!robotTokens.includes("follow") && !robotTokens.includes("nofollow")) {
    fail("seo.js robots directive contains neither follow nor nofollow");
  }
  const robots = {
    index: robotTokens.includes("index") && !robotTokens.includes("noindex"),
    follow: robotTokens.includes("follow") && !robotTokens.includes("nofollow"),
  };

  const sameAs = [social.github, social.linkedin].filter(Boolean);
  if (JSON.stringify(seo.sameAs) !== JSON.stringify(sameAs)) {
    fail(
      "seo.js sameAs has drifted from profile.social — the payload derives " +
      "sameAs from social, so the two must agree"
    );
  }

  const seoPayload = {
    siteName: seo.siteName,
    title: seo.title,
    description: seo.description,
    keywords: seo.keywords,
    author: seo.author,
    image: seo.image,
    imageAlt: seo.imageAlt,
    twitterCard: seo.twitterCard,
    twitterSite: seo.twitterSite ?? null,
    locale: seo.locale,
    type: seo.type,
    robots,
    person: seo.person,
    sameAs,
  };
  assertExactKeys(seoPayload, SEO_KEYS, "snapshot seo");
  if ("url" in seoPayload || "verification" in seoPayload) {
    fail("snapshot seo must not contain url/verification — they stay in seo.js");
  }
  if (JSON.stringify(robots) !== JSON.stringify({ index: true, follow: true })) {
    say(`note: robots parsed to ${JSON.stringify(robots)}`);
  }

  // ---- blogs (no entity — 0 rows) ------------------------------
  const blogs = blogsMod.default;
  if (!Array.isArray(blogs)) fail("blogs.js must export an array");

  // ---- forbidden facts (knowledge_base.json tripwire) ----------
  payload = {
    profile: profilePayload,
    about,
    projects: projectPayloads,
    skills: skillPayloads,
    certifications: certificationPayloads,
    seo: seoPayload,
    _migration: {
      tool: "scripts/extract-content.mjs",
      sources: [
        "src/data/projects.js",
        "src/data/profile.js",
        "src/data/skills.js",
        "src/data/certificates.js",
        "src/data/socials.js (derived — URLs only via profile.social)",
        "src/data/blogs.js (no entity — 0 rows)",
        "src/components/sections/About.jsx (aboutCards + section copy)",
        "src/config/seo.js (site_profile.seo split, DATABASE.md §5.1.3)",
        "public/images/projects/*.webp (image_width/image_height from headers)",
      ],
      counts: {
        profiles: 1,
        projects: projectPayloads.length,
        skill_categories: categories.length,
        skills: skillPayloads.length,
        certifications: certificationPayloads.length,
        about_cards: about.cards.length,
        about_paragraphs: about.paragraphs.length,
        blog_posts: 0,
      },
      omitted: [
        "certifications[].description — the certification table has no description column (DATABASE.md §5.5); 3 source strings are reported, not migrated",
        "profile.seo, profile.techStack — dead keys, no consumer (API.md §5.1.3)",
        "profile.profileImage — Vite asset import; stays a code import",
        "projects[].id — no public consumer; projects are identified by slug",
        "projects[].publishedAt — null in all rows, no consumer",
        "projects[].updatedAt — null in all rows; consumed only by scripts/seo/discovery.mjs reading src/data (deferred to Phase 7)",
        "socials.js labels/icons — derived presentation; the 3 URLs migrate inside profile.social",
        "seo.url, seo.verification — deployment config, stay in src/config/seo.js",
        "seo.sameAs — derived from profile.social at assembly, not stored",
        "meta.generated_at — request/payload timestamp, computed by the API; omitted so the snapshot stays byte-deterministic",
      ],
    },
  };

  assertExactKeys(payload, [
    "profile", "about", "projects", "skills", "certifications", "seo", "_migration",
  ], "snapshot top level (blog_posts and friends have no entity — see _migration.omitted)");

  const raw = JSON.stringify(payload, null, 2);
  for (const [pattern, label] of FORBIDDEN_FACT_PATTERNS) {
    if (pattern.test(raw)) {
      fail(
        `forbidden fact "${label}" appears in the extracted content — ` +
        "knowledge_base.json facts must not enter public content " +
        "(DATABASE.md §14.1 rule 6)"
      );
    }
  }
} finally {
  await vite.close();
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const bytes = `${JSON.stringify(payload, null, 2)}\n`;
fs.writeFileSync(outPath, bytes, "utf8");

say(`snapshot written: ${path.relative(rootDir, outPath)} (${Buffer.byteLength(bytes)} bytes)`);
say(
  `counts: ${payload._migration.counts.projects} projects, ` +
  `${payload._migration.counts.skill_categories} categories, ` +
  `${payload._migration.counts.skills} skills, ` +
  `${payload._migration.counts.certifications} certifications, ` +
  `1 profile, 1 about (${payload._migration.counts.about_cards} cards), ` +
  "0 blog posts"
);
say(
  "documented omissions: " +
  `${payload._migration.omitted.length} (see _migration.omitted in the snapshot)`
);
