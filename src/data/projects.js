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