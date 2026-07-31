// ==========================================
// 🚀 PROJECTS KNOWLEDGE BASE
// Used for:
// - Project Details
// - Technologies
// - Features
// - Challenges
// - Architecture
// - Live Demo
// ==========================================

export const projects = [

    // ======================================================
    // ORBIT AI
    // ======================================================
    {
        id: 1,

        name: "Orbit AI",

        slug: "orbit-ai",

        category: "Artificial Intelligence",

        featured: true,

        status: "Completed",

        overview: {
            short:
                "An AI-powered full-stack conversational platform built using modern web technologies.",

            detailed:
                "Orbit AI is a production-ready AI chatbot platform that integrates Large Language Models with a secure backend architecture. It supports intelligent conversations, authentication, persistent chat history, and modern responsive UI."
        },

        technologies: {
            frontend: [
                "React",
                "Bootstrap",
                "JavaScript",
                "Vite"
            ],

            backend: [
                "Node.js",
                "Express.js"
            ],

            database: [
                "MongoDB"
            ],

            ai: [
                "Google Gemini API",
                "Groq API"
            ],

            deployment: [
                "Vercel"
            ]
        },

        features: [
            "AI Chat Assistant",
            "Conversation History",
            "JWT Authentication",
            "Responsive UI",
            "Markdown Support",
            "Model Failover",
            "Secure Backend APIs",
            "Fast Performance"
        ],

        architecture: [
            "Frontend (React)",
            "REST API",
            "Express Backend",
            "MongoDB Database",
            "Google Gemini",
            "Groq AI Failover"
        ],

        challenges: [
            "Managing multiple AI providers.",
            "Reducing frontend bundle size.",
            "Securing API keys.",
            "Improving AI response performance."
        ],

        learnings: [
            "Production deployment",
            "Serverless Functions",
            "AI API integration",
            "Prompt Engineering",
            "Performance Optimization"
        ],

        liveDemo:
            "https://orbit-ai-client.vercel.app/",

        github:
            "https://github.com/riturajlabs",

        image: "orbit-ai",

        completionYear: 2026
    },

    // ======================================================
    // STAYORA
    // ======================================================
    {
        id: 2,

        name: "Stayora",

        slug: "stayora",

        category: "Full Stack",

        featured: true,

        status: "Completed",

        overview: {
            short:
                "An Airbnb-inspired rental platform.",

            detailed:
                "Stayora allows users to discover, list, and manage rental properties with authentication, image uploads, reviews, and wishlist functionality."
        },

        technologies: {
            frontend: [
                "HTML",
                "CSS",
                "Bootstrap",
                "JavaScript",
                "EJS"
            ],

            backend: [
                "Node.js",
                "Express.js"
            ],

            database: [
                "MongoDB"
            ],

            deployment: [
                "Render"
            ]
        },

        features: [
            "Authentication",
            "Property Listings",
            "Cloud Image Upload",
            "Reviews",
            "Wishlist",
            "Responsive Design"
        ],

        challenges: [
            "Authentication",
            "Cloud Storage Integration",
            "Database Relationships"
        ],

        learnings: [
            "MongoDB",
            "Express",
            "MVC Architecture",
            "CRUD Operations"
        ],

        liveDemo:
            "https://stayora-cuh3.onrender.com/",

        github:
            "https://github.com/riturajlabs",

        image: "stayora",

        completionYear: 2026
    },

    // ======================================================
    // SCIENTIFIC CALCULATOR
    // ======================================================
    {
        id: 3,

        name: "Scientific Calculator",

        slug: "scientific-calculator",

        category: "Frontend",

        featured: true,

        status: "Completed",

        overview: {
            short:
                "A responsive scientific calculator.",

            detailed:
                "A web-based calculator supporting arithmetic operations, trigonometric calculations, factorials, permutations, combinations, and advanced mathematical functions."
        },

        technologies: {
            frontend: [
                "HTML",
                "CSS",
                "JavaScript"
            ]
        },

        features: [
            "Scientific Functions",
            "Responsive Design",
            "Keyboard Support",
            "Fast Calculations"
        ],

        learnings: [
            "JavaScript Logic",
            "DOM Manipulation",
            "Responsive UI"
        ],

        liveDemo:
            "https://ritu-scientific-calculator.netlify.app",

        github:
            "https://github.com/riturajlabs",

        image: "calculator",

        completionYear: 2025
    },

    // ======================================================
    // ZERODHA CLONE
    // ======================================================
    {
        id: 4,

        name: "Zerodha Clone",

        slug: "zerodha-clone",

        category: "Frontend",

        featured: false,

        status: "In Progress",

        overview: {
            short:
                "A responsive trading platform UI.",

            detailed:
                "A modern frontend clone inspired by Zerodha focusing on reusable React components, responsive layouts, and clean architecture."
        },

        technologies: {
            frontend: [
                "React",
                "Bootstrap",
                "JavaScript"
            ]
        },

        features: [
            "Responsive Layout",
            "Reusable Components",
            "Modern UI"
        ],

        learnings: [
            "Component Design",
            "React Architecture",
            "Responsive Development"
        ],

        github:
            "https://github.com/riturajlabs",

        image: "zerodha",

        completionYear: 2026
    }
];