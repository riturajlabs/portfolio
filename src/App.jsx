import { lazy, Suspense } from "react";

import Navbar from "./components/layout/Navbar";
import Footer from "./components/layout/Footer";
import ScrollProgress from "./components/common/ScrollProgress";

import { MotionConfig } from "framer-motion";

import Home from "./pages/Home";
import SEO from "./components/common/SEO";
import { SpeedInsights } from "@vercel/speed-insights/react";

const ChatAssistant = lazy(() =>
    import("./components/common/ChatAssistant")
);


function App() {

    return (

        <MotionConfig reducedMotion="user">

            {/* SEO Metadata */}
           <SEO />


            <ScrollProgress />

            <Navbar />


            <main>

                <Home />

            </main>


            <Footer />


            <Suspense fallback={null}>

                <ChatAssistant />

            </Suspense>

            <SpeedInsights />
        </MotionConfig>

    );

}


export default App;