/**
 * Interview detail — transcript + scorecard, Nocturne mock 3b, NOW WIRED.
 *
 * This is the History detail view, reading GET /api/interviews/{id} (useGetInterviewDetailQuery).
 * It renders the SAME graded scorecard shape the live grade produces (overall + per-dimension
 * averages + per-question strength/gap/improvement), poured into the new mock-3b layout: a donut
 * ring, criteria bars, and per-question cards. The transcript reuses the shared <MessageRow>.
 *
 * NO ELAPSED TIME / QUESTION COUNT (unlike the mock): an interview's length isn't fixed (follow-ups
 * are dynamic) and we don't record per-answer durations, so the header carries just the date.
 *
 * An UNGRADED interview (scorecard === null) still shows its transcript — the scorecard column just
 * says so, no branching in the transcript itself.
 *
 * SAVING A QUESTION (job interviews only): each scorecard card gets a SaveQuestionButton, which claims
 * the generated question as a read-only practice question in "My questions". A SaveQuestionsBanner points
 * this out while at least one question is still unsaved (and until the user dismisses it).
 */
import { useParams, Link } from "react-router";
import AppNav from "../components/AppNav";
import MessageRow from "../components/MessageRow";
import ExpandableText from "../components/ExpandableText";
import FormattedText from "../components/FormattedText";
import Donut from "../components/Donut";
import ScoreBar from "../components/ScoreBar";
import InterviewDetailSkeleton from "../components/InterviewDetailSkeleton";
import InterviewKindTag from "../components/InterviewKindTag";
import SaveQuestionButton from "../components/SaveQuestionButton";
import SaveQuestionsBanner from "../components/SaveQuestionsBanner";
import { useGetInterviewDetailQuery, type AnswerGrade, type Scorecard } from "../api";
import { formatScore, formatShortDate, formatTime, interviewTitle } from "../helpers";

// Feedback label pills — three kinds, each its own colour (theme feedback tokens + accent). The
// real grade carries one sentence per kind: strength -> Strength, gap -> Gap, improvement -> Next.
type FeedbackKind = "Strength" | "Gap" | "Next";
const FEEDBACK_STYLE: Record<FeedbackKind, string> = {
    Strength: "border-strength-border bg-strength-bg text-strength",
    Gap: "border-gap-border bg-gap-bg text-gap",
    Next: "border-accent-700 bg-accent-900 text-accent-300",
};

// A question's headline rating = the mean of its own dimension scores (the persisted scorecard
// stores no per-question overall, only the whole-interview `overall`), rounded to match the mocks.
function questionRating(grade: AnswerGrade): number {
    const scores = grade.dimension_scores;
    if (scores.length === 0) return 0;
    const mean = scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
    return Math.round(mean * 100) / 100;
}

