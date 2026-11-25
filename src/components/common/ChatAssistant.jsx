import { useState, useRef, useEffect, useCallback, useMemo, useId, lazy, Suspense } from "react";
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
    FaPlus,
    FaBookOpen,
} from "react-icons/fa";

import { describeChatError, streamChat } from "../../lib/chatClient";
import Skeleton from "./Skeleton";
// 🚀 Lazy-load the entire markdown stack — react-markdown + remark-gfm +
// micromark together are ~80 KB. Loading them in a single dynamic import
// ensures the markdown chunk is only fetched when an AI message first renders
// (the greeting, as soon as the dialog opens) — never on the initial page boot.
// remark-gfm is intentionally NOT imported at the module top-level so that
// Rollup sees it only as a dynamic dependency: it will not be pulled into the
// ChatAssistant chunk's static import graph, and the browser will not fetch
// the markdown chunk until the Suspense boundary first renders.
const MarkdownMessage = lazy(() =>
    Promise.all([import("react-markdown"), import("remark-gfm")]).then(
        ([{ default: ReactMarkdown }, { default: remarkGfm }]) => ({
            // Wrap into a default export so `lazy()` can unwrap it.
            default: function MarkdownMessageInner({ components, children }) {
                return (
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={components}
                    >
                        {children}
                    </ReactMarkdown>
                );
            },
        })
    )
);

import "../../styles/chat.css";

// ==========================================
// 🚀 CONSTANTS & CONFIGURATION
// ==========================================
const MAX_CACHE_SIZE = 50;
// Cap on conversation turns we send to the backend. Backend further
// trims to its own MAX_HISTORY_TURNS — keep the client's cap slightly
// higher so the backend has full context to choose what to keep.
const MAX_HISTORY_TURNS = 6;

// Retry/timeout policy lives in `src/lib/chatClient.js` (bounded attempts,
// exponential backoff, a hard per-send budget). The old single 25 s attempt
// could not survive a Render free-tier cold start (~25-28 s of Python import
// before the first byte), so a transient 503 / timeout used to surface as a
// permanent "Offline". The client now retries transient failures within a
// strict budget and reports a temporary "waking up" state in between.
const RETRY_NOTICE_TEXT = "Waking up the AI service…";

// Session persistence keys.
const CHAT_STORAGE_KEY = "portfolio-chat-session";
const CHAT_OPENED_KEY = "portfolio-chat-opened";

// Resolved once at module init — every request reuses the same values.
// In production (VITE_BACKEND_URL unset) we use SAME-ORIGIN `/api/chat/*`
// URLs so Vercel's edge middleware (see `middleware.js` at the repo root)
// injects the shared `X-API-Key` header before the rewrite forwards the
// request to the Render backend — the secret never reaches the browser
// bundle.
//
// For local dev, set `VITE_BACKEND_URL=http://localhost:8000` in `.env`
// to bypass the rewrite and hit FastAPI directly (auth is skipped when
// `ENV=development`).
const CHAT_BASE_URL = import.meta.env.VITE_BACKEND_URL
    ? `${import.meta.env.VITE_BACKEND_URL.replace(/\/$/, "")}/chat`
    : "/api/chat";

const GREETING_TEXT =
    "Hi there! 👋 I'm Ritu Raj's AI Assistant. I can help you explore his projects, technical skills, education, certifications, and internship opportunities. Feel free to ask anything! 🚀";

const FIRST_RUN_PROMPTS = [
    { label: "About Ritu", prompt: "Tell me about Ritu Raj" },
    { label: "Best projects", prompt: "Show me your best projects" },
    { label: "Technical skills", prompt: "What technologies does Ritu know?" },
    { label: "Resume", prompt: "Can I see Ritu's resume?" },
    { label: "Certifications", prompt: "Which certifications does Ritu have?" },
    { label: "Why hire Ritu?", prompt: "Why should we hire Ritu Raj?" },
];

// ==========================================
// 🧩 REUSABLE COMPONENTS & HELPERS
// ==========================================
const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

