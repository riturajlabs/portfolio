import { describe, expect, it } from "vitest";

import {
  formatDateTime,
  isRemoteImage,
  SLUG_MAX_LENGTH,
  slugPreview,
  todayDateInputValue,
  validateImageDimensions,
  validateImagePath,
  validateSlug,
  validateUrl,
} from "./validators.js";

describe("validateSlug", () => {
  it("accepts lowercase slugs with single hyphens", () => {
    expect(validateSlug("hello-world")).toBeNull();
    expect(validateSlug("a")).toBeNull();
    expect(validateSlug("a1-b2")).toBeNull();
  });

  it("rejects empty, uppercase, double-hyphens, and symbols", () => {
    expect(validateSlug("")).toBe("Slug is required.");
    expect(validateSlug("Hello")).toMatch(/lowercase/);
    expect(validateSlug("a--b")).toMatch(/hyphens/);
    expect(validateSlug("a_b")).toMatch(/lowercase/);
    expect(validateSlug("a b")).toMatch(/lowercase/);
  });

  it("caps the length at the backend limit", () => {
    const tooLong = `p-${"a".repeat(SLUG_MAX_LENGTH)}`;
    expect(validateSlug(tooLong)).toBe(`Slug must be ${SLUG_MAX_LENGTH} characters or fewer.`);
  });
});

describe("validateImagePath", () => {
  it("accepts the /images/projects/*.webp shape", () => {
    expect(validateImagePath("/images/projects/hello.webp")).toBeNull();
  });

  it("accepts an absolute http(s) object-storage URL", () => {
    expect(validateImagePath("https://example.neon.tech/media/project-images/a1b2.webp")).toBeNull();
    expect(validateImagePath("http://localhost:9000/media/project-images/a1b2.png")).toBeNull();
  });

  it("rejects empty, wrong directory, non-webp and non-http values", () => {
    expect(validateImagePath("")).toBe("Image is required.");
    expect(validateImagePath("/img/hello.webp")).toMatch(/like \/images/);
    expect(validateImagePath("/images/projects/hello.png")).toMatch(/webp/);
    // A scheme that is not http(s) can never be an <img src>.
    expect(validateImagePath("javascript:alert(1)")).toMatch(/like \/images/);
    expect(validateImagePath("data:image/png;base64,AAAA")).toMatch(/like \/images/);
    // Whitespace/quote/angle bracket would break the emitted attribute.
    expect(validateImagePath('https://x.test/a"b.webp')).toMatch(/like \/images/);
    expect(validateImagePath("https://x.test/a b.webp")).toMatch(/like \/images/);
  });
});

describe("isRemoteImage", () => {
  it("distinguishes a stored URL from an in-repo path", () => {
    expect(isRemoteImage("https://example.neon.tech/media/x.webp")).toBe(true);
    expect(isRemoteImage("/images/projects/hello.webp")).toBe(false);
    expect(isRemoteImage("")).toBe(false);
  });
});

describe("validateImageDimensions", () => {
  it("accepts positive integers", () => {
    expect(validateImageDimensions(1200)).toBeNull();
    expect(validateImageDimensions("800")).toBeNull();
  });

  it("rejects zero, negatives, floats, and non-numbers", () => {
    expect(validateImageDimensions(0)).toMatch(/positive/);
    expect(validateImageDimensions(-5)).toMatch(/positive/);
    expect(validateImageDimensions(12.5)).toMatch(/whole/);
    expect(validateImageDimensions("n/a")).toMatch(/whole/);
  });
});

describe("validateUrl", () => {
  it("allows empty and full http(s) URLs", () => {
    expect(validateUrl("")).toBeNull();
    expect(validateUrl("https://example.com/a?b=1")).toBeNull();
    expect(validateUrl("http://localhost:8001")).toBeNull();
  });

  it("rejects protocol-less URLs", () => {
    expect(validateUrl("example.com")).toMatch(/http/);
    expect(validateUrl("javascript:alert(1)")).toMatch(/http/);
  });
});

describe("slugPreview", () => {
  it("slugifies then trims to the max length", () => {
    expect(slugPreview("Hello, World!")).toBe("hello-world");
    expect(slugPreview("  a  b  ")).toBe("a-b");
    expect(slugPreview("--x--")).toBe("x");
    expect(slugPreview("a".repeat(200)).length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
  });
});

describe("formatDateTime", () => {
  it("renders a stable en-GB summary or the placeholder", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("not-a-date")).toBe("—");
    expect(formatDateTime("2024-05-06T08:30:00Z")).toMatch(/6 May 2024/);
  });
});

describe("todayDateInputValue", () => {
  it("returns a YYYY-MM-DD value", () => {
    expect(todayDateInputValue()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});