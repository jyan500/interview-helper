/**
 * SignalPanel — the dashboard's right column: the "how am I doing" signal over the user's interview
 * SIMULATIONS, scoped to ONE round type (optionally one job) over a chosen time window. It owns the
 * scope controls and feeds the three cards (Readiness, Skill breakdown, Work on next) from
 * GET /api/dashboard. Self-contained: DashboardPage just drops it in.
 *
 * WHY A ROUND, NOT A JOB, IS THE REQUIRED SCOPE: a simulation is graded on its ROUND's rubric, so a
 * coding round's dimensions don't line up with a behavioral round's — averaging across rounds would
 * blend two different bars. The job is an optional narrowing (one company's rounds); cleared = every job.
 *
 * THE SCOPE IS A FORM, APPLIED ON SUBMIT — the same react-hook-form + submit pattern as the
 * Interviews page filters, not auto-apply. The user picks a round, a job and a window and clicks
 * Apply; only then does the query re-run. `applied` holds what's actually in effect (what the query
 * reads); the form is a plain draft until submit.
 *
 * PICKERS: round and job are async-paginate selects — round fed /api/round-types, job fed the
 * graded-jobs options (/api/jobs?graded=true, so a job with nothing graded is never a dead option).
 * PERIOD is a plain react-select.
 *
 * WHICH ROUND IS QUERIED FIRST: `applied.round` starts undefined, so the backend resolves the
 * effective round (the most-recently-graded simulation's) and we seed the form's picker LABEL from
 * what it chose — so the draft shows the round actually on screen before the first Apply.
 */
import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import Select from "react-select";
import type { SelectOption } from "./AsyncPaginateSelect";
import { ControlledAsyncPaginateSelect } from "./ControlledAsyncPaginateSelect";
import SignalCard from "./SignalCard";
import ReadinessCard from "./ReadinessCard";
import SkillBreakdownCard from "./SkillBreakdownCard";
import WorkOnNextCard from "./WorkOnNextCard";
import Button from "./Button";
import { nocturneSelectStyles } from "../selectStyles";
import {
    useGetDashboardQuery,
    useLazyGetGradedJobOptionsQuery,
    useLazyGetRoundTypesQuery,
} from "../api";
import type { DashboardPeriod, Readiness } from "../api";
import { useSeededSelectFields } from "../hooks";

// The window options — a plain (non-API) dropdown, so react-select's Select (see the dropdown
// convention). Values match DASHBOARD_PERIODS on the backend. `month` is the default.
const PERIOD_OPTIONS: SelectOption[] = [
    { value: "week", label: "Past week" },
    { value: "month", label: "Past month" },
    { value: "year", label: "Past year" },
];
const DEFAULT_PERIOD_OPTION = PERIOD_OPTIONS[1];

// The scope form: the picked round (null = "my most recent"), the job (null = every job), the window.
type SignalFilters = {
    round: SelectOption | null;
    job: SelectOption | null;
    period: SelectOption;
};

// The readiness shape to render while there's no data yet (loading, or nothing graded) — the card
// reads `latest === null` / `count === 0` from it for its empty state.
const EMPTY_READINESS: Readiness = { series: [], latest: null, delta: null, count: 0 };

export default function SignalPanel() {
    // what's actually in effect (drives the query). round undefined => let the backend pick the most
    // recent; job undefined => across every job.
    const [applied, setApplied] = useState<{ round?: string; job?: string; period: DashboardPeriod }>({
        period: "month",
    });

    const [triggerRounds] = useLazyGetRoundTypesQuery();
    const [triggerJobs] = useLazyGetGradedJobOptionsQuery();
    const { data, isFetching } = useGetDashboardQuery({
        round: applied.round,
        job: applied.job,
        period: applied.period,
    });

    // the draft form — applied only on submit. Seeded to the default window; the round label is
    // filled once the backend tells us the effective round (below).
    const { control, handleSubmit, setValue } = useForm<SignalFilters>({
        defaultValues: { round: null, job: null, period: DEFAULT_PERIOD_OPTION },
    });

    // seed the round picker's label from the round the backend actually used (so the draft shows
    // what's on screen). Keyed on the effective round SLUG, so a refetch that resolves to the same
    // round never clobbers an un-applied draft pick. See useSeededSelectFields. The job needs no
    // seeding: it's only ever set by the user's own pick.
    useSeededSelectFields(setValue, data?.round ?? null, [
        {
            name: "round",
            option: data?.round && data.round_name ? { value: data.round, label: data.round_name } : null,
        },
    ]);

    // Show the round picker's loading spinner while the query is (re)fetching AND no explicit round
    // is applied — that's exactly when the picker's value is the backend-RESOLVED one (cold load, or a
    // refetch after a new grade), so it would otherwise sit empty/stale with no indication. Once the
    // user has APPLIED a round, its value is their own pick and won't change on a refetch.
    const roundLoading = isFetching && applied.round === undefined;

    function onApply(values: SignalFilters) {
        setApplied({
            round: values.round?.value,
            job: values.job?.value,
            period: values.period.value as DashboardPeriod,
        });
    }

    return (
        <div className="flex flex-col gap-5">
            {/* Scope controls — which round, which job, over what window; applied together on submit */}
            <SignalCard title="Signal">
                <form onSubmit={handleSubmit(onApply)} className="mt-3 flex flex-col gap-2.5">
                    <ControlledAsyncPaginateSelect
                        control={control}
                        name="round"
                        fetchPage={triggerRounds}
                        placeholder="Select a round…"
                        isLoading={roundLoading}
                    />
                    <ControlledAsyncPaginateSelect
                        control={control}
                        name="job"
                        fetchPage={triggerJobs}
                        placeholder="All jobs"
                        isClearable
                    />
                    <Controller
                        control={control}
                        name="period"
                        render={({ field }) => (
                            <Select
                                options={PERIOD_OPTIONS}
                                value={field.value}
                                onChange={(opt) => field.onChange(opt)}
                                onBlur={field.onBlur}
                                isSearchable={false}
                                styles={nocturneSelectStyles}
                            />
                        )}
                    />
                    <Button
                        type="submit"
                        block
                        disabled={isFetching}
                        className="text-[13px] disabled:opacity-50"
                    >
                        {isFetching ? "Applying…" : "Apply"}
                    </Button>
                </form>
            </SignalCard>

            <ReadinessCard readiness={data?.readiness ?? EMPTY_READINESS} loading={isFetching} />
            <SkillBreakdownCard skills={data?.skill_breakdown ?? []} loading={isFetching} />
            <WorkOnNextCard items={data?.work_on_next ?? []} loading={isFetching} />
        </div>
    );
}