const TypingIndicator = () => (
    <div className="chat-bubble ai-msg typing-indicator-container" aria-label="Loading response">
        <Skeleton className="chat-typing-skeleton" />
        <Skeleton className="chat-typing-skeleton chat-typing-skeleton-short" />
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
// `chatTransport` is an optional test seam: it can inject `fetchImpl`,
// `sleep` and `config` into `streamChat` so retries can be exercised
// deterministically. Production renders `<ChatAssistant />` with no props.
function ChatAssistant({
    chatTransport,
    // Controlled-mode API: when `open` is provided the parent owns the single
    // source of truth for open state and mirrors every change through
    // `onOpenChange`. Direct renders (tests, embeds) may omit it and fall back
    // to their own state, optionally opened via `initialOpen`.
    open: controlledOpen,
    onOpenChange,
    initialOpen = false,
    hideExternalTrigger = false,
} = {}) {
    const isControlled = controlledOpen !== undefined;
    const [internalOpen, setInternalOpen] = useState(Boolean(initialOpen));
    const isOpen = isControlled ? Boolean(controlledOpen) : internalOpen;
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [retryNotice, setRetryNotice] = useState("");
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

    const promptGroupId = useId();
    const chatInputId = useId();
    const messagesEndRef = useRef(null);
    const chatBodyRef = useRef(null);
    const chatWindowRef = useRef(null);
    const fabRef = useRef(null);
    const isUserScrolled = useRef(false);
    const inputRef = useRef(null);
    const chatCache = useRef(new Map());
    const abortControllerRef = useRef(null);
    const stopRequestedRef = useRef(false);
    const unmountedRef = useRef(false);
    const prevOpenRef = useRef(false);
    const copyTimeoutRef = useRef(null);
    // Mirror messages into a ref so handleSend sees the LATEST state,
    // not the closure-captured stale value (handleSend is memoized).
    const messagesRef = useRef(messages);
    useEffect(() => { messagesRef.current = messages; }, [messages]);

    // Single write path for open state. Controlled mode delegates to the
    // parent; uncontrolled mode updates local state. Either way we record the
    // first open and notify the parent, so there is never a second effect that
    // can silently re-open a deliberately closed dialog.
    const setOpen = useCallback((nextOpen) => {
        const next = Boolean(nextOpen);
        if (!isControlled) {
            setInternalOpen(next);
        }
        if (next) {
            setHasOpened(true);
            try {
                localStorage.setItem(CHAT_OPENED_KEY, "true");
            } catch {
                // ignore
            }
        }
        if (typeof onOpenChange === "function") {
            onOpenChange(next);
        }
    }, [isControlled, onOpenChange]);

    const closeChat = useCallback(() => setOpen(false), [setOpen]);

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
                closeChat();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, closeChat]);

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

    // Clean up the copy-toast timeout on unmount, and abort any in-flight
    // chat request so a backoff/stream cannot resolve after unmount. The ref
    // is reset during setup so React StrictMode's dev-only
    // setup → cleanup → setup sequence cannot leave it permanently `true`
    // (which would disable every state update for the rest of the session).
    useEffect(() => {
        unmountedRef.current = false;
        return () => {
            unmountedRef.current = true;
            abortControllerRef.current?.abort();
            clearTimeout(copyTimeoutRef.current);
        };
    }, []);

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

    const handleToggleOpen = () => setOpen(!isOpen);

    // 🚀 Run one chat request into a reserved AI bubble. Retry/timeout policy
    // lives in `streamChat` (src/lib/chatClient.js); this only maps SSE events
    // onto state. It updates the bubble in place and never appends messages,
    // so automatic retries cannot duplicate a user or assistant turn.
    const runChatRequest = useCallback(async ({ userText, history, aiMessageId, normalizedQuery }) => {
        stopRequestedRef.current = false;
        const controller = new AbortController();
        abortControllerRef.current = controller;
        setIsLoading(true);
        setRetryNotice("");

        let finalText = "";
        let currentSources = [];
        let generatedBy = "AI Auto-Failover";

        const patchAiMessage = (patch) => {
            if (unmountedRef.current) return;
            setMessages(prev =>
                prev.map(m => (m.id === aiMessageId ? { ...m, ...patch } : m))
            );
        };

        const onEvent = (payload) => {
            if (payload.event === "sources" && Array.isArray(payload.data)) {
                // 📚 RAG sources — attach to the message so the UI can render
                // source chips under the answer.
                currentSources = payload.data;
                patchAiMessage({ sources: currentSources });
            } else if (payload.event === "token" && payload.data) {
                finalText += payload.data;
                patchAiMessage({
                    text: finalText,
                    sources: currentSources.length ? currentSources : undefined,
                });
            } else if (payload.event === "done" && payload.data) {
                generatedBy = payload.data;
            }
            // 'meta' event: reserved for future UI hooks.
        };

        const cacheFinalText = () => {
            if (!finalText.trim()) return;
            if (chatCache.current.size >= MAX_CACHE_SIZE) {
                const firstKey = chatCache.current.keys().next().value;
                chatCache.current.delete(firstKey);
            }
            chatCache.current.set(normalizedQuery, finalText);
        };

        // 🔑 No client-side API key header. In production the shared key is
        // injected by Vercel's edge middleware (middleware.js) before the
        // rewrite forwards to the Render backend. For local dev,
        // VITE_BACKEND_URL points straight at FastAPI where ENV=development
        // skips auth.
        try {
            await streamChat({
                baseUrl: CHAT_BASE_URL,
                body: { message: userText, history },
                signal: controller.signal,
                onEvent,
                onRetry: () => {
                    if (unmountedRef.current || stopRequestedRef.current) return;
                    // Temporary state only — a single transient failure must
                    // never leave the widget permanently "Offline".
                    setRetryNotice(RETRY_NOTICE_TEXT);
                },
                fetchImpl: chatTransport?.fetchImpl,
                sleep: chatTransport?.sleep,
                config: chatTransport?.config,
            });

            if (unmountedRef.current) return;
            setRetryNotice("");
            cacheFinalText();
            setActiveModelName(generatedBy);
        } catch (error) {
            if (unmountedRef.current) return;
            setRetryNotice("");

            // User cancelled (Stop) — keep whatever was streamed so far and
            // do NOT show an error.
            if (stopRequestedRef.current || error?.aborted) {
                patchAiMessage({
                    sources: currentSources.length ? currentSources : undefined,
                });
                return;
            }

            // Diagnostic detail stays in the console; the bubble gets a
            // sanitized, actionable sentence.
            console.warn("[Chat] request failed after retries:", error);

            if (finalText.trim()) {
                // Partial answer interrupted — keep it, flag it, don't lie.
                patchAiMessage({
                    text: finalText,
                    sources: currentSources.length ? currentSources : undefined,
                    isError: true,
                    interrupted: true,
                });
            } else {
                setActiveModelName("Offline");
                patchAiMessage({ text: describeChatError(error), isError: true });
            }
        } finally {
            if (!unmountedRef.current) {
                abortControllerRef.current = null;
                setIsLoading(false);
            }
        }
    }, [chatTransport]);

    // 🚀 Send a new message: append the user turn + an AI placeholder, then
    // stream the answer into that placeholder.
    const handleSend = useCallback(async (textOverride) => {
        const userMessageText = typeof textOverride === 'string' ? textOverride : input;
        if (!userMessageText.trim() || isLoading) return;

        const normalizedQuery = userMessageText.trim().toLowerCase();
        const userMessage = { id: generateId(), role: "user", text: userMessageText.trim() };

        // Snapshot history BEFORE we append the current message — the
        // current question is sent in `message`, the prior conversation
        // is what goes in `history`.
        const history = buildHistory(messagesRef.current);

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

        // Reserve a placeholder AI message we can update token-by-token.
        const aiMessageId = generateId();
        const aiPlaceholder = { id: aiMessageId, role: "ai", text: "" };
        setMessages(prev => [...prev, aiPlaceholder]);
        messagesRef.current = [...messagesRef.current, aiPlaceholder];

        await runChatRequest({
            userText: userMessageText.trim(),
            history,
            aiMessageId,
            normalizedQuery,
        });
    }, [input, isLoading, runChatRequest]);

    // 🔁 Manual retry for a failed answer — reuses the same AI bubble and its
    // originating user turn, so nothing is appended twice.
    const handleRetry = useCallback((aiMessageId) => {
        if (isLoading) return;
        const current = messagesRef.current;
        const aiIndex = current.findIndex((m) => m.id === aiMessageId);
        if (aiIndex < 1) return;

        let userIndex = -1;
        for (let i = aiIndex - 1; i >= 0; i -= 1) {
            if (current[i].role === "user" && current[i].text) {
                userIndex = i;
                break;
            }
        }
        if (userIndex === -1) return;

        const userText = current[userIndex].text;
        const history = buildHistory(current.slice(0, userIndex));

        // Reset the failed bubble in place before retrying.
        setMessages(prev => prev.map(m =>
            m.id === aiMessageId
                ? { ...m, text: "", isError: false, interrupted: false, sources: undefined }
                : m
        ));

        runChatRequest({
            userText: userText.trim(),
            history,
            aiMessageId,
            normalizedQuery: userText.trim().toLowerCase(),
        });
    }, [isLoading, runChatRequest]);

    const onSubmit = (e) => {
        e.preventDefault();
        handleSend();
    };

    const lastMsg = messages[messages.length - 1];
    const isStreamingEmpty =
        isLoading && lastMsg?.role === "ai" && !lastMsg.text;

    // 🗣️ Concise live-region text (U7): announce state *transitions* only —
    // never the streaming tokens. Re-announcing the whole transcript on every
    // patch is excessive; a short sentence is what a screen-reader user needs.
    const liveStatus = retryNotice
        ? RETRY_NOTICE_TEXT
        : isLoading
            ? isStreamingEmpty
                ? "Searching the knowledge base…"
                : "Generating a response…"
            : lastMsg?.role === "ai" && lastMsg?.text
                ? lastMsg.isError
                    ? "The assistant could not answer. A retry is available."
                    : "Assistant response ready."
                : "";

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
                        onClick={() => {
                            closeChat();
                        }}
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
                            transition={{ duration: 0.2, ease: "easeOut" }}
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
                                        onClick={closeChat}
                                        aria-label="Close Chat"
                                    >
                                        <FaTimes />
                                    </button>
                                </div>
                            </div>

                            {/* BODY */}
                            {/* U7: the transcript container is NOT a live region
                                (a streaming answer would re-announce every
                                token). A concise status region below carries
                                polite, transition-level announcements. */}
                            <div className="chat-body" ref={chatBodyRef} onScroll={handleScroll}>
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
                                            className={`chat-bubble ${msg.role === "ai" ? "ai-msg" : "user-msg"}${msg.isError ? " error-msg" : ""}`}
                                            role={msg.isError ? "alert" : undefined}
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.3 }}
                                        >
                                            {msg.role === "ai" ? (
                                                <Suspense
                                                    fallback={
                                                        <Skeleton className="chat-message-skeleton" />
                                                    }
                                                >
                                                    <MarkdownMessage
                                                        components={markdownComponents}
                                                    >
                                                        {msg.text}
                                                    </MarkdownMessage>
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
                                                    {msg.isError ? (
                                                        prevUserText && (
                                                            <button
                                                                type="button"
                                                                className="chat-action"
                                                                onClick={() => handleRetry(msg.id)}
                                                                disabled={isLoading}
                                                                aria-label="Try again"
                                                                title="Try again"
                                                            >
                                                                <FaRedo />
                                                            </button>
                                                        )
                                                    ) : (
                                                        <>
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
                                                                    title="Regenerate response"
                                                                >
                                                                    <FaRedo />
                                                                </button>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </motion.div>
                                    );
                                })}
                                
                                {messages.length === 0 && !isLoading && (
                                    <p className="chat-empty-state">
                                        Ask a question to get started.
                                    </p>
                                )}

                                {messages.length <= 1 && !isLoading && (
                                    <motion.div
                                        className="suggested-questions-container"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ delay: 0.2 }}
                                        role="group"
                                        aria-labelledby={promptGroupId}
                                    >
                                        <p className="chat-prompts-label" id={promptGroupId}>
                                            Try asking about
                                        </p>
                                        {FIRST_RUN_PROMPTS.map((item) => (
                                            <button
                                                key={item.label}
                                                type="button"
                                                onClick={() => handleSend(item.prompt)}
                                                className="suggested-btn"
                                            >
                                                {item.label}
                                            </button>
                                        ))}
                                    </motion.div>
                                )}

                                {isLoading && <TypingIndicator />}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* 🗣️ Concise, non-excessive live region (U7).
                                Always mounted so assistive tech registers it;
                                announces transitions, not streamed tokens. */}
                            <div
                                className="chat-a11y-status"
                                role="status"
                                aria-live="polite"
                                aria-atomic="true"
                            >
                                {liveStatus}
                            </div>

                            {/* 🔍 STREAMING STATUS / STOP */}
                            {isLoading && (
                                <div className="chat-stream-status">
                                    <span className="chat-searching-hint">
                                        <Skeleton className="chat-skeleton-line" />
                                        {retryNotice
                                            ? retryNotice
                                            : isStreamingEmpty
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
                                <label className="chat-input-label" htmlFor={chatInputId}>
                                    Message
                                </label>
                                <input
                                    id={chatInputId}
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
                {!hideExternalTrigger && (
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
                )}
            </div>
        </>
    );
}

export default ChatAssistant;
