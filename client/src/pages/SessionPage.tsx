/**
 * Interview session — Nocturne mocks 2a (voice) and 2b (text), NOW WIRED. ONE route, two
 * modes, switchable mid-session. Full-viewport height.
 *
 * This is the new home of the interview loop that used to live in App.tsx (the /interview-legacy
 * screen). The voice logic (useSmartVoiceTurn + useSpeak), the RTK Query mutations
 * (submitAnswer / getScorecard) and the two turn-taking effects moved here verbatim; the design's
 * mock content is replaced by the real transcript/draft/voice state. What is NOT here is the
 * KICKOFF: /api/interview is fired by the producer (Dashboard "Start interview" / Interviews
 * "New interview"), which then navigates here with the fresh interview in route state.
 *
 * ACCESS IS GUARDED BY SessionLayout (the parent layout route): by the time this renders, a valid
 * interview is guaranteed and arrives via useSessionNav() — no missing-interview case to defend
 * against here. See SessionLayout.tsx for guard #1 (no interview -> redirect).
 *
 * GUARD #2 — NO RE-ENTERING A FINISHED SESSION — lives here: ending the interview grades it and
 * navigates to the detail view with { replace: true }, dropping /session out of history so the back
 * button can't return to it. The backend is the real gate (it 409s an answer to a finished
 * interview); this is the client-side half so the dead screen is never shown at all.
 *
 * NO QUESTION COUNTER, deliberately: an interview has no fixed length — the interviewer may probe
 * with follow-ups (or not) depending on the answer, so "question N of M" isn't knowable ahead of
 * time. The header shows elapsed time only; the right rail lists the turns actually asked so far.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Gear, Microphone, PencilSimple, SpeakerHigh, Sparkle } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import MessageRow from "../components/MessageRow";
import LoadingDots from "../components/LoadingDots";
import SettingsModal from "../components/SettingsModal";
import { useAuth } from "../auth/AuthProvider";
import { useGetScorecardMutation, useSubmitAnswerMutation } from "../api";
import { useSessionNav } from "./SessionLayout";
import { initialsFrom, loadStoredMicDeviceId, saveStoredMicDeviceId } from "../helpers";
import { useAudioInputDevices, useElapsedClock, useNoInputPrompt, useSpeaking } from "../hooks";
import {
    pickPreferredVoice,
    setVoicePrefs,
    useSmartVoiceTurn,
    useSpeak,
    useVoices,
    type TtsEngine,
    type TurnMode,
} from "../voice/speech";

type Mode = "voice" | "text";

// A visible transcript line. `id` is a STABLE key so a specific interviewer bubble can be revealed
// later by id (race-safe even if other lines were appended meanwhile); `pending` = an interviewer
// turn whose audio is still synthesizing — we withhold the real text until useSpeak's onReady fires
// so text + voice land together. Same shape App.tsx used.
type Line = { id: number; who: "interviewer" | "you"; text: string; pending?: boolean };

// The microphone picker options (react-select shape). value "" is the system-default sentinel; a
// real value is a MediaDeviceInfo.deviceId. Labels are blank until mic permission is granted, so we
// fall back to "Microphone N" until the meter/first recording populates the real device names.
type MicOption = { value: string; label: string };
const DEFAULT_MIC_OPTION: MicOption = { value: "", label: "System default" };

/* ══════════════════════════════════════════════════════════════════════════
   The running interview — all the state + loop lives here. A valid interview is
   guaranteed by SessionLayout and read via useSessionNav().
   ══════════════════════════════════════════════════════════════════════ */
