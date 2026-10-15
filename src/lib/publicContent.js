// =========================================================
// 🧩 PUBLIC CONTENT ADAPTER
// =========================================================
// Phase 7 (docs/MIGRATION.md): the public components read their data
// from the build-time content snapshot (`src/generated/content.js`),
// not from `src/data/*.js`. The snapshot carries the API payload
// almost as-is; only three UI-facing shapes differ from what the
// components historically imported, and they are derived HERE, on
// top of the snapshot, so the components themselves stay unchanged:
//
//   `profile`          + the bundled portrait asset (Hero renders it)
//   `socials`          derived from profile.social + fixed icons
//   `skillCategories`  the flat skills list clustered by category
//   `certificates`     credential_url → the `credential` key the
//                      Certifications card renders
//
// `indexableProjects()` and every URL/SEO helper stay in
// src/lib/projectPages.js, which reads `projects` and `seo` from the
// same snapshot — one content authority, two consumers.
//
// Icons for skills/categories resolve through the ADR-008 registry
// (`src/components/icons.jsxx`). The three social icons are pure UI
// (the URLs come from profile.social), so they import directly from
// react-icons exactly as `src/data/socials.js` always did; the
// registry stays a closed, database-backed set.
// =========================================================

import profileImage from "../assets/images/ritu.webp";

import { FaEnvelope, FaGithub, FaLinkedin } from "react-icons/fa";

import { resolveIcon } from "../components/icons.jsx";

import {
    certifications as rawCertifications,
    profile as rawProfile,
    projects,
    seo,
    skills,
} from "../generated/content";



// =========================================================
// PROFILE
// =========================================================
// The portrait is code, like every other asset, so it is attached
// here rather than stored in the database.
export const profile = {
    ...rawProfile,
    profileImage,
};



// =========================================================
// SOCIALS
// =========================================================
// Same three links, same order, same hrefs as the legacy
// `src/data/socials.js`: GitHub, LinkedIn, mailto email.
export const socials = [
    {
        name: "GitHub",
        url: rawProfile.social.github,
        icon: FaGithub,
    },
    {
        name: "LinkedIn",
        url: rawProfile.social.linkedin,
        icon: FaLinkedin,
    },
    {
        name: "Email",
        url: `mailto:${rawProfile.social.email}`,
        icon: FaEnvelope,
    },
];



// =========================================================
// SKILL CATEGORIES
// =========================================================
// The API stores skills as a flat list whose rows carry a nested
// category (docs/DATABASE.md §11.1). The `<Skills />` section
// renders them clustered, like the legacy `skillCategories` array,
// so they are clustered here — preserving the legacy shape, order
// and icon components while the data itself stays flat.
export const skillCategories = Array.from(
    skills
        .slice()
        .sort((a, b) =>
            a.category.display_order !== b.category.display_order
                ? a.category.display_order - b.category.display_order
                : a.display_order - b.display_order
        )
        .reduce((categories, skill) => {
            const key = skill.category.name;
            const existing = categories.get(key);

            if (existing) {
                existing.skills.push({
                    name: skill.name,
                    icon: resolveIcon(skill.icon_key),
                });
            } else {
                categories.set(key, {
                    title: skill.category.name,
                    icon: resolveIcon(skill.category.icon_key),
                    skills: [
                        {
                            name: skill.name,
                            icon: resolveIcon(skill.icon_key),
                        },
                    ],
                });
            }

            return categories;
        }, new Map())
).map(([, category]) => category);



// =========================================================
// CERTIFICATES
// =========================================================
// The card renders `title`, `issuer`, `icon`, `description` and
// `credential`. The storage model has no description column
// (docs/CONTENT_MAPPING.md — OMITTED) and names the link
// `credential_url`, so that is the mapping. `description` stays
// undefined on purpose: no fabricated copy is ever invented to fill
// a column that does not exist.
export const certificates = rawCertifications.map((certification) => ({
    title: certification.title,
    issuer: certification.issuer,
    icon: certification.icon,
    credential: certification.credential_url,
}));



export { projects, seo };