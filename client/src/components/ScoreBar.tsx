/**
 * ScoreBar — one labelled horizontal score bar (a rubric dimension name, its 1-5 value, and a track
 * filled to value/5). The SAME bar renders the interview detail page's criteria breakdown
 * (ScorecardPanel) and the dashboard's skill breakdown, so it lives here once instead of being
 * hand-written in both — a reworded fill or scale changes them together.
 *
 * `weak` swaps the fill to accent-300 for the dashboard's "this is your low bar" emphasis; the detail
 * page leaves it off, so every criterion reads in the same accent there. The outer gap BETWEEN bars
 * is the caller's (the two lists space differently) — this component owns only the bar itself.
 *
 * The matching loading placeholder lives beside it as <ScoreBarSkeleton> (its own file).
 */
import { formatScore } from "../helpers";

// The rubric scale's ceiling — a bar fills value/SCORE_MAX. Matches the 1-5 rubric everywhere else
// (rubrics.scale, the scorecard Donut's max).
const SCORE_MAX = 5;

export default function ScoreBar({
    label,
    value,
    weak = false,
}: {
    label: string;
    value: number;
    weak?: boolean;
}) {
    return (
        <div>
            <div className="flex justify-between text-[13.5px]">
                <span>{label}</span>
                <span className="text-neutral-300">{formatScore(value)}</span>
            </div>
            <div className="mt-[5px] h-1.5 rounded-[3px] bg-neutral-800">
                <div
                    className={"h-1.5 rounded-[3px] " + (weak ? "bg-accent-300" : "bg-accent")}
                    style={{ width: `${(value / SCORE_MAX) * 100}%` }}
                />
            </div>
        </div>
    );
}
