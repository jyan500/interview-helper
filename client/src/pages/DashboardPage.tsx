/**
 * Dashboard — Nocturne mock 1a. Start an interview in two decisions (role + level),
 * and see whether you're improving.
 *
 * DESIGN/LAYOUT ONLY. Everything here is static mock data matching the handoff copy;
 * the buttons route but nothing is fetched or persisted. Production wiring points are
 * flagged with `// TODO(wire)`.
 *
 * Fluid, not fixed: the mock's 1440px frame becomes a max-width container, and the
 * two-column body collapses to one column below ~1024px (lg:).
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import AppNav from "../components/AppNav";

// The four seniority levels, in rank order (the active one takes the accent tint).
const LEVELS = ["Entry", "Mid", "Senior", "Staff"] as const;
type Level = (typeof LEVELS)[number];

// Static history rows — the "Past interviews" table in the mock.
const PAST = [
    { role: "Backend Engineer · Mid", date: "1 Sep", score: 78, takeaway: "Strong on schema design, thin on tradeoffs" },
    { role: "Backend Engineer · Mid", date: "28 Aug", score: 71, takeaway: "Answers ran long; missed the ask twice" },
    { role: "Platform Engineer · Senior", date: "24 Aug", score: 65, takeaway: "Needs sharper failure-mode reasoning" },
    { role: "Backend Engineer · Mid", date: "19 Aug", score: 62, takeaway: "Good structure, shallow on caching" },
];

// Static skill bars. The weakest one uses accent-300 so it reads as the low bar.
const SKILLS = [
    { label: "Communication", value: 86, weak: false },
    { label: "Technical depth", value: 74, weak: false },
    { label: "Structure (STAR)", value: 69, weak: false },
    { label: "Tradeoff reasoning", value: 54, weak: true },
];

const WORK_ON_NEXT = [
    "Name the tradeoff before choosing. Two answers on 1 Sep skipped it.",
    "Cap answers near 90 seconds — your median is 2m 40s.",
    "Practice cache invalidation; it came up twice and stalled both times.",
];

export default function DashboardPage() {
    const navigate = useNavigate();
    const [level, setLevel] = useState<Level>("Mid");

    return (
        <div className="min-h-screen bg-bg text-ink">
            <AppNav />

            <div className="mx-auto max-w-[1440px]">
                {/* Greeting */}
                <div className="px-7 pt-[22px]">
                    <div className="kicker">Wednesday, 3 September</div>
                    <h1 className="mt-1.5 font-heading text-[34px] font-medium leading-[1.05]">
                        Good afternoon, Jian
                    </h1>
                </div>

                {/* Two-column body — collapses to one column below lg */}
                <div className="grid grid-cols-1 gap-6 px-7 pb-[30px] pt-[22px] lg:grid-cols-[1fr_372px]">
                    {/* ── Left column ─────────────────────────────────────────── */}
                    <div className="flex flex-col gap-5">
                        {/* Unfinished session banner — render only when one exists */}
                        <div className="flex items-center justify-between gap-4 rounded-md border border-accent-600 bg-accent-900 px-[18px] py-4">
                            <div>
                                <div className="kicker text-accent-300">Unfinished session</div>
                                <div className="mt-0.5 font-heading text-[20px]">Mid-level Backend Engineer</div>
                            </div>
                            <div className="flex gap-2">
                                <button className="btn btn-ghost">Discard</button>
                                {/* TODO(wire): resume the in-progress interview */}
                                <button className="btn btn-primary" onClick={() => navigate("/session")}>
                                    Resume
                                </button>
                            </div>
                        </div>

                        {/* Start an interview */}
                        <div className="rounded-md border border-divider px-[22px] pb-[22px] pt-5">
                            <h2 className="font-heading text-[23px] font-medium">Start an interview</h2>

                            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <div className="field">
                                    {/* TODO(wire): swap for the searchable role combobox (react-select async) */}
                                    <label>Role</label>
                                    <input className="input" defaultValue="Backend Engineer" />
                                </div>
                                <div className="field">
                                    <label>Level</label>
                                    <div className="seg">
                                        {LEVELS.map((l) => (
                                            <button
                                                key={l}
                                                type="button"
                                                className={"seg-opt" + (level === l ? " is-active" : "")}
                                                onClick={() => setLevel(l)}
                                            >
                                                {l}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="mt-[18px] flex justify-end">
                                {/* TODO(wire): POST /api/interview then route to /session */}
                                <button
                                    className="btn btn-primary text-[15px]"
                                    style={{ padding: "11px 26px" }}
                                    onClick={() => navigate("/session")}
                                >
                                    Start interview
                                </button>
                            </div>
                        </div>

                        {/* Past interviews */}
                        <div className="rounded-md border border-divider px-[22px] pb-2 pt-[18px]">
                            <div className="mb-2 flex items-baseline justify-between">
                                <h2 className="font-heading text-[23px] font-medium">Past interviews</h2>
                                <div className="flex items-center gap-2 text-[13px] text-neutral-400">
                                    <span className="tag tag-outline">All roles</span>
                                    <span>View all (14)</span>
                                </div>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th>Interview</th>
                                            <th>Date</th>
                                            <th>Score</th>
                                            <th>Takeaway</th>
                                            <th></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {PAST.map((row, i) => (
                                            <tr key={i}>
                                                <td className="whitespace-nowrap">{row.role}</td>
                                                <td className="whitespace-nowrap">{row.date}</td>
                                                <td>
                                                    <strong>{row.score}</strong>
                                                </td>
                                                <td className="text-neutral-300">{row.takeaway}</td>
                                                <td className="text-right">
                                                    <button
                                                        className="text-accent-300"
                                                        onClick={() => navigate("/interviews/1")}
                                                    >
                                                        Transcript
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* ── Right column (signal) ───────────────────────────────── */}
                    <div className="flex flex-col gap-5">
                        {/* Readiness */}
                        <div className="rounded-md border border-divider px-5 py-[18px]">
                            <div className="kicker">Readiness</div>
                            <div className="mt-1 flex items-end gap-2.5">
                                <span className="font-heading text-[46px] leading-none">78</span>
                                <span className="pb-2 text-[13px] text-accent-300">+7 over 4 sessions</span>
                            </div>
                            <svg
                                viewBox="0 0 320 74"
                                className="mt-2 h-[74px] w-full"
                                preserveAspectRatio="none"
                            >
                                <line x1="0" y1="73" x2="320" y2="73" stroke="var(--color-divider)" />
                                <line x1="0" y1="37" x2="320" y2="37" stroke="var(--color-divider)" strokeDasharray="3 4" />
                                <polyline
                                    points="4,62 56,58 108,49 160,52 212,38 264,30 316,20"
                                    fill="none"
                                    stroke="var(--color-accent)"
                                    strokeWidth="1.5"
                                />
                                <circle cx="316" cy="20" r="3" fill="var(--color-accent)" />
                            </svg>
                        </div>

                        {/* Skill breakdown */}
                        <div className="rounded-md border border-divider px-5 py-[18px]">
                            <div className="kicker">Skill breakdown</div>
                            <div className="mt-3 flex flex-col gap-[11px] text-[13px]">
                                {SKILLS.map((s) => (
                                    <div key={s.label}>
                                        <div className="flex justify-between">
                                            <span>{s.label}</span>
                                            <span>{s.value}</span>
                                        </div>
                                        <div className="mt-1 h-1.5 rounded-[3px] bg-neutral-800">
                                            <div
                                                className={"h-1.5 rounded-[3px] " + (s.weak ? "bg-accent-300" : "bg-accent")}
                                                style={{ width: `${s.value}%` }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Work on next */}
                        <div className="rounded-md border border-divider px-5 py-[18px]">
                            <div className="kicker">Work on next</div>
                            <div className="mt-3 flex flex-col gap-3 text-[13.5px] leading-[1.4]">
                                {WORK_ON_NEXT.map((item, i) => (
                                    <div key={i} className="flex gap-2.5">
                                        <span className="font-heading text-[15px] text-accent-300">
                                            {String(i + 1).padStart(2, "0")}
                                        </span>
                                        <span>{item}</span>
                                    </div>
                                ))}
                            </div>
                            <button className="btn btn-secondary btn-block mt-3.5">Drill these in 10 min</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
