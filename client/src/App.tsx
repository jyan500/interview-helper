import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
    useStartInterviewMutation,
    useSubmitAnswerMutation,
    useGetScorecardMutation,
    useGetRolesQuery,
    useGetLevelsQuery,
    type Scorecard,
} from "./api";
import ScorecardView from "./ScorecardView";
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
    // Phase D — the candidate's picks BEFORE the interview starts. Both are slugs (what the
    // backend wants); "" until the option lists load and the effects below seed a default.
    const [selectedRole, setSelectedRole] = useState("");
    const [selectedLevel, setSelectedLevel] = useState("");
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

    // Phase D — the picker's options. QUERY hooks (not mutations): they fire on mount and cache,
    // so the two <select>s below populate from the DB vocab without a manual fetch.
    const { data: rolesData } = useGetRolesQuery();
    const { data: levelsData } = useGetLevelsQuery();

    // Seed a default selection the moment each list arrives, so "Start" is valid without the
    // user touching a dropdown. Guarded on the empty string so it runs ONCE and never fights a
    // choice the user has since made. (levels come back rank-ordered, so [0] is "entry".)
    useEffect(() => {
        if (!selectedRole && rolesData?.roles.length) {
            setSelectedRole(rolesData.roles[0].slug);
        }
    }, [rolesData, selectedRole]);
    useEffect(() => {
        if (!selectedLevel && levelsData?.levels.length) {
            setSelectedLevel(levelsData.levels[0].slug);
        }
    }, [levelsData, selectedLevel]);

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

    // WORKED EXAMPLE — start the interview (drives POST /api/interview). Phase D: the trigger
    // now takes the picked {role, seniority} (both slugs) instead of no args — that choice is
    // what makes the interview role- and level-scoped from its very first question.
    async function handleStart() {
        // .unwrap() returns the payload on success or THROWS on error (unlike the hook's
        // result object, which you'd have to inspect). Convenient with async/await.
        const res = await startInterview({ role: selectedRole, seniority: selectedLevel }).unwrap();
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
            <p>{session?.user.email}</p>
            {/* Phase C — the History view is just another route (main.tsx), so getting there is
                a plain <Link>, no new plumbing. It reads GET /api/interviews for this user. */}
            <Link to="/history" className="text-blue-700 underline">View past interviews</Link>
            <button onClick={() => {
                signOut()
            }} className="ml-2 rounded-md bg-slate-800 px-4 py-2 font-medium text-white transition hover:bg-slate-700 disabled:opacity-50">Signout</button>

            {interviewId === null ? (
                <div className="space-y-4">
                    {/* WORKED EXAMPLE — the ROLE picker. A controlled <select>: its value is the
                        state, onChange writes the chosen SLUG back. Options come straight from the
                        cached getRoles query — value is the slug we send, the label is the name. */}
                    <label className="block">
                        <span className="mb-1 block text-sm font-medium text-slate-700">Role</span>
                        <select
                            value={selectedRole}
                            onChange={(e) => setSelectedRole(e.target.value)}
                            className="w-full rounded-md border border-slate-300 p-2 focus:border-slate-500 focus:outline-none"
                        >
                            {rolesData?.roles.map((r) => (
                                <option key={r.slug} value={r.slug}>{r.name}</option>
                            ))}
                        </select>
                    </label>

                    {/* TODO (Phase D) — the LEVEL picker, a near-copy of the role one above. Write a
                        second <label>/<select> that:
                          - binds `value={selectedLevel}` and `onChange` -> setSelectedLevel(e.target.value)
                          - maps over `levelsData?.levels` for its <option>s (value = lvl.slug,
                            label = lvl.name). They arrive rank-ordered, so entry/mid/senior render
                            top-to-bottom with no sorting on your part.
                        Until you add it, selectedLevel is defaulted to "entry" by the effect above,
                        so Start still works — this control just lets the user change it. */}

                    <button
                        onClick={handleStart}
                        // disabled until BOTH picks resolve — guards the brief moment before the
                        // option lists load and the defaults seed (selectedRole/Level still "").
                        disabled={starting || !selectedRole || !selectedLevel}
                        className="rounded-md bg-slate-800 px-4 py-2 font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
                    >
                        {starting ? "Starting…" : "Start interview"}
                    </button>
                </div>
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
