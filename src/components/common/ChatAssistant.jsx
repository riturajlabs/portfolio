import { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    FaRobot,
    FaTimes,
    FaPaperPlane,
    FaCommentDots,
    FaCheck,
    FaCopy,
    FaThumbsUp,
    FaThumbsDown,
    FaRedo,
    FaStop,
    FaSpinner,
    FaPlus,
    FaBookOpen,
} from "react-icons/fa";
import remarkGfm from "remark-gfm";
// 🚀 Lazy-load markdown — react-markdown + micromark together are ~80 KB
// (remark-gfm is small and treeshakes well, so it's fine to keep sync).
// We only pay this cost the first time the user opens the chat AND an
// AI message arrives. Splitting keeps the initial bundle lean.
const ReactMarkdown = lazy(() => import("react-markdown"));

import "../../styles/chat.css";

// ==========================================
// 🚀 CONSTANTS & CONFIGURATION
// ==========================================
const MAX_CACHE_SIZE = 50;
// Cap on conversation turns we send to the backend. Backend further
// trims to its own MAX_HISTORY_TURNS — keep the client's cap slightly
// higher so the backend has full context to choose what to keep.
const MAX_HISTORY_TURNS = 6;

// Hard request timeout (ms) — Render free tier cold-starts can take 25 s.
const REQUEST_TIMEOUT_MS = 25000;

// Session persistence keys.
const CHAT_STORAGE_KEY = "portfolio-chat-session";
const CHAT_OPENED_KEY = "portfolio-chat-opened";

// Resolved once at module init — every request reuses the same values.
// We use SAME-ORIGIN relative URLs in production. Vercel's edge
// middleware (see `middleware.js` at the repo root) injects the shared
// `X-API-Key` header before the rewrite forwards the request to the
// Render backend, so the secret never reaches the browser bundle.
//
// For local dev, set `VITE_BACKEND_URL=http://localhost:8000` in `.env.local`
// to bypass the rewrite and hit FastAPI directly.
const API_URL =
    import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, "") || "";

const GREETING_TEXT =
    "Hi there! 👋 I'm Ritu Raj's AI Assistant. I can help you explore his projects, technical skills, education, certifications, and internship opportunities. Feel free to ask anything! 🚀";

const SUGGESTED_QUESTIONS = [

    "Tell me about yourself 👨‍💻",

    "Explain your projects 🚀",

    "Tell me about Orbit AI 🤖",

    "What technologies do you know? 💻",

    "Are you available for internships? 💼",

    "Why should we hire Ritu Raj? ⭐"

];

// ==========================================
// 🧩 REUSABLE COMPONENTS & HELPERS
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

// Restore a persisted conversation if it is well-formed; otherwise start fresh.
const loadInitialMessages = () => {
    try {
        const raw = sessionStorage.getItem(CHAT_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (
                Array.isArray(parsed) &&
                parsed.length > 0 &&
                parsed.every(
                    (m) =>
                        m &&
                        (m.role === "ai" || m.role === "user") &&
                        typeof m.text === "string"
                )
            ) {
                return parsed;
            }
        }
    } catch {
        // Corrupt/legacy storage — fall through to a fresh greeting.
    }
    return [{ id: generateId(), role: "ai", text: GREETING_TEXT }];
};

// Nearest user message before index `idx` (used by the regenerate action).
const findPrevUserText = (messages, idx) => {
    for (let i = idx - 1; i >= 0; i--) {
        if (messages[i].role === "user" && messages[i].text) {
            return messages[i].text;
        }
    }
    return null;
};

