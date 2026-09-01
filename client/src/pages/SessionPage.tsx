/**
 * Interview session — Nocturne mocks 2a (voice) and 2b (text). ONE route, two modes,
 * switchable mid-session. Full-viewport height.
 *
 * DESIGN/LAYOUT ONLY. `mode` is real local state (so the voice⇄text switch works as a
 * layout toggle); everything else is static mock content. The header, progress and
 * right rail are shared chrome; only the centre column changes with the mode.
 * Production wiring points are flagged `// TODO(wire)`.
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import { Gear, Microphone, PencilSimple, Sparkle, ThumbsUp, ThumbsDown } from "@phosphor-icons/react";
import MessageRow from "../components/MessageRow";

type Mode = "voice" | "text";

const TOTAL = 6;
const CURRENT = 3; // question 3 of 6

// The shared "This session" question list in the right rail.
const SESSION_QUESTIONS = [
    { n: "01", text: "Tell me about a service you own end to end.", state: "done" },
    { n: "02", text: "A deploy takes the API down. First five minutes?", state: "done" },
    { n: "03", text: "Read-heavy catalog at ten times traffic.", state: "current" },
    { n: "04", text: "Locked until answered", state: "locked" },
] as const;

export default function SessionPage() {
    const navigate = useNavigate();
    const [mode, setMode] = useState<Mode>("voice");

    return (
        <div className="flex h-screen flex-col bg-bg text-ink">
            {/* ── Session header (shared) ─────────────────────────────────────── */}
            <div className="flex h-[54px] items-center justify-between border-b border-divider px-6">
                <div className="flex items-center gap-3.5">
                    <span className="font-heading text-[17px] font-medium tracking-[-0.01em]">
                        Backend Engineer · Mid
                    </span>
                    <span className="tag tag-outline capitalize">{mode}</span>
                </div>
                <div className="flex items-center gap-[18px] text-[13px] text-neutral-300">
                    <span>
                        Question {CURRENT} of {TOTAL}
                    </span>
                    {/* progress ticks */}
                    <div className="flex gap-1">
                        {Array.from({ length: TOTAL }).map((_, i) => (
                            <span
                                key={i}
                                className={
                                    "h-[3px] w-[26px] rounded-[2px] " +
                                    (i < CURRENT ? "bg-accent" : "bg-neutral-800")
                                }
                            />
                        ))}
                    </div>
                    <span className="font-heading text-[18px] text-ink">08:42</span>
                    <button className="btn btn-ghost btn-icon" aria-label="Settings">
                        <Gear size={17} weight="regular" />
                    </button>
                </div>
            </div>

            {/* ── Body: centre column + right rail ────────────────────────────── */}
            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_300px]">
                {mode === "voice" ? (
                    <VoiceColumn onSwitch={() => setMode("text")} onEnd={() => navigate("/interviews/1")} />
                ) : (
                    <TextColumn onSwitch={() => setMode("voice")} onEnd={() => navigate("/interviews/1")} />
                )}

                <RightRail mode={mode} />
            </div>
        </div>
    );
}

/* ══════════════════════════════════════════════════════════════════════════
   Voice mode — centre column (mock 2a)
   ══════════════════════════════════════════════════════════════════════ */
function VoiceColumn({ onSwitch, onEnd }: { onSwitch: () => void; onEnd: () => void }) {
    return (
        <div className="flex flex-col items-center justify-center gap-[34px] px-[60px] py-8">
            {/* Current question */}
            <div className="max-w-[680px] text-center">
                <div className="kicker">Interviewer asked</div>
                <p className="mt-2 font-heading text-[31px] font-medium leading-[1.18] [text-wrap:pretty]">
                    Walk me through how you'd keep a read-heavy product catalog fast as traffic grows tenfold.
                </p>
            </div>

            {/* Two participant cells */}
            <div className="grid w-[600px] max-w-full grid-cols-2 rounded-md border border-divider">
                <ParticipantCell
                    initials="JY"
                    name="You"
                    role="Candidate"
                    speaking
                    className="border-r border-divider"
                />
                <ParticipantCell ai name="Interviewer" role="AI · Staff engineer" speaking={false} />
            </div>

            {/* Control cluster — one bordered row, no gaps */}
            <div className="flex items-center rounded-md border border-divider">
                <button
                    className="btn btn-primary flex items-center gap-[9px] text-[15px]"
                    style={{ padding: "13px 30px" }}
                >
                    <Microphone size={17} weight="regular" />
                    Speaking — tap to pause
                </button>
                <button
                    className="btn btn-ghost flex items-center gap-2 border-l border-divider"
                    style={{ padding: "13px 18px" }}
                    onClick={onSwitch}
                >
                    <PencilSimple size={16} weight="regular" />
                    Switch to text
                </button>
                <button
                    className="btn btn-ghost border-l border-divider"
                    style={{ padding: "13px 20px" }}
                    onClick={onEnd}
                >
                    End session
                </button>
            </div>

            <p className="m-0 text-[12.5px] text-neutral-400">
                Responses are generated by AI and may be wrong. Nothing is shared outside your account.
            </p>
        </div>
    );
}

