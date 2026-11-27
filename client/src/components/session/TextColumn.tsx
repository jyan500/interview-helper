import { useEffect, useRef } from "react";
import { Microphone, TreeStructure } from "@phosphor-icons/react";
import Button from "../Button";
import LoadingDots from "../LoadingDots";
import MessageRow from "../MessageRow";
import type { TranscriptLine } from "../../constants";

/* ══════════════════════════════════════════════════════════════════════════
   Text mode — centre column (mock 2b), wired
   ══════════════════════════════════════════════════════════════════════ */
export default function TextColumn({
    transcript,
    draft,
    setDraft,
    waiting,
    answering,
    transcribing,
    coding,
    canSend,
    done,
    ended,
    onSend,
    onSwitch,
    onEnd,
}: {
    transcript: TranscriptLine[];
    draft: string;
    setDraft: (v: string) => void;
    waiting: boolean;
    answering: boolean;
    transcribing: boolean;
    coding: boolean; // a coding round: no word-count target, and the code goes with the answer
    canSend: boolean;
    done: boolean;
    ended: boolean;
    onSend: () => void;
    onSwitch: () => void;
    onEnd: () => void;
}) {
    // Keep the newest message in view as the transcript grows.
    const bottomRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [transcript.length, waiting]);

    const words = draft.trim() ? draft.trim().split(/\s+/).length : 0;

    return (
        <div className="flex min-h-0 flex-col">
            {/* Scrolling message list */}
            <div className="flex flex-1 justify-center overflow-y-auto py-[30px]">
                <div className="flex w-[720px] max-w-full flex-col gap-[22px] px-4">
                    {transcript
                        // Pending interviewer bubbles aren't shown as bubbles — the typing indicator below
                        // stands in for them until their text is revealed.
                        .filter((line) => !line.pending)
                        .map((line) => (
                            <MessageRow
                                key={line.id}
                                who={line.who}
                                kicker={line.who === "interviewer" ? "Interviewer" : "You"}
                                text={line.text}
                            >
                                {line.diagramUpdated && (
                                    <span className="tag tag-accent gap-1.5 self-start">
                                        <TreeStructure size={12} weight="regular" />
                                        Updated the diagram
                                    </span>
                                )}
                            </MessageRow>
                        ))}

                    {/* Typing indicator — while the answer is in flight or the interviewer's audio loads */}
                    {waiting && (
                        <div className="flex items-center gap-3 text-[13px] text-neutral-400">
                            <LoadingDots />
                            <span>Interviewer is typing</span>
                        </div>
                    )}
                    <div ref={bottomRef} />
                </div>
            </div>

            {/* Composer (fixed at bottom of the column). Retired once the bank is exhausted. */}
            <div className="flex justify-center border-t border-divider px-4 pb-5 pt-[18px]">
                <div className="flex w-[720px] max-w-full flex-col gap-3">
                    {done ? (
                        <p className="m-0 rounded-md border border-accent px-3.5 py-3 text-[15px] text-accent-300">
                            That's the last question. End the session to see your scorecard.
                        </p>
                    ) : (
                        <div className="flex min-h-[78px] flex-col justify-between rounded-md border border-accent px-3.5 py-3">
                            <textarea
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                // Enter sends, Shift+Enter makes a newline — matches the hint copy below.
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        onSend();
                                    }
                                }}
                                rows={2}
                                placeholder="Type your answer…"
                                className="m-0 w-full resize-none border-0 bg-transparent p-0 text-[15px] leading-[1.5] text-neutral-100 outline-none placeholder:text-neutral-500"
                            />
                            <div className="flex items-center justify-between text-[12.5px] text-neutral-400">
                                <span>Shift + Enter for a new line</span>
                                {/* a word target means nothing for a coding answer */}
                                {!coding && <span>{words} words · aim for 150–250</span>}
                            </div>
                        </div>
                    )}
                    <div className="flex items-center justify-between">
                        <div className="flex items-center rounded-md border border-divider">
                            <Button
                                variant="ghost"
                                className="flex items-center gap-2"
                                style={{ padding: "10px 16px" }}
                                onClick={onSwitch}
                                data-tour="switch-mode"
                            >
                                <Microphone size={16} weight="regular" />
                                Switch to voice
                            </Button>
                            <Button
                                variant="ghost"
                                className="border-l border-divider disabled:opacity-50"
                                style={{ padding: "10px 18px" }}
                                onClick={onEnd}
                                data-tour="end-session"
                                disabled={ended}
                            >
                                {ended ? "Ending…" : "End session"}
                            </Button>
                        </div>
                        {!done && (
                            <Button
                                variant="primary"
                                className="text-[15px] disabled:opacity-50"
                                style={{ padding: "11px 28px" }}
                                onClick={onSend}
                                data-tour="answer-button" // every tour's answer step (tour/steps.ts)
                                disabled={answering || transcribing || ended || !canSend}
                            >
                                {transcribing ? "Transcribing…" : answering ? "Sending…" : "Send answer"}
                            </Button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
