import { afterEach, describe, expect, it, vi } from "vitest";

import { sendEmail } from "./emailService";

const PAYLOAD = {
    name: "Test User",
    email: "test@example.com",
    message: "Hello",
};

function pendingFetch() {
    return vi.fn(
        (_, { signal }) =>
            new Promise((_, reject) => {
                signal.addEventListener(
                    "abort",
                    () => {
                        const error = new Error("aborted");
                        error.name = "AbortError";
                        reject(error);
                    },
                    { once: true }
                );
            })
    );
}

describe("sendEmail", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("posts the allowed fields to the contact endpoint", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ ok: true }),
        });
        vi.stubGlobal("fetch", fetchMock);

        await expect(sendEmail(PAYLOAD)).resolves.toEqual({ ok: true });

        const [, options] = fetchMock.mock.calls[0];
        expect(options.method).toBe("POST");
        expect(JSON.parse(options.body)).toEqual(PAYLOAD);
        expect(options.signal).toBeInstanceOf(AbortSignal);
    });

    it("surfaces a TimeoutError when the request never settles", async () => {
        vi.useFakeTimers();
        vi.stubGlobal("fetch", pendingFetch());

        const promise = sendEmail(PAYLOAD, { timeoutMs: 10 });
        const assertion = expect(promise).rejects.toMatchObject({
            name: "TimeoutError",
        });
        await vi.advanceTimersByTimeAsync(10);

        await assertion;
    });

    it("honours a caller-provided abort signal", async () => {
        vi.stubGlobal("fetch", pendingFetch());
        const controller = new AbortController();

        const promise = sendEmail(PAYLOAD, { signal: controller.signal });
        const assertion = expect(promise).rejects.toMatchObject({
            name: "AbortError",
        });
        controller.abort();

        await assertion;
    });

    it("uses the backend error detail for a failed response", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: false,
                status: 400,
                json: async () => ({ detail: "Please use a valid email." }),
            })
        );

        await expect(sendEmail(PAYLOAD)).rejects.toThrow(
            "Please use a valid email."
        );
    });
});
