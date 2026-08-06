import { useEffect, useState } from "react";

function ScrollProgress() {
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        const handleScroll = () => {
            const scrollTop = window.scrollY;
            const docHeight =
                document.documentElement.scrollHeight - window.innerHeight;
            const pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
            setProgress(pct);
        };

        handleScroll();
        window.addEventListener("scroll", handleScroll, { passive: true });
        window.addEventListener("resize", handleScroll);

        return () => {
            window.removeEventListener("scroll", handleScroll);
            window.removeEventListener("resize", handleScroll);
        };
    }, []);

    return (
        <div
            className="scroll-progress"
            role="progressbar"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Scroll progress"
        >
            <span style={{ width: `${progress}%` }} />
        </div>
    );
}

export default ScrollProgress;
