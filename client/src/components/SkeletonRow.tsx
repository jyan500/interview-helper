import { Skeleton } from "./Skeleton";

// One shimmer placeholder row, matching the four columns. Each bar is `inline` so it honours the
// cell's text-align (the last column is right-aligned) the way a real value/button would. `withTag`
// adds a leading pill-shaped cell for tables with a kind-tag column (InterviewsTable's Type).
export function SkeletonRow({ withTag = false }: { withTag?: boolean }) {
    return (
        <tr>
            {withTag && <td><Skeleton inline className="h-5 w-14" /></td>}
            <td><Skeleton inline className="h-3.5 w-48" /></td>
            <td><Skeleton inline className="h-3.5 w-20" /></td>
            <td><Skeleton inline className="h-3.5 w-8" /></td>
            <td className="text-right"><Skeleton inline className="h-3.5 w-14" /></td>
        </tr>
    );
}
