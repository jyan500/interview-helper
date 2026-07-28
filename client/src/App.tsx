import { useState } from "react";
import {
    useStartSessionMutation,
    useSubmitAnswerMutation,
    useGetScorecardMutation,
    type Scorecard,
} from "./api";
import { speak, useSpeechRecognition } from "./voice/speech"

type Line = { who: "interviewer" | "you"; text: string };

export default function App() {
    // The BROWSER is the loop now (build-plan Phase 3.5). React holds ONLY what it renders:
    // the session id and the visible transcript. The agent's message_history stays on the
    // BACKEND, keyed by session_id — do NOT mirror it here.
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [transcript, setTranscript] = useState<Line[]>([]);
    const [draft, setDraft] = useState("");
    // Phase 5 — the graded scorecard, once the interview is ended. null until requested.
    const [scorecard, setScorecard] = useState<Scorecard | null>(null);

    // RTK Query mutation hooks return [trigger, { isLoading, error, ... }].
    const [startSession, { isLoading: starting }] = useStartSessionMutation();
    const [submitAnswer, { isLoading: answering }] = useSubmitAnswerMutation();
    const [getScorecard, { isLoading: scoring }] = useGetScorecardMutation();

    const { supported, listening, start, stop } = useSpeechRecognition(setDraft) 

    // WORKED EXAMPLE — start the interview (drives POST /api/session).
    async function handleStart() {
        // .unwrap() returns the payload on success or THROWS on error (unlike the hook's
        // result object, which you'd have to inspect). Convenient with async/await.
        const res = await startSession().unwrap();
        setSessionId(res.session_id);
        setTranscript([{ who: "interviewer", text: res.message }]);
        speak(res.message)
    }

    // send the candidate's answer (drives POST /api/answer). This is one iteration
    // of the interview loop, frontend side. Pointers:
    //   - guard:   if (!sessionId || !draft.trim()) return;
    //   - show it: setTranscript(t => [...t, { who: "you", text: draft }]);
    //   - call:    const res = await submitAnswer({ session_id: sessionId, text: draft }).unwrap();
    //   - append:  setTranscript(t => [...t, { who: "interviewer", text: res.message }]);
    //   - clear:   setDraft("");
    async function handleSend() {
        if (!sessionId || !draft.trim()){
            return
        }
        // include your answer to the interview question
        setTranscript(t => [...t, { who: "you", text: draft }])
        // send the answer to the backend
        const res = await submitAnswer({ session_id: sessionId, text: draft }).unwrap()
        // include the feedback/next question from the interviewer
        setTranscript(t => [...t, { who: "interviewer", text: res.message }])
        speak(res.message)
        // reset the textarea text for the next answer
        setDraft("")
    }

    // WORKED EXAMPLE — end the interview and grade it (drives POST /api/scorecard). This is
    // the Phase 5 END-OF-SESSION PASS from the frontend: it doesn't add a transcript line, it
    // asks the backend to grade every answer it already recorded and hands back a Scorecard.
    async function handleEndInterview() {
        if (!sessionId) {
            return
        }
        const card = await getScorecard({ session_id: sessionId }).unwrap()
        setScorecard(card)
    }

    return (
        <main className="mx-auto max-w-2xl p-6 font-sans">
            <h1 className="mb-4 text-2xl font-bold text-slate-800">Interview Helper</h1>

            {sessionId === null ? (
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
                        /* disabled={answering} */
                        className="mt-2 rounded-md bg-slate-800 px-4 py-2 font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
                    >
                        Send answer
                    </button>
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

// TODO — render the graded scorecard. The DATA is done (the backend grades every recorded
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

            {/* TODO — the per-answer breakdown. Map over card.answers and, for each, render:
                  - the question_text (a heading)
                  - its dimension_scores (each { dimension, score, note })
                  - the strength / gap / improvement lines
                Pointers:
                  {card.answers.map((a, i) => (
                      <div key={i} className="mt-4">
                          <p className="font-semibold">{a.question_text}</p>
                          ... map a.dimension_scores ...
                          <p>💪 {a.strength}</p>
                          <p>🕳️ {a.gap}</p>
                          <p>🔧 {a.improvement}</p>
                      </div>
                  ))}
            */}
        </section>
    );
}
