/**
 * Past interviews — list, Nocturne mock 3a. Every session, filterable, each reopenable.
 *
 * DESIGN/LAYOUT ONLY: static rows matching the handoff copy; the filter controls carry
 * local state so they toggle, but nothing filters the (static) list yet. Rows and the
 * "New interview" button route. Production wiring points are flagged `// TODO(wire)`.
 *
 * Deliberate product decision from the handoff: mode (voice/text) is NOT shown here —
 * both are the same interview, stored as one text transcript.
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import AppNav from "../components/AppNav";

type Row = {
    id: string;
    role: string;
    level: string;
    date: string;
} & (
    | { status: "scored"; topic: string; questions: number; score: string }
    | { status: "in-progress"; answered: number; questions: number }
);

const ROWS: Row[] = [
    { id: "1", role: "Backend engineer", level: "Entry level", date: "27 Aug", status: "scored", topic: "Debugging under pressure", questions: 4, score: "4.25" },
    { id: "2", role: "Product manager", level: "Entry level", date: "27 Aug", status: "scored", topic: "Prioritisation and stakeholders", questions: 5, score: "4.25" },
    { id: "3", role: "Backend engineer", level: "Mid level", date: "27 Aug", status: "in-progress", answered: 2, questions: 6 },
    { id: "4", role: "Backend engineer", level: "Mid level", date: "27 Aug", status: "scored", topic: "Caching and read scaling", questions: 6, score: "4.5" },
    { id: "5", role: "Backend engineer", level: "Senior", date: "25 Aug", status: "scored", topic: "Incident response", questions: 5, score: "4.0" },
    { id: "6", role: "Backend engineer", level: "Mid level", date: "25 Aug", status: "in-progress", answered: 1, questions: 6 },
    { id: "7", role: "Product manager", level: "Entry level", date: "24 Aug", status: "scored", topic: "Roadmap tradeoffs", questions: 4, score: "3.0" },
];

const FILTERS = ["All", "Scored", "In progress"] as const;
type Filter = (typeof FILTERS)[number];

const GRID = "grid grid-cols-[1fr_110px_140px] gap-3.5";

export default function InterviewsPage() {
    const navigate = useNavigate();
    const [filter, setFilter] = useState<Filter>("All");

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
                                28 sessions · 14 scored · 6 still in progress
                            </p>
                        </div>
                        {/* TODO(wire): start a new interview */}
                        <button className="btn btn-primary text-sm" onClick={() => navigate("/session")}>
                            New interview
                        </button>
                    </div>

                    {/* Filter row */}
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

                {/* Rows */}
                <div className="px-7 pb-[26px] pt-2">
                    {/* Column header */}
                    <div className={GRID + " kicker border-b border-divider px-3 pb-2"}>
                        <span>Interview</span>
                        <span>Date</span>
                        <span className="text-right">Score</span>
                    </div>

                    {ROWS.map((row) => (
                        <div
                            key={row.id}
                            className={GRID + " items-center rounded-sm border-b border-divider px-3 py-3.5 hover:bg-neutral-900"}
                        >
                            {/* Interview cell */}
                            <div>
                                <div className="text-[15px]">
                                    {row.role} <span className="text-neutral-400">· {row.level}</span>
                                </div>
                                {row.status === "scored" ? (
                                    <div className="mt-[3px] text-[12.5px] text-neutral-400">
                                        {row.topic} · {row.questions} questions
                                    </div>
                                ) : (
                                    <div className="mt-[3px] flex items-center gap-2 text-[12.5px] text-neutral-400">
                                        <span className="h-[5px] w-[5px] rounded-full bg-accent" />
                                        In progress · answered {row.answered} of {row.questions}
                                    </div>
                                )}
                            </div>

                            {/* Date */}
                            <span className="text-[13.5px] text-neutral-300">{row.date}</span>

                            {/* Score cell */}
                            <div className="flex items-center justify-end gap-3">
                                {row.status === "scored" ? (
                                    <>
                                        <span className="font-heading text-[19px]">
                                            {row.score}
                                            <span className="text-[13px] text-neutral-400">/5</span>
                                        </span>
                                        <button
                                            className="btn btn-ghost text-[13px]"
                                            onClick={() => navigate(`/interviews/${row.id}`)}
                                        >
                                            Open
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <span className="text-[13.5px] text-neutral-400">Not scored</span>
                                        <button
                                            className="btn btn-primary text-[13px]"
                                            onClick={() => navigate("/session")}
                                        >
                                            Resume
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    ))}

                    {/* Footer / pagination */}
                    <div className="mt-[18px] flex items-center justify-between text-[13px] text-neutral-400">
                        <span>Showing 7 of 28</span>
                        <div className="flex gap-2">
                            <button className="btn btn-ghost text-[13px]">Previous</button>
                            <button className="btn btn-secondary text-[13px]">Next</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
