/**
 * Skill breakdown card (Nocturne mock 1a) — one <ScoreBar> per rubric dimension, filled to its
 * average score across the selected role's graded interviews in the window (GET /api/dashboard). The
 * bar itself is shared with the interview detail page (see ScoreBar); this card only supplies the
 * data and marks the weakest dimension as the low bar.
 *
 * States inside the shared SignalCard shell: `loading` -> a column of shape-matching ScoreBarSkeleton
 * rows; no graded answers in the window -> an empty-state line; otherwise the bars.
 */
import SignalCard from "./SignalCard";
import ScoreBar from "./ScoreBar";
import ScoreBarSkeleton from "./ScoreBarSkeleton";
import type { SkillScore } from "../api";

// How many placeholder rows the skeleton shows — a typical rubric has ~4 dimensions.
const SKELETON_ROWS = 4;

export default function SkillBreakdownCard({
    skills,
    loading,
}: {
    skills: SkillScore[];
    loading?: boolean;
}) {
    // the weakest bar (lowest average) reads as the low bar; ties all get the treatment, which is fine.
    const weakest = skills.length ? Math.min(...skills.map((s) => s.average)) : null;

    return (
        <SignalCard title="Skill breakdown">
            {loading ? (
                <div className="mt-3 flex flex-col gap-[11px]">
                    {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                        <ScoreBarSkeleton key={i} />
                    ))}
                </div>
            ) : skills.length === 0 ? (
                <p className="mt-2 text-[13px] text-neutral-400">
                    No graded answers in this window yet.
                </p>
            ) : (
                <div className="mt-3 flex flex-col gap-[11px]">
                    {skills.map((s) => (
                        <ScoreBar
                            key={s.dimension}
                            label={s.dimension}
                            value={s.average}
                            weak={s.average === weakest}
                        />
                    ))}
                </div>
            )}
        </SignalCard>
    );
}
