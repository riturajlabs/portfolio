// =========================================================
// 💬 CHAT ASSISTANT TESTS — COLD-START RECOVERY IN THE UI
// =========================================================
// The widget must survive the Render free-tier cold start: a transient 503
// ("store still loading") should recover silently, and only a request that
// exhausts its bounded retries should surface an error — with a manual retry
// that reuses the same bubble instead of appending duplicate turns.
//
// `chatTransport` injects the fetch/sleep seams from `chatClient.js`, so these
// tests never touch the network or real timers.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChatAssistant from "./ChatAssistant";

// jsdom has no layout, so scroll-into-view is a no-op stub.
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
}

const encoder = new TextEncoder();

function sse(event, data) {
    return encoder.encode(`data: ${JSON.stringify({ event, data })}\n\n`);
}

function streamResponse(frames) {
    let i = 0;
    return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: {
            getReader: () => ({
                read: async () =>
                    i < frames.length
                        ? { value: frames[i++], done: false }
                        : { value: undefined, done: true },
            }),
        },
    };
}

function errorResponse(status) {
    return {
        ok: false,
        status,
        headers: { get: () => null },
        body: null,
    };
}

function successFrames(text) {
    return [
        sse("meta", {}),
        sse("sources", []),
        sse("token", text),
        sse("done", "Gemini"),
    ];
}

async function send(question) {
    const input = screen.getByPlaceholderText(/ask about my skills/i);
    fireEvent.change(input, { target: { value: question } });
    fireEvent.submit(input.closest("form"));
}

async function ask(question) {
    fireEvent.click(screen.getByLabelText("Open AI Chat"));
    await send(question);
}

describe("ChatAssistant", () => {
    beforeEach(() => {
        sessionStorage.clear();
        localStorage.clear();
    });

    it("recovers from a cold-start 503 and renders the answer (never 'Offline')", async () => {
        let call = 0;
        const fetchImpl = vi.fn(async () => {
            call += 1;
            // First attempt (both endpoints) is the cold-start 503.
            if (call <= 2) return errorResponse(503);
            return streamResponse(successFrames("Hello there"));
        });

        render(
            <ChatAssistant
                chatTransport={{ fetchImpl, sleep: vi.fn(async () => {}) }}
            />,
        );

        await ask("What do you know?");

        await waitFor(() =>
            expect(screen.getByText("Hello there")).toBeTruthy(),
        );
        expect(fetchImpl.mock.calls.length).toBeGreaterThan(2);
        expect(screen.queryByText("Offline")).toBeNull();
    });

    it("shows a temporary 'waking up' notice, then a manual retry on failure", async () => {
        const sleep = vi.fn(
            () => new Promise((resolve) => resolvers.push(resolve)),
        );
        const resolvers = [];
        const fetchImpl = vi.fn(async () => errorResponse(503));

        render(<ChatAssistant chatTransport={{ fetchImpl, sleep }} />);

        await ask("ping");
        // First backoff: the temporary notice is visible while retrying.
        await waitFor(() =>
            expect(screen.getByText(/waking up the ai service/i)).toBeTruthy(),
        );
        expect(resolvers.length).toBe(1);

        // Finish backoff 1 → attempt 2 fails → second backoff.
        await act(async () => resolvers[0]());
        await waitFor(() => expect(resolvers.length).toBe(2));
        act(() => resolvers[1]()); // finish backoff → attempt 3 fails → error

        const retry = await screen.findByLabelText("Try again");
        expect(retry).toBeInTheDocument();
        // The temporary notice is cleared once the send is over.
        expect(screen.queryByText(/waking up the ai service/i)).toBeNull();
    });

    it("recovers a failed answer in place via the Try again action", async () => {
        let call = 0;
        const fetchImpl = vi.fn(async () => {
            call += 1;
            // Three attempts × two endpoints all fail, then the manual retry
            // succeeds on the primary endpoint.
            if (call <= 6) return errorResponse(503);
            return streamResponse(successFrames("Recovered"));
        });
        const sleep = vi.fn(async () => {});

        render(<ChatAssistant chatTransport={{ fetchImpl, sleep }} />);
        await ask("status?");

        const retry = await screen.findByLabelText("Try again");
        const userTurnsBefore = screen.getAllByText("status?").length;

        fireEvent.click(retry);

        await waitFor(() => expect(screen.getByText("Recovered")).toBeTruthy());
        expect(screen.getAllByText("status?").length).toBe(userTurnsBefore);
        expect(screen.queryByLabelText("Try again")).toBeNull();
    });

    it("clears loading and streams again under React StrictMode", async () => {
        let call = 0;
        const fetchImpl = vi.fn(async () => {
            call += 1;
            return streamResponse(successFrames(`answer-${call}`));
        });

        render(
            <StrictMode>
                <ChatAssistant
                    chatTransport={{ fetchImpl, sleep: vi.fn(async () => {}) }}
                />
            </StrictMode>,
        );

        await ask("first question");
        await waitFor(() => expect(screen.getByText("answer-1")).toBeTruthy());

        // A second send only proceeds if loading was cleared — i.e. StrictMode's
        // dev-only mount cleanup did not permanently disable state updates.
        await send("second question");
        await waitFor(() => expect(screen.getByText("answer-2")).toBeTruthy());
    });
});
