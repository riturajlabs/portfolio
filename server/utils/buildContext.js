// ==========================================
// 🧠 CONTEXT BUILDER
// Retrieves only the most relevant knowledge
// ==========================================

import { profile } from "../knowledge/profile.js";
import { education } from "../knowledge/education.js";
import { skills } from "../knowledge/skills.js";
import { projects } from "../knowledge/projects.js";
import { certifications } from "../knowledge/certifications.js";
import { recruiter } from "../knowledge/recruiter.js";
import { socials } from "../knowledge/socials.js";
import { faq } from "../knowledge/faq.js";

const KNOWLEDGE = {
    profile,
    education,
    skills,
    projects,
    certifications,
    recruiter,
    socials,
    faq
};

// ==========================================
// Keywords
// ==========================================

const CATEGORY_KEYWORDS = {
    profile: [
        "about",
        "yourself",
        "who are you",
        "introduce",
        "background",
        "bio",
        "name"
    ],

    education: [
        "education",
        "college",
        "university",
        "degree",
        "semester",
        "study",
        "course",
        "subject",
        "cgpa"
    ],

    skills: [
        "skill",
        "skills",
        "technology",
        "technologies",
        "tech",
        "language",
        "languages",
        "frontend",
        "backend",
        "react",
        "node",
        "express",
        "mongodb",
        "javascript",
        "python",
        "java",
        "html",
        "css"
    ],

    projects: [
        "project",
        "projects",
        "orbit",
        "stayora",
        "calculator",
        "zerodha",
        "portfolio",
        "demo",
        "github"
    ],

    certifications: [
        "certificate",
        "certification",
        "credential",
        "training",
        "course completed"
    ],

    recruiter: [
        "hire",
        "hiring",
        "intern",
        "internship",
        "job",
        "career",
        "resume",
        "experience",
        "strength",
        "availability",
        "remote"
    ],

    socials: [
        "contact",
        "email",
        "linkedin",
        "github",
        "portfolio",
        "connect",
        "social"
    ],

    keywords:[
        "tell me",
        "about yourself",
        "why hire",
        "why should",
        "how learn",
        "currently learning",
        "career goal",
        "preferred stack",
        "experience"
    ]
};

// ==========================================
// Normalize
// ==========================================

function normalize(text = "") {
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

// ==========================================
// Score Sources
// ==========================================

function scoreCategories(question) {

    const query = normalize(question);

    const scores = {};

    for (const [source, keywords] of Object.entries(CATEGORY_KEYWORDS)) {

        let score = 0;

        for (const keyword of keywords) {

            const key = normalize(keyword);

            if (query.includes(key)) {
                score++;
            }
        }

        scores[source] = score;
    }

    return scores;
}

// ==========================================
// Relevant Sources
// ==========================================

function getRelevantSources(question) {

    const scores = scoreCategories(question);

    const sorted = Object.entries(scores)
        .sort((a, b) => b[1] - a[1]);

    const matched = sorted
        .filter(([, score]) => score > 0)
        .slice(0, 4)
        .map(([source]) => source);

    if (matched.length === 0) {
        return ["profile", "socials"];
    }

    return matched;
}

// ==========================================
// Build Context
// ==========================================

export function buildContext(question) {

    const sources = getRelevantSources(question);

    const context = {};

    for (const source of sources) {
        context[source] = KNOWLEDGE[source];
    }

    return {
        sources,
        context,
        suggestedQuestions: faq.suggestedQuestions
    };
}