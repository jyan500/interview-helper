import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useForm } from "react-hook-form";
import Select from "react-select";
import {
    useStartInterviewMutation,
    useSubmitAnswerMutation,
    useGetScorecardMutation,
    useLazyGetRolesQuery,
    useLazyGetLevelsQuery,
    type Scorecard,
} from "./api";
import { ControlledAsyncPaginateSelect } from "./components/ControlledAsyncPaginateSelect";
import type { SelectOption } from "./components/AsyncPaginateSelect";
import ScorecardView from "./ScorecardView";
import {
    useSpeak,
    useSmartVoiceTurn,
    type TurnMode,
    useVoices,
    pickPreferredVoice,
    setVoicePrefs,
    type TtsEngine,
} from "./voice/speech"
import { useAuth } from "./auth/AuthProvider"

// `id` is a STABLE key so we can reveal a specific bubble later by id (race-safe even if other lines
// were appended meanwhile). `pending` = an interviewer turn whose audio is still synthesizing: we show
// "thinking…" and withhold the real text until useSpeak's onReady fires, so text + voice land together
// (no more reading the question in silence for a beat while TTS loads).
type Line = { id: number; who: "interviewer" | "you"; text: string; pending?: boolean };

// Phase F — the TTS engine picker's options (react-select shape). Typed with the TtsEngine union so
// onChange stays type-safe end to end (no cast back from a bare string). Static, so module scope.
type EngineOption = { value: TtsEngine; label: string };
const TTS_ENGINE_OPTIONS: EngineOption[] = [
    { value: "openai", label: "OpenAI — neural (uses tokens)" },
    { value: "browser", label: "Browser — free (robotic)" },
];

// Phase D — the kickoff form's shape. Each field holds react-select's Option ({value: slug,
// label: name}) or null until picked; the submit handler unwraps `.value` to the slug the
// backend wants. Kept as Option (not a bare slug) so the async select can show the chosen
// label without re-fetching it.
type StartFormValues = {
    role: SelectOption | null;
    level: SelectOption | null;
};

