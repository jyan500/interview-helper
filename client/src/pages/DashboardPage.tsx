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
import { useNavigate } from "react-router";
import { useForm } from "react-hook-form";
import { useAuth } from "../auth/AuthProvider"
import { useLazyGetLevelsQuery, useLazyGetRolesQuery, useStartInterviewMutation } from "../api";
import { ControlledAsyncPaginateSelect } from "../components/ControlledAsyncPaginateSelect";
import type { SelectOption } from "../components/AsyncPaginateSelect";
import AppNav from "../components/AppNav";
import Sparkline from "../components/Sparkline";

// The kickoff form's shape — the same one App.tsx's legacy flow uses. Each field holds react-select's
// Option ({ value: slug, label: name }) or null until picked; onStart unwraps `.value` to the slug the
// backend wants and `.label` for the session header. Kept as Option (not a bare slug) so the async
// select can show the chosen label without re-fetching it.
type StartFormValues = {
    role: SelectOption | null;
    level: SelectOption | null;
};

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

// The readiness score series feeding the sparkline (oldest → newest, ending at 78).
const READINESS = [58, 61, 66, 64, 70, 74, 78];

const WORK_ON_NEXT = [
    "Name the tradeoff before choosing. Two answers on 1 Sep skipped it.",
    "Cap answers near 90 seconds — your median is 2m 40s.",
    "Practice cache invalidation; it came up twice and stalled both times.",
];

export default function DashboardPage() {
    const navigate = useNavigate();
    const { session } = useAuth();

    // The kickoff form — RHF owns the role/level Options; mode "onChange" keeps formState.isValid live
    // so the Start button enables the instant both required fields are picked. Same setup as App.tsx.
    const { control, handleSubmit, formState } = useForm<StartFormValues>({
        defaultValues: { role: null, level: null },
        mode: "onChange",
    });
    // LAZY option triggers handed straight to the two async selects as their `fetchPage` — the select
    // owns paginate/map, we only inject WHICH endpoint (see ControlledAsyncPaginateSelect).
    const [triggerRoles] = useLazyGetRolesQuery();
    const [triggerLevels] = useLazyGetLevelsQuery();

    // The KICKOFF: POST /api/interview, then hand the fresh interview to /session via route state
    // (SessionLayout guards on it; SessionPage seeds the first question + speaks it from firstMessage).
    // We never navigate to /session without a real interview — that's the whole producer/consumer split.
    const [startInterview, { isLoading: starting }] = useStartInterviewMutation();
    async function onStart({ role, level }: StartFormValues) {
        if (!role || !level) return; // narrows Option | null -> Option; `required` already guarantees it
        const res = await startInterview({ role: role.value, seniority: level.value }).unwrap();
        navigate("/session", {
            state: {
                interviewId: res.interview_id,
                firstMessage: res.message,
                role: role.label, // human-readable labels for the session header
                level: level.label,
            },
        });
    }

    return (
        <div className="min-h-screen bg-bg text-ink">
            <AppNav />

            <div className="mx-auto max-w-[1440px]">
                {/* Greeting */}
                <div className="px-7 pt-[22px]">
                    <div className="kicker">Wednesday, 3 September</div>
                    <h1 className="mt-1.5 font-heading text-[34px] font-medium leading-[1.05]">
                        Hello, {session?.user?.user_metadata?.display_name ?? ""}
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

                        {/* Start an interview — the searchable async role/level pickers (slugs), the same
                            widgets the legacy flow used, wrapped in RHF so both are required before Start
                            enables. handleSubmit(onStart) fires POST /api/interview then routes to /session. */}
                        <form
                            onSubmit={handleSubmit(onStart)}
                            className="rounded-md border border-divider px-[22px] pb-[22px] pt-5"
                        >
                            <h2 className="font-heading text-[23px] font-medium">Start an interview</h2>

                            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <div className="field">
                                    <label>Role</label>
                                    <ControlledAsyncPaginateSelect
                                        control={control}
                                        name="role"
                                        rules={{ required: true }}
                                        fetchPage={triggerRoles}
                                        placeholder="Search roles…"
                                    />
                                </div>
                                <div className="field">
                                    <label>Level</label>
                                    <ControlledAsyncPaginateSelect
                                        control={control}
                                        name="level"
                                        rules={{ required: true }}
                                        fetchPage={triggerLevels}
                                        placeholder="Search levels…"
                                    />
                                </div>
                            </div>

                            <div className="mt-[18px] flex justify-end">
                                <button
                                    type="submit"
                                    // disabled until BOTH required selects are valid, and while the POST is in flight
                                    disabled={starting || !formState.isValid}
                                    className="btn btn-primary text-[15px] disabled:opacity-50"
                                    style={{ padding: "11px 26px" }}
                                >
                                    {starting ? "Starting…" : "Start interview"}
                                </button>
                            </div>
                        </form>

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
                            <div className="mt-2">
                                <Sparkline data={READINESS} />
                            </div>
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
