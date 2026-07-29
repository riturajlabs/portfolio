import { useState } from "react";
import { motion } from "framer-motion";

import {
    FaEnvelope,
    FaGithub,
    FaLinkedin,
    FaPaperPlane,
} from "react-icons/fa";


import SectionTitle from "../common/SectionTitle";

import {
    sendEmail
} from "../../services/emailService";


import "../../styles/contacts.css";



function Contact() {


    const [formData, setFormData] = useState({

        name: "",

        email: "",

        message: "",

    });



    const [status, setStatus] = useState("");

    const [loading, setLoading] = useState(false);



    const contactLinks = [

        {
            icon: <FaEnvelope />,
            title: "Email",
            value: "riturajlabs@outlook.com",
            link: "mailto:riturajlabs@outlook.com",
        },


        {
            icon: <FaLinkedin />,
            title: "LinkedIn",
            value: "linkedin.com/in/riturajlabs",
            link: "https://linkedin.com/in/riturajlabs",
        },


        {
            icon: <FaGithub />,
            title: "GitHub",
            value: "github.com/riturajlabs",
            link: "https://github.com/riturajlabs",
        },

    ];





    async function handleSubmit(e) {

        e.preventDefault();


        try {


            setLoading(true);

            setStatus("");



            await sendEmail(formData);



            setStatus(
                "Message sent successfully 🚀"
            );



            setFormData({

                name: "",

                email: "",

                message: "",

            });



        } catch(error) {


            console.log(error);


            setStatus(
                "Failed to send message. Please try again."
            );


        }
        finally {


            setLoading(false);


        }


    }






    return (


        <section

            id="contact"

            className="contact-section"

        >


            <div className="container">



                <SectionTitle

                    tag="Contact"

                    title="Let's Build Something Together"

                    description=
                    "Have an opportunity, project idea, or just want to connect? Feel free to reach out."

                />





                <div className="contact-content">





                    {/* CONTACT INFO */}


                    <motion.div

                        className="contact-info"


                        initial={{
                            opacity:0,
                            x:-40
                        }}


                        whileInView={{
                            opacity:1,
                            x:0
                        }}


                        viewport={{
                            once:true
                        }}


                    >


                        <h3>
                            Get In Touch
                        </h3>



                        <p>

                            I am open to internship opportunities,
                            collaborations, and interesting
                            technology discussions.

                        </p>





                        <div className="contact-links">


                            {
                                contactLinks.map((item)=>(


                                    <a

                                        key={item.title}

                                        href={item.link}

                                        target={
                                            item.title !== "Email"
                                            ? "_blank"
                                            : undefined
                                        }

                                        rel="noopener noreferrer"

                                    >


                                        <span className="contact-icon">

                                            {item.icon}

                                        </span>



                                        <div>

                                            <h4>
                                                {item.title}
                                            </h4>


                                            <span>
                                                {item.value}
                                            </span>


                                        </div>


                                    </a>


                                ))
                            }


                        </div>


                    </motion.div>








                    {/* FORM */}



                    <motion.form

                        className="contact-form"


                        onSubmit={handleSubmit}


                        initial={{
                            opacity:0,
                            x:40
                        }}


                        whileInView={{
                            opacity:1,
                            x:0
                        }}


                        viewport={{
                            once:true
                        }}

                    >



                        <input


                            type="text"


                            placeholder="Your Name"


                            value={formData.name}


                            onChange={(e)=>

                                setFormData({

                                    ...formData,

                                    name:e.target.value

                                })

                            }


                            required


                        />






                        <input


                            type="email"


                            placeholder="Your Email"


                            value={formData.email}


                            onChange={(e)=>

                                setFormData({

                                    ...formData,

                                    email:e.target.value

                                })

                            }


                            required


                        />







                        <textarea


                            rows="5"


                            placeholder="Your Message"


                            value={formData.message}


                            onChange={(e)=>

                                setFormData({

                                    ...formData,

                                    message:e.target.value

                                })

                            }


                            required


                        />







                        <button

                            type="submit"

                            disabled={loading}

                        >


                            {
                                loading

                                ?

                                "Sending..."

                                :

                                "Send Message"
                            }



                            <FaPaperPlane />


                        </button>




                        {
                            status && (

                                <p className="contact-status">

                                    {status}

                                </p>

                            )
                        }





                    </motion.form>




                </div>



            </div>



        </section>


    );

}


export default Contact;