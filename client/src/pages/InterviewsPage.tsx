/**
 * Past interviews — the full list, Nocturne mock 3a. Every session the signed-in user has run,
 * each reopenable (and the most-recent unfinished one resumable).
 *
 * The list itself is InterviewsTable, shared with the Dashboard's "Past interviews" card, fed the
 * user's real history from GET /api/interviews. The search/filter row is still static placeholder
 * chrome — filtering and pagination are a later slice; this page just fills in the real rows.
 *
 * Deliberate product decision from the handoff: mode (voice/text) is NOT shown here — both are the
 * same interview, stored as one text transcript.
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import { useGetMyInterviewsQuery } from "../api";
import AppNav from "../components/AppNav";
import ResumeBanner from "../components/ResumeBanner";
import InterviewsTable from "../components/InterviewsTable";

const FILTERS = ["All", "Scored", "In progress"] as const;
type Filter = (typeof FILTERS)[number];

export default function InterviewsPage() {
    const navigate = useNavigate();
    const [filter, setFilter] = useState<Filter>("All");

    // The full history plus the one resumable interview (so the shared table can show its Resume
    // button). Same {interviews:[...]} shape; the resumable query narrows server-side to 0-or-1.
    const { data, isLoading, error } = useGetMyInterviewsQuery();
    const { data: resumableData } = useGetMyInterviewsQuery({ resumable: true });
    const interviews = data?.interviews ?? [];
    const resumableId = resumableData?.interviews[0]?.interview_id ?? null;

    // Real counts for the subtitle, derived from the list (overall !== null == scored).
    const scored = interviews.filter((iv) => iv.overall !== null).length;

    return (
        <div className="min-h-screen bg-bg text-ink">
            <AppNav />

            <div className="mx-auto max-w-[1280px]">
                {/* Header */}
                <div className="px-7 pb-3 pt-[26px]">
                    <div className="flex items-end justify-between gap-5">
                        <div>
                            <h1 className="font-heading text-[30px] font-medium leading-[1.1] tracking-[-0.02em]">
                                Past interviews
                            </h1>
                            <p className="mt-1.5 text-[13.5px] text-neutral-400">
                                {interviews.length} sessions · {scored} scored
                            </p>
                        </div>
                        {/* Starting an interview needs the role/level pickers, which live in the Dashboard's
                            "Start an interview" card — so send the user there rather than duplicate the
                            kickoff form (or POST with guessed defaults). The interview is created there,
                            then /session is entered with it in route state. */}
                        <button className="btn btn-primary text-sm" onClick={() => navigate("/")}>
                            New interview
                        </button>
                    </div>

                    {/* Unfinished session banner — the same affordance as the Dashboard, so a user
                        landing here can resume without a detour home. Renders only when one exists. */}
                    <ResumeBanner className="mt-5" />

                    {/* Filter row — static placeholder; wiring search/filter is a later slice. */}
                    <div className="mt-5 flex flex-wrap items-center gap-2.5">
                        <input
                            className="input w-[280px] text-[13.5px]"
                            placeholder="Search role, question or transcript…"
                        />
                        <div className="seg">
                            {FILTERS.map((f) => (
                                <button
                                    key={f}
                                    type="button"
                                    className={"seg-opt" + (filter === f ? " is-active" : "")}
                                    onClick={() => setFilter(f)}
                                >
                                    {f}
                                </button>
                            ))}
                        </div>
                        <span className="tag tag-outline">All roles</span>
                        <span className="tag tag-outline">All levels</span>
                        <span className="ml-auto text-[13px] text-neutral-400">Sort: Newest first</span>
                    </div>
                </div>

                {/* List — the shared table, fed real data. */}
                <div className="px-7 pb-[26px] pt-2">
                    {isLoading && <p className="px-3 py-6 text-[13.5px] text-neutral-400">Loading…</p>}
                    {error && (
                        <p className="px-3 py-6 text-[13.5px] text-gap">Couldn't load your interviews.</p>
                    )}
                    {!isLoading && !error && (
                        <InterviewsTable interviews={interviews} resumableId={resumableId} />
                    )}
                </div>
            </div>
        </div>
    );
}
