// =========================================================
// 📦 CONTENT SNAPSHOT — GENERATED FILE. DO NOT EDIT.
// =========================================================
// Produced by scripts/build-content.mjs from GET http://127.0.0.1:8001/api/content.
//
// This module is a build-time snapshot of the public content API
// (GET /api/content). It is written fresh on every `npm run build`
// and overwritten from the API — hand-editing it is overwritten and
// pointless. It is committed only so a fresh clone can lint and test
// without a running backend.
//
// Content authority: the backend + PostgreSQL, fetched at build time,
// validated fail-closed in src/lib/content.js. `url` and
// `verification` are merged in from src/config/seo.js, which owns
// those two deployment-level values.
//
// src/data/*.js are NOT this source. They are the legacy migration
// input (docs/CONTENT_MAPPING.md) and are no longer the public
// runtime authority.
// =========================================================

export const meta = {
    "generated_at": "2026-10-17T02:29:06.648782Z",
    "version": 1
};

export const profile = {
    "availableForInternship": true,
    "description": "Full Stack Developer passionate about building scalable web applications and AI-powered solutions. Currently pursuing a B.Sc. in Artificial Intelligence & Machine Learning while strengthening my problem-solving skills through DSA and real-world projects.",
    "greeting": "👋 Hello, I'm",
    "internshipText": "Available for Software Development Internship",
    "location": "Pune, Maharashtra, India",
    "name": "Ritu Raj",
    "resume": "/Ritu_Raj_Full_Stack_Developer_Resume.pdf",
    "roles": [
        "Full Stack Developer",
        "AI & ML Student",
        "MERN Stack Developer",
        "Building AI Solutions"
    ],
    "social": {
        "email": "riturajlabs@outlook.com",
        "github": "https://github.com/riturajlabs",
        "linkedin": "https://linkedin.com/in/riturajlabs"
    },
    "stats": [
        {
            "label": "Projects",
            "value": "4+"
        },
        {
            "label": "DSA Problems",
            "value": "10+"
        },
        {
            "label": "Tech Stack",
            "value": "MERN"
        }
    ],
    "title": "Full Stack Developer"
};

export const about = {
    "cards": [
        {
            "description": "B.Sc. Artificial Intelligence & Machine Learning student, building strong foundations in programming, mathematics, and AI technologies.",
            "icon_key": "FaGraduationCap",
            "title": "Education"
        },
        {
            "description": "Full Stack Developer focused on building scalable web applications using MERN Stack, modern frontend practices, and backend architectures.",
            "icon_key": "FaCode",
            "title": "Development"
        },
        {
            "description": "Exploring Machine Learning, Deep Learning, Generative AI, RAG systems, and AI Agents to create intelligent applications.",
            "icon_key": "FaBrain",
            "title": "AI & Machine Learning"
        },
        {
            "description": "Aspiring AI Engineer combining Software Engineering and Artificial Intelligence to build impactful real-world products.",
            "icon_key": "FaRocket",
            "title": "Career Goal"
        }
    ],
    "description": "I am an Artificial Intelligence and Machine Learning student passionate about creating modern software solutions and intelligent systems that solve real-world problems.",
    "heading": "My Journey",
    "paragraphs": [
        "My journey started with web development and problem solving. While building full stack applications, I developed a strong interest in Artificial Intelligence and Machine Learning.",
        "Currently, I am strengthening my skills in Data Structures & Algorithms, Machine Learning, Deep Learning, Generative AI, and building AI-powered applications."
    ],
    "tag": "About Me",
    "title": "Building Software. Exploring Intelligence."
};

