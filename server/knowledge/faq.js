// ==========================================
// ❓ FAQ KNOWLEDGE BASE
// Used for:
// - Common Visitor Questions
// - Recruiter Questions
// - Navigation
// - AI Intent Detection
// ==========================================

export const faq = {
    greetings: [
        "hi",
        "hello",
        "hey",
        "good morning",
        "good afternoon",
        "good evening",
        "how are you"
    ],

    categories: [

        {
            category: "About",

            questions: [
                "Who are you?",
                "Tell me about yourself.",
                "Introduce yourself.",
                "What do you do?",
                "What is your background?"
            ],

            knowledgeSource: [
                "profile"
            ]
        },

        {
            category: "Education",

            questions: [
                "What are you studying?",
                "Which university do you attend?",
                "Which semester are you in?",
                "What is your educational background?",
                "What subjects have you studied?"
            ],

            knowledgeSource: [
                "education"
            ]
        },

        {
            category: "Skills",

            questions: [
                "What technologies do you know?",
                "What programming languages do you use?",
                "Are you a MERN developer?",
                "What backend technologies do you know?",
                "What frontend frameworks do you use?",
                "Which databases have you worked with?"
            ],

            knowledgeSource: [
                "skills"
            ]
        },

        {
            category: "Projects",

            questions: [
                "What projects have you built?",
                "Which project are you most proud of?",
                "Tell me about Orbit AI.",
                "Tell me about Stayora.",
                "Show your portfolio projects.",
                "Which project is currently in progress?"
            ],

            knowledgeSource: [
                "projects"
            ]
        },

        {
            category: "Career",

            questions: [
                "What role are you looking for?",
                "Are you available for internships?",
                "Why should we hire you?",
                "What are your career goals?",
                "Can you work remotely?"
            ],

            knowledgeSource: [
                "recruiter"
            ]
        },

        {
            category: "Certifications",

            questions: [
                "Do you have certifications?",
                "Show your certificates.",
                "Which AI certifications do you have?",
                "What courses have you completed?"
            ],

            knowledgeSource: [
                "certifications"
            ]
        },

        {
            category: "Contact",

            questions: [
                "How can I contact you?",
                "Where is your GitHub?",
                "What is your LinkedIn?",
                "Can I download your resume?",
                "How can I reach you?"
            ],

            knowledgeSource: [
                "socials"
            ]
        }

    ],

    unsupportedQuestions: [
        "Politics",
        "Religion",
        "Medical Advice",
        "Financial Advice",
        "Personal Opinions",
        "Sensitive Personal Information"
    ],

    fallback: {
        title: "Unknown Question",

        message:
            "I couldn't find an exact answer to that. Feel free to ask about projects, skills, education, experience, technologies, or career goals."
    },

    suggestedQuestions: [
        "Tell me about yourself.",
        "What projects have you built?",
        "What technologies do you know?",
        "Are you available for internships?",
        "Show your GitHub.",
        "What are you currently learning?",
        "Tell me about Orbit AI.",
        "Why should we hire you?"
    ]
};