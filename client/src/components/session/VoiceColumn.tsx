import { Microphone, PencilSimple } from "@phosphor-icons/react";
import Button from "../Button";
import LoadingDots from "../LoadingDots";
import ParticipantCell from "./ParticipantCell";
import { micLabel } from "../../helpers";
import type { TranscriptLine } from "../../constants";

/* ══════════════════════════════════════════════════════════════════════════
   Voice mode — centre column (mock 2a), wired
   ══════════════════════════════════════════════════════════════════════ */
export default function VoiceColumn({
    compact,
    question,
    listening,
    userSpeaking,
    speaking,
    preparing,
    supported,
    noInput,
    done,
    ended,
    onToggleMic,
    onCheckMic,
    onSwitch,
    onEnd,
}: {
    // Beside the coding panel: half the width, so a smaller question and tighter gutters.
    compact: boolean;
    question?: TranscriptLine;
    listening: boolean;
    userSpeaking: boolean;
    speaking: boolean;
    preparing: boolean;
    supported: boolean;
    noInput: boolean;
    done: boolean;
    ended: boolean;
    onToggleMic: () => void;
    onCheckMic: () => void;
    onSwitch: () => void;
    onEnd: () => void;
}) {
    // "thinking" is just the single flow flag now: it already spans transcription, the answer
    // round-trip, and TTS synthesis, ending the instant the next question is revealed. One source of
    // truth, so there's no frame where it reads false while a turn is still being prepared.
    const thinking = preparing;
    // justify-center-SAFE, not plain center: in a scrolling column, plain centering pushes overflow out
    // of BOTH ends, and the top half of a long question can't be scrolled back to. Safe centering centres
    // while it fits and falls back to top-aligned (scrollable) when it doesn't.
    return (
        <div
            className={
                "flex min-h-0 flex-col items-center justify-center-safe overflow-y-auto py-8 " +
                (compact ? "gap-7 px-8" : "gap-[34px] px-[60px]")
            }
        >
            {/* Current question — the latest interviewer turn, or "thinking…" while we wait on the next */}
            <div className="max-w-[680px] text-center">
                <div className="kicker">{thinking ? "Interviewer is thinking" : "Interviewer asked"}</div>
                <p
                    className={
                        "mt-2 whitespace-pre-wrap font-heading font-medium [text-wrap:pretty] " +
                        (compact ? "text-[22px] leading-[1.3]" : "text-[31px] leading-[1.18]")
                    }
                >
                    {thinking || !question?.text ? <LoadingDots className="text-[26px]" /> : question.text}
                </p>
            </div>

            {/* Two participant cells — each pulses its icon while that participant is actually making
                sound: "You" on real mic input (hark), the interviewer while its TTS plays. */}
            <div className="grid w-[640px] max-w-full grid-cols-2 rounded-md border border-divider">
                <ParticipantCell
                    name="You"
                    role="Candidate"
                    speaking={userSpeaking}
                    className="border-r border-divider"
                    // The "You" cell's reserved footer slot (below the Speaking/Listening tag) holds the
                    // "check your mic" prompt — see ParticipantCell. The slot is ALWAYS present in BOTH
                    // cells, so the prompt appearing/disappearing changes no height and triggers no
                    // page-scrollbar layout shift. It shows when NO sound was ever heard (wrong/dead mic,
                    // or never started), amber (gap tokens) to read as attention; its button opens
                    // Settings to fix the input.
                    footer={
                        noInput ? (
                            <div className="flex items-center gap-2.5 whitespace-nowrap rounded-md border border-gap-border bg-gap-bg px-3 py-1.5 text-[12.5px] text-gap">
                                <span>Still there?</span>
                                <Button variant="ghost" className="text-[12.5px] text-gap" onClick={onCheckMic}>
                                    Check your mic
                                </Button>
                            </div>
                        ) : null
                    }
                />
                <ParticipantCell ai name="Interviewer" role="AI · Staff engineer" speaking={speaking} />
            </div>

            {/* Control cluster — one bordered row, no gaps. Once the bank is exhausted (done) the mic is
                retired and only "End session" remains. */}
            <div className="flex items-center rounded-md border border-divider">
                {supported && !done && (
                    <Button
                        variant="primary"
                        className="flex items-center gap-[9px] text-[15px] disabled:opacity-50"
                        style={{ padding: "13px 30px" }}
                        onClick={onToggleMic}
                        data-tour="answer-button" // every tour's answer step (tour/steps.ts)
                        // Locked while the AI is speaking, while a turn is being prepared
                        // (transcribe/answer/TTS), or once ended — so no new recording starts over any of those.
                        disabled={speaking || preparing || ended}
                    >
                        <Microphone size={17} weight="regular" />
                        {micLabel(listening)}
                    </Button>
                )}
                <Button
                    variant="ghost"
                    className="flex items-center gap-2 border-l border-divider"
                    style={{ padding: "13px 18px" }}
                    onClick={onSwitch}
                    data-tour="switch-mode"
                >
                    <PencilSimple size={16} weight="regular" />
                    Switch to text
                </Button>
                <Button
                    variant="ghost"
                    className="border-l border-divider disabled:opacity-50"
                    style={{ padding: "13px 20px" }}
                    onClick={onEnd}
                    data-tour="end-session"
                    disabled={ended}
                >
                    {ended ? "Ending…" : "End session"}
                </Button>
            </div>

            {done && (
                <p className="m-0 text-[13px] text-accent-300">
                    That's the last question. End the session to see your scorecard.
                </p>
            )}

            <p className="m-0 text-[12.5px] text-neutral-400">
                Responses are generated by AI and may be wrong. Nothing is shared outside your account.
            </p>
        </div>
    );
}
