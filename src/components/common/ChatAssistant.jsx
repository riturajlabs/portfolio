import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FaRobot, FaTimes, FaPaperPlane, FaCommentDots, FaCheck, FaCopy } from "react-icons/fa";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import "../../styles/chat.css";

// ==========================================
// 🚀 CONSTANTS & CONFIGURATION
// ==========================================
const MAX_HISTORY = 10;
const MAX_CACHE_SIZE = 50;

const SUGGESTED_QUESTIONS = [
    "Tell me about your projects 🚀",
    "What technologies do you know? 💻",
    "Show your certificates 📜",
    "Tell me about yourself 👨‍💻"
];

// ==========================================
// 🧩 REUSABLE COMPONENTS
// ==========================================
const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

const TypingIndicator = () => (
    <div className="chat-bubble ai-msg typing-indicator-container">
        {[0, 1, 2].map((i) => (
            <motion.span
                key={i}
                className="typing-dot"
                animate={{ y: [0, -5, 0] }}
                transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.2 }}
            />
        ))}
    </div>
);

// Code Block with Copy Button Component
const CodeBlock = ({ inline, className, children, ...props }) => {
    const [isCopied, setIsCopied] = useState(false);
    
    if (inline) {
        return <code className="markdown-inline-code" {...props}>{children}</code>;
    }

    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : 'text';

    const handleCopy = () => {
        navigator.clipboard.writeText(String(children).replace(/\n$/, ''));
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    };

    return (
        <div className="markdown-code-wrapper">
            <div className="markdown-code-header">
                <span className="markdown-code-lang">{language}</span>
                <button 
                    onClick={handleCopy} 
                    className="markdown-code-copy-btn"
                    aria-label="Copy code"
                >
                    {isCopied ? <><FaCheck size={12} /> Copied!</> : <><FaCopy size={12} /> Copy</>}
                </button>
            </div>
            <pre className="markdown-pre">
                <code className={className} {...props}>
                    {children}
                </code>
            </pre>
        </div>
    );
};

