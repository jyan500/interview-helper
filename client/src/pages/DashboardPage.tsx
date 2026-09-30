/**
 * Dashboard — job-interview-first (Nocturne mock 1a's two-column frame). Start a round for one of
 * your saved jobs, review your recent graded interviews, and see whether you're improving.
 *
 * UI vocabulary: a "Job" interview is what the code/API call a simulation (`job_id` set); a
 * "Practice" interview is a role + level bank one.
 *
 *   Left:  the resume banner, "Start a job interview" (SimulationKickoff: job picker + round cards),
 *          "Past interviews" (the newest few graded ones, both kinds, each row tagged Job/Practice),
 *          and "Your question bank" (QuestionBankCard: a read-only preview of the saved bank questions).
 *   Right: the signal panel (SignalPanel, job interviews only), scoped by round (+ optional job) and
 *          window.
 *
 * Bank practice itself (role + level, and curating the saved "My questions" it asks) lives on the
 * Questions page; the dashboard only calls back to it.
 *
 * Fluid, not fixed: the mock's 1440px frame becomes a max-width container, and the two-column body
 * collapses to one column below ~1024px (lg:).
 */
import { Link } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { useGetMyInterviewsQuery } from "../api";
import AppNav from "../components/AppNav";
import ResumeBanner from "../components/ResumeBanner";
import InterviewsTable from "../components/InterviewsTable";
import QuestionBankCard from "../components/QuestionBankCard";
import SignalPanel from "../components/SignalPanel";
import SimulationKickoff from "../components/SimulationKickoff";

// How many recent interviews the dashboard card shows before "View all" takes over. Sent as the page
// `size` so the server returns just this many (page 1, newest first) rather than the whole history.
const DASHBOARD_ROWS = 5;

export default function DashboardPage() {
    const { session } = useAuth();

    // Past interviews — the newest few GRADED interviews of BOTH kinds (scored: true hides
    // in-progress/abandoned ones, whose Score column would be blank; each row's Type tag tells Job from
    // Practice), and, separately, the one resumable interview so the table can show its Resume button.
    // Filtering by kind lives on the full Interviews page ("View all"). The unfinished interview isn't
    // lost from this page — the ResumeBanner above surfaces it.
    const { data: interviewsData, isFetching } = useGetMyInterviewsQuery({
        size: DASHBOARD_ROWS,
        scored: true,
    });
    const { data: resumableData } = useGetMyInterviewsQuery({ resumable: true });
    const interviews = interviewsData?.items ?? [];
    const resumableId = resumableData?.items[0]?.interview_id ?? null;

    return (
        <div className="min-h-screen bg-bg text-ink">
            <AppNav />

            <div className="mx-auto max-w-[1440px]">
                {/* Greeting */}
                <div className="px-7 pt-[22px]">
                    <h1 className="mt-1.5 font-heading text-[34px] font-medium leading-[1.05]">
                        Hello, {session?.user?.user_metadata?.display_name ?? ""}
                    </h1>
                </div>

                {/* Two-column body — collapses to one column below lg */}
                <div className="grid grid-cols-1 gap-6 px-7 pb-[30px] pt-[22px] lg:grid-cols-[1fr_372px]">
                    {/* ── Left column ─────────────────────────────────────────── */}
                    <div className="flex min-w-0 flex-col gap-5">
                        {/* Unfinished session banner — self-contained: renders only when the user has
                            a resumable interview (the most-recent unfinished one), else nothing. */}
                        <ResumeBanner />

                        {/* Start a job interview — pick a job, start one of its rounds. Self-contained. */}
                        <SimulationKickoff />

                        {/* Past interviews — the newest few graded ones (both kinds), sharing
                            InterviewsTable with the full Interviews page. "View all" routes to that page. */}
                        <div className="rounded-md border border-divider px-[22px] pb-2 pt-[18px]">
                            <div className="mb-2 flex items-baseline justify-between">
                                <h2 className="font-heading text-[23px] font-medium">Past interviews</h2>
                                <Link to="/interviews" className="text-[13px] text-accent-300">
                                    View all
                                </Link>
                            </div>
                            <InterviewsTable
                                interviews={interviews}
                                resumableId={resumableId}
                                loading={isFetching}
                                skeletonRows={DASHBOARD_ROWS}
                                emptyMessage="No graded interviews yet. Start a job interview above, or a practice one from the Questions page."
                            />
                        </div>

                        {/* Your question bank — a read-only call-back to bank practice (Questions page),
                            previewing the saved questions for the default role + level. Self-contained. */}
                        <QuestionBankCard />
                    </div>

                    {/* ── Right column (signal) — job-interview readiness / skill breakdown / work on next,
                        scoped by round (+ optional job) and window; self-contained. ─────────────── */}
                    <SignalPanel />
                </div>
            </div>
        </div>
    );
}
