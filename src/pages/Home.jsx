import { lazy, Suspense } from "react";

import SEO from "../components/common/SEO";

import Hero from "../components/sections/Hero";
import About from "../components/sections/About";
import Skills from "../components/sections/Skills";


import Loader from "../components/common/Loader";

// Lazy Loaded Sections
const GithubStats = lazy(() =>
    import("../components/sections/GithubStats")
);

const Certifications = lazy(() =>
    import("../components/sections/Certifications")
);

const Blog = lazy(() =>
    import("../components/sections/Blog")
);

const Contact = lazy(() =>
    import("../components/sections/Contact")
);

const Projects = lazy(() =>
    import("../components/sections/Projects")
);

function Home() {

    return (

        <>

            <SEO />

            {/* Above the Fold */}
            <Hero />

            <About />

            <Skills />


            {/* Lazy Loaded Sections */}
            <Suspense fallback={<Loader />}>

                <Projects />

                <GithubStats />

                <Certifications />

                <Blog />

                <Contact />

            </Suspense>

        </>

    );

}

export default Home;