export default function InterviewDetailPage() {
    const { id } = useParams();
    // `id` is always present for this route (/interviews/:id), but the hook's arg is typed string —
    // fall back to "" so the types line up; the route never actually renders without an id.
    const { data, isLoading, error } = useGetInterviewDetailQuery(id ?? "");

    if (isLoading) return <InterviewDetailSkeleton />;

    if (error || !data) {
        return (
            <div className="min-h-screen bg-bg text-ink">
                <AppNav />
                <p className="px-7 py-10 text-[13.5px] text-gap">Couldn't load this interview.</p>
            </div>
        );
    }

    const { interview_id, created_at, turns, scorecard, job_id, saved_question_ids } = data;
    // company · round for a job simulation, role · level for a bank interview
    const [title, subtitle] = interviewTitle(data);
    // the save banner only makes sense on a graded job interview with a question still unsaved
    const hasUnsavedQuestion = Boolean(
        job_id && scorecard?.answers.some((grade) => !saved_question_ids.includes(grade.question_id))
    );

    return (
        <div className="min-h-screen bg-bg text-ink">
            <AppNav />

            <div className="mx-auto max-w-[1280px]">
                {/* Header block */}
                <div className="border-b border-divider px-7 pb-5 pt-[22px]">
                    {/* A simulation's crumb leads back to its job (where its other rounds live). */}
                    <div className="text-[13px] text-neutral-400">
                        {job_id ? (
                            <Link to={`/jobs/${job_id}`} className="text-neutral-400 hover:text-accent">
                                {title}
                            </Link>
                        ) : (
                            <Link to="/interviews" className="text-neutral-400 hover:text-accent">
                                Interviews
                            </Link>
                        )}{" "}
                        / <span className="text-neutral-300">{formatShortDate(created_at)} · {job_id ? subtitle : title}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                        <h1 className="font-heading text-[29px] font-medium leading-[1.1] tracking-[-0.02em]">
                            {title} · {subtitle}
                        </h1>
                        <InterviewKindTag jobId={job_id} />
                    </div>
                </div>

                {hasUnsavedQuestion && <SaveQuestionsBanner className="mx-7 mt-5" />}

                {/* Body */}
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px]">
                    {/* Transcript */}
                    <div className="flex flex-col gap-[22px] border-divider px-7 pb-8 pt-6 lg:border-r">
                        <h2 className="font-heading text-[19px] font-medium tracking-[-0.01em]">Transcript</h2>
                        {turns.map((turn, i) => (
                            <div key={i} className="flex flex-col gap-[22px]">
                                <MessageRow
                                    who="interviewer"
                                    kicker="Interviewer"
                                    text={turn.question_text}
                                    timestamp={formatTime(turn.at)}
                                    maxWidth={600}
                                />
                                {/* answer is null for the OPEN turn (presented, not yet answered) — skip it */}
                                {turn.answer !== null && (
                                    <MessageRow
                                        who="you"
                                        kicker="You"
                                        text={turn.answer}
                                        timestamp={formatTime(turn.at)}
                                        maxWidth={600}
                                    />
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Scorecard */}
                    <div className="flex flex-col gap-[22px] px-6 pb-8 pt-6">
                        {scorecard ? (
                            <ScorecardPanel
                                card={scorecard}
                                interviewId={interview_id}
                                isJobInterview={Boolean(job_id)}
                                savedQuestionIds={saved_question_ids}
                            />
                        ) : (
                            <div>
                                <div className="kicker">Scorecard</div>
                                <p className="mt-2 text-[13.5px] text-neutral-400 [text-wrap:pretty]">
                                    This interview hasn't been graded yet.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// The graded panel — overall donut, per-dimension criteria bars, and one card per question. Split
// out so the null (ungraded) case above stays a plain one-liner and this only renders with a grade.
// A job interview's cards also get a SaveQuestionButton.
function ScorecardPanel({
    card,
    interviewId,
    isJobInterview,
    savedQuestionIds,
}: {
    card: Scorecard;
    interviewId: string;
    isJobInterview: boolean;
    savedQuestionIds: string[];
}) {
    return (
        <>
            {/* Overall + donut */}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="kicker">Scorecard</div>
                    <div className="mt-1.5 flex items-baseline gap-1.5">
                        <span className="font-heading text-[44px] font-medium leading-none tracking-[-0.02em]">
                            {formatScore(card.overall)}
                        </span>
                        <span className="text-[15px] text-neutral-400">/ 5 overall</span>
                    </div>
                </div>
                <Donut value={card.overall} max={5} />
            </div>

            {/* Criteria bars — one per rubric dimension, grouped by question KIND: each kind is graded
                on its own question type's rubric, so a mixed Practice interview gets one group per kind
                (the kind label shows only then). Shared <ScoreBar> with the dashboard's skill breakdown. */}
            {card.kind_averages.map((group) => (
                <div key={group.kind} className="flex flex-col gap-[13px]">
                    {card.kind_averages.length > 1 && <div className="kicker">{group.kind}</div>}
                    {Object.entries(group.dimension_averages).map(([dimension, avg]) => (
                        <ScoreBar key={dimension} label={dimension} value={avg} />
                    ))}
                </div>
            ))}

            {/* Per-question cards */}
            {card.answers.map((grade, i) => {
                // Strength/Gap/Next map to the grade's three sentences — skip any the grader left blank.
                const feedback = ([
                    { kind: "Strength", text: grade.strength },
                    { kind: "Gap", text: grade.gap },
                    { kind: "Next", text: grade.improvement },
                ] as { kind: FeedbackKind; text: string }[]).filter((f) => f.text.trim());

                return (
                    <div key={i} className="rounded-md border border-divider px-4 py-[15px]">
                        <div className="flex items-baseline justify-between gap-3">
                            <span className="kicker">
                                Question {i + 1} · {grade.kind}
                            </span>
                            {/* a skipped question is graded with no dimension scores (and is left out of
                                the averages), so it shows as skipped rather than a 0 */}
                            <span className="text-[13px] text-neutral-300">
                                {grade.dimension_scores.length === 0 ? "Skipped" : formatScore(questionRating(grade))}
                            </span>
                        </div>
                        <div className="mt-2 text-[15px] font-medium text-ink">{grade.question_title}</div>
                        {/* a generated coding problem keeps its line breaks (and any example code block).
                            Clamped to ~3 lines (3 x 14px x 1.45) behind "Show more", so a long problem doesn't
                            push the feedback and the Save button far down; the full text is in the transcript. */}
                        <div className="mt-1.5">
                            <ExpandableText clampClass="max-h-[61px] overflow-hidden">
                                <FormattedText text={grade.question_text} className="text-[14px] leading-[1.45] text-neutral-300" />
                            </ExpandableText>
                        </div>

                        {/* Chip row — this question's score per dimension. Wraps, since a rubric can carry
                            more dimensions than fit one row. */}
                        <div className="mt-3 flex flex-wrap gap-[5px]">
                            {grade.dimension_scores.map((score) => (
                                <span
                                    key={score.dimension}
                                    className={
                                        "rounded-sm px-2 py-[5px] text-center text-[12px] " +
                                        (score.score === 5
                                            ? "bg-accent-900 text-accent-200"
                                            : "bg-neutral-900 text-neutral-300")
                                    }
                                >
                                    {score.dimension} {score.score}
                                </span>
                            ))}
                        </div>

                        {/* Feedback items */}
                        <div className="mt-3.5 flex flex-col gap-[11px] text-[13.5px] leading-[1.45]">
                            {feedback.map((f, j) => (
                                <div key={j} className="flex items-start gap-2">
                                    <div className = "w-1/4">
                                        <span className={"tag flex-none border " + FEEDBACK_STYLE[f.kind]}>{f.kind}</span>
                                    </div>
                                    <div className = "w-3/4">
                                        <span className="[text-wrap:pretty]">{f.text}</span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {isJobInterview && (
                            <div className="mt-3.5 flex justify-end border-t border-divider pt-3">
                                <SaveQuestionButton
                                    interviewId={interviewId}
                                    slug={grade.question_id}
                                    saved={savedQuestionIds.includes(grade.question_id)}
                                />
                            </div>
                        )}
                    </div>
                );
            })}
        </>
    );
}
