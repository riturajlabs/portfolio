import { prompts } from "../knowledge/prompts.js";
import { buildContext } from "./buildContext.js";

const MAX_HISTORY = 6;

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

// -----------------------------------------
// Compress objects into readable text
// -----------------------------------------

function objectToText(obj, indent = "") {

    if (Array.isArray(obj)) {
        return obj
            .map(item => {

                if (typeof item === "object") {
                    return objectToText(item, indent + "  ");
                }

                return `${indent}- ${item}`;

            })
            .join("\n");
    }

    if (typeof obj === "object" && obj !== null) {

        return Object.entries(obj)
            .map(([key, value]) => {

                if (
                    typeof value === "object" &&
                    value !== null
                ) {

                    return `${indent}${key}:\n${objectToText(
                        value,
                        indent + "  "
                    )}`;
                }

                return `${indent}${key}: ${value}`;

            })
            .join("\n");
    }

    return String(obj);
}

// -----------------------------------------
// Detect recruiter questions
// -----------------------------------------

function isRecruiterQuestion(question) {

    const q = question.toLowerCase();

    return [
        "hire",
        "intern",
        "experience",
        "salary",
        "resume",
        "role",
        "available",
        "remote"
    ].some(word => q.includes(word));

}

// -----------------------------------------
// Detect project mentioned
// -----------------------------------------

function detectProject(question, projects = []) {

    const q = question.toLowerCase();

    return projects.find(project =>
        q.includes(project.name.toLowerCase())
    );

}

// -----------------------------------------
// Build compact context
// -----------------------------------------

function buildCompactContext(question, context) {

    const sections = [];

    for (const [key, value] of Object.entries(context)) {

        if (key === "projects") {

            const matchedProject =
                detectProject(question, value);

            if (matchedProject) {

                sections.push(
`PROJECT

${objectToText(matchedProject)}`
                );

                continue;
            }

            sections.push(
`PROJECTS

${value
    .filter(p => p.featured)
    .map(p =>
`${p.name}
- ${p.overview.short}`
    )
    .join("\n\n")}`
            );

            continue;
        }

        sections.push(
`${key.toUpperCase()}

${objectToText(value)}`
        );

    }

    return sections.join("\n\n----------------------\n\n");

}

// -----------------------------------------
// Main Prompt Builder
// -----------------------------------------

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

=========================
AVAILABLE KNOWLEDGE
=========================

${compactContext}

=========================
CONVERSATION
=========================

${historyText || "No previous conversation."}

=========================
QUESTION
=========================

${question}

=========================
INSTRUCTIONS
=========================

- Answer ONLY using the available knowledge.
- Never invent information.
- Use Markdown.
- If information is unavailable, say so.
- Mention technologies only when relevant.
- Keep the response concise unless the user asks for more details.
`;
}