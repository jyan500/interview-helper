import { Skeleton } from "./Skeleton";

// One shimmer placeholder row, matching the four columns. Each bar is `inline` so it honours the
// cell's text-align (the last column is right-aligned) the way a real value/button would.
export function SkeletonRow() {
    return (
        <tr>
            <td><Skeleton inline className="h-3.5 w-48" /></td>
            <td><Skeleton inline className="h-3.5 w-20" /></td>
            <td><Skeleton inline className="h-3.5 w-8" /></td>
            <td className="text-right"><Skeleton inline className="h-3.5 w-14" /></td>
        </tr>
    );
}