function ParticipantCell({
    initials,
    ai,
    name,
    role,
    speaking,
    className = "",
}: {
    initials?: string;
    ai?: boolean;
    name: string;
    role: string;
    speaking: boolean;
    className?: string;
}) {
    return (
        <div className={"flex flex-col items-center gap-3 px-[22px] py-[26px] " + className}>
            <div
                className={
                    "flex h-16 w-16 items-center justify-center rounded-md border " +
                    (ai ? "border-accent text-accent-300" : "border-neutral-700 text-neutral-400")
                }
            >
                {ai ? <Sparkle size={26} weight="regular" /> : <span className="font-heading text-[22px]">{initials}</span>}
            </div>
            <div className="text-center">
                <div className="font-heading text-[19px]">{name}</div>
                <div className="text-[12.5px] text-neutral-400">{role}</div>
            </div>
            <Waveform speaking={speaking} />
            {speaking ? (
                <span className="tag tag-accent">Speaking · 0:38</span>
            ) : (
                <span className="tag tag-neutral">Listening</span>
            )}
        </div>
    );
}

// The 180×34 waveform: 20 varying accent strokes when speaking, a flat neutral row when not.
function Waveform({ speaking }: { speaking: boolean }) {
    const heights = [0, 5, 11, 7, 14, 8, 3, 12, 6, 9, 2, 13, 5, 10, 4, 8, 1, 6, 2, 0];
    return (
        <svg viewBox="0 0 200 34" className="h-[34px] w-[180px]">
            <g stroke={speaking ? "var(--color-accent)" : "var(--color-neutral-800)"} strokeWidth="2">
                {speaking
                    ? heights.map((h, i) => (
                          <line key={i} x1={6 + i * 10} y1={17 - h} x2={6 + i * 10} y2={17 + h} />
                      ))
                    : Array.from({ length: 10 }).map((_, i) => (
                          <line key={i} x1={6 + i * 20} y1={17} x2={6 + i * 20} y2={17} />
                      ))}
            </g>
        </svg>
    );
}

/* ══════════════════════════════════════════════════════════════════════════
   Text mode — centre column (mock 2b)
   ══════════════════════════════════════════════════════════════════════ */
