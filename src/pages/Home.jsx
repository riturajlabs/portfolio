import SEO from "../components/common/SEO";

import Hero from "../components/sections/Hero";
import About from "../components/sections/About";
import Skills from "../components/sections/Skills";
import Projects from "../components/sections/Projects";
import GithubStats from "../components/sections/GithubStats";
import Certifications from "../components/sections/Certifications";
import Blog from "../components/sections/Blog";
import Contact from "../components/sections/Contact";

function Home() {

    return (

        <>

            <SEO />

            <Hero />

            <About />

            <Skills />

            <Projects />

            <GithubStats />

            <Certifications />

            <Blog />

            <Contact />

        </>

    );

}

export default Home;