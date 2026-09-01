/**
 * Interview detail — transcript + scorecard, Nocturne mock 3b.
 *
 * DESIGN/LAYOUT ONLY: static content matching the handoff. The transcript reuses the
 * shared <MessageRow> (same bubble as the text session); the scorecard is built here.
 * `:id` is read from the route but not used to fetch — TODO(wire) marks where it would.
 */
import { useParams, Link } from "react-router";
import AppNav from "../components/AppNav";
import MessageRow from "../components/MessageRow";

// ── Static transcript (the four turns from the mock) ──────────────────────────
const TRANSCRIPT = [
    {
        who: "interviewer" as const,
        kicker: "Interviewer",
        time: "6:30:51 PM",
        text: "Tell me about a time you had to debug a production issue under pressure. What was the problem and how did you approach it?",
    },
    {
        who: "you" as const,
        kicker: "You · 2m 04s",
        time: "6:30:51 PM",
        text: "I ran into an issue at my previous position that involved an API endpoint that was coded incorrectly. The endpoint was making updates to multiple student records instead of one, due to an incorrect assumption on an update query, where it used a \"student_id\" column that was not actually unique. I worked with customer service to figure out the affected records, found about 20, and went into database backups to fix them manually rather than taking a more drastic measure like a rollback.",
    },
    {
        who: "interviewer" as const,
        kicker: "Interviewer",
        time: "6:31:22 PM",
        text: "That sounds like a stressful situation, and your approach to surgical remediation was sensible. Could you walk me through the steps you took to identify the root cause in the code, and how you validated that the fix would resolve the issue without causing further damage?",
    },
    {
        who: "you" as const,
        kicker: "You · 1m 47s",
        time: "6:31:22 PM",
        text: "Since I was familiar with the area where the queries were placed, I had a good idea of where to look. To validate the fix, I seeded my local database with production data, tested locally to confirm it only updated the intended student record, then wrote unit tests with mock data — first with the non-unique column to verify it fails, then with the primary key to confirm a single row updates.",
    },
];

// ── Static scorecard ──────────────────────────────────────────────────────────
const CRITERIA = [
    { label: "Clarity of communication", value: "4.0", pct: 80 },
    { label: "Technical depth / correctness", value: "4.0", pct: 80 },
    { label: "Tradeoff reasoning", value: "4.0", pct: 80 },
    { label: "Concrete examples over generalities", value: "5.0", pct: 100 },
];

type FeedbackKind = "Strength" | "Gap" | "Next";
type QuestionCard = {
    n: number;
    rating: string;
    question: string;
    chips: { label: string; score: number }[];
    feedback: { kind: FeedbackKind; text: string }[];
};

const QUESTIONS: QuestionCard[] = [
    {
        n: 1,
        rating: "4.25",
        question: "Tell me about a time you had to debug a production issue under pressure.",
        chips: [
            { label: "Clarity", score: 4 },
            { label: "Depth", score: 4 },
            { label: "Tradeoff", score: 4 },
            { label: "Examples", score: 5 },
        ],
        feedback: [
            { kind: "Strength", text: "Excellent justification for choosing a targeted manual fix over a disruptive rollback, based on the small scope of affected data." },
            { kind: "Gap", text: "The answer does not touch on monitoring, alerting, or how the issue was initially discovered." },
            { kind: "Next", text: "Mention how the incident was detected to round out the incident response lifecycle." },
        ],
    },
    {
        n: 2,
        rating: "4.5",
        question: "Walk me through identifying the root cause and validating the fix.",
        chips: [
            { label: "Clarity", score: 4 },
            { label: "Depth", score: 5 },
            { label: "Tradeoff", score: 4 },
            { label: "Examples", score: 5 },
        ],
        feedback: [
            { kind: "Strength", text: "Testing the failing case before the fix is a strong validation habit and you named it explicitly." },
            { kind: "Next", text: "Say what you would add to prevent recurrence — a constraint on the column, or a code review check." },
        ],
    },
];

// Feedback label pills — three kinds, each its own colour (theme feedback tokens + accent).
const FEEDBACK_STYLE: Record<FeedbackKind, string> = {
    Strength: "border-strength-border bg-strength-bg text-strength",
    Gap: "border-gap-border bg-gap-bg text-gap",
    Next: "border-accent-700 bg-accent-900 text-accent-300",
};

