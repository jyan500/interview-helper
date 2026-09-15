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
import { useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router";
import { useForm } from "react-hook-form";
import { useAuth } from "../auth/AuthProvider"
import { useToast } from "../toast/ToastProvider";
import {
    useGetMyInterviewsQuery,
    useGetProfileQuery,
    useLazyGetLevelsQuery,
    useLazyGetRolesQuery,
    useStartInterviewMutation,
    useUpdateProfileMutation,
} from "../api";
import { ControlledAsyncPaginateSelect } from "../components/ControlledAsyncPaginateSelect";
import type { SelectOption } from "../components/AsyncPaginateSelect";
import AppNav from "../components/AppNav";
import ResumeBanner from "../components/ResumeBanner";
import InterviewsTable from "../components/InterviewsTable";
import SignalPanel from "../components/SignalPanel";

// The kickoff form's shape — the same one App.tsx's legacy flow uses. Each field holds react-select's
// Option ({ value: slug, label: name }) or null until picked; onStart unwraps `.value` to the slug the
// backend wants and `.label` for the session header. Kept as Option (not a bare slug) so the async
// select can show the chosen label without re-fetching it.
type StartFormValues = {
    role: SelectOption | null;
    level: SelectOption | null;
};

// How many recent interviews the dashboard card shows before "View all" takes over. Sent as the
// page `size` so the server returns just this many (page 1, newest first) rather than the whole history.
const DASHBOARD_ROWS = 5;

export default function DashboardPage() {
    const navigate = useNavigate();
    const { session } = useAuth();

    // The kickoff form — RHF owns the role/level Options; mode "onChange" keeps formState.isValid live
    // so the Start button enables the instant both required fields are picked. Same setup as App.tsx.
    const { control, handleSubmit, formState, setValue, watch } = useForm<StartFormValues>({
        defaultValues: { role: null, level: null },
        mode: "onChange",
    });

    // PRE-FILL from the user's saved default (GET /api/profile), once — so a returning user opens on
    // the role/level they usually practise instead of two empty pickers. Seeded via setValue (not the
    // form's defaultValues, which are fixed before the profile loads) and guarded by a ref so it never
    // clobbers a pick the user has since made. A profile with no default leaves the pickers empty.
    const { data: profile } = useGetProfileQuery();
    const seededDefaults = useRef(false);
    useEffect(() => {
        if (seededDefaults.current || !profile) return;
        if (profile.role) setValue("role", { value: profile.role.slug, label: profile.role.name });
        if (profile.level) setValue("level", { value: profile.level.slug, label: profile.level.name });
        seededDefaults.current = true;
    }, [profile, setValue]);

    // "Set as default" — persist the currently-picked role + level to the profile (PATCH /api/profile),
    // so it becomes next visit's pre-fill and the signal panel's default scope. Watched so the button
    // enables only once both are picked; a toast confirms (or reports) the write without a route change.
    const { toast } = useToast();
    const [saveDefault, { isLoading: savingDefault }] = useUpdateProfileMutation();
    const roleValue = watch("role");
    const levelValue = watch("level");
    async function onSetDefault() {
        if (!roleValue || !levelValue) return;
        try {
            await saveDefault({ role: roleValue.value, level: levelValue.value }).unwrap();
            toast("Saved as your default role & level", { variant: "success" });
        } catch {
            toast("Couldn't save your default. Try again.", { variant: "error" });
        }
    }
    // LAZY option triggers handed straight to the two async selects as their `fetchPage` — the select
    // owns paginate/map, we only inject WHICH endpoint (see ControlledAsyncPaginateSelect).
    const [triggerRoles] = useLazyGetRolesQuery();
    const [triggerLevels] = useLazyGetLevelsQuery();

    // Past interviews — the full history (for the count + the newest few rows) and, separately, the
    // one resumable interview so the table can show its Resume button. Both come back in the same
    // {interviews:[...]} shape; the resumable query narrows server-side to a 0-or-1-element list.
    const { data: interviewsData, isFetching } = useGetMyInterviewsQuery({ size: DASHBOARD_ROWS });
    const { data: resumableData } = useGetMyInterviewsQuery({ resumable: true });
    const interviews = interviewsData?.items ?? [];
    const resumableId = resumableData?.items[0]?.interview_id ?? null;

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
                        {/* Unfinished session banner — self-contained: renders only when the user has
                            a resumable interview (the most-recent unfinished one), else nothing. */}
                        <ResumeBanner />

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

                            <div className="mt-[18px] flex items-center justify-end gap-3">
                                {/* Save the current picks as the default (see onSetDefault). type="button"
                                    so it never submits the form / starts an interview. Enabled once both
                                    picks exist. */}
                                <button
                                    type="button"
                                    onClick={onSetDefault}
                                    disabled={savingDefault || !roleValue || !levelValue}
                                    className="btn btn-secondary text-[15px] disabled:opacity-50"
                                    style={{ padding: "11px 20px" }}
                                >
                                    {savingDefault ? "Saving…" : "Set as default"}
                                </button>
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

                        {/* Past interviews — the newest few, sharing InterviewsTable with the full
                            Interviews page. "View all" routes to that page. */}
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
                            />
                        </div>
                    </div>

                    {/* ── Right column (signal) — role- and window-scoped readiness / skill breakdown /
                        work on next, self-contained (fetches its own data). ─────────────────────── */}
                    <SignalPanel />
                </div>
            </div>
        </div>
    );
}
