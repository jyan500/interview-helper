/**
 * Readiness card — the signal panel's headline trend (Nocturne mock 1a), now data-driven.
 *
 * The big number is the latest graded simulation's overall (the app's 1-5 scale, same as the
 * scorecard Donut and the interviews table); the help tooltip in the corner says so and gives the
 * window's average, so it isn't misread against the skill breakdown (a period average). The delta is
 * the change across the selected window, and the Sparkline plots the series. All of it comes from GET /api/dashboard, scoped to the
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

    // The headline is ONE interview, while the skill breakdown is a period average, so the help
    // tooltip says so and gives the period average to compare (once there's more than one point).
    const help = (
        <>
            Your score on your most recent interview of this type, out of 5. The line tracks each
            interview in the selected period.
            {average !== null && count > 1 && (
                <>
                    {" "}Your average over the period is{" "}
                    <span className="text-ink">{formatScore(average)}</span>
                </>
            )}
        </>
    );

    return (
        <SignalCard title="Readiness" help={help}>
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
                    <div className="mt-2">
                        <Sparkline data={series} />
                    </div>
                </>
            )}
        </SignalCard>
    );
}