export default function InterviewDetailPage() {
    const { id } = useParams(); // TODO(wire): useGetInterviewDetailQuery(id)

    // Overall 4.25 / 5 → dasharray (4.25/5 × 176 ≈ 149.5) on the donut.
    const overall = 4.25;
    const dash = (overall / 5) * 176;

    return (
        <div className="min-h-screen bg-bg text-ink">
            <AppNav />

            <div className="mx-auto max-w-[1280px]">
                {/* Header block */}
                <div className="border-b border-divider px-7 pb-5 pt-[22px]">
                    <div className="text-[13px] text-neutral-400">
                        <Link to="/interviews" className="text-neutral-400 hover:text-accent">
                            Interviews
                        </Link>{" "}
                        / <span className="text-neutral-300">27 Aug · Backend engineer{id ? "" : ""}</span>
                    </div>
                    <h1 className="mt-2 font-heading text-[29px] font-medium leading-[1.1] tracking-[-0.02em]">
                        Backend engineer · Entry level
                    </h1>
                    <div className="mt-2 flex flex-wrap items-center gap-3.5 text-[13.5px] text-neutral-400">
                        <span>27 Aug 2026, 6:30 PM</span>
                        <span>·</span>
                        <span>18m 42s</span>
                        <span>·</span>
                        <span>4 questions</span>
                    </div>
                </div>

                {/* Body */}
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px]">
                    {/* Transcript */}
                    <div className="flex flex-col gap-[22px] border-divider px-7 pb-8 pt-6 lg:border-r">
                        <h2 className="font-heading text-[19px] font-medium tracking-[-0.01em]">Transcript</h2>
                        {TRANSCRIPT.map((t, i) => (
                            <MessageRow
                                key={i}
                                who={t.who}
                                kicker={t.kicker}
                                text={t.text}
                                timestamp={t.time}
                                maxWidth={600}
                            />
                        ))}
                    </div>

                    {/* Scorecard */}
                    <div className="flex flex-col gap-[22px] px-6 pb-8 pt-6">
                        {/* Overall + donut */}
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <div className="kicker">Scorecard</div>
                                <div className="mt-1.5 flex items-baseline gap-1.5">
                                    <span className="font-heading text-[44px] font-medium leading-none tracking-[-0.02em]">
                                        {overall}
                                    </span>
                                    <span className="text-[15px] text-neutral-400">/ 5 overall</span>
                                </div>
                                <div className="mt-1.5 text-[13px] text-accent-300">
                                    Above your Entry-level average of 3.8
                                </div>
                            </div>
                            <svg width="66" height="66" viewBox="0 0 66 66">
                                <circle cx="33" cy="33" r="28" fill="none" stroke="var(--color-neutral-800)" strokeWidth="5" />
                                <circle
                                    cx="33"
                                    cy="33"
                                    r="28"
                                    fill="none"
                                    stroke="var(--color-accent)"
                                    strokeWidth="5"
                                    strokeLinecap="round"
                                    strokeDasharray={`${dash} 176`}
                                    transform="rotate(-90 33 33)"
                                />
                            </svg>
                        </div>

                        {/* Criteria bars */}
                        <div className="flex flex-col gap-[13px]">
                            {CRITERIA.map((c) => (
                                <div key={c.label}>
                                    <div className="flex justify-between text-[13.5px]">
                                        <span>{c.label}</span>
                                        <span className="text-neutral-300">{c.value}</span>
                                    </div>
                                    <div className="mt-[5px] h-1.5 rounded-[3px] bg-neutral-800">
                                        <div className="h-1.5 rounded-[3px] bg-accent" style={{ width: `${c.pct}%` }} />
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Per-question cards */}
                        {QUESTIONS.map((q) => (
                            <div key={q.n} className="rounded-md border border-divider px-4 py-[15px]">
                                <div className="flex items-baseline justify-between gap-3">
                                    <span className="kicker">Question {q.n}</span>
                                    <span className="text-[13px] text-neutral-300">{q.rating}</span>
                                </div>
                                <p className="mt-2 text-[14px] leading-[1.45] [text-wrap:pretty]">{q.question}</p>

                                {/* Chip row */}
                                <div className="mt-3 flex gap-[5px]">
                                    {q.chips.map((chip) => (
                                        <span
                                            key={chip.label}
                                            className={
                                                "flex-1 rounded-sm py-[5px] text-center text-[12px] " +
                                                (chip.score === 5
                                                    ? "bg-accent-900 text-accent-200"
                                                    : "bg-neutral-900 text-neutral-300")
                                            }
                                        >
                                            {chip.label} {chip.score}
                                        </span>
                                    ))}
                                </div>

                                {/* Feedback items */}
                                <div className="mt-3.5 flex flex-col gap-[11px] text-[13.5px] leading-[1.45]">
                                    {q.feedback.map((f, i) => (
                                        <div key={i} className="flex items-start gap-2.5">
                                            <span className={"tag flex-none border " + FEEDBACK_STYLE[f.kind]}>
                                                {f.kind}
                                            </span>
                                            <span className="[text-wrap:pretty]">{f.text}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
