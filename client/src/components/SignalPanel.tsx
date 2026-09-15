/**
 * SignalPanel — the dashboard's right column: the "how am I doing" signal, scoped to ONE role over a
 * chosen time window. It owns the scope controls and feeds the three cards (Readiness, Skill
 * breakdown, Work on next) from GET /api/dashboard. Self-contained: DashboardPage just drops it in.
 *
 * THE SCOPE IS A FORM, APPLIED ON SUBMIT — the same react-hook-form + submit pattern as the
 * Interviews page filters, not auto-apply. The user picks a role and a window and clicks Apply; only
 * then does the query re-run. `applied` holds what's actually in effect (what the query reads); the
 * form is a plain draft until submit.
 *
 * ROLE PICKER is the async-paginate select (the user's graded roles can exceed a page), fed the
 * interviewed-roles endpoint — the same widget the kickoff form uses. PERIOD is a plain react-select.
 *
 * WHICH ROLE IS QUERIED FIRST: `applied.role` starts undefined, so the backend resolves the effective
 * role (the user's default, else most-recently-graded) and we seed the form's picker LABEL from what
 * it chose — so the draft shows the role actually on screen before the first Apply.
 */
import { useEffect, useRef, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import Select from "react-select";
import { AsyncPaginateSelect } from "./AsyncPaginateSelect";
import type { SelectOption } from "./AsyncPaginateSelect";
import { ControlledAsyncPaginateSelect } from "./ControlledAsyncPaginateSelect";
import SignalCard from "./SignalCard";
import ReadinessCard from "./ReadinessCard";
import SkillBreakdownCard from "./SkillBreakdownCard";
import WorkOnNextCard from "./WorkOnNextCard";
import { nocturneSelectStyles } from "../selectStyles";
import { useGetDashboardQuery, useLazyGetInterviewedRolesQuery } from "../api";
import type { DashboardPeriod, Readiness } from "../api";

// The window options — a plain (non-API) dropdown, so react-select's Select (see the dropdown
// convention). Values match DASHBOARD_PERIODS on the backend. `month` is the default.
const PERIOD_OPTIONS: SelectOption[] = [
    { value: "week", label: "Past week" },
    { value: "month", label: "Past month" },
    { value: "year", label: "Past year" },
];
const DEFAULT_PERIOD_OPTION = PERIOD_OPTIONS[1];

// The scope form: the picked role (or null = "use my default") and the window.
type SignalFilters = {
    role: SelectOption | null;
    period: SelectOption;
};

// The readiness shape to render while there's no data yet (loading, or nothing graded) — the card
// reads `latest === null` / `count === 0` from it for its empty state.
const EMPTY_READINESS: Readiness = { series: [], latest: null, delta: null, count: 0 };

export default function SignalPanel() {
    // what's actually in effect (drives the query). role undefined => let the backend pick the default.
    const [applied, setApplied] = useState<{ role?: string; period: DashboardPeriod }>({
        period: "month",
    });

    const [triggerRoles] = useLazyGetInterviewedRolesQuery();
    const { data, isFetching } = useGetDashboardQuery({ role: applied.role, period: applied.period });

    // the draft form — applied only on submit. Seeded to the default window; the role label is filled
    // once the backend tells us the effective role (below).
    const { control, handleSubmit, setValue } = useForm<SignalFilters>({
        defaultValues: { role: null, period: DEFAULT_PERIOD_OPTION },
    });

    // seed the picker's label from the role the backend actually used (so the draft shows what's on
    // screen), once — never clobbering a role the user has since typed into the draft.
    const seededRole = useRef(false);
    useEffect(() => {
        if (!seededRole.current && data?.role && data.role_name) {
            setValue("role", { value: data.role, label: data.role_name });
            seededRole.current = true;
        }
    }, [data, setValue]);

    function onApply(values: SignalFilters) {
        setApplied({
            role: values.role?.value,
            period: values.period.value as DashboardPeriod,
        });
    }

    return (
        <div className="flex flex-col gap-5">
            {/* Scope controls — which role, over what window; applied together on submit */}
            <SignalCard title="Signal">
                <form onSubmit={handleSubmit(onApply)} className="mt-3 flex flex-col gap-2.5">
                    <ControlledAsyncPaginateSelect
                        control={control}
                        name="role"
                        fetchPage={triggerRoles}
                        placeholder="Select a role…"
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
                    <button
                        type="submit"
                        disabled={isFetching}
                        className="btn btn-primary btn-block text-[13px] disabled:opacity-50"
                    >
                        {isFetching ? "Applying…" : "Apply"}
                    </button>
                </form>
            </SignalCard>

            <ReadinessCard readiness={data?.readiness ?? EMPTY_READINESS} loading={isFetching} />
            <SkillBreakdownCard skills={data?.skill_breakdown ?? []} loading={isFetching} />
            <WorkOnNextCard items={data?.work_on_next ?? []} loading={isFetching} />
        </div>
    );
}
