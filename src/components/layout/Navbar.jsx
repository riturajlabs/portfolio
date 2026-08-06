import { useEffect, useState } from "react";
import { FaBars, FaTimes } from "react-icons/fa";
import { motion, AnimatePresence } from "framer-motion";

import ThemeToggle from "./ThemeToggle";
import useScrollSpy from "../../hooks/useScrollSpy";
import profile from "../../data/profile";
import "../../styles/navbar.css";

const navigation = [
    { id: "home", label: "Home" },
    { id: "about", label: "About" },
    { id: "skills", label: "Skills" },
    { id: "projects", label: "Projects" },

    { id: "certifications", label: "Certifications" },
    
    { id: "contact", label: "Contact" },
];

function Navbar() {
    const [menuOpen, setMenuOpen] = useState(false);
    const [scrolled, setScrolled] = useState(false);
    const [activeSection, setActiveSection] = useScrollSpy("home");

    // Navbar background on scroll
    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 40);
        };

        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    // Lock scroll when mobile menu is open
    useEffect(() => {
        if (menuOpen) {
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "";
        }

        return () => {
            document.body.style.overflow = "";
        };
    }, [menuOpen]);

    return (
        <header
            className={`navbar-wrapper ${scrolled ? "navbar-scrolled" : ""}`}
        >
            <div className="container">
                <nav className="navbar-custom">
                    
                    {/* LOGO */}
                    <a
                        href="#home"
                        className="logo"
                        onClick={() => setMenuOpen(false)}
                    >
                        <h1 className="logo-name">{profile.name}</h1>
                    </a>

                    {/* ================= DESKTOP NAV (FIXED) ================= */}
                    <ul className="nav-links d-none d-lg-flex">
                        {navigation.map((item) => (
                            <li key={item.id}>
                                <a
                                    href={`#${item.id}`}
                                    className={activeSection === item.id ? "active-link" : ""}
                                    onClick={() => setActiveSection(item.id)}
                                >
                                    {item.label}
                                </a>
                            </li>
                        ))}
                    </ul>

                    {/* ACTIONS */}
                    <div className="navbar-actions">
                        <ThemeToggle />

                        <a
                            href={profile.resume}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="resume-btn d-none d-lg-inline-flex"
                        >
                            Resume
                        </a>

                        <button
                            className="menu-btn d-lg-none"
                            onClick={() => setMenuOpen(!menuOpen)}
                            aria-label="Toggle Menu"
                        >
                            {menuOpen ? <FaTimes /> : <FaBars />}
                        </button>
                    </div>
                </nav>

                
                {/* ================= MOBILE MENU ================= */}
                <AnimatePresence>
                    {menuOpen && (
                        <motion.div
                            className="mobile-menu d-lg-none"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.3, ease: "easeInOut" }}
                        >
                            <div className="mobile-menu-content">
                                {navigation.map((item) => (
                                    <a
                                        key={item.id}
                                        href={`#${item.id}`}
                                        className={activeSection === item.id ? "active-link" : ""}
                                        onClick={(e) => {
                                            e.preventDefault();

                                            setActiveSection(item.id);
                                            
                                            // 1. Sabse pehle menu close karo taaki body ka "overflow: hidden" hat jaye aur page unlock ho.
                                            setMenuOpen(false); 
                                            
                                            // 2. 300ms ka wait karo (taaki Framer motion ka close animation ho jaye aur DOM update ho jaye) 
                                            // Fir perfectly correct section par scroll karo.
                                            setTimeout(() => {
                                                document.getElementById(item.id)?.scrollIntoView({
                                                    behavior: "smooth"
                                                });
                                            }, 300);
                                        }}
                                    >
                                        {item.label}
                                    </a>
                                ))}

                                <a
                                    href={profile.resume}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mobile-resume"
                                >
                                    Download Resume
                                </a>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </header>
    );
}

export default Navbar;