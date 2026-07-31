import { lazy, Suspense } from "react";

import Navbar from "./components/layout/Navbar";
import Footer from "./components/layout/Footer";
import ScrollToTop from "./components/common/ScrollToTop";



import Home from "./pages/Home";
import SEO from "./components/common/SEO";


const ChatAssistant = lazy(() =>
    import("./components/common/ChatAssistant")
);


function App() {

    return (

        <>

            {/* SEO Metadata */}
           <SEO />


            <ScrollToTop />


            <Navbar />


            <main>

                <Home />

            </main>


            <Footer />


            <Suspense fallback={null}>

                <ChatAssistant />

            </Suspense>


        </>

    );

}


export default App;