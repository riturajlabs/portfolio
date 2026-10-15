// Phase 10 (docs/TESTING.md §6): the homepage <SEO /> component. Asserted
// against the real <head> React Helmet writes, because that head is what a
// crawler actually reads.

import { HelmetProvider } from "react-helmet-async";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import SEO from "./SEO";
import { seo } from "../../lib/publicContent";
import { ROBOTS_DIRECTIVE } from "../../lib/projectPages";

function renderSeo(props = {}) {
    return render(
        <HelmetProvider>
            <SEO {...props} />
        </HelmetProvider>
    );
}

function metaContent(attribute, value) {
    const tag = document.head.querySelector(`meta[${attribute}="${value}"]`);
    return tag ? tag.getAttribute("content") : null;
}

describe("SEO", () => {
    it("applies the default title and description from the content snapshot", async () => {
        renderSeo();

        await waitFor(() => {
            expect(document.title).toBe(seo.title);
        });

        expect(metaContent("name", "description")).toBe(seo.description);
    });

    it("emits a canonical link and the robots directive", async () => {
        renderSeo();

        await waitFor(() => {
            const canonical = document.head.querySelector('link[rel="canonical"]');
            expect(canonical).not.toBeNull();
            expect(canonical.getAttribute("href")).toBe(seo.url);
        });

        expect(metaContent("name", "robots")).toBe(ROBOTS_DIRECTIVE);
    });

    it("emits Open Graph and Twitter card tags", async () => {
        renderSeo();

        await waitFor(() => {
            expect(metaContent("property", "og:title")).toBe(seo.title);
        });

        expect(metaContent("property", "og:description")).toBe(seo.description);
        expect(metaContent("property", "og:url")).toBe(seo.url);
        expect(metaContent("property", "og:image")).toBeTruthy();
        expect(metaContent("property", "og:type")).toBe(seo.type);
        expect(metaContent("name", "twitter:card")).toBe(seo.twitterCard);
        expect(metaContent("name", "twitter:title")).toBe(seo.title);
    });

    it("emits Person + WebSite structured data that parses as JSON-LD", async () => {
        renderSeo();

        await waitFor(() => {
            const scripts = [
                ...document.querySelectorAll('script[type="application/ld+json"]'),
            ];
            expect(scripts.length).toBeGreaterThan(0);
        });

        const scripts = [
            ...document.querySelectorAll('script[type="application/ld+json"]'),
        ];
        const parsed = scripts.map((script) => JSON.parse(script.textContent));

        const graph = parsed.flatMap((entry) => entry["@graph"] || [entry]);
        const types = graph.map((node) => node["@type"]);

        expect(types).toContain("Person");
        expect(types).toContain("WebSite");

        const person = graph.find((node) => node["@type"] === "Person");
        expect(person["@id"]).toBe(`${seo.url}#person`);
        expect(person.name).toBe(seo.person.name);
    });

    it("honours explicit prop overrides", async () => {
        renderSeo({
            title: "Custom Title For Test",
            description: "Custom description for test.",
        });

        await waitFor(() => {
            expect(document.title).toBe("Custom Title For Test");
        });

        expect(metaContent("name", "description")).toBe(
            "Custom description for test."
        );
        expect(metaContent("property", "og:title")).toBe(
            "Custom Title For Test"
        );
    });
});