export const projects = [
    {
        "category": "AI SaaS",
        "description": "Multi-tenant RAG-powered AI knowledge assistant SaaS platform that enables businesses to embed intelligent chat assistants on their websites using zero-code integration.",
        "display_order": 0,
        "featured": true,
        "github": "https://github.com/riturajlabs/webchat-AI",
        "highlights": [
            "Production-grade AI assistant with RAG pipeline, semantic search, vector database, and grounded LLM responses",
            "Zero-code embeddable widget SDK with real-time streaming chat using SSE architecture",
            "Multi-tenant SaaS architecture with FastAPI backend, Next.js dashboard, MongoDB Atlas Vector Search, and secure API authentication"
        ],
        "image": "/images/projects/webchat-ai.webp",
        "imageAlt": "WebChat AI landing page with the embedded chat widget answering a visitor question from a 156-page indexed knowledge base",
        "image_height": 896,
        "image_width": 1870,
        "indexable": true,
        "live": "https://webchat-ai-dashboard.vercel.app/",
        "longDescription": "- Production-grade AI assistant with RAG pipeline, semantic search, vector database, and grounded LLM responses\n- Zero-code embeddable widget SDK with real-time streaming chat using SSE architecture\n- Multi-tenant SaaS architecture with FastAPI backend, Next.js dashboard, MongoDB Atlas Vector Search, and secure API authentication",
        "seoDescription": "A look inside WebChat AI, a multi-tenant SaaS that turns website content into an embeddable AI support chatbot using RAG, vector search and Gemini AI.",
        "seoTitle": "WebChat AI: RAG Support Chatbot for Websites",
        "slug": "webchat-ai",
        "status": "published",
        "techStack": [
            "Next.js",
            "React",
            "TypeScript",
            "FastAPI",
            "Python",
            "MongoDB Atlas",
            "Vector Search",
            "RAG",
            "Gemini AI",
            "Playwright"
        ],
        "title": "WebChat AI"
    },
    {
        "category": "AI",
        "description": "AI-powered conversational assistant built with full-stack architecture, integrating LLM capabilities, backend APIs, database persistence, and intelligent workflows.",
        "display_order": 1,
        "featured": true,
        "github": "https://github.com/riturajlabs/Orbit-AI",
        "highlights": [
            "End-to-end full-stack AI product: FastAPI + Express backend, MongoDB persistence, and a React client",
            "LLM integration with RAG-style knowledge grounding and streaming chat responses",
            "JWT auth, rate limiting, and secure API gateway patterns"
        ],
        "image": "/images/projects/orbit-ai.webp",
        "imageAlt": "Orbit AI dark landing page showing an AI assistant chat that explains React hooks next to its feature list",
        "image_height": 322,
        "image_width": 617,
        "indexable": true,
        "live": "https://orbit-ai-client.vercel.app/",
        "longDescription": "- End-to-end full-stack AI product: FastAPI + Express backend, MongoDB persistence, and a React client\n- LLM integration with RAG-style knowledge grounding and streaming chat responses\n- JWT auth, rate limiting, and secure API gateway patterns",
        "seoDescription": "How Orbit AI puts a large language model behind a full-stack chat app, combining a React client, Express and FastAPI services, and MongoDB persistence.",
        "seoTitle": "Orbit AI: Full-Stack LLM Chat Assistant",
        "slug": "orbit-ai",
        "status": "published",
        "techStack": [
            "React",
            "Node.js",
            "Express",
            "FastAPI",
            "MongoDB",
            "AI/LLM"
        ],
        "title": "Orbit AI"
    },
    {
        "category": "Full Stack",
        "description": "Airbnb-inspired full-stack rental platform featuring authentication, property listings, wishlist, reviews, and cloud image uploads.",
        "display_order": 2,
        "featured": false,
        "github": "https://github.com/riturajlabs/Stayora",
        "highlights": [
            "Airbnb-inspired platform with user authentication and authorization",
            "Property listings, wishlist, reviews, and cloud image uploads",
            "RESTful API design with Express and MongoDB schema modeling"
        ],
        "image": "/images/projects/stayora.webp",
        "imageAlt": "StayOra rental search page with trending destination categories and property listing cards showing nightly prices",
        "image_height": 250,
        "image_width": 512,
        "indexable": true,
        "live": "https://stayora-cuh3.onrender.com",
        "longDescription": "- Airbnb-inspired platform with user authentication and authorization\n- Property listings, wishlist, reviews, and cloud image uploads\n- RESTful API design with Express and MongoDB schema modeling",
        "seoDescription": "Stayora is an Airbnb-inspired rental platform built with Node.js, Express and MongoDB, covering authentication, property listings, reviews and image uploads.",
        "seoTitle": "Stayora: Airbnb-Inspired Rental Platform",
        "slug": "stayora",
        "status": "published",
        "techStack": [
            "JavaScript",
            "Node.js",
            "Express",
            "MongoDB"
        ],
        "title": "Stayora"
    },
    {
        "category": "Frontend",
        "description": "Trading platform UI clone focused on responsive design, reusable components, and modern frontend architecture.",
        "display_order": 3,
        "featured": false,
        "github": "https://github.com/riturajlabs/Zerodha-Clone",
        "highlights": [
            "Pixel-faithful UI clone of a popular trading platform",
            "Reusable component architecture with Bootstrap theming",
            "Responsive layouts tested across multiple viewports"
        ],
        "image": "/images/projects/zerodha-clone.webp",
        "imageAlt": "Zerodha-style dashboard landing page showing login prompts, product navigation, and a responsive trading platform hero section",
        "image_height": 896,
        "image_width": 1863,
        "indexable": true,
        "live": "https://zerodha-clone-ui.vercel.app/",
        "longDescription": "- Pixel-faithful UI clone of a popular trading platform\n- Reusable component architecture with Bootstrap theming\n- Responsive layouts tested across multiple viewports",
        "seoDescription": "A Zerodha trading platform UI clone built with React and Bootstrap, focused on pixel-faithful layouts, reusable components and responsive design across screens.",
        "seoTitle": "Zerodha Clone: Trading Dashboard UI in React",
        "slug": "zerodha-clone",
        "status": "published",
        "techStack": [
            "React",
            "Bootstrap",
            "JavaScript"
        ],
        "title": "Zerodha Clone"
    },
    {
        "category": "Web App",
        "description": "Responsive scientific calculator supporting arithmetic operations, trigonometry, factorials, permutations and combinations.",
        "display_order": 4,
        "featured": false,
        "github": "https://github.com/riturajlabs/Scientific-Calculator-Web-App",
        "highlights": [
            "Full scientific feature set: trigonometry, factorials, permutations & combinations",
            "Keyboard support and accessible semantic markup",
            "Pure vanilla JavaScript logic with zero external dependencies"
        ],
        "image": "/images/projects/scientific-calculator.webp",
        "imageAlt": "Dark scientific calculator interface with a blank display above a numeric keypad and a column of amber operator keys",
        "image_height": 756,
        "image_width": 1437,
        "indexable": true,
        "live": "https://ritu-scientific-calculator.netlify.app",
        "longDescription": "- Full scientific feature set: trigonometry, factorials, permutations & combinations\n- Keyboard support and accessible semantic markup\n- Pure vanilla JavaScript logic with zero external dependencies",
        "seoDescription": "A responsive scientific calculator web app in vanilla JavaScript, with trigonometry, factorials, permutations and combinations plus full keyboard support.",
        "seoTitle": "Scientific Calculator Built in Vanilla JavaScript",
        "slug": "scientific-calculator",
        "status": "published",
        "techStack": [
            "HTML",
            "CSS",
            "JavaScript"
        ],
        "title": "Scientific Calculator"
    }
];

