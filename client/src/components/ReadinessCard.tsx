/**
 * Readiness card — the signal panel's headline trend (Nocturne mock 1a), now data-driven.
 *
 * The big number is the latest graded simulation's overall (the app's 1-5 scale, same as the
 * scorecard Donut and the interviews table), labeled "Latest interview" with the window's average
 * beside it, so it isn't misread against the skill breakdown (a period average); the delta is the
 * change across the selected window, and the Sparkline plots the series. All of it comes from GET /api/dashboard, scoped to the
 * chosen round (+ optional job) and time window.
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
    const { series, latest, average, delta, count } = readiness;

    return (
        <SignalCard title="Readiness">
            {loading ? (
                <>
                    <div className="mt-1.5 flex items-end gap-2.5">
                        <Skeleton className="h-11 w-20" />
                        <Skeleton className="mb-1 h-3.5 w-32" />
                    </div>
                    <Skeleton className="mt-1.5 h-3 w-44" />
                    <Skeleton className="mt-2 h-[74px] w-full" />
                </>
            ) : latest === null ? (
                <p className="mt-2 text-[13px] text-neutral-400">
                    Complete a job interview in this round to see your readiness trend.
                </p>
            ) : (
                <>
                    <div className="mt-2 flex items-end gap-2.5">
                        <span className="font-heading text-[46px] leading-none">{formatScore(latest)}</span>
                        <span className="pb-2 text-[13px] text-neutral-400">/ 5</span>
                        {delta !== null && (
                            <span className="pb-2 text-[13px] text-accent-300">
                                {delta >= 0 ? "+" : ""}
                                {formatScore(delta)} over {count} interviews
                            </span>
                        )}
                    </div>
                    {/* The headline is ONE interview; the average matches the skill breakdown's period scope */}
                    <p className="mt-1.5 text-[12px] text-neutral-400">
                        Latest interview
                        {average !== null && count > 1 && (
                            <>
                                {" · "}
                                <span className="text-neutral-200">{formatScore(average)}</span> average this period
                            </>
                        )}
                    </p>
                    <div className="mt-2">
                        <Sparkline data={series} />
                    </div>
                </>
            )}
        </SignalCard>
    );
}
