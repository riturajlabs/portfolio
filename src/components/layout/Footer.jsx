import {
    FaArrowUp,
} from "react-icons/fa";

import { motion } from "framer-motion";

import profile from "../../data/profile";
import socials from "../../data/socials";

import "../../styles/footer.css";


function Footer() {


    const footerLinks = [

    {
        name: "Home",
        link: "#home",
    },

    {
        name: "About",
        link: "#about",
    },

    {
        name: "Skills",
        link: "#skills",
    },

    {
        name: "Projects",
        link: "#projects",
    },

    {
        name: "Certifications",
        link: "#certifications",
    },

    {
        name: "Blog",
        link: "#blog",
    },

    {
        name: "Contact",
        link: "#contact",
    },

];



    return (

        <footer className="footer-section">

            <div className="container">


                <div className="footer-content">


                    {/* ================= BRAND ================= */}

                    <motion.div
                        className="footer-brand"

                        initial={{
                            opacity:0,
                            y:30
                        }}

                        whileInView={{
                            opacity:1,
                            y:0
                        }}

                        viewport={{
                            once:true
                        }}
                    >


                        <a
                            href="#home"
                            className="footer-logo"
                        >

                            {profile.name}

                            <span>
                                .
                            </span>

                        </a>



                        <p>

                            {profile.title}

                            <br />

                            AI & ML Student

                        </p>



                        <span>

                            Building scalable software
                            and intelligent AI solutions 🚀

                        </span>


                    </motion.div>





                    {/* ================= LINKS ================= */}


                    <div className="footer-navigation">


                        <h4>
                            Quick Links
                        </h4>


                        <ul>

                            {
                                footerLinks.map((item)=>(

                                    <li
                                        key={item.name}
                                    >

                                        <a
                                            href={item.link}
                                        >
                                            {item.name}
                                        </a>


                                    </li>

                                ))
                            }

                        </ul>


                    </div>






                    {/* ================= SOCIAL ================= */}


                    <div className="footer-social">


                        <h4>
                            Connect
                        </h4>



                        <div className="footer-icons">


                            {
                                socials.map((social)=>{


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


                                })
                            }


                        </div>


                    </div>



                </div>








                {/* ================= BOTTOM ================= */}


                <div className="footer-bottom">


                    <p>

                        © {new Date().getFullYear()} {profile.name}.
                        All rights reserved.

                    </p>




                    <a

                        href="#home"

                        className="back-top"

                        aria-label="Back to top"

                    >

                        <FaArrowUp />

                    </a>



                </div>



            </div>


        </footer>

    );

}


export default Footer;