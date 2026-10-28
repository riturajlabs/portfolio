import { lazy, Suspense, useState } from "react";

import Navbar from "./components/layout/Navbar";
import Footer from "./components/layout/Footer";
import ScrollProgress from "./components/common/ScrollProgress";

import { MotionConfig, motion } from "framer-motion";

import Home from "./pages/Home";
import SEO from "./components/common/SEO";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { FaCommentDots } from "react-icons/fa";

const ChatAssistant = lazy(() =>
    import("./components/common/ChatAssistant")
);


function App() {
    const [chatMounted, setChatMounted] = useState(false);

    const handleOpenChat = () => {
        if (chatMounted) return;
        setChatMounted(true);
    };

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


            {!chatMounted && (
                <div className="chat-fab-wrapper">
                    <motion.button
                        className="chat-fab chat-fab-pulse"
                        onClick={handleOpenChat}
                        whileHover={{ scale: 1.08 }}
                        whileTap={{ scale: 0.92 }}
                        aria-label="Open AI Chat"
                        aria-haspopup="dialog"
                        aria-expanded="false"
                    >
                        <FaCommentDots />
                    </motion.button>
                    <span className="chat-fab-notification" aria-hidden="true" />
                </div>
            )}

            {chatMounted && (
                <Suspense fallback={null}>

                    <ChatAssistant externalOpen={true} hideExternalTrigger={true} />

                </Suspense>
            )}

            <SpeedInsights />
        </MotionConfig>

    );

}


export default App;