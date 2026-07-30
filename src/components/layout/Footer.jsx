import { FaArrowUp, FaHeart } from "react-icons/fa";
import { motion } from "framer-motion";

import profile from "../../data/profile";
import socials from "../../data/socials";

import "../../styles/footer.css";

function Footer() {
    const footerLinks = [
        { name: "Home", link: "#home" },
        { name: "About", link: "#about" },
        { name: "Skills", link: "#skills" },
        { name: "Projects", link: "#projects" },
        { name: "Certifications", link: "#certifications" },
        { name: "Blog", link: "#blog" },
        { name: "Contact", link: "#contact" },
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

                        {/* Added an inspiring tech quote */}
                        <blockquote className="footer-quote">
                            "Any fool can write code that a computer can understand.
                            Good programmers write code that humans can understand."
                            <span>— &nbsp;Martin Fowler</span>
                        </blockquote>
                    </motion.div>


                    {/* ================= QUICK LINKS ================= */}
                    <div className="footer-navigation">
                        <h4>Quick Links</h4>
                        <ul>
                            {footerLinks.map((item) => (
                                <li key={item.name}>
                                    <a href={item.link}>
                                        {item.name}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>


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