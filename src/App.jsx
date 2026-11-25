import { lazy, Suspense, useEffect, useRef, useState } from "react";

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
    // Chat open state has exactly one owner: App. `isChatOpen` drives both the
    // dialog (through the controlled `open` prop) and the trigger below, so a
    // deliberate close can never be reopened by a stale effect. The
    // `chatMounted` latch keeps the lazy ChatAssistant subtree (and its
    // conversation state) alive after the first open, but it never controls
    // visibility.
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [chatMounted, setChatMounted] = useState(false);
    const triggerRef = useRef(null);
    const wasOpenRef = useRef(false);

    const handleOpenChat = () => {
        setChatMounted(true);
        setIsChatOpen(true);
    };

    // Return focus to the trigger after the dialog closes. ChatAssistant owns
    // its own focus handling when it renders its own FAB; in integrated mode
    // the trigger lives here, so App restores focus.
    useEffect(() => {
        if (wasOpenRef.current && !isChatOpen) {
            triggerRef.current?.focus();
        }
        wasOpenRef.current = isChatOpen;
    }, [isChatOpen]);

    return (

        <MotionConfig reducedMotion="user">

            <a className="skip-link" href="#main-content">Skip to main content</a>

            {/* SEO Metadata */}
            <SEO />


            <ScrollProgress />

            <Navbar />


            <main id="main-content" tabIndex={-1}>

                <Home />

            </main>


            <Footer />


            {/* Single, always-available trigger. It is the only control that
                opens the chat; when the dialog is open it is hidden so there
                is never a double FAB. */}
            {!isChatOpen && (
                <div className="chat-fab-wrapper">
                    <motion.button
                        ref={triggerRef}
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
                    {!chatMounted && (
                        <span className="chat-fab-notification" aria-hidden="true" />
                    )}
                </div>
            )}

            {/* ChatAssistant is mounted once, on the first open, and stays
                mounted so its conversation and lazy chunk survive close/reopen
                cycles. It is fully controlled: App owns `open` and receives
                every change through `onOpenChange`. hideExternalTrigger keeps
                the FAB above as the single trigger. */}
            {chatMounted && (
                <Suspense fallback={<div className="chat-loading" role="status">Loading assistant…</div>}>
                    <ChatAssistant
                        open={isChatOpen}
                        onOpenChange={setIsChatOpen}
                        hideExternalTrigger={true}
                    />
                </Suspense>
            )}

            <SpeedInsights />
        </MotionConfig>

    );

}


export default App;