export default function SessionPage() {
    const navigate = useNavigate();
    const { session } = useAuth();
    const nav = useSessionNav();

    // interviewId is a stable guard param (it never changes for this mounted session), so we read it
    // once off nav rather than threading nav.interviewId through every handler.
    const interviewId = nav.interviewId;

    const [mode, setMode] = useState<Mode>("voice");
    const [transcript, setTranscript] = useState<Line[]>([]);
    const [draft, setDraft] = useState("");
    // done = the client-driven loop exhausted the bank (submitAnswer told us). ended = we've kicked
    // off grading + navigation away, used to freeze the UI so nothing double-fires.
    const [done, setDone] = useState(false);
    const [ended, setEnded] = useState(false);

    // THE ONE "interviewer is preparing the next turn" flag. It owns the WHOLE pipeline as a single
    // span — set true at the start of a turn (the candidate finishing their answer, or the initial
    // seed) and cleared exactly once when the next question is revealed (revealLine, from speak()'s
    // onReady = the moment its TTS begins and the text shows). This deliberately REPLACES OR-ing
    // transcribing/answering/pending together for the "thinking" indicator: those flags flip at
    // different instants, leaving one-render gaps where all read false and the previous question
    // flashed. A single latch set-at-start / cleared-at-reveal has no such gap by construction.
    const [preparing, setPreparing] = useState(false);

    // The RTK Query mutations — the only two the in-session loop needs. startInterview already ran
    // on the producer; the scorecard is fetched once, on end.
    const [submitAnswer, { isLoading: answering }] = useSubmitAnswerMutation();
    const [getScorecard, { isLoading: scoring }] = useGetScorecardMutation();

    // Which TTS engine speaks the interviewer's turns. "openai" = neural (spends tokens),
    // "browser" = free/robotic (handy for debugging without burning credit). useSpeak(engine)
    // dispatches; the picker in the right rail flips it, mid-session is fine.
    const [ttsEngine, setTtsEngine] = useState<TtsEngine>("browser");
    const { speak, speaking } = useSpeak(ttsEngine);

    // Smart voice turn-taking, exactly as App.tsx drove it. "manual" = tap to start/stop;
    // "smart" = VAD notices silence -> "still there?" countdown -> auto stop+submit, and the mic
    // auto-opens after the AI finishes speaking (the edge effect below). onFinalTranscript is the
    // COMBINED stop+send: the hook hands us the Whisper text and we submit it like a typed answer.
    const [voiceMode, setVoiceMode] = useState<TurnMode>("manual");

    // Which microphone to capture from. "" = system default; a real deviceId pins that exact mic —
    // the picker exists because a wrong default mic silently recorded nothing on Firefox. Threaded
    // into useSmartVoiceTurn so BOTH the recorder and the smart-mode VAD open the same device.
    //
    // SEEDED FROM localStorage so a mic chosen in a previous session is the DEFAULT this one opens with,
    // rather than only taking effect after a turn passes. handleChangeMic writes every change back.
    const { devices: micDevices, refresh: refreshMics } = useAudioInputDevices();
    const [micDeviceId, setMicDeviceId] = useState<string>(loadStoredMicDeviceId);
    function handleChangeMic(id: string) {
        setMicDeviceId(id);
        saveStoredMicDeviceId(id); // persist so it's the default next session too
    }

    // The in-session Settings modal (behind the header gear): mic + live test meter, TTS engine, and
    // the voice/text mode toggle. Open state only — the settings themselves live in the state above.
    const [settingsOpen, setSettingsOpen] = useState(false);

    const { supported, listening, confirming, countdownMs, transcribing, stream, start, stop, keepListening } =
        useSmartVoiceTurn({
            mode: voiceMode,
            deviceId: micDeviceId || null,
            onFinalTranscript: (text) => handleSend(text),
            // Answer ended (mic stopped) -> raise the flag NOW, before transcription, so the "…" holds
            // through the whole voice pipeline. handleSend releases it (empty misfire) or the reveal does.
            onCaptureStopped: () => setPreparing(true),
        });

    // Is the candidate actually making sound right now? hark watches the live mic stream (null when
    // not recording -> false). Drives the "You" cell's pulsing mic icon — the real "you're speaking"
    // signal, unlike `listening` which is just "the mic is armed". See useSpeaking.
    const userSpeaking = useSpeaking(stream);

    // The "check your mic" watch: the mic is armed but NO sound is coming through it (a wrong/dead mic,
    // or the candidate never started). Drives a distinct prompt from the smart-mode "still there?"
    // countdown — that one ends a turn AFTER speech; this one fires when nothing was ever heard, in BOTH
    // modes. It disarms the instant any sound registers (userSpeaking), so a thinking pause never trips
    // it and, once the candidate has spoken, it stays quiet for the rest of the recording. See
    // useNoInputPrompt. `dismissNoInput` hides it when they head to Settings via the prompt's button.
    const { noInput, dismiss: dismissNoInput } = useNoInputPrompt(listening, userSpeaking);
    // The prompt's action: clear it and open Settings (mic picker + live test meter) so they can fix the
    // input. Changing the mic there re-opens capture on the new device mid-turn (see useSmartVoiceTurn).
    function handleCheckMic() {
        dismissNoInput();
        setSettingsOpen(true);
    }

    // Device labels are blank until mic permission is granted; the first recording grants it, so
    // re-enumerate when a stream opens to swap the generic "Microphone N" for real device names.
    useEffect(() => {
        if (stream) refreshMics();
    }, [stream, refreshMics]);

    // Browser-voice auto-pick (only matters for the "browser" engine, harmless otherwise): grab the
    // best system voice the moment the async list loads and push it into speak()'s shared prefs.
    const voices = useVoices();
    const [selectedVoiceURI, setSelectedVoiceURI] = useState<string | null>(null);
    useEffect(() => {
        if (selectedVoiceURI !== null || voices.length === 0) return;
        const preferred = pickPreferredVoice(voices);
        if (preferred) {
            setSelectedVoiceURI(preferred.voiceURI);
            setVoicePrefs({ voiceURI: preferred.voiceURI });
        }
    }, [voices, selectedVoiceURI]);

    // Stable per-line id (a ref counter, not state — it never renders). Lets revealLine() target the
    // exact "thinking…" bubble by id even if the user sends again before its audio starts.
    const lineIdRef = useRef(0);
    function nextId() {
        lineIdRef.current += 1;
        return lineIdRef.current;
    }
    // Swap a pending interviewer bubble's placeholder for the real text — called from speak()'s
    // onReady, i.e. exactly when audio begins. Matches by id so it hits the right bubble. This is also
    // the SINGLE place `preparing` is cleared on the happy path: the interviewer's turn is now on
    // screen and audible, so the flow is over.
    function revealLine(id: number, text: string) {
        setTranscript((t) => t.map((l) => (l.id === id ? { ...l, text, pending: false } : l)));
        setPreparing(false);
    }

    // Seed the first interviewer turn ONCE from the producer's firstMessage, and speak it. Mirrors
    // App.onStart's tail: a "thinking…" bubble now, revealed the instant the voice is ready. (Autoplay
    // may be blocked because the click that allowed it happened before the route change; if so onReady
    // still fires immediately and the text just reveals without sound — same graceful path as a synth
    // failure.) A ref guards against StrictMode's double-invoke in dev.
    const seededRef = useRef(false);
    useEffect(() => {
        if (seededRef.current) return;
        seededRef.current = true;
        const id = nextId();
        setPreparing(true); // hold "…" until the first question's TTS is ready (revealLine clears it)
        setTranscript([{ id, who: "interviewer", text: "", pending: true }]);
        speak(nav.firstMessage, () => revealLine(id, nav.firstMessage));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // send the candidate's answer (POST /api/answer) — one iteration of the loop. `textOverride` lets
    // the VOICE path submit the Whisper transcript directly (the hook calls us before `draft` would
    // have updated); typed answers call handleSend() with no arg and fall back to `draft`.
    async function handleSend(textOverride?: string) {
        const text = (textOverride ?? draft).trim();
        // Nothing to send: a pure-silence voice misfire (onCaptureStopped already raised `preparing`),
        // or a terminal state. Release the flag so the "…" doesn't hang, and bail without POSTing.
        if (!interviewId || !text || done || ended) {
            setPreparing(false);
            return;
        }
        setPreparing(true); // typed-answer path starts the flow here (voice already raised it on capture-stop)
        // Append the answer AND the interviewer's pending "thinking…" bubble in ONE update, UP FRONT
        // (not after submitAnswer resolves). Keeping the pending line present for the whole request means
        // there's never a render where `answering` has flipped false but the pending line isn't there yet
        // — that gap briefly unhid the PREVIOUS question ("flash → back to thinking → real question").
        const youId = nextId();
        const pendingId = nextId();
        setTranscript((t) => [
            ...t,
            { id: youId, who: "you", text },
            { id: pendingId, who: "interviewer", text: "", pending: true },
        ]);
        setDraft("");
        let res;
        try {
            res = await submitAnswer({ interview_id: interviewId, text }).unwrap();
        } catch (e) {
            // Surface the failure IN the pending bubble — don't leave it "thinking" forever, and don't
            // add a second interviewer line. (A 409 here would mean the interview finished under us —
            // rare, since we gate on `done`, but honest to show.)
            console.error(e);
            revealLine(pendingId, "Sorry — I couldn't record that. Try again.");
            return;
        }
        // Reveal the pending bubble's text in sync with the voice via onReady.
        speak(res.message, () => revealLine(pendingId, res.message));
        if (res.done) setDone(true);
    }

    // End the interview: grade what's recorded (POST /api/scorecard) then leave for the detail view.
    // `replace: true` is guard #2 — it drops /session from history so the finished session can't be
    // returned to. We navigate even if grading errors (the detail page can show it ungraded); `ended`
    // freezes the controls the moment this starts so a double-tap can't double-grade.
    async function handleEnd() {
        if (!interviewId || ended) return;
        setEnded(true);
        try {
            await getScorecard({ interview_id: interviewId }).unwrap();
        } catch (e) {
            console.error(e);
        }
        navigate(`/interviews/${interviewId}`, { replace: true });
    }

    // ── Smart-mode: open the mic ONLY on the AI-finished-speaking EDGE ───────────────────────────
    // Trigger on the `speaking` true->false EDGE (not merely "not speaking"): there's a brief gap
    // between an answer submitting and TTS starting where a level check would fire and record over the
    // AI's turn. prevSpeakingRef remembers last render's value so we only act once the AI has FINISHED.
    const prevSpeakingRef = useRef(false);
    useEffect(() => {
        const wasSpeaking = prevSpeakingRef.current;
        prevSpeakingRef.current = speaking;
        if (voiceMode !== "smart" || !interviewId || done || ended) return;
        if (wasSpeaking && !speaking && !listening && !confirming && !transcribing && !answering) {
            start();
        }
    }, [voiceMode, speaking, interviewId, done, ended, listening, confirming, transcribing, answering, start]);

    // ── "Still there?" — any keypress keeps the turn open during the countdown ───────────────────
    useEffect(() => {
        if (!confirming) return;
        const onKey = () => keepListening();
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [confirming, keepListening]);

    // ── Derived view state ───────────────────────────────────────────────────────────────────────
    // Interviewer turns asked so far, oldest-first — drives the right-rail list and the current
    // question shown in voice mode. No count/total is derived from it (see the header note).
    const interviewerLines = useMemo(() => transcript.filter((l) => l.who === "interviewer"), [transcript]);
    const currentQuestion = interviewerLines[interviewerLines.length - 1];

    // A real elapsed-time clock (replaces the mock "08:42"), started at mount — see useElapsedClock.
    const clock = useElapsedClock();

    const initials = initialsFrom(session?.user?.user_metadata?.display_name, session?.user?.email);

    // System default first, then one option per detected mic (real label once permission lands).
    const micOptions: MicOption[] = useMemo(
        () => [
            DEFAULT_MIC_OPTION,
            ...micDevices.map((d, i) => ({ value: d.deviceId, label: d.label || `Microphone ${i + 1}` })),
        ],
        [micDevices],
    );

    return (
        <div className="flex h-screen flex-col bg-bg text-ink">
            {/* ── Session header (shared) ─────────────────────────────────────── */}
            <div className="flex h-[54px] items-center justify-between border-b border-divider px-6">
                <div className="flex items-center gap-3.5">
                    <span className="font-heading text-[17px] font-medium tracking-[-0.01em]">
                        {nav.role} · {nav.level}
                    </span>
                    <span className="tag tag-outline capitalize">{mode}</span>
                </div>
                <div className="flex items-center gap-[18px] text-[13px] text-neutral-300">
                    <span className="font-heading text-[18px] text-ink">{clock}</span>
                    <button
                        className="btn btn-ghost btn-icon"
                        aria-label="Settings"
                        onClick={() => setSettingsOpen(true)}
                    >
                        <Gear size={17} weight="regular" />
                    </button>
                </div>
            </div>

            {/* ── Body: centre column + right rail ────────────────────────────── */}
            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_300px]">
                {mode === "voice" ? (
                    <VoiceColumn
                        initials={initials}
                        question={currentQuestion}
                        listening={listening}
                        userSpeaking={userSpeaking}
                        speaking={speaking}
                        // The single flow flag (mic-stop -> transcribe -> answer -> the next question's
                        // TTS begins). Drives the "thinking" indicator AND locks the mic so no new
                        // recording starts mid-preparation. No OR of transcribing/answering -> no gap.
                        preparing={preparing}
                        voiceMode={voiceMode}
                        supported={supported}
                        confirming={confirming}
                        countdownMs={countdownMs}
                        noInput={noInput}
                        done={done}
                        ended={ended}
                        onToggleMic={() => (listening ? stop() : start())}
                        onCheckMic={handleCheckMic}
                        onToggleVoiceMode={() => setVoiceMode((m) => (m === "manual" ? "smart" : "manual"))}
                        onKeepListening={keepListening}
                        onSwitch={() => setMode("text")}
                        onEnd={handleEnd}
                    />
                ) : (
                    <TextColumn
                        transcript={transcript}
                        draft={draft}
                        setDraft={setDraft}
                        waiting={preparing}
                        answering={answering}
                        transcribing={transcribing}
                        done={done}
                        ended={ended}
                        onSend={() => handleSend()}
                        onSwitch={() => setMode("voice")}
                        onEnd={handleEnd}
                    />
                )}

                <RightRail mode={mode} interviewerLines={interviewerLines} scoring={scoring} />
            </div>

            {/* In-session settings (mic + live test meter, TTS engine, voice/text mode), behind the
                header gear. Mic changes persist via handleChangeMic; onMicReady re-reads device labels
                once the test meter grants mic permission. */}
            <SettingsModal
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                mode={mode}
                onChangeMode={setMode}
                ttsEngine={ttsEngine}
                onChangeTtsEngine={setTtsEngine}
                micOptions={micOptions}
                micDeviceId={micDeviceId}
                onChangeMic={handleChangeMic}
                onMicReady={refreshMics}
            />
        </div>
    );
}

/* ══════════════════════════════════════════════════════════════════════════
   Voice mode — centre column (mock 2a), wired
   ══════════════════════════════════════════════════════════════════════ */
function VoiceColumn({
    initials,
    question,
    listening,
    userSpeaking,
    speaking,
    preparing,
    voiceMode,
    supported,
    confirming,
    countdownMs,
    noInput,
    done,
    ended,
    onToggleMic,
    onCheckMic,
    onToggleVoiceMode,
    onKeepListening,
    onSwitch,
    onEnd,
}: {
    initials: string;
    question?: Line;
    listening: boolean;
    userSpeaking: boolean;
    speaking: boolean;
    preparing: boolean;
    voiceMode: TurnMode;
    supported: boolean;
    confirming: boolean;
    countdownMs: number;
    noInput: boolean;
    done: boolean;
    ended: boolean;
    onToggleMic: () => void;
    onCheckMic: () => void;
    onToggleVoiceMode: () => void;
    onKeepListening: () => void;
    onSwitch: () => void;
    onEnd: () => void;
}) {
    // "thinking" is just the single flow flag now: it already spans transcription, the answer
    // round-trip, and TTS synthesis, ending the instant the next question is revealed. One source of
    // truth, so there's no frame where it reads false while a turn is still being prepared.
    const thinking = preparing;
    return (
        <div className="flex flex-col items-center justify-center gap-[34px] px-[60px] py-8">
            {/* Current question — the latest interviewer turn, or "thinking…" while we wait on the next */}
            <div className="max-w-[680px] text-center">
                <div className="kicker">{thinking ? "Interviewer is thinking" : "Interviewer asked"}</div>
                <p className="mt-2 font-heading text-[31px] font-medium leading-[1.18] [text-wrap:pretty]">
                    {thinking || !question?.text ? <LoadingDots className="text-[26px]" /> : question.text}
                </p>
            </div>

            {/* Two participant cells — each pulses its icon while that participant is actually making
                sound: "You" on real mic input (hark), the interviewer while its TTS plays. */}
            <div className="grid w-[640px] max-w-full grid-cols-2 rounded-md border border-divider">
                <ParticipantCell
                    initials={initials}
                    name="You"
                    role="Candidate"
                    speaking={userSpeaking}
                    className="border-r border-divider"
                    // The "You" cell's reserved footer slot (below the Speaking/Listening tag) holds one of
                    // two mutually-exclusive prompts — see ParticipantCell. The slot is ALWAYS present in
                    // BOTH cells, so a prompt appearing/disappearing changes no height and triggers no
                    // page-scrollbar layout shift.
                    //   1. confirming — the smart-mode "still there?" countdown, AFTER speech: a tap, any key
                    //      (the effect in SessionPage), or this button keeps the turn open.
                    //   2. noInput — the "check your mic" prompt, when NO sound was ever heard (wrong/dead
                    //      mic, or never started). Amber (gap tokens) to read as attention, not the accent
                    //      countdown; its button opens Settings to fix the input.
                    // They can't both be true (a countdown needs prior speech, noInput needs none), but
                    // confirming is checked first defensively.
                    footer={
                        confirming ? (
                            <div className="flex items-center gap-2.5 rounded-md border border-accent px-3 py-1.5 text-[12.5px] text-accent-300">
                                <span>Still there? {Math.ceil(countdownMs / 1000)}s</span>
                                <button className="btn btn-ghost text-[12.5px]" onClick={onKeepListening}>
                                    Keep talking
                                </button>
                            </div>
                        ) : noInput ? (
                            <div className="flex items-center gap-2.5 whitespace-nowrap rounded-md border border-gap-border bg-gap-bg px-3 py-1.5 text-[12.5px] text-gap">
                                <span>Still there?</span>
                                <button className="btn btn-ghost text-[12.5px] text-gap" onClick={onCheckMic}>
                                    Check your mic
                                </button>
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
                    <>
                        <button
                            className="btn btn-primary flex items-center gap-[9px] text-[15px] disabled:opacity-50"
                            style={{ padding: "13px 30px" }}
                            onClick={onToggleMic}
                            // Locked while the AI is speaking, while a turn is being prepared
                            // (transcribe/answer/TTS), or once ended — so no new recording starts over any of those.
                            disabled={speaking || preparing || ended}
                        >
                            <Microphone size={17} weight="regular" />
                            {micLabel(listening, voiceMode)}
                        </button>
                        <button
                            className="btn btn-ghost flex items-center gap-2 border-l border-divider disabled:opacity-50"
                            style={{ padding: "13px 18px" }}
                            onClick={onToggleVoiceMode}
                            disabled={listening || confirming || preparing}
                        >
                            Mode: {voiceMode}
                        </button>
                    </>
                )}
                <button
                    className="btn btn-ghost flex items-center gap-2 border-l border-divider"
                    style={{ padding: "13px 18px" }}
                    onClick={onSwitch}
                >
                    <PencilSimple size={16} weight="regular" />
                    Switch to text
                </button>
                <button
                    className="btn btn-ghost border-l border-divider disabled:opacity-50"
                    style={{ padding: "13px 20px" }}
                    onClick={onEnd}
                    disabled={ended}
                >
                    {ended ? "Ending…" : "End session"}
                </button>
            </div>

            {done && (
                <p className="m-0 text-[13px] text-accent-300">
                    That's the last question — end the session to see your scorecard.
                </p>
            )}

            <p className="m-0 text-[12.5px] text-neutral-400">
                Responses are generated by AI and may be wrong. Nothing is shared outside your account.
            </p>
        </div>
    );
}

// The mic button copy, mirroring App.tsx: manual STOP submits (combined stop+send), smart STOP just
// stops (the countdown/VAD submits).
function micLabel(listening: boolean, voiceMode: TurnMode): string {
    if (!listening) return "Record your answer";
    return voiceMode === "manual" ? "Speaking — tap to stop & send" : "Speaking — tap to stop";
}

function ParticipantCell({
    initials,
    ai,
    name,
    role,
    speaking,
    className = "",
    footer = null,
}: {
    initials?: string;
    ai?: boolean;
    name: string;
    role: string;
    speaking: boolean;
    className?: string;
    // Content for the reserved slot below the Speaking/Listening tag (the "You" cell's "Still there?"
    // countdown). The slot's height is reserved unconditionally in BOTH cells regardless of `footer`,
    // so toggling its content never reflows the box — that's what kills the layout shift.
    footer?: ReactNode;
}) {
    // Zoom-style status icon — a mic for the candidate, a speaker for the interviewer — that pulses
    // (accent + filled) while that participant is making sound, idle/neutral otherwise. Fixed-height
    // slot so the cell doesn't reflow as it toggles.
    const StatusIcon: Icon = ai ? SpeakerHigh : Microphone;
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
            <div className="flex h-[34px] items-center justify-center">
                <StatusIcon
                    size={26}
                    weight={speaking ? "fill" : "regular"}
                    className={speaking ? "text-accent-300 speaking-pulse" : "text-neutral-600"}
                />
            </div>
            {speaking ? (
                <span className="tag tag-accent">Speaking</span>
            ) : (
                <span className="tag tag-neutral">Listening</span>
            )}
            {/* Reserved footer slot — fixed height in BOTH cells so the "Still there?" badge can appear
                and disappear inside the "You" cell without changing the box's height (no scrollbar flash). */}
            <div className="mt-4 flex h-[38px] items-center justify-center">{footer}</div>
        </div>
    );
}

/* ══════════════════════════════════════════════════════════════════════════
   Text mode — centre column (mock 2b), wired
   ══════════════════════════════════════════════════════════════════════ */
function TextColumn({
    transcript,
    draft,
    setDraft,
    waiting,
    answering,
    transcribing,
    done,
    ended,
    onSend,
    onSwitch,
    onEnd,
}: {
    transcript: Line[];
    draft: string;
    setDraft: (v: string) => void;
    waiting: boolean;
    answering: boolean;
    transcribing: boolean;
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
                            />
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
                            That's the last question — end the session to see your scorecard.
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
                                <span>{words} words · aim for 150–250</span>
                            </div>
                        </div>
                    )}
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
                                className="btn btn-ghost border-l border-divider disabled:opacity-50"
                                style={{ padding: "10px 18px" }}
                                onClick={onEnd}
                                disabled={ended}
                            >
                                {ended ? "Ending…" : "End session"}
                            </button>
                        </div>
                        {!done && (
                            <button
                                className="btn btn-primary text-[15px] disabled:opacity-50"
                                style={{ padding: "11px 28px" }}
                                onClick={onSend}
                                disabled={answering || transcribing || ended || !draft.trim()}
                            >
                                {transcribing ? "Transcribing…" : answering ? "Sending…" : "Send answer"}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ══════════════════════════════════════════════════════════════════════════
   Right rail (shared) — question list (from the transcript) + scratchpad + footer
   ══════════════════════════════════════════════════════════════════════ */
function RightRail({
    mode,
    interviewerLines,
    scoring,
}: {
    mode: Mode;
    interviewerLines: Line[];
    scoring: boolean;
}) {
    // A private, local-only scratchpad (not persisted — deliberately, it's throwaway thinking space).
    const [scratch, setScratch] = useState("");

    return (
        <div className="hidden flex-col gap-[22px] border-l border-divider p-5 lg:flex">
            {/* This session — the interviewer turns asked so far, newest = current. No total: an
                interview's length isn't fixed (follow-ups are dynamic), so this just grows as we go. */}
            <div>
                <div className="kicker">This session</div>
                <div className="mt-2.5 flex flex-col gap-[9px] text-[13px]">
                    {interviewerLines.length === 0 ? (
                        <span className="text-neutral-400">Waiting for the first question…</span>
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
            <div>
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
