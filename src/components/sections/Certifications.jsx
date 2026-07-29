import { motion } from "framer-motion";

import {
    FaExternalLinkAlt,
} from "react-icons/fa";


import certificates from "../../data/certificates";

import SectionTitle from "../common/SectionTitle";

import "../../styles/certifications.css";


function Certifications() {


    return (

        <section
            id="certifications"
            className="certifications-section"
        >

            <div className="container">


                <SectionTitle

                    tag="Certifications"

                    title="Continuous Learning"

                    description=
                    "Professional certifications representing my learning journey in Full Stack Development, Data Science, and Artificial Intelligence."

                />



                <div className="certification-grid">


                    {
                        certificates.map(
                            (certificate,index)=>(


                            <motion.article

                                key={certificate.title}

                                className="certificate-card"


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


                                transition={{
                                    delay:index*0.15
                                }}

                            >


                                <div className="certificate-icon">

                                    {certificate.icon}

                                </div>



                                <h3>

                                    {certificate.title}

                                </h3>



                                <span className="certificate-issuer">

                                    {certificate.issuer}

                                </span>



                                <p>

                                    {certificate.description}

                                </p>



                                <a

                                    href={certificate.credential}

                                    target="_blank"

                                    rel="noopener noreferrer"

                                >

                                    View Credential

                                    <FaExternalLinkAlt />

                                </a>


                            </motion.article>


                        ))
                    }


                </div>


            </div>


        </section>

    );

}


export default Certifications;