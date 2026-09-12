/**
 * Readiness card — the signal panel's headline trend (Nocturne mock 1a), now data-driven.
 *
 * The big number is the latest graded interview's overall (the app's 1-5 scale, same as the
 * scorecard Donut and the interviews table); the delta is the change across the selected window,
 * and the Sparkline plots the series. All of it comes from GET /api/dashboard, scoped to the
 * chosen role + time window.
 *
 * THREE STATES inside the shared SignalCard shell: `loading` shows a shape-matching skeleton (so the
 * panel holds its layout while the fetch is in flight); with nothing graded in the window
 * (`latest === null`) an empty-state prompt; otherwise the number + delta + sparkline.
 */
import Sparkline from "./Sparkline";
import SignalCard from "./SignalCard";
import { Skeleton } from "./Skeleton";
import { formatScore } from "../helpers";
import type { Readiness } from "../api";

export default function ReadinessCard({
    readiness,
    loading,
}: {
    readiness: Readiness;
    loading?: boolean;
}) {
    const { series, latest, delta, count } = readiness;

    return (
        <SignalCard title="Readiness">
            {loading ? (
                <>
                    <div className="mt-1.5 flex items-end gap-2.5">
                        <Skeleton className="h-11 w-20" />
                        <Skeleton className="mb-1 h-3.5 w-32" />
                    </div>
                    <Skeleton className="mt-2 h-[74px] w-full" />
                </>
            ) : latest === null ? (
                <p className="mt-2 text-[13px] text-neutral-400">
                    Complete an interview for this role to see your readiness trend.
                </p>
            ) : (
                <>
                    <div className="mt-1 flex items-end gap-2.5">
                        <span className="font-heading text-[46px] leading-none">{formatScore(latest)}</span>
                        <span className="pb-2 text-[13px] text-neutral-400">/ 5</span>
                        {delta !== null && (
                            <span className="pb-2 text-[13px] text-accent-300">
                                {delta >= 0 ? "+" : ""}
                                {formatScore(delta)} over {count} sessions
                            </span>
                        )}
                    </div>
                    <div className="mt-2">
                        <Sparkline data={series} />
                    </div>
                </>
            )}
        </SignalCard>
    );
}
