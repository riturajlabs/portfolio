import { useCallback, useEffect, useRef, useState } from "react";

// Distance (px) from the top of the viewport to the detection line.
// Must clear the fixed navbar (75px) with a little breathing room.
const NAV_OFFSET = 88;

// Height of the detection band. Kept tiny so only ONE section can ever
// contain it — that is what makes the scroll spy flicker-free.
const LINE_HEIGHT = 4;

function getRootMargin() {
    const vh =
        window.innerHeight || document.documentElement.clientHeight || 0;
    const bottom = Math.max(0, vh - (NAV_OFFSET + LINE_HEIGHT));
    return `-${NAV_OFFSET}px 0px -${bottom}px 0px`;
}

// Scroll spy that highlights the section currently sitting just under the
// fixed navbar. Unlike a naive observer (threshold 0.5) this works for:
//   - tall sections that can never show 50% of their height,
//   - sections that are lazy-loaded after the hook mounts,
//   - hash navigation and manual link clicks.
export default function useScrollSpy(initialId = "") {
    const [activeId, setActiveIdState] = useState(initialId);
    const observerRef = useRef(null);
    const sectionIdsRef = useRef(new Set());
    const currentIdRef = useRef(initialId);

    const setActiveId = useCallback((id) => {
        if (!id || id === currentIdRef.current) return;
        currentIdRef.current = id;
        setActiveIdState(id);
    }, []);

    const buildObserver = useCallback(() => {
        observerRef.current?.disconnect();

        const observer = new IntersectionObserver(
            (entries) => {
                let best = null;
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    // At a section boundary the band can briefly touch two
                    // sections — prefer the one whose top is lowest (the
                    // section that has just crossed the detection line).
                    if (
                        !best ||
                        entry.boundingClientRect.top > best.top
                    ) {
                        best = {
                            top: entry.boundingClientRect.top,
                            id: entry.target.id,
                        };
                    }
                }
                if (best) setActiveId(best.id);
            },
            { rootMargin: getRootMargin(), threshold: 0 }
        );

        observerRef.current = observer;

        sectionIdsRef.current.forEach((id) => {
            const el = document.getElementById(id);
            if (el) observer.observe(el);
        });
    }, [setActiveId]);

    useEffect(() => {
        const observeSections = () => {
            document
                .querySelectorAll("section[id]")
                .forEach((section) => {
                    const id = section.id;
                    if (sectionIdsRef.current.has(id)) return;
                    sectionIdsRef.current.add(id);
                    observerRef.current?.observe(section);
                });
        };

        buildObserver();
        observeSections();

        // Lazy-loaded sections mount after the navbar. Watch the DOM and
        // observe any section that appears later.
        const mutationObserver = new MutationObserver((mutations) => {
            const hasSection = mutations.some((mutation) =>
                Array.from(mutation.addedNodes).some(
                    (node) =>
                        node.nodeType === 1 &&
                        (node.matches?.("section[id]") ||
                            node.querySelector?.("section[id]"))
                )
            );
            if (hasSection) observeSections();
        });
        mutationObserver.observe(document.body, {
            childList: true,
            subtree: true,
        });

        // rootMargin depends on viewport height — rebuild when it changes.
        let resizeTimer;
        const onResize = () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(buildObserver, 150);
        };
        window.addEventListener("resize", onResize);

        // Keep the spy in sync with direct hash navigation / link clicks.
        const onHashChange = () => {
            const id = window.location.hash.replace("#", "");
            if (id && sectionIdsRef.current.has(id)) setActiveId(id);
        };
        window.addEventListener("hashchange", onHashChange);

        const initialHash = window.location.hash.replace("#", "");
        if (initialHash && document.getElementById(initialHash)) {
            setActiveId(initialHash);
        }

        return () => {
            observerRef.current?.disconnect();
            mutationObserver.disconnect();
            window.removeEventListener("resize", onResize);
            window.removeEventListener("hashchange", onHashChange);
        };
    }, [buildObserver, setActiveId]);

    return [activeId, setActiveId];
}