function TextColumn({ onSwitch, onEnd }: { onSwitch: () => void; onEnd: () => void }) {
    return (
        <div className="flex min-h-0 flex-col">
            {/* Scrolling message list */}
            <div className="flex flex-1 justify-center overflow-y-auto py-[30px]">
                <div className="flex w-[720px] max-w-full flex-col gap-[22px] px-4">
                    <MessageRow
                        who="interviewer"
                        kicker="Interviewer"
                        text="Tell me about a service you owned end to end — what it did, and what you were responsible for when it broke."
                    />
                    <MessageRow
                        who="you"
                        kicker="You · 1m 20s"
                        text="I owned the payments reconciliation service at Fintrail — a Go service that matched settlement files against our ledger nightly. On-call was mine, so when a file arrived malformed at 3am I was the one paging into it."
                    />
                    <MessageRow
                        who="interviewer"
                        kicker="Interviewer"
                        text="Good. Take the 3am case: the file is malformed and the ledger is half-written. What do you do in the first five minutes, and what do you tell the team at hour one?"
                    >
                        {/* Message actions under the interviewer bubble */}
                        <div className="flex items-center gap-3.5 text-[12.5px] text-neutral-400">
                            <button className="btn btn-ghost btn-icon" aria-label="Helpful">
                                <ThumbsUp size={15} weight="regular" />
                            </button>
                            <button className="btn btn-ghost btn-icon" aria-label="Not helpful">
                                <ThumbsDown size={15} weight="regular" />
                            </button>
                            <span>Rephrase</span>
                            <span>Hint</span>
                        </div>
                    </MessageRow>

                    {/* Typing indicator */}
                    <div className="flex items-center gap-3 text-[13px] text-neutral-400">
                        <span className="h-[5px] w-[5px] bg-accent" />
                        <span className="h-[5px] w-[5px] bg-accent-400" />
                        <span className="h-[5px] w-[5px] bg-accent-300" />
                        <span>Interviewer is typing</span>
                    </div>
                </div>
            </div>

            {/* Composer (fixed at bottom of the column) */}
            <div className="flex justify-center border-t border-divider px-4 pb-5 pt-[18px]">
                <div className="flex w-[720px] max-w-full flex-col gap-3">
                    <div className="flex min-h-[78px] flex-col justify-between rounded-md border border-accent px-3.5 py-3">
                        <p className="m-0 text-[15px] leading-[1.5] text-neutral-300">
                            First five minutes I'd stop the job and freeze writes so the ledger doesn't drift further,
                        </p>
                        <div className="flex items-center justify-between text-[12.5px] text-neutral-400">
                            <span>Shift + Enter for a new line</span>
                            <span>124 words · aim for 150–250</span>
                        </div>
                    </div>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center rounded-md border border-divider">
                            <button
                                className="btn btn-ghost flex items-center gap-2"
                                style={{ padding: "10px 16px" }}
                                onClick={onSwitch}
                            >
                                <Microphone size={16} weight="regular" />
                                Switch to voice
                            </button>
                            <button
                                className="btn btn-ghost border-l border-divider"
                                style={{ padding: "10px 18px" }}
                                onClick={onEnd}
                            >
                                End session
                            </button>
                        </div>
                        {/* TODO(wire): POST /api/answer */}
                        <button className="btn btn-primary text-[15px]" style={{ padding: "11px 28px" }}>
                            Send answer
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ══════════════════════════════════════════════════════════════════════════
   Right rail (shared) — question list + scratchpad + mode-specific footer
   ══════════════════════════════════════════════════════════════════════ */
function RightRail({ mode }: { mode: Mode }) {
    return (
        <div className="hidden flex-col gap-[22px] border-l border-divider p-5 lg:flex">
            {/* This session */}
            <div>
                <div className="kicker">This session</div>
                <div className="mt-2.5 flex flex-col gap-[9px] text-[13px]">
                    {SESSION_QUESTIONS.map((q) => (
                        <div
                            key={q.n}
                            className={"flex gap-2.5 " + (q.state === "locked" ? "opacity-45" : "")}
                        >
                            <span
                                className={
                                    "w-4 font-heading " + (q.state === "locked" ? "" : "text-accent-300")
                                }
                            >
                                {q.n}
                            </span>
                            <span className={q.state === "done" ? "text-neutral-400 [text-wrap:pretty]" : "[text-wrap:pretty]"}>
                                {q.text}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Scratchpad */}
            <div>
                <div className="kicker">Scratchpad</div>
                <div className="mt-2.5 min-h-[120px] rounded-md border border-divider p-3 text-[13px] leading-[1.5] text-neutral-300">
                    read replicas → cache → CDN
                    <br />
                    invalidation?
                </div>
            </div>

            {/* Mode-specific footer, pinned to the bottom */}
            {mode === "voice" ? (
                <div className="mt-auto">
                    <div className="kicker">Audio</div>
                    <div className="mt-2 flex items-center gap-2 text-[13px] text-neutral-300">
                        <span className="h-[7px] w-[7px] bg-accent" />
                        MacBook Pro Microphone
                    </div>
                    <button className="btn btn-ghost pl-0 text-[13px]">Adjust audio settings</button>
                </div>
            ) : (
                <div className="mt-auto text-[12.5px] leading-[1.5] text-neutral-400">
                    Feedback and a score are generated when you end the session.
                </div>
            )}
        </div>
    );
}
