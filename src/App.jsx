import { lazy, Suspense } from "react";

import Navbar from "./components/layout/Navbar";
import Footer from "./components/layout/Footer";
import ScrollToTop from "./components/common/ScrollToTop";
import ScrollProgress from "./components/common/ScrollProgress";



import Home from "./pages/Home";
import SEO from "./components/common/SEO";
import { SpeedInsights } from "@vercel/speed-insights/react";

const ChatAssistant = lazy(() =>
    import("./components/common/ChatAssistant")
);


function App() {

    return (

        <>

            {/* SEO Metadata */}
           <SEO />


            <ScrollToTop />

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
        </>

    );

}


export default App;