/**
 * Past interviews — the full list, Nocturne mock 3a. Every session the signed-in user has run,
 * each reopenable (and the most-recent unfinished one resumable).
 *
 * The list is InterviewsTable (shared with the Dashboard card); the rows come from GET /api/interviews,
 * now server-side PAGED (20/page) and FILTERED. The filter surface is one react-hook-form form — a
 * search box (matched against role/level name only, sent as `q`) and two async role/level pickers whose
 * value is the vocab slug (sent as role/level) — and ONE submit applies all three together.
 *
 * THE URL IS THE SOURCE OF TRUTH. The query args are derived from the query string every render, so a
 * deep link like ?role=backend-engineer&page=2 reproduces exactly this view, and Back/Forward just work.
 * The form only WRITES to the URL on submit; it never holds applied state the URL doesn't. The pickers
 * show only the slug in the URL, so their labels are hydrated by fetching the role/level by slug
 * (useGetRole/LevelQuery) — the live name, not a copy cached in the URL.
 *
 * Deliberate product decision from the handoff: mode (voice/text) is NOT shown here — both are the
 * same interview, stored as one text transcript.
 */
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useForm } from "react-hook-form";
import { skipToken } from "@reduxjs/toolkit/query/react";
import {
    useGetLevelQuery,
    useGetMyInterviewsQuery,
    useGetRoleQuery,
    useLazyGetLevelsQuery,
    useLazyGetRolesQuery,
    type QueryParams,
} from "../api";
import type { SelectOption } from "../components/AsyncPaginateSelect";
import { ControlledAsyncPaginateSelect } from "../components/ControlledAsyncPaginateSelect";
import AppNav from "../components/AppNav";
import ResumeBanner from "../components/ResumeBanner";
import InterviewsTable from "../components/InterviewsTable";
import Pagination from "../components/Pagination";
import { optionFromSlug } from "../helpers";
import { PAGE_SIZE } from "../constants"

// The filter form: the search text plus the two picker Options. Each Option is { value: slug, label:
// name } so it feeds straight into the async select and back into the URL as role/level.
type FiltersForm = {
    q: string;
    role: SelectOption | null;
    level: SelectOption | null;
};

