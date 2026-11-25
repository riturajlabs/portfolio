import { useEffect, useRef, useState } from "react";
import { FaBars, FaTimes } from "react-icons/fa";
import { motion, AnimatePresence } from "framer-motion";

import ThemeToggle from "./ThemeToggle";
import useScrollSpy from "../../hooks/useScrollSpy";
import { profile } from "../../lib/publicContent";
import "../../styles/navbar.css";

const navigation = [
    { id: "home", label: "Home" },
    { id: "about", label: "About" },
    { id: "skills", label: "Skills" },
    { id: "projects", label: "Projects" },
    { id: "github", label: "GitHub" },
    { id: "certifications", label: "Certifications" },
    { id: "blog", label: "Blog" },
    { id: "contact", label: "Contact" },
];

function Navbar() {
    const [menuOpen, setMenuOpen] = useState(false);
    const [scrolled, setScrolled] = useState(false);
    const [activeSection, setActiveSection] = useScrollSpy("home");
    const menuButtonRef = useRef(null);
    const menuPanelRef = useRef(null);

    // Navbar background on scroll
    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 40);
        };

        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    useEffect(() => {
        if (!menuOpen) return undefined;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [menuOpen]);

    useEffect(() => {
        if (!menuOpen) return undefined;

        const panel = menuPanelRef.current;
        const focusableSelector = "a[href], button:not([disabled])";
        const focusables = () =>
            panel ? [...panel.querySelectorAll(focusableSelector)] : [];
        const previouslyFocused = document.activeElement;

        const frame = window.requestAnimationFrame(() => {
            focusables()[0]?.focus();
        });

        const handleKeyDown = (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                setMenuOpen(false);
                menuButtonRef.current?.focus({ preventScroll: true });
                return;
            }

            if (event.key !== "Tab") return;

            const items = focusables();
            if (items.length === 0) return;

            const first = items[0];
            const last = items[items.length - 1];

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener("keydown", handleKeyDown);

        return () => {
            window.cancelAnimationFrame(frame);
            document.removeEventListener("keydown", handleKeyDown);
            if (previouslyFocused instanceof HTMLElement) {
                previouslyFocused.focus({ preventScroll: true });
            }
        };
    }, [menuOpen]);

    return (
        <header
            className={`navbar-wrapper ${scrolled ? "navbar-scrolled" : ""}`}
        >
            <div className="container">
                <nav className="navbar-custom" aria-label="Main navigation">
                    
                    {/* LOGO */}
                    <a
                        href="#home"
                        className="logo"
                        onClick={() => setMenuOpen(false)}
                    >
                        <span className="logo-name">{profile.name}</span>
                    </a>

                    {/* ================= DESKTOP NAV (FIXED) ================= */}
                    <ul className="nav-links d-none d-lg-flex">
                        {navigation.map((item) => (
                            <li key={item.id}>
                                <a
                                    href={`#${item.id}`}
                                    className={activeSection === item.id ? "active-link" : ""}
                                    aria-current={activeSection === item.id ? "page" : undefined}
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
                            ref={menuButtonRef}
                            className="menu-btn d-lg-none"
                            onClick={() => setMenuOpen(!menuOpen)}
                            aria-label={menuOpen ? "Close Menu" : "Open Menu"}
                            aria-expanded={menuOpen}
                            aria-controls="mobile-menu-panel"
                        >
                            {menuOpen ? <FaTimes aria-hidden="true" /> : <FaBars aria-hidden="true" />}
                        </button>
                    </div>
                </nav>

                
                {/* ================= MOBILE MENU ================= */}
                <AnimatePresence>
                    {menuOpen && (
                        <motion.div
                            ref={menuPanelRef}
                            id="mobile-menu-panel"
                            className="mobile-menu d-lg-none"
                            role="dialog"
                            aria-modal="true"
                            aria-label="Site navigation"
                            tabIndex={-1}
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.3, ease: "easeInOut" }}
                        >
                            <div className="mobile-menu-content">
                                <button
                                    type="button"
                                    className="mobile-menu-close"
                                    aria-label="Close navigation menu"
                                    onClick={() => {
                                        setMenuOpen(false);
                                        menuButtonRef.current?.focus({ preventScroll: true });
                                    }}
                                >
                                    <FaTimes aria-hidden="true" />
                                </button>
                                {navigation.map((item) => (
                                    <a
                                        key={item.id}
                                        href={`#${item.id}`}
                                        className={activeSection === item.id ? "active-link" : ""}
                                        aria-current={activeSection === item.id ? "page" : undefined}
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