export default function App() {
    // The BROWSER is the loop now (build-plan Phase 3.5). React holds ONLY what it renders:
    // the interview id and the visible transcript. The agent's message_history stays on the
    // BACKEND — as of Phase A, in the `interviews` row keyed by interview_id, not a dict in
    // the server's memory. Either way: do NOT mirror it here.
    const [interviewId, setInterviewId] = useState<string | null>(null);
    const [transcript, setTranscript] = useState<Line[]>([]);
    const [draft, setDraft] = useState("");
    //
    // 1. A SIGN-OUT AFFORDANCE. `const { session, signOut } = useAuth()` (from
    //    ./auth/AuthProvider) gives you `session.user.email` to show and `signOut` to call.
    //    A line next to the <h1> is enough. Note you don't navigate afterwards: signing out
    //    empties the mirror and <ProtectedRoute> does the redirect.
    //
    // 2. DON'T EAT A HALF-TYPED ANSWER. Everything this component holds is React state, so a
    //    sign-out (or a crashed tab) takes `draft` and `interviewId` with it. The interview
    //    itself is safe — it's a Postgres row, that was the point of Phase A — but the
    //    sentence someone was midway through typing is not. Mirroring just those two values
    //    into localStorage on change, and reading them back on mount, costs a `useEffect`
    //    each and removes the only genuinely unrecoverable loss in the app.
    //    (Restoring the visible TRANSCRIPT needs Phase C's GET /api/sessions/{id} — the data
    //    is all in `turns`, there's just no route serving it yet.)
    // Phase 5 — the graded scorecard, once the interview is ended. null until requested.
    const { session, signOut } = useAuth()
    const [scorecard, setScorecard] = useState<Scorecard | null>(null);
    // Phase 5 — the backend flips done=true once the client-driven loop exhausts the bank.
    const [done, setDone] = useState(false);

    // RTK Query mutation hooks return [trigger, { isLoading, error, ... }].
    const [startInterview, { isLoading: starting }] = useStartInterviewMutation();
    const [submitAnswer, { isLoading: answering }] = useSubmitAnswerMutation();
    const [getScorecard, { isLoading: scoring }] = useGetScorecardMutation();

    // Phase D — the kickoff form. React Hook Form owns the role/level selection state (replacing
    // the old useState + defaulting effects); mode "onChange" keeps formState.isValid live so the
    // Start button can enable the instant both required fields are picked.
    const { control, handleSubmit, formState } = useForm<StartFormValues>({
        defaultValues: { role: null, level: null },
        mode: "onChange",
    });

    // Phase D — the picker's data source. LAZY query triggers, handed straight to the two selects
    // as their `fetchPage`: the AsyncPaginateSelect calls the trigger imperatively (per
    // keystroke/scroll) and owns the paginate/map logic itself. We only inject WHICH endpoint.
    const [triggerRoles] = useLazyGetRolesQuery();
    const [triggerLevels] = useLazyGetLevelsQuery();

    // Smart voice turn-taking (layer 1), replacing useWhisperRecognition's manual-only path.
    //   "manual" = tap to start, tap to stop (good for long coding/design answers with lots of pauses)
    //   "smart"  = VAD notices silence -> "still there?" countdown -> auto stop+submit; App auto-opens
    //              the mic after the AI finishes speaking (the effect further down)
    // onFinalTranscript is the COMBINED stop+send: the hook hands us the Whisper text and we submit it
    // exactly like a typed answer (handleSend), so the spoken path no longer needs a separate "Send" click.
    const [voiceMode, setVoiceMode] = useState<TurnMode>("manual")
    const { supported, listening, confirming, countdownMs, transcribing, start, stop, keepListening } =
        useSmartVoiceTurn({ mode: voiceMode, onFinalTranscript: (text) => handleSend(text) })

    // Which TTS engine to use. "openai" = neural (spends tokens); "browser" = free local
    // SpeechSynthesis (robotic), handy for debugging without burning OpenAI credit. The picker below
    // flips this; useSpeak(engine) dispatches. Defaults to openai (the production voice).
    const [ttsEngine, setTtsEngine] = useState<TtsEngine>("openai")

    // Phase F — the OUTPUT edge adapter, engine-switchable. useSpeak(engine) wraps whichever TTS is
    // chosen and hands back speak(text, onReady). We pass onReady to REVEAL the interviewer bubble in
    // sync with the voice (#5): it shows "thinking…" until audio is ready, then text + sound together.
    const { speak, speaking } = useSpeak(ttsEngine)

    // Stable per-line id (a ref counter, not state — it never renders). Lets revealLine() target the
    // exact "thinking…" bubble by id, even if the user sends again before the audio starts.
    const lineIdRef = useRef(0)
    function nextId() { lineIdRef.current += 1; return lineIdRef.current }

    // Swap a pending interviewer bubble's placeholder for the real text — called from speak()'s onReady,
    // i.e. exactly when audio begins. Matches by id so it hits the right bubble regardless of order.
    function revealLine(id: number, text: string) {
        setTranscript(t => t.map(l => (l.id === id ? { ...l, text, pending: false } : l)))
    }

    // Phase 5 TTS polish — the OUTPUT edge adapter, richer knobs. `useVoices()` gives the live
    // (async-loaded) voice list; `selectedVoiceURI` records which voice we've settled on (also the
    // "have we auto-picked yet?" guard for the effect below).
    const voices = useVoices();
    const [selectedVoiceURI, setSelectedVoiceURI] = useState<string | null>(null);

    // WORKED EXAMPLE — auto-pick a good voice the moment the list loads, so TTS sounds neural
    // immediately WITHOUT the user touching any control. Runs once voices are known and nothing
    // is selected yet; pushes the choice into speak()'s shared prefs via setVoicePrefs.
    useEffect(() => {
        if (selectedVoiceURI !== null || voices.length === 0) return;
        const preferred = pickPreferredVoice(voices);
        if (preferred) {
            setSelectedVoiceURI(preferred.voiceURI);
            setVoicePrefs({ voiceURI: preferred.voiceURI });
        }
    }, [voices, selectedVoiceURI]);

    // WORKED EXAMPLE — start the interview (drives POST /api/interview). Phase D: RHF's
    // handleSubmit hands us the validated form values, so we unwrap each Option to its slug and
    // send {role, seniority} — that choice is what makes the interview role- and level-scoped from
    // its very first question. `required` validation guarantees both are set; the guard just
    // narrows SelectOption | null to SelectOption for TypeScript.
    async function onStart({ role, level }: StartFormValues) {
        if (!role || !level) return;
        // .unwrap() returns the payload on success or THROWS on error (unlike the hook's
        // result object, which you'd have to inspect). Convenient with async/await.
        const res = await startInterview({ role: role.value, seniority: level.value }).unwrap();
        setInterviewId(res.interview_id);
        // Show a "thinking…" interviewer bubble immediately, then reveal the question the moment the
        // voice is ready (onReady) — text and audio in lockstep. onStart is a click, so autoplay is allowed.
        const id = nextId();
        setTranscript([{ id, who: "interviewer", text: "", pending: true }]);
        speak(res.message, () => revealLine(id, res.message))
    }

    // send the candidate's answer (drives POST /api/answer). This is one iteration of the interview
    // loop, frontend side. Now takes an optional `textOverride` so the VOICE path can submit the Whisper
    // transcript directly (combined stop+send) instead of round-tripping through the `draft` textarea
    // state — which wouldn't have updated yet when the hook calls us. Typed answers call handleSend()
    // with no arg and fall back to `draft`.
    async function handleSend(textOverride?: string) {
        const text = (textOverride ?? draft).trim()
        if (!interviewId || !text){
            return
        }
        // include your answer to the interview question
        setTranscript(t => [...t, { id: nextId(), who: "you", text }])
        // send the answer to the backend
        const res = await submitAnswer({ interview_id: interviewId, text }).unwrap()
        // add a "thinking…" placeholder for the interviewer turn, then reveal its text + start audio
        // together via onReady (below) instead of showing the question a beat before any sound.
        const id = nextId()
        setTranscript(t => [...t, { id, who: "interviewer", text: "", pending: true }])
        speak(res.message, () => revealLine(id, res.message))
        // reset the textarea text for the next answer
        setDraft("")
        // the client-driven loop tells us when the bank is exhausted — stop taking answers
        if (res.done) {
            setDone(true)
        }
    }

    // WORKED EXAMPLE — end the interview and grade it (drives POST /api/scorecard). This is
    // the END-OF-INTERVIEW PASS from the frontend: it doesn't add a transcript line, it asks
    // the backend to grade every answer it already recorded and hands back a Scorecard.
    async function handleEndInterview() {
        if (!interviewId) {
            return
        }
        const card = await getScorecard({ interview_id: interviewId }).unwrap()
        setScorecard(card)
    }

    // ── Smart-mode turn-taking: open the mic ONLY on the AI-finished-speaking EDGE ───────────────
    // The mic (recorder + VAD) belongs to the AI's turn until it stops talking. We trigger on the
    // `speaking` true->false EDGE — not merely on "not speaking" — because there's a brief gap between an
    // answer submitting (answering flips false) and TTS synthesis starting (speaking flips true). A
    // level check ("if not speaking, start") fires IN that gap and opens the mic over the AI's turn,
    // which is the "recording while the AI talks" bug. prevSpeakingRef remembers last render's value so we
    // only act when the AI has just FINISHED. During the AI's turn `listening` stays false, so the VAD
    // (gated on listening) and the recorder are both off — the mic is genuinely paused until it's our turn.
    const prevSpeakingRef = useRef(false)
    useEffect(() => {
        const wasSpeaking = prevSpeakingRef.current
        prevSpeakingRef.current = speaking
        if (voiceMode !== "smart" || !interviewId || done) return
        if (wasSpeaking && !speaking && !listening && !confirming && !transcribing && !answering) {
            start()
        }
    }, [voiceMode, speaking, interviewId, done, listening, confirming, transcribing, answering, start])

    // ── "Still there?" — any keypress keeps the turn open during the countdown ───────────────────
    // The countdown UI has a "Keep talking" button (a tap); this makes ANY key do the same, so the
    // candidate can keep the turn without reaching for the mouse. Only armed while confirming.
    useEffect(() => {
        if (!confirming) return
        const onKey = () => keepListening()
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [confirming, keepListening])

    return (
        <main className="mx-auto max-w-2xl p-6 font-sans">
            <h1 className="mb-4 text-2xl font-bold text-slate-800">Interview Helper</h1>
            <p>{session?.user.email}</p>
            {/* Phase C — the History view is just another route (main.tsx), so getting there is
                a plain <Link>, no new plumbing. It reads GET /api/interviews for this user. */}
            <Link to="/history" className="text-blue-700 underline">View past interviews</Link>
            <button onClick={() => {
                signOut()
            }} className="ml-2 rounded-md bg-slate-800 px-4 py-2 font-medium text-white transition hover:bg-slate-700 disabled:opacity-50">Signout</button>

            {/* Phase F — voice engine picker (react-select, same widget family as the kickoff role/level
                selects; no API here so a plain static options list, not the async-paginate variant).
                Switch to the free browser voice to debug without spending OpenAI tokens; switch back for
                neural. Works mid-interview — useSpeak(engine) just re-dispatches the next speak() call. */}
            <div className="mt-3 max-w-xs">
                <label className="mb-1 block text-sm font-medium text-slate-700">Voice</label>
                <Select<EngineOption>
                    options={TTS_ENGINE_OPTIONS}
                    value={TTS_ENGINE_OPTIONS.find((o) => o.value === ttsEngine)}
                    onChange={(opt) => opt && setTtsEngine(opt.value)}
                    isSearchable={false}
                />
            </div>

            {interviewId === null ? (
                // Phase D — the kickoff FORM. RHF's handleSubmit(onStart) runs onStart only when
                // validation passes, so the two required selects gate the whole thing. Each
                // ControlledAsyncPaginateSelect is the same component with a different endpoint
                // trigger injected as `fetchPage` — the role/level difference is ONLY that.
                <form onSubmit={handleSubmit(onStart)} className="space-y-4">
                    <label className="block">
                        <span className="mb-1 block text-sm font-medium text-slate-700">Role</span>
                        <ControlledAsyncPaginateSelect
                            control={control}
                            name="role"
                            rules={{ required: true }}
                            fetchPage={triggerRoles}
                            placeholder="Search roles…"
                        />
                    </label>

                    <label className="block">
                        <span className="mb-1 block text-sm font-medium text-slate-700">Level</span>
                        <ControlledAsyncPaginateSelect
                            control={control}
                            name="level"
                            rules={{ required: true }}
                            fetchPage={triggerLevels}
                            placeholder="Search levels…"
                        />
                    </label>

                    <button
                        type="submit"
                        // disabled until BOTH required selects are valid — no defaulting anymore,
                        // an explicit pick is required (cleaner with async-loaded options).
                        disabled={starting || !formState.isValid}
                        className="rounded-md bg-slate-800 px-4 py-2 font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
                    >
                        {starting ? "Starting…" : "Start interview"}
                    </button>
                </form>
            ) : (
                <>
                    <ul className="space-y-3">
                        {transcript.map((line) => (
                            <li
                                key={line.id}
                                className={
                                    "rounded-md border p-3 text-ink " +
                                    (line.who === "interviewer" ? "border-divider" : "border-accent")
                                }
                            >
                                <span
                                    className={
                                        "font-semibold " +
                                        (line.who === "interviewer" ? "text-neutral-300" : "text-accent-300")
                                    }
                                >
                                    {line.who === "interviewer" ? "🧑‍💼 Interviewer" : "🗣️ You"}:
                                </span>{" "}
                                {line.pending
                                    ? <span className="italic text-neutral-400">thinking…</span>
                                    : line.text}
                            </li>
                        ))}
                    </ul>
                    {/* answer controls only while the interview is still running. Once the
                        client-driven loop exhausts the bank (done), stop taking answers and
                        nudge toward the scorecard. */}
                    {!done ? (
                        <>
                            <textarea
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                rows={3}
                                placeholder="Type your answer…"
                                className="mt-4 w-full rounded-md border border-slate-300 p-2 focus:border-slate-500 focus:outline-none"
                            />

                            {/* Voice controls — a Manual|Smart toggle plus the mic. The mic STOP now
                                submits (combined stop+send), so the spoken path has no separate Send. */}
                            {supported && (
                                <div className="mt-2 flex items-center gap-2">
                                    <button
                                        onClick={() => setVoiceMode((m) => (m === "manual" ? "smart" : "manual"))}
                                        disabled={listening || confirming}
                                        className="rounded-md border border-slate-800 px-3 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-100 disabled:opacity-50"
                                    >
                                        Mode: {voiceMode} · tap to switch
                                    </button>
                                    <button
                                        onClick={() => (listening ? stop() : start())}
                                        className="rounded-md bg-slate-800 px-4 py-2 font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
                                    >
                                        🎤 {listening
                                            ? (voiceMode === "manual" ? "Stop & send" : "Stop")
                                            : "Record your answer"}
                                    </button>
                                </div>
                            )}

                            {/* "Still there?" countdown — smart mode only, shown while confirming. Any key
                                (the effect above) or this button keeps the turn open. */}
                            {confirming && (
                                <div className="mt-2 flex items-center gap-3 rounded-md bg-amber-50 p-3 text-amber-800">
                                    <span>Still there? Submitting in {Math.ceil(countdownMs / 1000)}s.</span>
                                    <button
                                        onClick={keepListening}
                                        className="rounded-md border border-amber-700 px-3 py-1 font-medium transition hover:bg-amber-100"
                                    >
                                        Keep talking
                                    </button>
                                </div>
                            )}

                            {/* Typed-answer send. The spoken path submits itself; this is for the textarea. */}
                            <button
                                onClick={() => handleSend()}
                                disabled={answering || transcribing}
                                className="mt-2 rounded-md bg-slate-800 px-4 py-2 font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
                            >
                                {!transcribing ? "Send answer" : "Transcribing…"}
                            </button>
                        </>
                    ) : (
                        <p className="mt-4 rounded-md bg-slate-100 p-3 text-slate-700">
                            ✅ The interview has concluded. See your scorecard below.
                        </p>
                    )}
                    <button
                        onClick={handleEndInterview}
                        disabled={scoring}
                        className="mt-2 ml-2 rounded-md border border-slate-800 px-4 py-2 font-medium text-slate-800 transition hover:bg-slate-100 disabled:opacity-50"
                    >
                        {scoring ? "Grading…" : "End interview & see scorecard"}
                    </button>
                    {scorecard && <ScorecardView card={scorecard} />}
                </>
            )}
        </main>
    );
}
