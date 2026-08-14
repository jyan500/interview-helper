import { useEffect, useState } from "react";
import {
    useStartInterviewMutation,
    useSubmitAnswerMutation,
    useGetScorecardMutation,
    type Scorecard,
} from "./api";
import {
    speak,
    useWhisperRecognition,
    useVoices,
    pickPreferredVoice,
    setVoicePrefs,
} from "./voice/speech"
import { useAuth } from "./auth/AuthProvider"

type Line = { who: "interviewer" | "you"; text: string };

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

    // THE SEAM, made literal: both hooks return the SAME { supported, listening, start, stop }
    // contract, so swapping the INPUT edge adapter is a one-line change and nothing below moves.
    //   useSpeechRecognition — Phase 4, browser Web Speech API (Chrome-only, audio -> Google)
    //   useWhisperRecognition — Phase 5, mic capture here + our /api/transcribe (OpenAI Whisper)
    const { supported, listening, start, stop, transcribing } = useWhisperRecognition(setDraft)

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

    // WORKED EXAMPLE — start the interview (drives POST /api/interview).
    async function handleStart() {
        // .unwrap() returns the payload on success or THROWS on error (unlike the hook's
        // result object, which you'd have to inspect). Convenient with async/await.
        const res = await startInterview().unwrap();
        setInterviewId(res.interview_id);
        setTranscript([{ who: "interviewer", text: res.message }]);
        speak(res.message)
    }

    // send the candidate's answer (drives POST /api/answer). This is one iteration
    // of the interview loop, frontend side.
    async function handleSend() {
        if (!interviewId || !draft.trim()){
            return
        }
        // include your answer to the interview question
        setTranscript(t => [...t, { who: "you", text: draft }])
        // send the answer to the backend
        const res = await submitAnswer({ interview_id: interviewId, text: draft }).unwrap()
        // include the feedback/next question from the interviewer
        setTranscript(t => [...t, { who: "interviewer", text: res.message }])
        speak(res.message)
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

    return (
        <main className="mx-auto max-w-2xl p-6 font-sans">
            <h1 className="mb-4 text-2xl font-bold text-slate-800">Interview Helper</h1>
            <p>{session.user.email}</p>
            <button onClick={() => {
                signOut()
            }} className="rounded-md bg-slate-800 px-4 py-2 font-medium text-white transition hover:bg-slate-700 disabled:opacity-50">Signout</button>

            {interviewId === null ? (
                <button
                    onClick={handleStart}
                    disabled={starting}
                    className="rounded-md bg-slate-800 px-4 py-2 font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
                >
                    {starting ? "Starting…" : "Start interview"}
                </button>
            ) : (
                <>
                    <ul className="space-y-3">
                        {transcript.map((line, i) => (
                            <li
                                key={i}
                                className={
                                    "rounded-lg p-3 " +
                                    (line.who === "interviewer" ? "bg-slate-100" : "bg-blue-50")
                                }
                            >
                                <span className="font-semibold">
                                    {line.who === "interviewer" ? "🧑‍💼 Interviewer" : "🗣️ You"}:
                                </span>{" "}
                                {line.text}
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
                            {supported && (
                                <button
                                    onClick={() => {
                                        if (!listening){
                                            start()
                                        }
                                        else {
                                            stop()
                                        }
                                    }}
                                    className="mt-2 rounded-md bg-slate-800 px-4 py-2 font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
                                >
                                    🎤 {!listening ? "Record your answer" : "Stop recording"}
                                </button>
                            )}
                            <button
                                onClick={handleSend}
                                disabled={answering || transcribing}
                                className="mt-2 rounded-md bg-slate-800 px-4 py-2 font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
                            >
                                {!transcribing ? "Send answer" : "Transcribing..."}
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

// render the graded scorecard. The DATA is done (the backend grades every recorded
// answer and aggregates it); this is purely the DISPLAY. The overall score + per-dimension
// averages are wired below as the worked example — fill in the per-answer breakdown where
// marked. Fields available on `card` (see api.ts Scorecard): overall, dimension_averages
// (name -> number), answers[] each with { question_text, dimension_scores[], strength, gap,
// improvement }.
function ScorecardView({ card }: { card: Scorecard }) {
    return (
        <section className="mt-6 rounded-lg border border-slate-300 p-4">
            <h2 className="text-xl font-bold text-slate-800">
                Scorecard — {card.overall}/5 overall
            </h2>

            {/* WORKED EXAMPLE — per-dimension averages. Object.entries turns the
                {dimension: average} map into rows. */}
            <ul className="mt-3 space-y-1">
                {Object.entries(card.dimension_averages).map(([dim, avg]) => (
                    <li key={dim} className="flex justify-between text-sm">
                        <span className="text-slate-600">{dim}</span>
                        <span className="font-semibold text-slate-800">{avg}/5</span>
                    </li>
                ))}
            </ul>
            {
                card.answers.map((a, i) => (
                    <div key={i} className = "mt-4">
                        <p className="font-semibold">{a.question_text}</p> 
                        {
                            a?.dimension_scores?.map((score) => {
                                return (
                                    <div key={score.dimension} className = "flex flex-col gap-y-2">
                                        <div className = "flex flex-row gap-x-2">
                                            <p>{score.dimension}</p>
                                            <p>{score.score}</p>
                                        </div>
                                        <p>{score.note}</p>
                                    </div>
                                )
                            })
                        }
                       <p>💪 {a.strength}</p> 
                       <p>🕳️ {a.gap}</p> 
                       <p>🔧 {a.improvement}</p> 
                    </div>
                ))
            }
        </section>
    );
}
