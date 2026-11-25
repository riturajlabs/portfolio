export default function Skeleton({ className = "", ...props }) {
    return (
        <div
            className={`placeholder-glow ${className}`.trim()}
            aria-hidden="true"
            {...props}
        >
            <span className="placeholder col-12" />
        </div>
    );
}