// ==========================================
// 🤖 MAIN CHAT ASSISTANT COMPONENT
// ==========================================
function ChatAssistant() {
    const [isOpen, setIsOpen] = useState(false);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [activeModelName, setActiveModelName] = useState("AI Auto-Failover");
    
    const [messages, setMessages] = useState([
        { 
            id: generateId(),
            role: "ai", 
            text: "Hi there! 👋 I'm Ritu Raj's AI Portfolio Assistant. Ask me anything about his projects, skills, or certificates!" 
        }
    ]);

    const messagesEndRef = useRef(null);
    const chatBodyRef = useRef(null);
    const isUserScrolled = useRef(false);
    const inputRef = useRef(null);
    const chatCache = useRef(new Map()); 

    const handleScroll = useCallback(() => {
        if (!chatBodyRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = chatBodyRef.current;
        isUserScrolled.current = scrollHeight - scrollTop - clientHeight > 50;
    }, []);

    useEffect(() => {
        if (!isUserScrolled.current) {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }, [messages, isLoading]);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isOpen) {
                setIsOpen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    useEffect(() => {
        if (isOpen) {
            document.body.classList.add('chat-open');
        } else {
            document.body.classList.remove('chat-open');
        }
        return () => document.body.classList.remove('chat-open');
    }, [isOpen]);

    useEffect(() => {
        if (!window.visualViewport) return;
        const handleResize = () => {
            document.documentElement.style.setProperty(
                "--keyboard-height",
                `${window.innerHeight - window.visualViewport.height}px`
            );
        };
        handleResize();
        window.visualViewport.addEventListener("resize", handleResize);
        return () => {
            window.visualViewport.removeEventListener("resize", handleResize);
        };
    }, []);

    const getStatusColor = () => {
        if (activeModelName.toLowerCase().includes('gemini')) return 'var(--status-gemini, #10b981)';
        if (activeModelName.toLowerCase().includes('groq')) return 'var(--status-groq, #f59e0b)';
        if (activeModelName === 'Offline') return 'var(--status-offline, #ef4444)';
        return 'var(--status-default, #3b82f6)';
    };

    const markdownComponents = useMemo(() => ({
        p: ({node, ...props}) => <p className="markdown-p" {...props} />,
        strong: ({node, ...props}) => <strong className="markdown-strong" {...props} />,
        em: ({node, ...props}) => <em className="markdown-em" {...props} />,
        a: ({node, ...props}) => <a {...props} target="_blank" rel="noopener noreferrer" className="markdown-link" />,
        ul: ({node, ...props}) => <ul className="markdown-ul" {...props} />,
        ol: ({node, ...props}) => <ol className="markdown-ol" {...props} />,
        li: ({node, ...props}) => <li className="markdown-li" {...props} />,
        h1: ({node, ...props}) => <h1 className="markdown-h" {...props} />,
        h2: ({node, ...props}) => <h2 className="markdown-h" {...props} />,
        h3: ({node, ...props}) => <h3 className="markdown-h" {...props} />,
        table: ({node, ...props}) => (
            <div className="markdown-table-wrapper">
                <table className="markdown-table" {...props} />
            </div>
        ),
        th: ({node, ...props}) => <th className="markdown-th" {...props} />,
        td: ({node, ...props}) => <td className="markdown-td" {...props} />,
        code: CodeBlock
    }), []);

    // 🚀 NEW: Secure Fetch from Serverless Backend
    const handleSend = useCallback(async (textOverride) => {
        const userMessageText = typeof textOverride === 'string' ? textOverride : input;
        if (!userMessageText.trim() || isLoading) return;

        const normalizedQuery = userMessageText.trim().toLowerCase();
        const userMessage = { id: generateId(), role: "user", text: userMessageText.trim() };
        
        const updatedMessages = [...messages, userMessage].slice(-MAX_HISTORY);
        setMessages(updatedMessages);
        setInput("");
        setIsLoading(true);

        // Serve from Cache if available
        if (chatCache.current.has(normalizedQuery)) {
            setTimeout(() => {
                setMessages(prev => [...prev, { id: generateId(), role: "ai", text: chatCache.current.get(normalizedQuery) }]);
                setIsLoading(false);
            }, 500); 
            return;
        }

        try {
            // Call Vercel Serverless Function instead of API directly
            const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: updatedMessages })
});

const text = await response.text();

console.log("SERVER RESPONSE:");
console.log(text);

return;

            // Cache management
            if (chatCache.current.size >= MAX_CACHE_SIZE) {
                const firstKey = chatCache.current.keys().next().value;
                chatCache.current.delete(firstKey);
            }
            chatCache.current.set(normalizedQuery, data.reply);
            
            setActiveModelName(data.generatedBy);
            setMessages(prev => [...prev, { id: generateId(), role: "ai", text: data.reply }]);

        } catch (error) {
            console.error("[Chat Frontend] Error:", error);
            setActiveModelName("Offline");
            setMessages(prev => [...prev, { 
                id: generateId(),
                role: "ai", 
                text: "The AI service is currently busy or experiencing network issues. Please try again in a few seconds." 
            }]);
        } finally {
            setIsLoading(false);
        }
    }, [input, isLoading, messages]);

    const onSubmit = (e) => {
        e.preventDefault();
        handleSend();
    };

    return (
        <>
            {/* BACKDROP BLUR OVERLAY */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        className="chat-backdrop"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.4, ease: "easeInOut" }}
                        onClick={() => setIsOpen(false)}
                        aria-hidden="true"
                    />
                )}
            </AnimatePresence>

            <div className={`chat-container ${isOpen ? "chat-opened" : ""}`}>
                <AnimatePresence>
                    {isOpen && (
                        <motion.div
                            className="chat-window"
                            initial={{ opacity: 0, y: 30, scale: 0.95, transformOrigin: "bottom right" }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 30, scale: 0.95 }}
                            transition={{ type: "spring", stiffness: 300, damping: 25 }}
                            role="dialog"
                            aria-label="AI Portfolio Assistant"
                            
                        >
                            {/* HEADER */}
                            <div className="chat-header">
                                <div className="chat-header-info">
                                    <div className="chat-robot-icon-wrapper">
                                        <FaRobot className="chat-robot-icon" aria-hidden="true" />
                                    </div>
                                    <div>
                                        <h4>AI Assistant</h4>
                                        <div className="chat-header-status-wrapper">
                                            <span 
                                                className="status-dot" 
                                                style={{ backgroundColor: getStatusColor() }} 
                                            />
                                            <span className="chat-header-model">Powered by {activeModelName}</span>
                                        </div>
                                    </div>
                                </div>
                                <button 
                                    className="chat-close-btn" 
                                    onClick={() => setIsOpen(false)}
                                    aria-label="Close Chat"
                                >
                                    <FaTimes />
                                </button>
                            </div>

                            {/* BODY */}
                            <div className="chat-body" aria-live="polite" ref={chatBodyRef} onScroll={handleScroll}>
                                {messages.map((msg) => (
                                    <motion.div 
                                        key={msg.id} 
                                        className={`chat-bubble ${msg.role === "ai" ? "ai-msg" : "user-msg"}`}
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.3 }}
                                    >
                                        {msg.role === "ai" ? (
                                            <ReactMarkdown 
                                                remarkPlugins={[remarkGfm]} 
                                                components={markdownComponents}
                                            >
                                                {msg.text}
                                            </ReactMarkdown>
                                        ) : (
                                            msg.text
                                        )}
                                    </motion.div>
                                ))}
                                
                                {/* SUGGESTED QUESTIONS */}
                                {messages.length === 1 && !isLoading && (
                                    <motion.div 
                                        className="suggested-questions-container"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ delay: 0.2 }}
                                    >
                                        {SUGGESTED_QUESTIONS.map((q, idx) => (
                                            <button 
                                                key={idx}
                                                onClick={() => handleSend(q)}
                                                className="suggested-btn"
                                            >
                                                {q}
                                            </button>
                                        ))}
                                    </motion.div>
                                )}

                                {isLoading && <TypingIndicator />}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* FOOTER */}
                            <form className="chat-footer" onSubmit={onSubmit}>
                                <input
                                    ref={inputRef}
                                    type="text"
                                    placeholder={isLoading ? "AI is generating..." : "Ask about my skills or projects..."}
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    disabled={isLoading}
                                    aria-disabled={isLoading}
                                />
                                <button 
                                    type="submit" 
                                    className="chat-send-btn" 
                                    aria-label="Send Message"
                                    disabled={!input.trim() || isLoading}
                                >
                                    <FaPaperPlane />
                                </button>
                            </form>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* FLOATING BUTTON WITH LABEL */}
                <div className="chat-fab-wrapper">
                    <AnimatePresence>
                        {!isOpen && (
                            <motion.div
                                className="chat-fab-label"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 5 }}
                                transition={{ delay: 1, duration: 0.5 }}
                            >
                                Ask AI ✨
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <motion.button
                        className={`chat-fab ${!isOpen ? "chat-fab-pulse" : ""}`}
                        onClick={() => setIsOpen(!isOpen)}
                        whileHover={{ scale: 1.08 }}
                        whileTap={{ scale: 0.92 }}
                        aria-label={isOpen ? "Close AI Chat" : "Open AI Chat"}
                    >
                        {isOpen ? <FaTimes /> : <FaCommentDots />}
                    </motion.button>
                </div>
            </div>
        </>
    );
}

export default ChatAssistant;