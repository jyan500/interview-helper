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
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useForm } from "react-hook-form";
import { skipToken } from "@reduxjs/toolkit/query/react";
import { useAuth } from "../auth/AuthProvider"
import { useToast } from "../toast/ToastProvider";
import {
    useGetMyInterviewsQuery,
    useGetProfileQuery,
    useGetQuestionsQuery,
    useLazyGetLevelsQuery,
    useLazyGetRolesQuery,
    useStartInterviewMutation,
    useUpdateProfileMutation,
} from "../api";
import { useQuestionSelection, useSeededSelectFields } from "../hooks";
import { optionFromItem } from "../helpers";
import { ControlledAsyncPaginateSelect } from "../components/ControlledAsyncPaginateSelect";
import type { SelectOption } from "../components/AsyncPaginateSelect";
import AppNav from "../components/AppNav";
import ResumeBanner from "../components/ResumeBanner";
import InterviewsTable from "../components/InterviewsTable";
import QuestionsTable from "../components/QuestionsTable";
import SelectionBar from "../components/SelectionBar";
import AddQuestionModal from "../components/AddQuestionModal";
import Pagination from "../components/Pagination";
import SignalPanel from "../components/SignalPanel";
import Button from "../components/Button";
import OverwriteInterviewModal from "../components/OverwriteInterviewModal";
import StartingOverlay from "../components/StartingOverlay";
import { PAGE_SIZE } from "../constants";

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

    // PRE-FILL from the user's saved default (GET /api/profile) — so a returning user opens on the
    // role/level they usually practise instead of two empty pickers. Keyed on the default's slugs so it
    // re-seeds when the default changes (e.g. edited on the Settings page) but never clobbers a manual
    // pick; see useSeededSelectFields. A profile with no default leaves the pickers empty.
    const { data: profile, isLoading: profileLoading } = useGetProfileQuery();
    useSeededSelectFields(
        setValue,
        profile ? `${profile.role?.slug ?? ""}|${profile.level?.slug ?? ""}` : null,
        [
            { name: "role", option: optionFromItem(profile?.role) },
            { name: "level", option: optionFromItem(profile?.level) },
        ],
        { shouldValidate: true },
    );

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

    // Past interviews — the newest few GRADED interviews (scored: true hides in-progress/abandoned
    // ones, whose Score column would be blank) and, separately, the one resumable interview so the
    // table can show its Resume button. Both come back in the same {interviews:[...]} shape; the
    // resumable query narrows server-side to a 0-or-1-element list. The unfinished interview isn't
    // lost from this page — the ResumeBanner above surfaces it.
    const { data: interviewsData, isFetching } = useGetMyInterviewsQuery({ size: DASHBOARD_ROWS, scored: true });
    // `isLoading` gates the Start button below: we can't know whether starting would overwrite an
    // unfinished interview until this settles. It's true only on the first load with no data, so a
    // FAILED request flips it back to false — re-enabling Start (resumableId stays null → no confirm,
    // just a direct start), rather than trapping the user behind a query that never came back.
    const { data: resumableData, isLoading: resumableLoading } = useGetMyInterviewsQuery({ resumable: true });
    const interviews = interviewsData?.items ?? [];
    const resumableId = resumableData?.items[0]?.interview_id ?? null;

    // The KICKOFF: POST /api/interview, then hand the fresh interview to /session via route state
    // (SessionLayout guards on it; SessionPage seeds the first question + speaks it from firstMessage).
    // We never navigate to /session without a real interview — that's the whole producer/consumer split.
    // While the POST is in flight, <StartingOverlay> blocks the whole page (see `starting` below).
    const [startInterview, { isLoading: starting }] = useStartInterviewMutation();
    async function doStart({ role, level }: StartFormValues) {
        if (!role || !level) return; // narrows Option | null -> Option; `required` already guarantees it
        try {
            const res = await startInterview({ role: role.value, seniority: level.value }).unwrap();
            navigate("/session", {
                state: {
                    interviewId: res.interview_id,
                    firstMessage: res.message,
                    role: role.label, // human-readable labels for the session header
                    level: level.label,
                },
            });
        } catch {
            toast("Couldn't start your interview. Try again.", { variant: "error" });
        }
    }

    // Form submit gate: if the user has an unfinished (resumable) interview, starting a new one would
    // overwrite it, so confirm first. Otherwise start straight away. handleSubmit only calls this once
    // both required picks are valid, so `values` are guaranteed present here.
    const [confirmOverwrite, setConfirmOverwrite] = useState(false);
    function onStart(values: StartFormValues) {
        if (resumableId) {
            setConfirmOverwrite(true);
            return;
        }
        doStart(values);
    }
    // Confirmed the overwrite: close the modal and hand off to the blocking overlay while doStart runs.
    // The picks are still in the form (never reset), so we read them from the watched values.
    function onConfirmOverwrite() {
        setConfirmOverwrite(false);
        doStart({ role: roleValue, level: levelValue });
    }

    // ── My questions ──────────────────────────────────────────────────────────────────────────
    // The saved question set for the CURRENTLY-PICKED role+level — it tracks the pickers above, so
    // changing the role/level re-scopes it. Skips (skipToken) until both are picked. `mine: true`
    // returns only the user's saved questions; its `total` is the base for the SelectionBar's count.
    // Every row here starts saved, so toggling one stages a REMOVAL, committed by Save. An empty set
    // is fine — the interview then falls back to a default of 3 questions of increasing difficulty.
    const roleSlug = roleValue?.value;
    const levelSlug = levelValue?.value;
    const canBrowse = Boolean(roleSlug && levelSlug);
    const [myqPage, setMyqPage] = useState(1);
    // a role/level change resets to page 1 so a change never leaves us on an out-of-range page.
    useEffect(() => { setMyqPage(1); }, [roleSlug, levelSlug]);
    const { data: myQuestions, isFetching: myqFetching } = useGetQuestionsQuery(
        canBrowse
            ? { role: roleSlug!, level: levelSlug!, saved: true, page: myqPage, size: PAGE_SIZE }
            : skipToken,
    );
    const savedTotal = myQuestions?.total ?? 0;
    const selection = useQuestionSelection(savedTotal);
    const [addOpen, setAddOpen] = useState(false);

    return (
        <div className="min-h-screen bg-bg text-ink">
            {/* Confirm overwriting an unfinished interview (only reached when one exists). */}
            <OverwriteInterviewModal
                open={confirmOverwrite}
                onClose={() => setConfirmOverwrite(false)}
                onConfirm={onConfirmOverwrite}
            />
            {/* Blocks the page for BOTH start paths while the kickoff POST is in flight. */}
            {starting && <StartingOverlay />}

            {/* Browse all role+level questions to add to the saved set. Mounted only while open, so
                closing discards any unsaved staging. Reachable only once role+level are picked. */}
            {addOpen && canBrowse && (
                <AddQuestionModal
                    role={roleSlug!}
                    roleName={roleValue!.label}
                    onClose={() => setAddOpen(false)}
                />
            )}

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
                                        isLoading={profileLoading}
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
                                        isLoading={profileLoading}
                                    />
                                </div>
                            </div>

                            <div className="mt-[18px] flex items-center justify-end gap-3">
                                {/* Save the current picks as the default (see onSetDefault). type="button"
                                    so it never submits the form / starts an interview. Enabled once both
                                    picks exist. */}
                                <Button
                                    variant="secondary"
                                    onClick={onSetDefault}
                                    disabled={savingDefault || !roleValue || !levelValue}
                                    className="text-[15px] disabled:opacity-50"
                                    style={{ padding: "11px 20px" }}
                                >
                                    {savingDefault ? "Saving…" : "Set as default"}
                                </Button>
                                <Button
                                    type="submit"
                                    variant="primary"
                                    // disabled until BOTH required selects are valid, while the POST is in
                                    // flight, and until the resumable-check query settles (so we know
                                    // whether to warn about overwriting an unfinished interview)
                                    disabled={starting || !formState.isValid || resumableLoading}
                                    className="text-[15px] disabled:opacity-50"
                                    style={{ padding: "11px 26px" }}
                                >
                                    {starting ? "Starting…" : "Start interview"}
                                </Button>
                            </div>
                        </form>

                        {/* My questions — the saved set for the currently-picked role+level (it tracks
                            the pickers above). Check/uncheck to curate; "Add question" opens the full
                            bank. An empty set is fine: the interview falls back to a 3-question default. */}
                        <div className="rounded-md border border-divider px-[22px] pb-3 pt-[18px]">
                            <div className="mb-2 flex items-center justify-between">
                                <h2 className="font-heading text-[23px] font-medium">My questions</h2>
                                <Button
                                    variant="secondary"
                                    className="text-[13px] disabled:opacity-50"
                                    disabled={!canBrowse}
                                    onClick={() => setAddOpen(true)}
                                >
                                    Add question
                                </Button>
                            </div>
                            {!canBrowse ? (
                                <p className="px-3 py-6 text-[13.5px] text-neutral-400">
                                    Pick a role and level above to choose the questions you want to practise.
                                </p>
                            ) : (
                                <>
                                    <p className="mb-2 text-[13px] text-neutral-400">
                                        These are the questions your next interview will ask. If you don't
                                        pick any, we'll choose 3 of increasing difficulty for this role and level.
                                    </p>
                                    <QuestionsTable
                                        questions={myQuestions?.items ?? []}
                                        isChecked={selection.isChecked}
                                        onToggle={selection.toggle}
                                        loading={myqFetching}
                                        skeletonRows={5}
                                        emptyMessage="No saved questions yet — add some, or start and we'll pick 3 for you."
                                    />
                                    <Pagination
                                        page={myQuestions?.page ?? myqPage}
                                        totalPages={myQuestions?.pages ?? 0}
                                        onPageChange={setMyqPage}
                                    />
                                    <SelectionBar
                                        count={selection.selectedCount}
                                        dirty={selection.dirty}
                                        saving={selection.saving}
                                        onSave={selection.save}
                                        onReset={selection.reset}
                                    />
                                </>
                            )}
                        </div>

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
