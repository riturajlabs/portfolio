// ==========================================
// 🧠 CONTEXT BUILDER
// Selects only the most relevant knowledge
// based on the user's question.
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
    socials
};

// ------------------------------------------
// Keywords mapped to knowledge sections
// ------------------------------------------

const CATEGORY_KEYWORDS = [
    {
        source: "profile",
        keywords: [
            "about",
            "yourself",
            "introduce",
            "background",
            "who are you",
            "bio"
        ]
    },

    {
        source: "education",
        keywords: [
            "education",
            "college",
            "university",
            "degree",
            "semester",
            "study",
            "course",
            "subject"
        ]
    },

    {
        source: "skills",
        keywords: [
            "skill",
            "technology",
            "tech",
            "language",
            "frontend",
            "backend",
            "react",
            "node",
            "express",
            "mongodb",
            "java",
            "python",
            "javascript"
        ]
    },

    {
        source: "projects",
        keywords: [
            "project",
            "orbit",
            "stayora",
            "calculator",
            "zerodha",
            "portfolio",
            "demo",
            "github"
        ]
    },

    {
        source: "certifications",
        keywords: [
            "certificate",
            "certification",
            "course",
            "credential",
            "training"
        ]
    },

    {
        source: "recruiter",
        keywords: [
            "hire",
            "internship",
            "career",
            "job",
            "role",
            "strength",
            "experience",
            "availability",
            "remote"
        ]
    },

    {
        source: "socials",
        keywords: [
            "contact",
            "email",
            "linkedin",
            "github",
            "resume",
            "portfolio",
            "connect"
        ]
    }
];

// ------------------------------------------
// Normalize
// ------------------------------------------

function normalize(text = "") {
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .trim();
}

// ------------------------------------------
// Score every category
// ------------------------------------------

function scoreCategories(question) {

    const query = normalize(question);

    const scores = {};

    CATEGORY_KEYWORDS.forEach(category => {

        let score = 0;

        category.keywords.forEach(keyword => {

            if (query.includes(keyword))
                score++;
        });

        scores[category.source] = score;
    });

    return scores;
}

// ------------------------------------------
// Return best matching categories
// ------------------------------------------

function getRelevantSources(question) {

    const scores = scoreCategories(question);

    const sorted = Object.entries(scores)
        .sort((a, b) => b[1] - a[1]);

    const bestScore = sorted[0][1];

    if (bestScore === 0) {
        return ["profile"];
    }

    return sorted
        .filter(item => item[1] > 0)
        .map(item => item[0]);
}

// ------------------------------------------
// Build Context
// ------------------------------------------

export function buildContext(question) {

    const sources = getRelevantSources(question);

    const context = {};

    sources.forEach(source => {

        context[source] = KNOWLEDGE[source];
    });

    return {
        sources,
        context,
        suggestedQuestions: faq.suggestedQuestions
    };
}