// `vitest.setup.js` — runs before every vitest test file. Kept at the repo
// root (not inside src/) so it is never part of the build graph.
import "@testing-library/jest-dom/vitest";

import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

// react-type-animation (Hero's infinite typing headline) schedules
// requestAnimationFrame from a timer chain that outlives jsdom teardown,
// surfacing as an unhandled "requestAnimationFrame is not defined" rejection
// that fails the whole vitest run. Animations are not unit-tested
// (docs/TESTING.md §6), so render a static first phrase instead.
vi.mock("react-type-animation", async () => {
  const React = await import("react");
  return {
    TypeAnimation: ({ sequence = [] }) =>
      React.createElement(
        "span",
        null,
        sequence.find((item) => typeof item === "string") ?? "",
      ),
  };
});

// ---------------------------------------------------------------------------
// jsdom polyfills — the browser APIs the public site relies on that jsdom
// does not implement. Present from the first render so component tests never
// depend on call order. Scoped to browser environments: the build-script
// suites run with `environment: node` and share this setup file.
// ---------------------------------------------------------------------------

if (typeof window !== "undefined") {
  // Scroll spy, scroll progress and the footer observe sections with
  // IntersectionObserver (src/hooks/useScrollSpy.js and friends). A no-op
  // implementation is enough: the tests assert what renders, not which
  // intersection callback fires.
  if (!("IntersectionObserver" in globalThis)) {
    class IntersectionObserverStub {
      constructor(callback) {
        this.callback = callback;
        this.targets = new Set();
      }
      observe(target) {
        this.targets.add(target);
      }
      unobserve(target) {
        this.targets.delete(target);
      }
      disconnect() {
        this.targets.clear();
      }
      takeRecords() {
        return [];
      }
    }
    globalThis.IntersectionObserver = IntersectionObserverStub;
  }

  if (!("ResizeObserver" in globalThis)) {
    globalThis.ResizeObserver = class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }

  // Theme/media queries: jsdom always reports no match. Default to "no
  // preference" so framer-motion and the theme code take their normal path.
  if (!globalThis.matchMedia) {
    globalThis.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }

  // jsdom's window.scrollTo logs "Not implemented" as an error, which would
  // pollute the console of every component test that scrolls on mount.
  window.scrollTo = () => {};
}
