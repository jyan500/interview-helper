/**
 * Loading skeleton for the interview detail page — mirrors its two-column layout so the page holds
 * its shape while GET /api/interviews/{id} is in flight and doesn't reflow when the data lands.
 *
 *   Left column  — a heading bar + a few transcript-row placeholders (avatar square + message bubble).
 *   Right column — a square block (where the overall score + donut go) over a tall rectangle (the
 *                  criteria bars + per-question breakdown).
 */
import AppNav from "./AppNav";
import { SHIMMER } from "../constants";

export default function InterviewDetailSkeleton() {
    return (
        <div className="min-h-screen bg-bg text-ink">
            <AppNav />

            <div className="mx-auto max-w-[1280px]">
                {/* Header block */}
                <div className="border-b border-divider px-7 pb-5 pt-[22px]">
                    <div className={"h-3.5 w-52 " + SHIMMER} />
                    <div className={"mt-3 h-7 w-72 " + SHIMMER} />
                    <div className={"mt-3 h-3.5 w-28 " + SHIMMER} />
                </div>

                {/* Body — same grid as the real page */}
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px]">
                    {/* Transcript column — heading + a few message-row placeholders */}
                    <div className="flex flex-col gap-[22px] border-divider px-7 pb-8 pt-6 lg:border-r">
                        <div className={"h-5 w-28 " + SHIMMER} />
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="flex gap-3">
                                <div className={"h-[30px] w-[30px] flex-none rounded-md " + SHIMMER} />
                                <div className={"h-[78px] w-full max-w-[600px] rounded-md " + SHIMMER} />
                            </div>
                        ))}
                    </div>

                    {/* Scorecard column — a square (overall + donut) over a tall rectangle (breakdown) */}
                    <div className="flex flex-col gap-[22px] px-6 pb-8 pt-6">
                        <div className={"aspect-square w-full rounded-md " + SHIMMER} />
                        <div className={"h-[460px] w-full rounded-md " + SHIMMER} />
                    </div>
                </div>
            </div>
        </div>
    );
}
