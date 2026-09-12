import { Skeleton } from "./Skeleton";

// A single inline text-line placeholder. Thin wrapper over the shared Skeleton primitive, kept as a
// named export for the one-line "a bit of text is loading" case.
export const SkeletonText = () => <Skeleton inline className="mt-2 h-3.5" />;
