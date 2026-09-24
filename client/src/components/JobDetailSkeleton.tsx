/**
 * The Job page's loading placeholder, in the page's shape: crumb + title + summary header, then the
 * round cards and the simulations list on the left and the details card on the right.
 */
import AppNav from "./AppNav";
import { RoundCardSkeleton } from "./RoundCard";
import { Skeleton } from "./Skeleton";

export default function JobDetailSkeleton() {
    return (
        <div className="min-h-screen bg-bg text-ink">
            <AppNav />
            <div className="mx-auto max-w-[1280px]">
                <div className="border-b border-divider px-7 pb-5 pt-[22px]">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="mt-3 h-7 w-80" />
                    <Skeleton className="mt-3 h-3.5 w-full max-w-[720px]" />
                    <Skeleton className="mt-2 h-3.5 w-2/3 max-w-[480px]" />
                </div>
                <div className="grid grid-cols-1 gap-6 px-7 pb-8 pt-6 lg:grid-cols-[1fr_400px]">
                    <div className="grid grid-cols-1 gap-4 self-start md:grid-cols-3">
                        <RoundCardSkeleton />
                        <RoundCardSkeleton />
                        <RoundCardSkeleton />
                    </div>
                    <Skeleton className="h-[420px] w-full rounded-md" />
                </div>
            </div>
        </div>
    );
}