// Deduplicate RAG sources by name, dropping empty entries.
const dedupeSources = (sources) => {
    const seen = new Set();
    const result = [];
    for (const s of sources || []) {
        const name = s?.source;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        result.push(s);
    }
    return result;
};

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
    const [messages, setMessages] = useState(loadInitialMessages);
    const [copiedId, setCopiedId] = useState("");
    const [feedback, setFeedback] = useState({});
    const [hasOpened, setHasOpened] = useState(() => {
        try {
            return localStorage.getItem(CHAT_OPENED_KEY) === "true";
        } catch {
            return false;
        }
    });

    const messagesEndRef = useRef(null);
    const chatBodyRef = useRef(null);
    const chatWindowRef = useRef(null);
    const fabRef = useRef(null);
    const isUserScrolled = useRef(false);
    const inputRef = useRef(null);
    const chatCache = useRef(new Map());
    const abortControllerRef = useRef(null);
    const stopRequestedRef = useRef(false);
    const prevOpenRef = useRef(false);
    const copyTimeoutRef = useRef(null);
    // Mirror messages into a ref so handleSend sees the LATEST state,
    // not the closure-captured stale value (handleSend is memoized).
    const messagesRef = useRef(messages);
    useEffect(() => { messagesRef.current = messages; }, [messages]);

    // 💾 Persist conversation for this tab session.
    useEffect(() => {
        try {
            sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
        } catch {
            // Storage unavailable (private mode etc.) — non-fatal.
        }
    }, [messages]);

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

    // 🎯 Focus input when opening; restore focus to the FAB when closing
    // (but never steal focus on first page load).
    useEffect(() => {
        if (isOpen) {
            inputRef.current?.focus();
        } else if (prevOpenRef.current) {
            fabRef.current?.focus();
        }
        prevOpenRef.current = isOpen;
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

    // 🚧 Focus trap: keep Tab navigation inside the chat window.
    useEffect(() => {
        if (!isOpen) return;
        const windowEl = chatWindowRef.current;
        if (!windowEl) return;

        const handleTab = (e) => {
            if (e.key !== "Tab") return;
            const focusables = Array.from(
                windowEl.querySelectorAll(
                    'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select, [tabindex]:not([tabindex="-1"])'
                )
            ).filter((el) => el.offsetParent !== null);
            if (focusables.length === 0) return;

            const first = focusables[0];
            const last = focusables[focusables.length - 1];

            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };

        windowEl.addEventListener("keydown", handleTab);
        return () => windowEl.removeEventListener("keydown", handleTab);
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

    // Clean up the copy-toast timeout on unmount.
    useEffect(() => () => clearTimeout(copyTimeoutRef.current), []);

    const getStatusColor = () => {
        if (activeModelName.toLowerCase().includes('gemini')) return 'var(--status-gemini, #10b981)';
        if (activeModelName.toLowerCase().includes('groq')) return 'var(--status-groq, #f59e0b)';
        if (activeModelName === 'Offline') return 'var(--status-offline, #ef4444)';
        return 'var(--status-default, #3b82f6)';
    };

    // Factory that strips the `node` prop react-markdown passes to every
    // renderer (spreading it onto a DOM element triggers React warnings).
    const markdownElement = (Tag, className, extraProps = {}) => {
        const Component = ({ node, ...props }) => {
            void node;
            return <Tag className={className} {...extraProps} {...props} />;
        };
        return Component;
    };

    const markdownComponents = useMemo(() => ({
        p: markdownElement("p", "markdown-p"),
        strong: markdownElement("strong", "markdown-strong"),
        em: markdownElement("em", "markdown-em"),
        a: markdownElement("a", "markdown-link", {
            target: "_blank",
            rel: "noopener noreferrer",
        }),
        ul: markdownElement("ul", "markdown-ul"),
        ol: markdownElement("ol", "markdown-ol"),
        li: markdownElement("li", "markdown-li"),
        h1: markdownElement("h1", "markdown-h"),
        h2: markdownElement("h2", "markdown-h"),
        h3: markdownElement("h3", "markdown-h"),
        table: ({ node, ...props }) => {
            void node;
            return (
                <div className="markdown-table-wrapper">
                    <table className="markdown-table" {...props} />
                </div>
            );
        },
        th: markdownElement("th", "markdown-th"),
        td: markdownElement("td", "markdown-td"),
        code: CodeBlock
    }), []);

    // Build the conversation history payload from the latest messages
    // snapshot. Excludes the empty placeholder AI bubble reserved during
    // streaming so the model doesn't see an empty assistant turn.
    const buildHistory = (currentMessages) => {
        const visible = currentMessages.filter(
            (m) => !(m.role === "ai" && !m.text)
        );
        const recent = visible.slice(-MAX_HISTORY_TURNS);
        return recent.map((m) => ({
            role: m.role === "ai" ? "assistant" : "user",
            content: m.text,
        }));
    };

    // ==========================================
    // MESSAGE ACTIONS
    // ==========================================
    const handleCopy = async (id, text) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedId(id);
            clearTimeout(copyTimeoutRef.current);
            copyTimeoutRef.current = setTimeout(() => setCopiedId(""), 2000);
        } catch (error) {
            console.warn("[Chat] Copy failed:", error);
        }
    };

    const toggleFeedback = (id, type) => {
        setFeedback((prev) => ({
            ...prev,
            [id]: prev[id] === type ? "" : type,
        }));
    };

    // ⏹️ Stop generating — aborts the in-flight request, keeping partial text.
    const handleStop = () => {
        stopRequestedRef.current = true;
        abortControllerRef.current?.abort();
    };

    // 🧹 New conversation — clears state, cache and storage.
    const handleNewChat = () => {
        if (isLoading) return;
        try {
            sessionStorage.removeItem(CHAT_STORAGE_KEY);
        } catch {
            // ignore
        }
        chatCache.current = new Map();
        setMessages([{ id: generateId(), role: "ai", text: GREETING_TEXT }]);
        setFeedback({});
        setCopiedId("");
        inputRef.current?.focus();
    };

    const handleToggleOpen = () => {
        if (!isOpen) {
            setHasOpened(true);
            try {
                localStorage.setItem(CHAT_OPENED_KEY, "true");
            } catch {
                // ignore
            }
        }
        setIsOpen(!isOpen);
    };

    // 🚀 Streaming fetch with AbortController timeout + non-streaming fallback
    const handleSend = useCallback(async (textOverride) => {
        const userMessageText = typeof textOverride === 'string' ? textOverride : input;
        if (!userMessageText.trim() || isLoading) return;

        const normalizedQuery = userMessageText.trim().toLowerCase();
        const userMessage = { id: generateId(), role: "user", text: userMessageText.trim() };

        // Snapshot history BEFORE we append the current message — the
        // current question is sent in `message`, the prior conversation
        // is what goes in `history`.
        const history = buildHistory(messagesRef.current);

        stopRequestedRef.current = false;

        setMessages(prev => [...prev, userMessage]);
        messagesRef.current = [...messagesRef.current, userMessage];
        setInput("");
        setIsLoading(true);

        // Serve from cache if available
        if (chatCache.current.has(normalizedQuery)) {
            setTimeout(() => {
                setMessages(prev => [...prev, {
                    id: generateId(),
                    role: "ai",
                    text: chatCache.current.get(normalizedQuery),
                }]);
                setIsLoading(false);
            }, 400);
            return;
        }

        // Reserve a placeholder AI message we can update token-by-token
        const aiMessageId = generateId();
        const aiPlaceholder = { id: aiMessageId, role: "ai", text: "" };
        setMessages(prev => [...prev, aiPlaceholder]);
        messagesRef.current = [...messagesRef.current, aiPlaceholder];

        // AbortController with hard timeout
        const controller = new AbortController();
        abortControllerRef.current = controller;
        const timeoutId = setTimeout(
            () => controller.abort(),
            REQUEST_TIMEOUT_MS
        );

        // 🔑 No client-side API key header. In production the shared key is
        // injected by Vercel's edge middleware (middleware.js) before the
        // rewrite forwards to the Render backend. For local dev, VITE_BACKEND_URL
        // points straight at FastAPI where ENV=development skips auth.
        const authHeaders = {};

        // Common request body — used by both streaming and fallback paths.
        const requestBody = {
            message: userMessageText.trim(),
            history,
        };

        let streamedOk = false;
        let finalText = "";
        let currentSources = [];
        let generatedBy = "AI Auto-Failover";

        // Patch the streaming AI message in state.
        const patchAiMessage = (patch) => {
            setMessages(prev =>
                prev.map(m =>
                    m.id === aiMessageId ? { ...m, ...patch } : m
                )
            );
        };

        // Shared SSE consumer — used by both /chat/stream and the /chat
        // fallback path (since /chat now streams SSE too).
        const consumeSse = async streamResponse => {
            const reader = streamResponse.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let sepIdx;
                while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
                    const rawEvent = buffer.slice(0, sepIdx);
                    buffer = buffer.slice(sepIdx + 2);
                    const line = rawEvent
                        .split("\n")
                        .find(l => l.startsWith("data:"));
                    if (!line) continue;
                    try {
                        const payload = JSON.parse(line.slice(5).trim());
                        if (payload.event === "sources" && Array.isArray(payload.data)) {
                            // 📚 RAG sources — attach to the message so the
                            // UI can render source chips under the answer.
                            currentSources = payload.data;
                            patchAiMessage({ sources: currentSources });
                        } else if (payload.event === "token" && payload.data) {
                            finalText += payload.data;
                            streamedOk = true;
                            patchAiMessage({
                                text: finalText,
                                sources: currentSources.length ? currentSources : undefined,
                            });
                        } else if (payload.event === "done") {
                            generatedBy = payload.data || generatedBy;
                            patchAiMessage({
                                sources: currentSources.length ? currentSources : undefined,
                            });
                        } else if (payload.event === "error") {
                            throw new Error(payload.data || "Stream error");
                        }
                        // 'meta' event: reserved for future UI hooks.
                    } catch {
                        // ignore malformed line
                    }
                }
            }
        };

        try {
            // 🌊 PRIMARY: streaming SSE
            const streamResponse = await fetch(`${API_URL}/chat/stream`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "text/event-stream",
                    ...authHeaders,
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal,
            });

            if (!streamResponse.ok) {
                throw new Error(`Stream HTTP ${streamResponse.status}`);
            }

            await consumeSse(streamResponse);
        } catch (streamErr) {
            // If the user pressed Stop, keep whatever was streamed so far —
            // do NOT fall back or mark as an error.
            if (stopRequestedRef.current) {
                patchAiMessage({
                    sources: currentSources.length ? currentSources : undefined,
                });
                return;
            }

            // If SSE failed and we haven't streamed anything yet, fall back.
            if (!streamedOk) {
                console.warn(
                    "[Chat] SSE failed, falling back to /chat:",
                    streamErr
                );
                try {
                    // /chat now also streams SSE (same shape), so reuse the
                    // SSE consumer instead of parsing JSON. This also avoids
                    // thread-blocking the request on a stuck LLM call.
                    const fallbackResponse = await fetch(`${API_URL}/chat`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Accept: "text/event-stream",
                            ...authHeaders,
                        },
                        body: JSON.stringify(requestBody),
                        signal: controller.signal,
                    });

                    if (!fallbackResponse.ok) {
                        throw new Error(`HTTP ${fallbackResponse.status}`, {
                            cause: streamErr,
                        });
                    }

                    await consumeSse(fallbackResponse);
                } catch (fallbackErr) {
                    console.error("[Chat] Fallback also failed:", fallbackErr);

                    if (stopRequestedRef.current) {
                        patchAiMessage({
                            text: finalText || undefined,
                            sources: currentSources.length ? currentSources : undefined,
                        });
                    } else {
                        setActiveModelName("Offline");
                        patchAiMessage({
                            text:
                                controller.signal.aborted
                                    ? "⏱️ The AI took too long to respond. Please try again."
                                    : "The AI service is currently offline or experiencing network issues. Please try again.",
                            isError: true,
                        });
                    }
                }
            }
        } finally {
            clearTimeout(timeoutId);
            abortControllerRef.current = null;
            setIsLoading(false);

            // Cache the final text
            if (finalText && finalText.trim()) {
                if (chatCache.current.size >= MAX_CACHE_SIZE) {
                    const firstKey = chatCache.current.keys().next().value;
                    chatCache.current.delete(firstKey);
                }
                chatCache.current.set(normalizedQuery, finalText);
                setActiveModelName(generatedBy);
            }
        }
    }, [input, isLoading]);

    const onSubmit = (e) => {
        e.preventDefault();
        handleSend();
    };

    const lastMsg = messages[messages.length - 1];
    const isStreamingEmpty =
        isLoading && lastMsg?.role === "ai" && !lastMsg.text;

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
                            ref={chatWindowRef}
                            className="chat-window"
                            initial={{ opacity: 0, y: 30, scale: 0.95, transformOrigin: "bottom right" }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 30, scale: 0.95 }}
                            transition={{ type: "spring", stiffness: 300, damping: 25 }}
                            role="dialog"
                            aria-modal="true"
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

                                <div className="chat-header-actions">
                                    {messages.length > 1 && (
                                        <button
                                            className="chat-newchat-btn"
                                            onClick={handleNewChat}
                                            aria-label="New conversation"
                                            title="New conversation"
                                        >
                                            <FaPlus />
                                        </button>
                                    )}
                                    <button 
                                        className="chat-close-btn" 
                                        onClick={() => setIsOpen(false)}
                                        aria-label="Close Chat"
                                    >
                                        <FaTimes />
                                    </button>
                                </div>
                            </div>

                            {/* BODY */}
                            <div className="chat-body" aria-live="polite" ref={chatBodyRef} onScroll={handleScroll}>
                                {messages.map((msg, idx) => {
                                    const isStreamingMsg =
                                        isLoading &&
                                        idx === messages.length - 1 &&
                                        msg.role === "ai";
                                    const prevUserText = findPrevUserText(messages, idx);
                                    const sources = dedupeSources(msg.sources);

                                    return (
                                        <motion.div 
                                            key={msg.id} 
                                            className={`chat-bubble ${msg.role === "ai" ? "ai-msg" : "user-msg"}`}
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.3 }}
                                        >
                                            {msg.role === "ai" ? (
                                                <Suspense
                                                    fallback={
                                                        <span className="chat-bubble-loading">…</span>
                                                    }
                                                >
                                                    <ReactMarkdown
                                                        remarkPlugins={[remarkGfm]}
                                                        components={markdownComponents}
                                                    >
                                                        {msg.text}
                                                    </ReactMarkdown>
                                                </Suspense>
                                            ) : (
                                                msg.text
                                            )}

                                            {/* 📚 RAG SOURCE CHIPS */}
                                            {msg.role === "ai" && msg.text && sources.length > 0 && (
                                                <div className="chat-sources">
                                                    <span className="chat-sources-label">
                                                        <FaBookOpen aria-hidden="true" />
                                                        Sources
                                                    </span>
                                                    {sources.map((s, i) => (
                                                        <span
                                                            key={`${s.source}-${i}`}
                                                            className="chat-source-chip"
                                                            title={
                                                                typeof s.score === "number"
                                                                    ? `Relevance ${Math.round(s.score * 100)}%`
                                                                    : undefined
                                                            }
                                                        >
                                                            {s.source}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}

                                            {/* 👍 PER-MESSAGE ACTIONS */}
                                            {msg.role === "ai" && msg.text && !isStreamingMsg && (
                                                <div className="chat-msg-actions">
                                                    <button
                                                        type="button"
                                                        className={`chat-action ${copiedId === msg.id ? "active" : ""}`}
                                                        onClick={() => handleCopy(msg.id, msg.text)}
                                                        aria-label="Copy response"
                                                        title="Copy response"
                                                    >
                                                        {copiedId === msg.id ? <FaCheck /> : <FaCopy />}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={`chat-action ${feedback[msg.id] === "up" ? "active" : ""}`}
                                                        onClick={() => toggleFeedback(msg.id, "up")}
                                                        aria-label="Good response"
                                                        title="Helpful"
                                                    >
                                                        <FaThumbsUp />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={`chat-action ${feedback[msg.id] === "down" ? "active" : ""}`}
                                                        onClick={() => toggleFeedback(msg.id, "down")}
                                                        aria-label="Bad response"
                                                        title="Not helpful"
                                                    >
                                                        <FaThumbsDown />
                                                    </button>
                                                    {prevUserText && (
                                                        <button
                                                            type="button"
                                                            className="chat-action"
                                                            onClick={() => handleSend(prevUserText)}
                                                            aria-label="Regenerate response"
                                                            title="Regenerate"
                                                        >
                                                            <FaRedo />
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </motion.div>
                                    );
                                })}
                                
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

                            {/* 🔍 STREAMING STATUS / STOP */}
                            {isLoading && (
                                <div className="chat-stream-status">
                                    <span className="chat-searching-hint">
                                        <FaSpinner className="chat-spinner" aria-hidden="true" />
                                        {isStreamingEmpty
                                            ? "Searching my knowledge base…"
                                            : "Generating response…"}
                                    </span>
                                    <button
                                        type="button"
                                        className="chat-stop-btn"
                                        onClick={handleStop}
                                        aria-label="Stop generating"
                                    >
                                        <FaStop aria-hidden="true" />
                                        Stop
                                    </button>
                                </div>
                            )}

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
                        {!isOpen && !hasOpened && (
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
                        ref={fabRef}
                        className={`chat-fab ${!isOpen ? "chat-fab-pulse" : ""}`}
                        onClick={handleToggleOpen}
                        whileHover={{ scale: 1.08 }}
                        whileTap={{ scale: 0.92 }}
                        aria-label={isOpen ? "Close AI Chat" : "Open AI Chat"}
                        aria-haspopup="dialog"
                        aria-expanded={isOpen}
                    >
                        {isOpen ? <FaTimes /> : <FaCommentDots />}
                    </motion.button>

                    {!isOpen && !hasOpened && (
                        <span className="chat-fab-notification" aria-hidden="true" />
                    )}
                </div>
            </div>
        </>
    );
}

export default ChatAssistant;