export default function InterviewsPage() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    const [triggerRoles] = useLazyGetRolesQuery();
    const [triggerLevels] = useLazyGetLevelsQuery();

    // Query args derived from the URL every render — the results always match the query string.
    const roleSlug = searchParams.get("role");
    const levelSlug = searchParams.get("level");
    const page = Number(searchParams.get("page")) || 1;
    const queryArgs: QueryParams = {
        page,
        size: PAGE_SIZE,
        q: searchParams.get("q") || undefined,
        role: roleSlug || undefined,
        level: levelSlug || undefined,
    };

    // isFetching (not isLoading) so the skeleton shows on EVERY refetch — a page or filter change —
    // not just the first mount, and the stale rows are hidden behind it meanwhile.
    const { data, isFetching, error } = useGetMyInterviewsQuery(queryArgs);
    const { data: resumableData } = useGetMyInterviewsQuery({ resumable: true });
    const interviews = data?.items ?? [];
    const totalPages = data?.pages ?? 0;
    const resumableId = resumableData?.items[0]?.interview_id ?? null;

    // Resolve the current NAME for whichever role/level slug is in the URL, so the picker can show its
    // label instead of the bare slug. skipToken = no slug, so the query stays idle.
    const { data: roleData } = useGetRoleQuery(roleSlug ?? skipToken);
    const { data: levelData } = useGetLevelQuery(levelSlug ?? skipToken);

    // The filter form, seeded from the URL so a deep link's filters show selected. Applying happens only
    // on submit (handleSubmit(applyFilters)); nothing here auto-fires, so the form is a plain draft.
    const { control, register, handleSubmit, reset, setValue } = useForm<FiltersForm>({
        defaultValues: {
            q: searchParams.get("q") ?? "",
            role: optionFromSlug(roleSlug),
            level: optionFromSlug(levelSlug),
        },
    });

    // Swap each picker's placeholder slug-label for the fetched name. Guarded on the slug still matching
    // the URL so a cached result from a since-cleared filter can't repopulate the picker.
    useEffect(() => {
        if (roleData && roleData.slug === roleSlug)
            setValue("role", { value: roleData.slug, label: roleData.name });
    }, [roleData, roleSlug, setValue]);
    useEffect(() => {
        if (levelData && levelData.slug === levelSlug)
            setValue("level", { value: levelData.slug, label: levelData.name });
    }, [levelData, levelSlug, setValue]);

    function applyFilters(values: FiltersForm) {
        const next = new URLSearchParams();
        if (values.q.trim()) next.set("q", values.q.trim());
        if (values.role) next.set("role", values.role.value);
        if (values.level) next.set("level", values.level.value);
        // no `page` => page 1: a changed filter resets to the first page of the new result set.
        setSearchParams(next);
    }

    // Clear both the form draft and the applied filters in the URL, without a navigation.
    function clearFilters() {
        reset({ q: "", role: null, level: null });
        setSearchParams(new URLSearchParams());
    }

    function goToPage(p: number) {
        const next = new URLSearchParams(searchParams);
        next.set("page", String(p));
        setSearchParams(next);
        // The pager sits at the bottom, so a page change would otherwise leave the user staring at
        // the footer of the new page — send them back to the top.
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    const hasFilters = Boolean(queryArgs.q || roleSlug || levelSlug);

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
                                {data?.total ?? 0} sessions
                            </p>
                        </div>
                        {/* Starting an interview needs the role/level pickers, which live in the Dashboard's
                            "Start an interview" card — so send the user there rather than duplicate the
                            kickoff form (or POST with guessed defaults). The interview is created there,
                            then /session is entered with it in route state. */}
                        <button className="btn btn-primary text-sm" onClick={() => navigate("/")}>
                            New interview
                        </button>
                    </div>

                    {/* Unfinished session banner — the same affordance as the Dashboard, so a user
                        landing here can resume without a detour home. Renders only when one exists. */}
                    <ResumeBanner className="mt-5" />

                    {/* Filter row — one RHF form; Search (or Enter) applies the text AND both pickers at once. */}
                    <form
                        onSubmit={handleSubmit(applyFilters)}
                        className="mt-5 flex flex-wrap items-center gap-2.5"
                    >
                        <input
                            {...register("q")}
                            className="input w-[280px] text-[13.5px]"
                            placeholder="Search by role or level…"
                        />
                        <div className="w-[190px]">
                            <ControlledAsyncPaginateSelect
                                control={control}
                                name="role"
                                fetchPage={triggerRoles}
                                placeholder="All roles"
                            />
                        </div>
                        <div className="w-[190px]">
                            <ControlledAsyncPaginateSelect
                                control={control}
                                name="level"
                                fetchPage={triggerLevels}
                                placeholder="All levels"
                            />
                        </div>
                        <button type="submit" className="btn btn-primary text-[13px]">
                            Search
                        </button>
                        {hasFilters && (
                            <button type="button" className="btn btn-ghost text-[13px]" onClick={clearFilters}>
                                Clear
                            </button>
                        )}
                    </form>
                </div>

                {/* List — the shared table, fed real (paged, filtered) data. */}
                <div className="px-7 pb-[26px] pt-2">
                    {error ? (
                        <p className="px-3 py-6 text-[13.5px] text-gap">Couldn't load your interviews.</p>
                    ) : (
                        <>
                            <InterviewsTable
                                interviews={interviews}
                                resumableId={resumableId}
                                loading={isFetching}
                            />
                            {!isFetching && (
                                <Pagination page={data?.page ?? page} totalPages={totalPages} onPageChange={goToPage} />
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
