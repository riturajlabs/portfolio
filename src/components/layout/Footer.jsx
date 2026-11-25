import { FaArrowUp, FaHeart } from "react-icons/fa";
import { motion } from "framer-motion";

import { profile, socials } from "../../lib/publicContent";

import "../../styles/footer.css";

function Footer() {
    const primaryLinks = [
        { name: "Home", link: "#home" },
        { name: "Projects", link: "#projects" },
        { name: "Contact", link: "#contact" },
    ];

    const secondaryLinks = [
        { name: "About", link: "#about" },
        { name: "Skills", link: "#skills" },
        { name: "GitHub", link: "#github" },
        { name: "Certifications", link: "#certifications" },
        { name: "Blog", link: "#blog" },
    ];

   

    // Smooth scroll to top function
    const scrollToTop = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    return (
        <footer className="footer-section">
            
            {/* Decorative Top Border */}
            <div className="footer-top-border"></div>

            <div className="container">
                <div className="footer-content">

                    {/* ================= BRAND & QUOTE ================= */}
                    <motion.div
                        className="footer-brand"
                        initial={{ opacity: 0, y: 30 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                    >
                        <a href="#home" className="footer-logo">
                            {profile.name}<span>.</span>
                        </a>

                        <p className="footer-role">
                            {profile.title} <br />
                            AI & ML Student
                        </p>

                        <p className="footer-tagline">
                            Building scalable software and intelligent AI solutions 🚀
                        </p>
                    </motion.div>


                    <nav className="footer-navigation" aria-label="Primary footer navigation">
                        <h4>Explore</h4>
                        <ul>
                            {primaryLinks.map((item) => (
                                <li key={item.name}>
                                    <a href={item.link}>
                                        {item.name}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </nav>

                    <nav className="footer-navigation" aria-label="More footer navigation">
                        <h4>More</h4>
                        <ul>
                            {secondaryLinks.map((item) => (
                                <li key={item.name}>
                                    <a href={item.link}>
                                        {item.name}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </nav>


                    {/* ================= CONNECT ================= */}
                    <div className="footer-social">
                        <h4>Connect</h4>
                        <p className="social-text">Follow my journey and let's connect!</p>
                        
                        <div className="footer-icons">
                            {socials.map((social) => {
                                const Icon = social.icon;
                                return (
                                    <a
                                        key={social.name}
                                        href={social.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        aria-label={social.name}
                                        title={social.name}
                                    >
                                        <Icon />
                                    </a>
                                );
                            })}
                        </div>
                    </div>

                </div>

                {/* ================= BOTTOM ================= */}
                <div className="footer-bottom">
                    
                    <p className="copyright-text">
                        © {new Date().getFullYear()} {profile.name}. All rights reserved.
                    </p>

                    <div className="footer-bottom-center">
                        <p>Built with <FaHeart className="heart-icon"/> by {profile.name}</p>
                    </div>

                    <button
                        onClick={scrollToTop}
                        className="back-top"
                        aria-label="Back to top"
                    >
                        <FaArrowUp />
                    </button>

                </div>

            </div>
        </footer>
    );
}

export default Footer;