/**
 * Phase C — the History view. SCAFFOLD: the list is the worked example; the detail drill-in
 * (InterviewDetailView) is the TODO.
 *
 * WHAT THIS PROVES: ownership from Phase B finally has a payoff a user can see. GET /api/interviews
 * returns only THIS user's interviews (scoped by the verified uid, server-side), and each one can
 * be reopened — transcript AND remembered grade — without re-running the grader. The same
 * <ScorecardView> that renders a live grade renders the persisted one, because get_scorecard hands
 * back the identical shape.
 *
 * ROUTING: this is one <Route path="/history"> in main.tsx, inside the <ProtectedRoute> block, so
 * it's already gated. We keep list-vs-detail as local state (selectedId) rather than a nested
 * /history/:id route — one screen, one route, and the back button within the page is a setState.
 * (Graduating to a nested route later is trivial if deep-linking to one interview is ever wanted.)
 */
import { useState } from "react";
import { Link } from "react-router";
import {
    useGetMyInterviewsQuery,
    useGetInterviewDetailQuery,
} from "./api";
import ScorecardView from "./ScorecardView";

export default function HistoryPage() {
    // when set, we're looking at ONE interview's detail; null = the list.
    const [selectedId, setSelectedId] = useState<string | null>(null);

    // WORKED EXAMPLE — the LIST. useGetMyInterviewsQuery fires on mount and re-fetches when the
    // component remounts (e.g. after finishing an interview), so the newest one is already here.
    const { data, isLoading, error } = useGetMyInterviewsQuery();

    if (selectedId) {
        return <InterviewDetailView interviewId={selectedId} onBack={() => setSelectedId(null)} />;
    }

    return (
        <main className="mx-auto max-w-2xl p-6 font-sans">
            <div className="mb-4 flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-800">Past interviews</h1>
                <Link to="/" className="text-blue-700 underline">← Back to interview</Link>
            </div>

            {isLoading && <p className="text-slate-600">Loading…</p>}
            {error && <p className="text-red-700">Couldn't load your interviews.</p>}
            {data && data.interviews.length === 0 && (
                <p className="text-slate-600">No interviews yet — finish one and it'll show up here.</p>
            )}

            <ul className="space-y-2">
                {data?.interviews.map((iv) => (
                    <li key={iv.interview_id}>
                        <button
                            onClick={() => setSelectedId(iv.interview_id)}
                            className="flex w-full items-center justify-between rounded-lg border border-slate-300 p-3 text-left transition hover:bg-slate-50"
                        >
                            <span>
                                <span className="font-semibold text-slate-800">{iv.role}</span>
                                <span className="text-slate-500"> · {iv.level}</span>
                                <span className="block text-xs text-slate-400">
                                    {new Date(iv.created_at).toLocaleDateString()}
                                    {!iv.done && " · in progress"}
                                </span>
                            </span>
                            {/* the grade, or an em-dash for a not-yet-graded interview */}
                            <span className="font-semibold text-slate-800">
                                {iv.overall !== null ? `${iv.overall}/5` : "—"}
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
        </main>
    );
}

// ===========================================================================
// TODO — the DETAIL drill-in. The data plumbing is wired for you; render it.
//
// useGetInterviewDetailQuery(interviewId) gives { data, isLoading, error } where `data` is the
// InterviewDetail shape (see api.ts): { interview_id, turns[], summary, scorecard }.
//
// What to render:
//   - a loading line while isLoading, and an error line on error (mirror the list above)
//   - a "← Back" control calling onBack() to return to the list (a <button>, not a <Link> —
//     we're switching local state, not the URL)
//   - the TRANSCRIPT: data.turns.map(...) — each turn has { question_id, answer, at }. (Note the
//     turns carry the question SLUG, not its text; that's all get_interview stores per turn. The
//     question TEXT is available per graded question inside the scorecard below.)
//   - the GRADE, reusing the SAME component the live flow uses — no new display code:
//         {data.scorecard && <ScorecardView card={data.scorecard} />}
//     `scorecard` is null for an interview that was never graded (or until the backend's
//     get_scorecard read-back is implemented) — so guard it, don't assume it's there.
// ===========================================================================
function InterviewDetailView({
    interviewId,
    onBack,
}: {
    interviewId: string;
    onBack: () => void;
}) {
    const { data, isLoading, error } = useGetInterviewDetailQuery(interviewId);

    // TODO: replace this placeholder with the transcript + <ScorecardView> per the notes above.
    // Kept minimal (and referencing the fetched values) so the file compiles as you build it out.
    return (
        <main className="mx-auto max-w-2xl p-6 font-sans">
            <button onClick={onBack} className="mb-4 text-blue-700 underline">← Back</button>
            {isLoading && <p className="text-slate-600">Loading…</p>}
            {error && <p className="text-red-700">Couldn't load that interview.</p>}
            {data && <p className="text-slate-500">Interview {data.interview_id} — {data.turns.length} turns.</p>}
            {/* TODO: transcript list + {data?.scorecard && <ScorecardView card={data.scorecard} />} */}
            <div className = "flex flex-col gap-y-2 p-4">
                <p>Transcript: </p>
                {data.turns.map((turn) => {
                    const question = data.scorecard.answers.find((answer) => answer.question_id === turn.question_id)?.question_text
                    const date = new Date(turn.at)
                    return (
                        <div className = "flex flex-col gap-y-2">
                            <div>Question: {question ?? ""}</div>
                            <div>Answer: {turn.answer}</div>
                            <div>At: {date.toLocaleString()}</div>
                        </div>
                    )
                })} 
            </div>
            {
                data?.scorecard && <ScorecardView card={data.scorecard}/> 
            }
        </main>
    );
}
