import { motion } from "framer-motion";

import {
    FaArrowRight,
} from "react-icons/fa";


import blogs from "../../data/blogs";

import SectionTitle from "../common/SectionTitle";

import "../../styles/blogs.css";


function Blog() {


    return (

        <section
            id="blog"
            className="blog-section"
        >

            <div className="container">


                <SectionTitle

                    tag="Blog"

                    title="Sharing What I Learn"

                    description=
                    "Writing about Artificial Intelligence, Software Development, and my learning journey."

                />



                <div className="blog-grid">


                    {
                        blogs.map((blog,index)=>(


                            <motion.article

                                key={blog.title}

                                className="blog-card"


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
                                    delay:index*0.12
                                }}

                            >


                                <span className="blog-category">

                                    {blog.category}

                                </span>




                                <h3>

                                    {blog.title}

                                </h3>




                                <p>

                                    {blog.description}

                                </p>





                                <div className="blog-meta">

                                    <span>
                                        {blog.date}
                                    </span>


                                    <span>
                                        {blog.readTime}
                                    </span>

                                </div>





                                {
                                    blog.link !== "#" && (

                                        <a

                                            href={blog.link}

                                            target="_blank"

                                            rel="noopener noreferrer"

                                        >

                                            Read Article

                                            <FaArrowRight />

                                        </a>

                                    )
                                }



                                {
                                    blog.link === "#" && (

                                        <button
                                            className="blog-coming-btn"
                                            disabled
                                        >

                                            Coming Soon

                                        </button>

                                    )
                                }



                            </motion.article>


                        ))
                    }


                </div>


            </div>


        </section>

    );

}


export default Blog;