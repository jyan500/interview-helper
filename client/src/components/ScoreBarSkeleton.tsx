import { Skeleton } from "./Skeleton";

/**
 * A shape-matching loading placeholder for one <ScoreBar> — same track height and top margin as the
 * real bar, so a column of these holds the exact layout the loaded bars will take (no reflow when the
 * data lands). Kept beside ScoreBar as its own component so any consumer that shows loading bars
 * (e.g. the dashboard's skill breakdown) imports the placeholder without pulling in the bar itself.
 */
export default function ScoreBarSkeleton() {
    return (
        <div>
            <div className="flex justify-between">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3.5 w-6" />
            </div>
            <Skeleton className="mt-[5px] h-1.5 w-full" />
        </div>
    );
}
