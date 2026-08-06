import { motion } from "framer-motion";
import { TypeAnimation } from "react-type-animation";
import {
    FaArrowRight,
    FaDownload,
    FaMapMarkerAlt,
} from "react-icons/fa";

import profile from "../../data/profile";
import Button from "../common/Button";
import SocialLinks from "../common/SocialLinks";

function Hero() {
    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: {
                staggerChildren: 0.2,
                delayChildren: 0.5,
            }
        }
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 20 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.5 } }
    };

    return (
        <section
            id="home"
            className="hero-section"
        >
            <div className="container">
                <div className="hero-content">

                    {/* ================= LEFT ================= */}
                    <motion.div
                        className="hero-left"
                        initial={{ opacity: 0, x: -40 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.8 }}
                    >
                        <span className="hero-greeting">
                            {profile.greeting}
                        </span>

                        {profile.availableForInternship && (
                            <div className="hero-status">
                                <span>
                                    <span className="pulse-dot"></span>
                                    {profile.internshipText}
                                </span>
                            </div>
                        )}

                        <h1 className="hero-title">
                            {profile.name}
                        </h1>

                        <h2 className="hero-subtitle">
                            <TypeAnimation
                                sequence={profile.roles.flatMap((role) => [
                                    role,
                                    2000,
                                ])}
                                speed={60}
                                repeat={Infinity}
                                cursor
                            />
                        </h2>

                        <div className="hero-location">
                            <FaMapMarkerAlt color="red" c/>
                            <span>
                                {profile.location}
                            </span>
                        </div>

                        <p className="hero-description">
                            {profile.description}
                        </p>

                        {/* ================= STATS ================= */}
                        <motion.div 
                            className="hero-stats"
                            variants={containerVariants}
                            initial="hidden"
                            whileInView="visible"
                            viewport={{ once: true }}
                        >
                            {profile.stats.map((stat) => (
                                <motion.div
                                    key={stat.label}
                                    className="hero-stat"
                                    variants={itemVariants}
                                >
                                    <h3>{stat.value}</h3>
                                    <span>{stat.label}</span>
                                </motion.div>
                            ))}
                        </motion.div>

                        {/* ================= BUTTONS ================= */}
                        <div className="hero-buttons">
                            <Button
                                href="#projects"
                                variant="primary"
                            >
                                Explore My Work
                                <FaArrowRight />
                            </Button>

                            <Button
                                href={profile.resume}
                                download
                                variant="outline"
                            >
                                Download Resume
                                <FaDownload />
                            </Button>
                        </div>

                        {/* ================= SOCIAL ================= */}
                        <SocialLinks
                            className="hero-social"
                            showLabels
                        />
                    </motion.div>

                    {/* ================= RIGHT ================= */}
                    <motion.div
                        className="hero-right"
                        initial={{ opacity: 0, x: 40 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.8, delay: 0.2 }}
                    >
                        <div className="hero-visual">
                            {/* Circular profile image with professional gradient ring */}
                            <div className="hero-image-frame">
                                <img
                                    src={profile.profileImage}
                                    alt={profile.name}
                                    className="hero-image"
                                    loading="eager"
                                />
                            </div>
                        </div>
                    </motion.div>

                </div>
            </div>
        </section>
    );
}

export default Hero;