import { useEffect, useState } from "react";
import { FaBars, FaTimes } from "react-icons/fa";
import { motion, AnimatePresence } from "framer-motion";

import ThemeToggle from "./ThemeToggle";
import profile from "../../data/profile";

import "../../styles/navbar.css";


const navigation = [
    {
        id: "home",
        label: "Home",
    },

    {
        id: "about",
        label: "About",
    },

    {
        id: "skills",
        label: "Skills",
    },

    {
        id: "projects",
        label: "Projects",
    },

    {
        id: "certifications",
        label: "Certifications",
    },

    {
        id: "blog",
        label: "Blog",
    },

    {
        id: "contact",
        label: "Contact",
    },
];



function Navbar() {


    const [menuOpen, setMenuOpen] = useState(false);

    const [scrolled, setScrolled] = useState(false);

    const [activeSection, setActiveSection] = useState("home");





    /*
        Navbar background on scroll
    */

    useEffect(() => {


        const handleScroll = () => {

            setScrolled(
                window.scrollY > 40
            );

        };



        window.addEventListener(
            "scroll",
            handleScroll
        );



        return () => {

            window.removeEventListener(
                "scroll",
                handleScroll
            );

        };


    }, []);






    /*
        Lock body scroll on mobile menu
    */

    useEffect(() => {


        document.body.style.overflow = menuOpen
            ? "hidden"
            : "";



        return () => {

            document.body.style.overflow = "";

        };


    }, [menuOpen]);







    /*
        Active navigation observer
    */

    useEffect(() => {


        const sections =
            document.querySelectorAll(
                "section[id]"
            );



        const observer =
            new IntersectionObserver(

                (entries)=>{


                    entries.forEach(
                        (entry)=>{


                            if(entry.isIntersecting){

                                setActiveSection(
                                    entry.target.id
                                );

                            }


                        }
                    );


                },

                {
                    threshold:0.5
                }

            );



        sections.forEach(
            section =>
                observer.observe(section)
        );



        return () => {

            observer.disconnect();

        };


    }, []);








    return (


        <header

            className={
                `navbar-wrapper ${
                    scrolled
                    ? "navbar-scrolled"
                    : ""
                }`
            }

        >


            <div className="container">



                <nav className="navbar-custom">



                    {/* LOGO */}

                    <a

                        href="#home"

                        className="logo"

                        onClick={() =>
                            setMenuOpen(false)
                        }

                    >

                        <span className="logo-name">

                            {profile.name}

                        </span>


                    </a>









                    {/* DESKTOP NAV */}


                    <ul className="nav-links d-none d-lg-flex">


                        {
                            navigation.map(
                                (item)=>(


                                    <li key={item.id}>


                                        <a

                                            href={`#${item.id}`}

                                            className={
                                                activeSection === item.id
                                                ? "active-link"
                                                : ""
                                            }

                                        >

                                            {item.label}


                                        </a>


                                    </li>


                                )
                            )
                        }


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

                            onClick={() =>
                                setMenuOpen(!menuOpen)
                            }

                            aria-label="Toggle Menu"

                        >

                            {
                                menuOpen
                                ?
                                <FaTimes />
                                :
                                <FaBars />
                            }


                        </button>



                    </div>



                </nav>









                {/* MOBILE MENU */}



                <AnimatePresence>


                    {
                        menuOpen && (


                            <motion.div

                                className="mobile-menu d-lg-none"

                                initial={{
                                    opacity:0,
                                    height:0
                                }}

                                animate={{
                                    opacity:1,
                                    height:"auto"
                                }}

                                exit={{
                                    opacity:0,
                                    height:0
                                }}

                                transition={{
                                    duration:0.3
                                }}

                            >


                                <div className="mobile-menu-content">


                                    {
                                        navigation.map(
                                            (item)=>(


                                                <a

                                                    key={item.id}

                                                    href={`#${item.id}`}

                                                    className={
                                                        activeSection === item.id
                                                        ? "active-link"
                                                        : ""
                                                    }


                                                    onClick={() =>
                                                        setMenuOpen(false)
                                                    }


                                                >

                                                    {item.label}


                                                </a>


                                            )
                                        )
                                    }





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


                        )
                    }



                </AnimatePresence>



            </div>


        </header>


    );


}



export default Navbar;