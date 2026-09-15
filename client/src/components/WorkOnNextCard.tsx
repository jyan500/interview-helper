/**
 * Work on next card (Nocturne mock 1a) — a short numbered list of the most recent `improvement`
 * lines from the selected role's graded interviews (GET /api/dashboard), newest first. It's the
 * "what to fix next" prompt, capped server-side so it stays a nudge, not a backlog.
 *
 * States inside the shared SignalCard shell: `loading` -> shape-matching skeleton rows (an index box
 * beside two text lines, mirroring a real item); nothing to suggest yet -> an empty-state line;
 * otherwise the numbered list.
 *
 * The mock's "Drill these in 10 min" button is intentionally omitted — that flow isn't built, and a
 * dead button reads worse than no button. Add it back here when the drill feature lands.
 */
import SignalCard from "./SignalCard";
import { Skeleton } from "./Skeleton";

// Rows the skeleton shows — matches the server-side cap's typical length.
const SKELETON_ROWS = 3;

export default function WorkOnNextCard({
    items,
    loading,
}: {
    items: string[];
    loading?: boolean;
}) {
    return (
        <SignalCard title="Work on next">
            {loading ? (
                <div className="mt-3 flex flex-col gap-3">
                    {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                        <div key={i} className="flex gap-2.5">
                            <Skeleton className="h-3.5 w-5 flex-none" />
                            <div className="flex-1">
                                <Skeleton className="h-3.5 w-full" />
                                <Skeleton className="mt-1.5 h-3.5 w-2/3" />
                            </div>
                        </div>
                    ))}
                </div>
            ) : items.length === 0 ? (
                <p className="mt-2 text-[13px] text-neutral-400">
                    No suggestions yet — finish an interview to get targeted next steps.
                </p>
            ) : (
                <div className="mt-3 flex flex-col gap-3 text-[13.5px] leading-[1.4]">
                    {items.map((item, i) => (
                        <div key={i} className="flex gap-2.5">
                            <span className="font-heading text-[15px] text-accent-300">
                                {String(i + 1).padStart(2, "0")}
                            </span>
                            <span>{item}</span>
                        </div>
                    ))}
                </div>
            )}
        </SignalCard>
    );
}
