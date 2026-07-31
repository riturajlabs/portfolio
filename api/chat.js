import { GoogleGenerativeAI } from "@google/generative-ai";

import { buildPrompt } from "../server/utils/buildPrompt.js";

// ==========================================
// 🚀 CONSTANTS & CONFIGURATION
// ==========================================
const MAX_OUTPUT_TOKENS = 1024; 
const TEMPERATURE = 0.3;
const REQUEST_TIMEOUT_MS = 10000;

const FALLBACK_MODELS = [
    { provider: "gemini", name: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash" },
    { provider: "gemini", name: "gemini-2.0-flash", displayName: "Gemini 2.0 Flash" },
    { provider: "gemini", name: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
    { provider: "groq", name: "llama-3.3-70b-versatile", displayName: "Groq Llama 3.3" },
    { provider: "groq", name: "mixtral-8x7b-32768", displayName: "Groq Mixtral" },
    { provider: "groq", name: "llama3-8b-8192", displayName: "Groq Llama 3 (8B)" },
];



// Utility for Timeout
const withTimeout = (promise, ms) => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Request Timeout")), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
};

// ==========================================
// ⚙️ SERVERLESS FUNCTION HANDLER
// ==========================================
export default async function handler(req, res) {
    // 1. Validate Method
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
    }

    // 2. Validate Body
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'Invalid request. Messages array is required.' });
    }

    try {
        // Build history for AI
        const history = messages.slice(0, -1).map(msg => ({
            role: msg.role === "ai" ? "assistant" : "user",
            content: msg.text
        }));

        // Latest user message
        const currentQuestion =
            messages[messages.length - 1]?.text || "";

        // Build optimized prompt using knowledge base
        const fullPrompt = buildPrompt(
            currentQuestion,
            history
        );

        // Groq uses the same prompt
        const groqMessagesArray = [
            {
                role: "user",
                content: fullPrompt
            }
        ];

        let responseText = null;
        let generatedBy = "Offline";

        // 3. Failover Waterfall Logic
        for (const config of FALLBACK_MODELS) {
            try {
                if (config.provider === "gemini") {
                    // Use process.env in backend, NOT import.meta.env
                    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
                    const model = genAI.getGenerativeModel({ 
                        model: config.name,
                        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: TEMPERATURE }
                    });
                    
                    const result = await withTimeout(
                        model.generateContent(fullPrompt),
                        REQUEST_TIMEOUT_MS
                    );
                    responseText = result.response.text();
                } 
                else if (config.provider === "groq") {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
                    
                    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            model: config.name,
                            messages: groqMessagesArray,
                            temperature: TEMPERATURE,
                            max_tokens: MAX_OUTPUT_TOKENS
                        }),
                        signal: controller.signal
                    });
                    
                    clearTimeout(timeoutId);
                    
                    if (!groqRes.ok) throw new Error(`Groq API Error: ${groqRes.status}`);
                    const data = await groqRes.json();
                    if (!data.choices || !data.choices[0].message) throw new Error("Empty Response");
                    responseText = data.choices[0].message.content;
                }

                // If successful, break the loop
                if (responseText) {
                    generatedBy = config.displayName;
                    break; 
                }
            } catch (error) {
                console.warn(`[AI Backend] ⚠️ Failed with ${config.name}. Trying next...`, error.message);
            }
        }

        // 4. Return Result
        if (responseText) {
            return res.status(200).json({ reply: responseText, generatedBy });
        } else {
            return res.status(503).json({ error: "All AI models are currently busy or unavailable." });
        }

    } catch (error) {
        console.error("[AI Backend] Fatal Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
}