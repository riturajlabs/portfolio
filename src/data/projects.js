const projects = [
    {
        id: 5,
        title: "WebChat AI",
        featured: true,
        category: "AI SaaS",

        description:
            "Multi-tenant RAG-powered AI knowledge assistant SaaS platform that enables businesses to embed intelligent chat assistants on their websites using zero-code integration.",

        image: "/images/projects/webchat-ai.webp",
        imageAlt:
            "WebChat AI landing page with the embedded chat widget answering a visitor question from a 156-page indexed knowledge base",

        slug: "webchat-ai",
        seoTitle: "WebChat AI: RAG Support Chatbot for Websites",
        seoDescription:
            "A look inside WebChat AI, a multi-tenant SaaS that turns website content into an embeddable AI support chatbot using RAG, vector search and Gemini AI.",

        publishedAt: null,
        updatedAt: null,

        indexable: true,

        highlights: [
            "Production-grade AI assistant with RAG pipeline, semantic search, vector database, and grounded LLM responses",
            "Zero-code embeddable widget SDK with real-time streaming chat using SSE architecture",
            "Multi-tenant SaaS architecture with FastAPI backend, Next.js dashboard, MongoDB Atlas Vector Search, and secure API authentication",
        ],

        techStack: [
            "Next.js",
            "React",
            "TypeScript",
            "FastAPI",
            "Python",
            "MongoDB Atlas",
            "Vector Search",
            "RAG",
            "Gemini AI",
            "Playwright",
        ],

        live: "https://webchat-ai-dashboard.vercel.app/",
        github: "https://github.com/riturajlabs/webchat-AI",
    },
    {
        id: 1,
        title: "Orbit AI",
        featured: true,
        category: "AI",

        description:
            "AI-powered conversational assistant built with full-stack architecture, integrating LLM capabilities, backend APIs, database persistence, and intelligent workflows.",

        image: "/images/projects/orbit-ai.webp",
        imageAlt:
            "Orbit AI dark landing page showing an AI assistant chat that explains React hooks next to its feature list",

        slug: "orbit-ai",
        seoTitle: "Orbit AI: Full-Stack LLM Chat Assistant",
        seoDescription:
            "How Orbit AI puts a large language model behind a full-stack chat app, combining a React client, Express and FastAPI services, and MongoDB persistence.",

        publishedAt: null,
        updatedAt: null,

        indexable: true,

        highlights: [
            "End-to-end full-stack AI product: FastAPI + Express backend, MongoDB persistence, and a React client",
            "LLM integration with RAG-style knowledge grounding and streaming chat responses",
            "JWT auth, rate limiting, and secure API gateway patterns",
        ],

        techStack: [
            "React",
            "Node.js",
            "Express",
            "FastAPI",
            "MongoDB",
            "AI/LLM",
        ],

        live: "https://orbit-ai-client.vercel.app/",
        github: "https://github.com/riturajlabs/Orbit-AI",
    },

    {
        id: 2,
        title: "Stayora",
        category: "Full Stack",

        description:
            "Airbnb-inspired full-stack rental platform featuring authentication, property listings, wishlist, reviews, and cloud image uploads.",

        image: "/images/projects/stayora.webp",
        imageAlt:
            "StayOra rental search page with trending destination categories and property listing cards showing nightly prices",

        slug: "stayora",
        seoTitle: "Stayora: Airbnb-Inspired Rental Platform",
        seoDescription:
            "Stayora is an Airbnb-inspired rental platform built with Node.js, Express and MongoDB, covering authentication, property listings, reviews and image uploads.",

        publishedAt: null,
        updatedAt: null,

        indexable: true,

        highlights: [
            "Airbnb-inspired platform with user authentication and authorization",
            "Property listings, wishlist, reviews, and cloud image uploads",
            "RESTful API design with Express and MongoDB schema modeling",
        ],

        techStack: [
            "JavaScript",
            "Node.js",
            "Express",
            "MongoDB",
        ],

        live: "https://stayora-cuh3.onrender.com",
        github: "https://github.com/riturajlabs/Stayora",
    },

    {
        id: 3,
        title: "Zerodha Clone",
        category: "Frontend",

        description:
            "Trading platform UI clone focused on responsive design, reusable components, and modern frontend architecture.",

        image: "/images/projects/zerodha-clone.webp",
        imageAlt:
            "Zerodha-style dashboard landing page showing login prompts, product navigation, and a responsive trading platform hero section",

        slug: "zerodha-clone",
        seoTitle: "Zerodha Clone: Trading Dashboard UI in React",
        seoDescription:
            "A Zerodha trading platform UI clone built with React and Bootstrap, focused on pixel-faithful layouts, reusable components and responsive design across screens.",

        publishedAt: null,
        updatedAt: null,

        indexable: true,

        highlights: [
            "Pixel-faithful UI clone of a popular trading platform",
            "Reusable component architecture with Bootstrap theming",
            "Responsive layouts tested across multiple viewports",
        ],

        techStack: [
            "React",
            "Bootstrap",
            "JavaScript",
        ],

        live: "https://zerodha-clone-ui.vercel.app/",
        github: "https://github.com/riturajlabs/Zerodha-Clone",
    },

    {
        id: 4,
        title: "Scientific Calculator",
        category: "Web App",

        description:
            "Responsive scientific calculator supporting arithmetic operations, trigonometry, factorials, permutations and combinations.",

        image: "/images/projects/scientific-calculator.webp",
        imageAlt:
            "Dark scientific calculator interface with a blank display above a numeric keypad and a column of amber operator keys",

        slug: "scientific-calculator",
        seoTitle: "Scientific Calculator Built in Vanilla JavaScript",
        seoDescription:
            "A responsive scientific calculator web app in vanilla JavaScript, with trigonometry, factorials, permutations and combinations plus full keyboard support.",

        publishedAt: null,
        updatedAt: null,

        indexable: true,

        highlights: [
            "Full scientific feature set: trigonometry, factorials, permutations & combinations",
            "Keyboard support and accessible semantic markup",
            "Pure vanilla JavaScript logic with zero external dependencies",
        ],

        techStack: [
            "HTML",
            "CSS",
            "JavaScript",
        ],

        live: "https://ritu-scientific-calculator.netlify.app",
        github: "https://github.com/riturajlabs/Scientific-Calculator-Web-App",
    },
];

export default projects;