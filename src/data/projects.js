import orbitAI from "../assets/images/orbit-ai.webp";
import stayora from "../assets/images/stayora.webp";
// import zerodha from "../assets/images/zerodha.webp";
import calculator from "../assets/images/calculator.webp";

const projects = [
    {
        id: 1,
        title: "Orbit AI",
        featured: true,
        category: "AI",

        description:
            "AI-powered conversational assistant built with full-stack architecture, integrating LLM capabilities, backend APIs, database persistence, and intelligent workflows.",

        image: orbitAI,

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

        image: stayora,

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

        live: "https://stayora-cuh3.onrender.com/",
        github: "https://github.com/riturajlabs/Stayora",
    },

    {
        id: 3,
        title: "Zerodha Clone",
        category: "Frontend",

        description:
            "Trading platform UI clone focused on responsive design, reusable components, and modern frontend architecture.",

        image: null,

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

        live: "#",
        github: "#",
    },

    {
        id: 4,
        title: "Scientific Calculator",
        category: "Web App",

        description:
            "Responsive scientific calculator supporting arithmetic operations, trigonometry, factorials, permutations and combinations.",

        image: calculator,

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