import {
    FaReact,
    FaNodeJs,
    FaPython,
    FaDatabase,
    FaGitAlt,
    FaLinux,
    FaCode,
} from "react-icons/fa";

import {
    SiJavascript,
    SiMongodb,
    SiExpress,
    SiFastapi,
    SiPytorch,
    SiLangchain,
    SiBootstrap,
    SiPostgresql,
} from "react-icons/si";

const skillCategories = [
    {
        title: "Frontend Development",
        icon: FaReact,
        skills: [
            {
                name: "React.js",
                icon: FaReact,
            },
            {
                name: "JavaScript",
                icon: SiJavascript,
            },
            {
                name: "HTML & CSS",
                icon: FaCode,
            },
            {
                name: "Bootstrap",
                icon: SiBootstrap,
            },
        ],
    },

    {
        title: "Backend Development",
        icon: FaNodeJs,
        skills: [
            {
                name: "Node.js",
                icon: FaNodeJs,
            },
            {
                name: "Express.js",
                icon: SiExpress,
            },
            {
                name: "FastAPI",
                icon: SiFastapi,
            },
            {
                name: "REST APIs",
                icon: FaCode,
            },
        ],
    },

    {
        title: "AI & Machine Learning",
        icon: FaPython,
        skills: [
            {
                name: "Python",
                icon: FaPython,
            },
            {
                name: "Machine Learning",
                icon: FaCode,
            },
            {
                name: "PyTorch",
                icon: SiPytorch,
            },
            {
                name: "LangChain",
                icon: SiLangchain,
            },
        ],
    },

    {
        title: "Database & Tools",
        icon: FaDatabase,
        skills: [
            {
                name: "MongoDB",
                icon: SiMongodb,
            },
            {
                name: "PostgreSQL",
                icon: SiPostgresql,
            },
            {
                name: "Git & GitHub",
                icon: FaGitAlt,
            },
            {
                name: "Linux",
                icon: FaLinux,
            },
        ],
    },
];

export default skillCategories;