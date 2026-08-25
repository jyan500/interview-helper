import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useForm } from "react-hook-form";
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
    speak,
    useWhisperRecognition,
    useVoices,
    pickPreferredVoice,
    setVoicePrefs,
} from "./voice/speech"
import { useAuth } from "./auth/AuthProvider"

type Line = { who: "interviewer" | "you"; text: string };

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
