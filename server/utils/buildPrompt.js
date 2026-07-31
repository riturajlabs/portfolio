import { prompts } from "../knowledge/prompts.js";
import { buildContext } from "./buildContext.js";

const MAX_HISTORY = 6;

// ==========================================
// Conversation History
// ==========================================

function formatHistory(history = []) {
    return history
        .slice(-MAX_HISTORY)
        .map(({ role, content }) => {
            const speaker =
                role === "assistant"
                    ? "Assistant"
                    : "User";

            return `${speaker}: ${content}`;
        })
        .join("\n");
}

// ==========================================
// Convert Object -> Readable Text
// ==========================================

function objectToText(data, indent = "") {

    if (Array.isArray(data)) {

        return data
            .map(item => {

                if (typeof item === "object") {
                    return objectToText(item, indent + "  ");
                }

                return `${indent}- ${item}`;

            })
            .join("\n");
    }

    if (typeof data === "object" && data !== null) {

        return Object.entries(data)
            .map(([key, value]) => {

                const title =
                    key
                        .replace(/([A-Z])/g, " $1")
                        .replace(/^./, c => c.toUpperCase());

                if (
                    typeof value === "object" &&
                    value !== null
                ) {

                    return `${indent}${title}:\n${objectToText(
                        value,
                        indent + "  "
                    )}`;
                }

                return `${indent}${title}: ${value}`;

            })
            .join("\n");
    }

    return String(data);
}

// ==========================================
// Recruiter Detection
// ==========================================

function isRecruiterQuestion(question) {

    const q = question.toLowerCase();

    return [
        "hire",
        "intern",
        "internship",
        "experience",
        "resume",
        "salary",
        "availability",
        "career",
        "remote",
        "role",
        "job"
    ].some(word => q.includes(word));

}

// ==========================================
// Detect Project
// ==========================================

function detectProject(question, projects = []) {

    const q = question.toLowerCase();

    return projects.find(project =>
        q.includes(project.name.toLowerCase())
    );

}

// ==========================================
// Build Compact Context
// ==========================================

function buildCompactContext(question, context) {

    const sections = [];

    for (const [key, value] of Object.entries(context)) {

        if (key === "projects") {

            const matched =
                detectProject(question, value);

            if (matched) {

                sections.push(`

## PROJECT

${objectToText(matched)}

`);

                continue;
            }

            sections.push(`

## FEATURED PROJECTS

${value
    .filter(project => project.featured)
    .map(project =>
`### ${project.name}

${project.overview.short}`
    )
    .join("\n\n")}

`);

            continue;
        }

        sections.push(`

## ${key.toUpperCase()}

${objectToText(value)}

`);

    }

    return sections.join("\n--------------------------\n");
}

// ==========================================
// Prompt Builder
// ==========================================

export function buildPrompt(question, history = []) {

    const {
        context,
        sources
    } = buildContext(question);

    const historyText =
        formatHistory(history);

    const compactContext =
        buildCompactContext(
            question,
            context
        );

    const recruiter =
        isRecruiterQuestion(question);

    return `
${prompts.system}

${prompts.personality}

${prompts.responseStyle}

${prompts.technicalRules}

${prompts.projectRules}

${prompts.safetyRules}

${recruiter ? prompts.recruiterRules : ""}

=================================================
REFERENCE DATA (FACTS)
=================================================

Everything below is factual portfolio information.

Never contradict it.

Never add information that is not present.

Relevant Sources:
${sources.join(", ")}

${compactContext}

=================================================
CONVERSATION
=================================================

${historyText || "No previous conversation."}

=================================================
USER QUESTION
=================================================

${question}

=================================================
INSTRUCTIONS
=================================================

GENERAL RULES

- Answer ONLY using the reference data.
- Never invent information.
- Never assume facts.
- If information is unavailable, clearly say so.
- Keep answers concise unless detailed information is requested.

MARKDOWN RULES (MANDATORY)

- Return ONLY valid GitHub Flavored Markdown.
- Use "##" for main headings.
- Use "###" for sub-headings.
- Use "-" for every unordered list.
- Never use bullets like • ● ◦ ▪.
- Never leave blank lines between bullet items.
- Leave exactly ONE blank line between sections.
- Wrap code inside triple backticks.
- Use tables only if explicitly requested.

OUTPUT STYLE

Example:

## Programming Languages

- Java
- JavaScript
- Python
- C++

## Project

### Technologies

- React
- Node.js
- Express
- MongoDB

### Features

- Feature One
- Feature Two

### Learnings

- Learning One
- Learning Two

FOR RECRUITER QUESTIONS

- Be professional.
- Be confident.
- Never exaggerate.
- Mention strengths honestly.

DO NOT

- Do not output plain text lists.
- Do not use inconsistent spacing.
- Do not repeat headings.
- Do not generate malformed Markdown.
- Do not answer outside the provided knowledge.
`;
}