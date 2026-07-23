import { useState } from "react";
import { useStartSessionMutation, useSubmitAnswerMutation } from "./api";

type Line = { who: "interviewer" | "you"; text: string };

export default function App() {
    // The BROWSER is the loop now (build-plan Phase 3.5). React holds ONLY what it renders:
    // the session id and the visible transcript. The agent's message_history stays on the
    // BACKEND, keyed by session_id — do NOT mirror it here.
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [transcript, setTranscript] = useState<Line[]>([]);
    const [draft, setDraft] = useState("");

    // RTK Query mutation hooks return [trigger, { isLoading, error, ... }].
    const [startSession, { isLoading: starting }] = useStartSessionMutation();
    const [submitAnswer, { isLoading: answering }] = useSubmitAnswerMutation();

    // WORKED EXAMPLE — start the interview (drives POST /api/session).
    async function handleStart() {
        // .unwrap() returns the payload on success or THROWS on error (unlike the hook's
        // result object, which you'd have to inspect). Convenient with async/await.
        const res = await startSession().unwrap();
        setSessionId(res.session_id);
        setTranscript([{ who: "interviewer", text: res.message }]);
    }

    // TODO — send the candidate's answer (drives POST /api/answer). This is one iteration
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
        // reset the textarea text for the next answer
        setDraft("")
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
                    <button
                        onClick={handleSend}
                        /* disabled={answering} */
                        className="mt-2 rounded-md bg-slate-800 px-4 py-2 font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
                    >
                        Send answer
                    </button>
                </>
            )}
        </main>
    );
}
