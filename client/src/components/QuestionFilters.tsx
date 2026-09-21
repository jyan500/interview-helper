/**
 * QuestionFilters — the filter row above ONE questions table (the Saved section or the Other section).
 * One react-hook-form form: a keyword box (case-insensitive substring match on the question TEXT, sent
 * as `q`), plus three async pickers — role, level, and question TYPE — and a single Search that applies
 * all four at once (the "filters apply on submit" rule). A Clear button resets the section.
 *
 * It's the questions-page counterpart of the Interviews-page filter row, generalised so the SAME
 * component drives both sections (the page mounts two, one per prefix). It knows nothing about the URL:
 * the parent owns that (via useSectionFilters) and passes the applied slugs in, receiving the picked
 * slugs back through `onApply` — the same seam that keeps the pickers reusable.
 *
 * ROLE IS NOT OPTIONAL the way level/type are: the questions bank is scoped per role, so there's always
 * an effective role (the parent falls back to the profile default). Clear therefore resets the role
 * picker to `defaultRole`, not to empty, while level/type go back to "all".
 */
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { skipToken } from "@reduxjs/toolkit/query/react";
import {
    useGetLevelQuery,
    useGetQuestionTypeQuery,
    useGetRoleQuery,
    useLazyGetLevelsQuery,
    useLazyGetQuestionTypesQuery,
    useLazyGetRolesQuery,
} from "../api";
import type { AppliedSectionFilters } from "../hooks";
import type { SelectOption } from "./AsyncPaginateSelect";
import { ControlledAsyncPaginateSelect } from "./ControlledAsyncPaginateSelect";
import Button from "./Button";
import { optionFromSlug } from "../helpers";

// The RHF draft — each picker holds a full Option (value=slug, label=name) so it feeds the async
// select directly; `q` is the raw search text; `savedOnly` backs the optional "Saved only" checkbox.
type FiltersForm = {
    q: string;
    role: SelectOption | null;
    level: SelectOption | null;
    questionType: SelectOption | null;
    savedOnly: boolean;
};

interface QuestionFiltersProps {
    // The applied state, from the URL. `roleSlug` is the EFFECTIVE role (URL role ?? default), always
    // present; the other three are the raw slugs (undefined = no filter).
    roleSlug: string;
    levelSlug?: string;
    questionTypeSlug?: string;
    q?: string;
    // What Clear resets the role picker to (the profile default role as an Option) — since role can't
    // be "none". A label refresh from getRole still corrects it if this label is stale.
    defaultRole: SelectOption | null;
    // Show the Clear button (the parent computes this from whether any filter diverges from default).
    showClear: boolean;
    // Opt into the "Saved only" checkbox (the Add-question modal; the Questions page splits Saved/Other
    // into two tables instead, so it leaves this off). `savedOnly` seeds its applied state.
    showSavedFilter?: boolean;
    savedOnly?: boolean;
    onApply: (values: AppliedSectionFilters) => void;
    onClear: () => void;
}

export default function QuestionFilters({
    roleSlug,
    levelSlug,
    questionTypeSlug,
    q,
    defaultRole,
    showClear,
    showSavedFilter = false,
    savedOnly = false,
    onApply,
    onClear,
}: QuestionFiltersProps) {
    const [triggerRoles] = useLazyGetRolesQuery();
    const [triggerLevels] = useLazyGetLevelsQuery();
    const [triggerTypes] = useLazyGetQuestionTypesQuery();

    // Seeded from the applied slugs so a deep link's filters show selected. The pickers start with the
    // slug as a placeholder label, swapped for the real name by the effects below. Applying happens only
    // on submit — nothing here auto-fires.
    const { control, register, handleSubmit, reset, setValue } = useForm<FiltersForm>({
        defaultValues: {
            q: q ?? "",
            role: optionFromSlug(roleSlug),
            level: optionFromSlug(levelSlug ?? null),
            questionType: optionFromSlug(questionTypeSlug ?? null),
            savedOnly,
        },
    });

    // Resolve each slug's live NAME so the picker shows a label, not the bare slug. skipToken keeps a
    // query idle when its slug is absent (level/type may be unset).
    const { data: roleData } = useGetRoleQuery(roleSlug || skipToken);
    const { data: levelData } = useGetLevelQuery(levelSlug ?? skipToken);
    const { data: typeData } = useGetQuestionTypeQuery(questionTypeSlug ?? skipToken);

    // Swap each placeholder slug-label for the fetched name, guarded on the slug still matching so a
    // cached result from a since-changed filter can't repopulate the picker.
    useEffect(() => {
        if (roleData && roleData.slug === roleSlug)
            setValue("role", { value: roleData.slug, label: roleData.name });
    }, [roleData, roleSlug, setValue]);
    useEffect(() => {
        if (levelData && levelData.slug === levelSlug)
            setValue("level", { value: levelData.slug, label: levelData.name });
    }, [levelData, levelSlug, setValue]);
    useEffect(() => {
        if (typeData && typeData.slug === questionTypeSlug)
            setValue("questionType", { value: typeData.slug, label: typeData.name });
    }, [typeData, questionTypeSlug, setValue]);

    function submit(values: FiltersForm) {
        onApply({
            q: values.q,
            role: values.role?.value ?? null,
            level: values.level?.value ?? null,
            questionType: values.questionType?.value ?? null,
            savedOnly: values.savedOnly,
        });
    }

    function clear() {
        // role reverts to the default (the bank always needs a concrete role); the optional filters go
        // back to "all"/off. The parent's onClear then wipes this section's URL params.
        reset({ q: "", role: defaultRole, level: null, questionType: null, savedOnly: false });
        onClear();
    }

    return (
        <form onSubmit={handleSubmit(submit)} className="mb-3 flex flex-wrap items-center gap-2.5">
            <input
                {...register("q")}
                className="input w-[240px] text-[13.5px]"
                placeholder="Search question text…"
            />
            <div className="w-[180px]">
                <ControlledAsyncPaginateSelect
                    control={control}
                    name="role"
                    fetchPage={triggerRoles}
                    placeholder="Role"
                />
            </div>
            <div className="w-[150px]">
                <ControlledAsyncPaginateSelect
                    control={control}
                    name="level"
                    fetchPage={triggerLevels}
                    placeholder="All levels"
                />
            </div>
            <div className="w-[180px]">
                <ControlledAsyncPaginateSelect
                    control={control}
                    name="questionType"
                    fetchPage={triggerTypes}
                    placeholder="All types"
                />
            </div>
            {showSavedFilter && (
                <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-neutral-300">
                    <input
                        type="checkbox"
                        {...register("savedOnly")}
                        className="h-4 w-4 cursor-pointer accent-accent"
                    />
                    Saved only
                </label>
            )}
            <Button type="submit" variant="primary" className="text-[13px]">
                Search
            </Button>
            {showClear && (
                <Button variant="ghost" className="text-[13px]" onClick={clear}>
                    Clear
                </Button>
            )}
        </form>
    );
}
