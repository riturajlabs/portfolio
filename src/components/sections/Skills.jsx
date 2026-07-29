import { motion } from "framer-motion";

import SectionTitle from "../common/SectionTitle";

import skillCategories from "../../data/skills";

import "../../styles/skills.css";

function Skills() {
    return (
        <section
            id="skills"
            className="skills-section"
        >
            <div className="container">

                <SectionTitle
                    tag="My Skills"
                    title="Technologies I Work With"
                    description="A combination of Full Stack Development, Artificial Intelligence, and modern tools to build real-world applications."
                />

                <div className="skills-grid">
                    {skillCategories.map((category, index) => {
                        const CategoryIcon = category.icon;

                        return (
                            <motion.article
                                key={category.id || category.title}
                                className="skill-card"
                                initial={{
                                    opacity: 0,
                                    y: 30,
                                }}
                                whileInView={{
                                    opacity: 1,
                                    y: 0,
                                }}
                                viewport={{
                                    once: true,
                                }}
                                transition={{
                                    duration: 0.5,
                                    delay: index * 0.1,
                                }}
                            >
                                <div className="skill-heading">
                                    <div className="skill-category-icon">
                                        <CategoryIcon />
                                    </div>

                                    <h3>{category.title}</h3>
                                </div>

                                <div className="skill-list">
                                    {category.skills.map((skill) => {
                                        const SkillIcon = skill.icon;

                                        return (
                                            <div
                                                key={skill.id || skill.name}
                                                className="skill-item"
                                            >
                                                <span className="skill-icon">
                                                    <SkillIcon />
                                                </span>

                                                <span>{skill.name}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </motion.article>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}

export default Skills;