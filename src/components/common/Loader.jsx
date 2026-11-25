import Skeleton from "./Skeleton";

export default function Loader() {
    return (
        <div className="container py-5" aria-busy="true">
            <Skeleton className="mb-3" />
            <Skeleton className="mb-3 col-10" />
            <Skeleton className="col-8" />
        </div>
    );
}
