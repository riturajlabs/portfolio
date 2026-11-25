import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  fieldErrorMap,
  get,
  uploadImage,
  uploadResume,
} from "./client.js";

describe("ApiError", () => {
  it("exposes status, code, message, fields and request_id", () => {
    const error = new ApiError(409, {
      code: "SLUG_TAKEN",
      message: "Slug already in use.",
      fields: [{ field: "slug", message: "Already taken." }],
      request_id: "req_abc",
    });
    expect(error.status).toBe(409);
    expect(error.code).toBe("SLUG_TAKEN");
    expect(error.message).toBe("Slug already in use.");
    expect(error.fields).toEqual([{ field: "slug", message: "Already taken." }]);
    expect(error.request_id).toBe("req_abc");
  });

  it("survives a non-object payload", () => {
    const error = new ApiError(500, "boom");
    expect(error.status).toBe(500);
    expect(error.message).toBe("Request failed with status 500.");
    expect(error.fields).toEqual([]);
    expect(String(error)).toContain("500");
  });
});

describe("fieldErrorMap", () => {
  it("flattens error.fields into { field: message }", () => {
    const error = new ApiError(422, {
      code: "VALIDATION",
      message: "Invalid body.",
      fields: [
        { field: "slug", message: "Already taken." },
        { field: "image", message: "Must be a webp path." },
      ],
    });
    expect(fieldErrorMap(error)).toEqual({
      slug: "Already taken.",
      image: "Must be a webp path.",
    });
  });

  it("normalizes bracketed and malformed nested paths", () => {
    const error = new ApiError(422, {
      code: "VALIDATION_ERROR",
      message: "Invalid body.",
      fields: [
        {
          field: "case_study.outcomes[0].evidence.source",
          message: "Must be a webp path.",
        },
        { field: "case_study..role", message: "Required." },
        { field: "case_study.role", message: "Second problem." },
        { field: null, message: "No stable path." },
      ],
    });
    expect(fieldErrorMap(error)).toEqual({
      "case_study.outcomes.0.evidence.source": "Must be a webp path.",
      "case_study.role": "Required. Second problem.",
    });
  });

  it("ignores entries without a field and survives a missing fields array", () => {
    expect(fieldErrorMap(null)).toEqual({});
    expect(
      fieldErrorMap(new ApiError(400, { code: "BAD_REQUEST", message: "nope" })),
    ).toEqual({});
    expect(
      fieldErrorMap(
        new ApiError(422, {
          code: "VALIDATION",
          message: "x",
          fields: [{ message: "no field name" }, null, { field: "alt", message: "real" }],
        }),
      ),
    ).toEqual({ alt: "real" });
  });
});

describe("admin error responses", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("turns the admin error envelope into an ApiError usable by fieldErrorMap", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "VALIDATION_ERROR",
            message: "Request validation failed.",
            fields: [
              {
                field: "case_study.outcomes[0].evidence.source",
                message: "Invalid source.",
              },
            ],
            request_id: "req-123",
          },
        }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await get("/projects/project-1").catch((thrown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(422);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.request_id).toBe("req-123");
    expect(fieldErrorMap(error)).toEqual({
      "case_study.outcomes.0.evidence.source": "Invalid source.",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/projects/project-1",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("keeps status, fallback message, and Retry-After for a malformed error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("temporarily unavailable", {
            status: 429,
            headers: { "Retry-After": "4" },
          }),
      ),
    );

    const error = await get("/projects").catch((thrown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(429);
    expect(error.code).toBeNull();
    expect(error.message).toBe("Request failed with status 429.");
    expect(error.fields).toEqual([]);
    expect(error.retryAfter).toBe(4);
  });
});

describe("uploadImage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("POSTs the file as multipart without overwriting the browser Content-Type", async () => {
    const calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, options) => {
        calls.push({ url, options });
        if (String(url).endsWith("/api/admin/me")) {
          return new Response(JSON.stringify({ csrf_token: "tok-123" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({
            image: "https://cdn.example.com/new.webp",
            image_width: 30,
            image_height: 20,
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const file = new File(["image"], "new.webp", { type: "image/webp" });
    const result = await uploadImage(file);

    expect(result).toEqual({
      image: "https://cdn.example.com/new.webp",
      image_width: 30,
      image_height: 20,
    });

    const upload = calls.find((call) =>
      String(call.url).endsWith("/api/admin/uploads"),
    );
    expect(upload).toBeTruthy();
    expect(upload.options.method).toBe("POST");
    expect(upload.options.body).toBeInstanceOf(FormData);
    expect(upload.options.body.get("file").name).toBe("new.webp");
    expect(upload.options.headers.get("Content-Type")).toBeNull();
    expect(upload.options.headers.get("X-CSRF-Token")).toBe("tok-123");
  });
});

describe("uploadResume", () => {
  afterEach(() => vi.restoreAllMocks());

  it("POSTs the file as multipart to /api/admin/profile/resume without a Content-Type header", async () => {
    const calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, options) => {
        calls.push({ url, options });
        if (String(url).endsWith("/api/admin/me")) {
          return new Response(JSON.stringify({ csrf_token: "tok-123" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({ resume: "/api/resume", key: "resumes/abc.pdf", audit_id: "a1" }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "cv.pdf", {
      type: "application/pdf",
    });
    const result = await uploadResume(file);

    expect(result).toEqual({ resume: "/api/resume", key: "resumes/abc.pdf", audit_id: "a1" });

    const upload = calls.find((call) => String(call.url).endsWith("/api/admin/profile/resume"));
    expect(upload).toBeTruthy();
    expect(upload.options.method).toBe("POST");
    expect(upload.options.body).toBeInstanceOf(FormData);
    const sent = upload.options.body.get("file");
    expect(sent).toBeInstanceOf(File);
    expect(sent.name).toBe("cv.pdf");
    expect(sent.type).toBe("application/pdf");
    // The browser must set the multipart boundary itself; an explicit
    // Content-Type would drop it and the server could not parse the body.
    expect(upload.options.headers.get("Content-Type")).toBeNull();
    expect(upload.options.headers.get("X-CSRF-Token")).toBe("tok-123");
  });
});