export const skills = [
    {
        "category": {
            "display_order": 0,
            "icon_key": "FaReact",
            "name": "Frontend Development"
        },
        "display_order": 0,
        "icon_key": "FaReact",
        "name": "React.js"
    },
    {
        "category": {
            "display_order": 0,
            "icon_key": "FaReact",
            "name": "Frontend Development"
        },
        "display_order": 1,
        "icon_key": "SiJavascript",
        "name": "JavaScript"
    },
    {
        "category": {
            "display_order": 0,
            "icon_key": "FaReact",
            "name": "Frontend Development"
        },
        "display_order": 2,
        "icon_key": "FaCode",
        "name": "HTML & CSS"
    },
    {
        "category": {
            "display_order": 0,
            "icon_key": "FaReact",
            "name": "Frontend Development"
        },
        "display_order": 3,
        "icon_key": "SiBootstrap",
        "name": "Bootstrap"
    },
    {
        "category": {
            "display_order": 1,
            "icon_key": "FaNodeJs",
            "name": "Backend Development"
        },
        "display_order": 0,
        "icon_key": "FaNodeJs",
        "name": "Node.js"
    },
    {
        "category": {
            "display_order": 1,
            "icon_key": "FaNodeJs",
            "name": "Backend Development"
        },
        "display_order": 1,
        "icon_key": "SiExpress",
        "name": "Express.js"
    },
    {
        "category": {
            "display_order": 1,
            "icon_key": "FaNodeJs",
            "name": "Backend Development"
        },
        "display_order": 2,
        "icon_key": "SiFastapi",
        "name": "FastAPI"
    },
    {
        "category": {
            "display_order": 1,
            "icon_key": "FaNodeJs",
            "name": "Backend Development"
        },
        "display_order": 3,
        "icon_key": "FaCode",
        "name": "REST APIs"
    },
    {
        "category": {
            "display_order": 2,
            "icon_key": "FaPython",
            "name": "AI & Machine Learning"
        },
        "display_order": 0,
        "icon_key": "FaPython",
        "name": "Python"
    },
    {
        "category": {
            "display_order": 2,
            "icon_key": "FaPython",
            "name": "AI & Machine Learning"
        },
        "display_order": 1,
        "icon_key": "FaCode",
        "name": "Machine Learning"
    },
    {
        "category": {
            "display_order": 2,
            "icon_key": "FaPython",
            "name": "AI & Machine Learning"
        },
        "display_order": 2,
        "icon_key": "SiPytorch",
        "name": "PyTorch"
    },
    {
        "category": {
            "display_order": 2,
            "icon_key": "FaPython",
            "name": "AI & Machine Learning"
        },
        "display_order": 3,
        "icon_key": "SiLangchain",
        "name": "LangChain"
    },
    {
        "category": {
            "display_order": 3,
            "icon_key": "FaDatabase",
            "name": "Database & Tools"
        },
        "display_order": 0,
        "icon_key": "SiMongodb",
        "name": "MongoDB"
    },
    {
        "category": {
            "display_order": 3,
            "icon_key": "FaDatabase",
            "name": "Database & Tools"
        },
        "display_order": 1,
        "icon_key": "SiPostgresql",
        "name": "PostgreSQL"
    },
    {
        "category": {
            "display_order": 3,
            "icon_key": "FaDatabase",
            "name": "Database & Tools"
        },
        "display_order": 2,
        "icon_key": "FaGitAlt",
        "name": "Git & GitHub"
    },
    {
        "category": {
            "display_order": 3,
            "icon_key": "FaDatabase",
            "name": "Database & Tools"
        },
        "display_order": 3,
        "icon_key": "FaLinux",
        "name": "Linux"
    }
];

