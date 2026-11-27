import { useState } from "react";
import LoadingDots from "../LoadingDots";
import type { AnswerMode, TranscriptLine } from "../../constants";

/* ══════════════════════════════════════════════════════════════════════════
   Right rail (shared) — question list (from the transcript) + scratchpad + footer
   ══════════════════════════════════════════════════════════════════════ */
export default function RightRail({
    mode,
    isResume,
    interviewerLines,
    scoring,
}: {
    mode: AnswerMode;
    isResume: boolean;
    interviewerLines: TranscriptLine[];
    scoring: boolean;
}) {
    // A private, local-only scratchpad (not persisted — deliberately, it's throwaway thinking space).
    const [scratch, setScratch] = useState("");

    // Scrolls on its own: the "This session" list grows every turn and must not stretch the page.
    return (
        <div className="hidden min-h-0 flex-col gap-[22px] overflow-y-auto border-l border-divider p-5 lg:flex">
            {/* This session — the interviewer turns asked so far, newest = current. No total: an
                interview's length isn't fixed (follow-ups are dynamic), so this just grows as we go. */}
            <div>
                <div className="kicker">This session</div>
                <div className="mt-2.5 flex flex-col gap-[9px] text-[13px]">
                    {interviewerLines.length === 0 ? (
                        <span className="text-neutral-400">{isResume ? "Resuming..." : "Waiting for the first question…"}</span>
                    ) : (
                        interviewerLines.map((q, i) => {
                            const isCurrent = i === interviewerLines.length - 1;
                            return (
                                <div key={q.id} className="flex gap-2.5">
                                    <span className={"w-4 font-heading " + (isCurrent ? "text-accent-300" : "")}>
                                        {String(i + 1).padStart(2, "0")}
                                    </span>
                                    <span className={isCurrent ? "[text-wrap:pretty]" : "text-neutral-400 [text-wrap:pretty]"}>
                                        {q.pending ? <LoadingDots/> : q.text}
                                    </span>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Scratchpad — real, editable, local to this browser tab */}
            <div data-tour="scratchpad">
                <div className="kicker">Scratchpad</div>
                <textarea
                    value={scratch}
                    onChange={(e) => setScratch(e.target.value)}
                    placeholder="Jot notes while you think…"
                    className="mt-2.5 min-h-[120px] w-full resize-none rounded-md border border-divider bg-transparent p-3 text-[13px] leading-[1.5] text-neutral-300 outline-none placeholder:text-neutral-500 focus:border-neutral-600"
                />
            </div>

            {/* Voice controls (mic + test meter, TTS engine, mode) now live in the header-gear Settings
                modal, so the rail's footer is just the text-mode grading note. */}
            {mode === "text" && (
                <div className="mt-auto text-[12.5px] leading-[1.5] text-neutral-400">
                    {scoring
                        ? "Grading your answers…"
                        : "Feedback and a score are generated when you end the session."}
                </div>
            )}
        </div>
    );
}
