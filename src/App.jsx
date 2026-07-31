import { lazy, Suspense } from "react";

import Navbar from "./components/layout/Navbar";
import Footer from "./components/layout/Footer";
import ScrollToTop from "./components/common/ScrollToTop";

import Home from "./pages/Home";

const ChatAssistant = lazy(() =>
    import("./components/common/ChatAssistant")
);

function App() {

    return (

        <>

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