export const certifications = [
    {
        "credential_id": null,
        "credential_url": "https://mycourse.app/0alZAvqjp0gicVLOm",
        "display_order": 0,
        "icon": "🌐",
        "issued_on": null,
        "issuer": "Apna College",
        "title": "Delta - Full Stack Web Development"
    },
    {
        "credential_id": null,
        "credential_url": "https://www.linkedin.com/learning/certificates/5ee986f46956a2a977b06f6e09b183944b57b49578a44664a2f0af4be6eaa973",
        "display_order": 1,
        "icon": "🐍",
        "issued_on": null,
        "issuer": "LinkedIn Learning",
        "title": "Python for Data Science and Machine Learning"
    },
    {
        "credential_id": null,
        "credential_url": "https://www.linkedin.com/learning/certificates/697ee1e69f10746e7523ad54338ed17cd69d31e3486cb17fc2bd13dc6bc4fd1c",
        "display_order": 2,
        "icon": "🤖",
        "issued_on": null,
        "issuer": "LinkedIn Learning",
        "title": "Artificial Intelligence Foundations: Machine Learning"
    }
];

export const seo = {
    "author": "Ritu Raj",
    "description": "Portfolio of Ritu Raj (RituRajLabs), Full Stack Developer & AI/ML Student. MERN Stack: React, Node.js, Express, MongoDB. Open to Software Developer Internship.",
    "image": "https://riturajlabs.vercel.app/images/portfolio-og.jpg",
    "imageAlt": "Ritu Raj - Full Stack Developer & AI/ML Student portfolio",
    "keywords": [
        "Ritu Raj",
        "RituRajLabs",
        "Ritu Raj Portfolio",
        "Full Stack Developer",
        "MERN Stack Developer",
        "React Developer",
        "Node.js Developer",
        "Express.js Developer",
        "MongoDB Developer",
        "JavaScript Developer",
        "Backend Developer",
        "Frontend Developer",
        "Software Developer",
        "Software Engineer",
        "Software Developer Internship",
        "AI ML Student",
        "Artificial Intelligence",
        "Machine Learning",
        "Generative AI",
        "Java Developer",
        "Python Developer",
        "Web Developer",
        "Developer Portfolio"
    ],
    "locale": "en_US",
    "person": {
        "address": {
            "country": "IN",
            "locality": "Pune",
            "region": "Maharashtra"
        },
        "alternateName": "RituRajLabs",
        "credential": "B.Sc. Artificial Intelligence & Machine Learning",
        "email": "riturajlabs@outlook.com",
        "jobTitle": "Full Stack Developer & AI/ML Student",
        "knowsAbout": [
            "React.js",
            "JavaScript",
            "HTML & CSS",
            "Bootstrap",
            "Node.js",
            "Express.js",
            "FastAPI",
            "REST APIs",
            "Python",
            "Machine Learning",
            "PyTorch",
            "LangChain",
            "MongoDB",
            "PostgreSQL",
            "Git & GitHub",
            "Linux"
        ],
        "name": "Ritu Raj",
        "nationality": "India"
    },
    "robots": {
        "follow": true,
        "index": true
    },
    "sameAs": [
        "https://github.com/riturajlabs",
        "https://linkedin.com/in/riturajlabs"
    ],
    "siteName": "Ritu Raj Portfolio",
    "title": "Ritu Raj | Full Stack Developer | MERN Stack & AI/ML Student",
    "twitterCard": "summary_large_image",
    "twitterSite": "@riturajlabs",
    "type": "website",
    "url": "https://riturajlabs.vercel.app/",
    "verification": {
        "google": "",
        "bing": ""
    }
};

export const PROJECT_IMAGE_DIMENSIONS = {
    "webchat-ai": {
        "width": 1870,
        "height": 896
    },
    "orbit-ai": {
        "width": 617,
        "height": 322
    },
    "stayora": {
        "width": 512,
        "height": 250
    },
    "zerodha-clone": {
        "width": 1863,
        "height": 896
    },
    "scientific-calculator": {
        "width": 1437,
        "height": 756
    }
};
