// =========================================================
// U8 — CHAT LIFECYCLE REGRESSION
// =========================================================
// Covers the U8 invariants at the component level:
//   1. Open → close → remain closed (no stale prop/effect re-opens it)
//   2. Reopen after a deliberate close
//   3. Trigger visibility and correct ARIA state
//   4. One source of truth: controlled mode delegates every change to the
//      parent, uncontrolled mode owns its own state (and can start open)
//
// `chatTransport` suppresses real network calls; jsdom has no layout engine,
// so scroll-into-view is stubbed.

import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChatAssistant from "./ChatAssistant";

vi.mock("framer-motion", () => {
    const stripMotionProps = (props) =>
        Object.fromEntries(
            Object.entries(props).filter(
                ([key]) =>
                    !["initial", "animate", "exit", "transition", "whileHover", "whileTap"].includes(key),
            ),
        );

    return {
        AnimatePresence: ({ children }) => children,
        motion: {
            div: (props) => <div {...stripMotionProps(props)} />,
            button: (props) => <button {...stripMotionProps(props)} />,
        },
    };
});

if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
}

// Minimal no-op transport so no real fetch occurs.
const noopTransport = {
    fetchImpl: vi.fn(async () => ({
        ok: false,
        status: 503,
        headers: { get: () => null },
        body: null,
    })),
    sleep: vi.fn(async () => {}),
};

// Mirrors App's integration: the parent owns `open` and passes the setter
// straight through as `onOpenChange`.
function ControlledChat({ initiallyOpen = false }) {
    const [open, setOpen] = useState(initiallyOpen);
    return (
        <ChatAssistant
            chatTransport={noopTransport}
            open={open}
            onOpenChange={setOpen}
        />
    );
}

describe("ChatAssistant (U8) — controlled lifecycle", () => {
    beforeEach(() => {
        sessionStorage.clear();
        localStorage.clear();
    });

    it("opens when the controlled `open` prop becomes true", () => {
        render(<ControlledChat initiallyOpen />);
        expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("starts closed when the controlled `open` prop is false", () => {
        render(<ControlledChat />);
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("open → close → remains closed (no effect re-opens it)", async () => {
        render(<ControlledChat />);

        fireEvent.click(screen.getByRole("button", { name: "Open AI Chat" }));
        await waitFor(() =>
            expect(screen.getByRole("dialog")).toBeInTheDocument()
        );

        fireEvent.click(screen.getByRole("button", { name: "Close Chat" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

        // A parent re-render (the effect that used to reopen the dialog)
        // must leave it closed.
        await act(async () => {});
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("reopens after a deliberate close", async () => {
        render(<ControlledChat />);

        fireEvent.click(screen.getByRole("button", { name: "Open AI Chat" }));
        await waitFor(() =>
            expect(screen.getByRole("dialog")).toBeInTheDocument()
        );

        fireEvent.click(screen.getByRole("button", { name: "Close Chat" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

        const fab = screen.getByRole("button", { name: "Open AI Chat" });
        expect(fab).toHaveAttribute("aria-expanded", "false");
        fireEvent.click(fab);

        await waitFor(() =>
            expect(screen.getByRole("dialog")).toBeInTheDocument()
        );
    });

    it("escape closes the dialog through the controlled callback", async () => {
        render(<ControlledChat initiallyOpen />);
        expect(screen.getByRole("dialog")).toBeInTheDocument();

        fireEvent.keyDown(window, { key: "Escape" });
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

        // Parent re-render must not undo the close.
        await act(async () => {});
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("FAB aria-expanded and label track the open/closed state", async () => {
        render(<ControlledChat />);

        const closedFab = screen.getByRole("button", { name: "Open AI Chat" });
        expect(closedFab).toHaveAttribute("aria-haspopup", "dialog");
        expect(closedFab).toHaveAttribute("aria-expanded", "false");

        fireEvent.click(closedFab);
        const openFab = await screen.findByRole("button", {
            name: "Close AI Chat",
        });
        expect(openFab).toHaveAttribute("aria-expanded", "true");
    });
});

describe("ChatAssistant (U8) — uncontrolled fallback", () => {
    beforeEach(() => {
        sessionStorage.clear();
        localStorage.clear();
    });

    it("can start open via `initialOpen`", () => {
        render(<ChatAssistant chatTransport={noopTransport} initialOpen />);
        expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("opens from its own FAB, closes, stays closed, then reopens", async () => {
        render(<ChatAssistant chatTransport={noopTransport} />);

        fireEvent.click(screen.getByRole("button", { name: "Open AI Chat" }));
        await waitFor(() =>
            expect(screen.getByRole("dialog")).toBeInTheDocument()
        );

        fireEvent.click(screen.getByRole("button", { name: "Close Chat" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        await act(async () => {});
        expect(screen.queryByRole("dialog")).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "Open AI Chat" }));
        await waitFor(() =>
            expect(screen.getByRole("dialog")).toBeInTheDocument()
        );
    });

    it("hides the internal trigger when `hideExternalTrigger` is set", () => {
        render(
            <ChatAssistant
                chatTransport={noopTransport}
                hideExternalTrigger
            />
        );
        expect(
            screen.queryByRole("button", { name: /AI Chat/ })
        ).toBeNull();
        expect(screen.queryByRole("dialog")).toBeNull();
    });
});
