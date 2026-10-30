/**
 * One imported role in ResumeReviewModal: an include checkbox and, while checked, the same fields as
 * ExperienceModal (title, company, start/end months, "I currently work here", description). Reads the
 * modal's form through useFormContext; `roles.${index}` is this row.
 *
 * The rules mirror ExperienceModal's, guarded so they only apply while the row is CHECKED: an unchecked
 * row isn't being saved, so a missing date on it mustn't block the rest. An unchecked row collapses to
 * its header. `canInclude` is false once the free slots are used up, which locks an unchecked box.
 */
import { useFormContext, useWatch } from "react-hook-form";
import { BACKGROUND_DESCRIPTION_MAX_CHARS, BACKGROUND_NAME_MAX_CHARS } from "../../constants";
import type { ResumeReviewFields } from "../../helpers";

export default function ImportedRoleFields({ index, canInclude }: { index: number; canInclude: boolean }) {
    const {
        register,
        control,
        formState: { errors },
    } = useFormContext<ResumeReviewFields>();
    const role = useWatch({ control, name: `roles.${index}` });
    const rowErrors = errors.roles?.[index];
    const descriptionLength = role.description.trim().length;

    // a rule that only runs while this row is checked
    const whenIncluded =
        (check: (value: string, row: ResumeReviewFields["roles"][number]) => true | string) =>
        (value: string, values: ResumeReviewFields) =>
            !values.roles[index]?.include || check(value, values.roles[index]);

    const requiredText = (label: string) =>
        whenIncluded((value) => {
            if (value.trim().length === 0) return `${label} is required.`;
            if (value.trim().length > BACKGROUND_NAME_MAX_CHARS) return `Must be under ${BACKGROUND_NAME_MAX_CHARS} characters.`;
            return true;
        });

    return (
        <div className="rounded-md border border-divider px-4 py-3.5">
            <label
                className={`flex items-center gap-2.5 text-[14px] ${canInclude ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
                title={canInclude ? undefined : "No free slots left. Uncheck another role first."}
            >
                <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-accent disabled:cursor-not-allowed"
                    disabled={!canInclude}
                    {...register(`roles.${index}.include`)}
                />
                <span className="min-w-0 truncate text-ink">
                    {role.title || "Untitled role"}
                    {role.company && <span className="text-neutral-400"> at {role.company}</span>}
                </span>
                {role.duplicate && (
                    <span className="ml-auto flex-none text-[12px] text-neutral-500">Already on your profile</span>
                )}
            </label>

            {role.include && (
                <div className="mt-4 flex flex-col gap-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="field">
                            <label>Title</label>
                            <input className="input" {...register(`roles.${index}.title`, { validate: requiredText("Title") })} />
                            <span className="text-[12.5px] text-gap">{rowErrors?.title?.message}</span>
                        </div>
                        <div className="field">
                            <label>Company</label>
                            <input className="input" {...register(`roles.${index}.company`, { validate: requiredText("Company") })} />
                            <span className="text-[12.5px] text-gap">{rowErrors?.company?.message}</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="field">
                            <label>Start</label>
                            <input
                                type="month"
                                className="input [color-scheme:dark]"
                                {...register(`roles.${index}.start`, {
                                    validate: whenIncluded((start) => Boolean(start) || "Start month is required."),
                                })}
                            />
                            <span className="text-[12.5px] text-gap">{rowErrors?.start?.message}</span>
                        </div>
                        <div className="field">
                            <label>End</label>
                            <input
                                type="month"
                                className="input [color-scheme:dark] disabled:opacity-50"
                                disabled={role.current}
                                {...register(`roles.${index}.end`, {
                                    deps: [`roles.${index}.start`],
                                    // "YYYY-MM" strings compare correctly as text, so a plain < is a date check
                                    validate: whenIncluded((end, row) => {
                                        if (row.current) return true;
                                        if (!end) return "End month is required (or check \"I currently work here\").";
                                        if (row.start && end < row.start) return "End can't be before the start.";
                                        return true;
                                    }),
                                })}
                            />
                            <span className="text-[12.5px] text-gap">{rowErrors?.end?.message}</span>
                        </div>
                    </div>

                    <label className="flex items-center gap-2 text-[13.5px] text-neutral-300">
                        <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer accent-accent"
                            {...register(`roles.${index}.current`, { deps: [`roles.${index}.end`] })}
                        />
                        I currently work here
                    </label>

                    <div className="field">
                        <label>Description</label>
                        <textarea
                            className="input min-h-[120px] leading-[1.5]"
                            {...register(`roles.${index}.description`, {
                                validate: whenIncluded(
                                    (value) =>
                                        value.trim().length <= BACKGROUND_DESCRIPTION_MAX_CHARS ||
                                        `Must be under ${BACKGROUND_DESCRIPTION_MAX_CHARS.toLocaleString()} characters.`,
                                ),
                            })}
                        />
                        <div className="mt-1 flex justify-between text-[12.5px]">
                            <span className="text-gap">{rowErrors?.description?.message}</span>
                            <span className={descriptionLength > BACKGROUND_DESCRIPTION_MAX_CHARS ? "text-gap" : "text-neutral-500"}>
                                {descriptionLength.toLocaleString()} / {BACKGROUND_DESCRIPTION_MAX_CHARS.toLocaleString()}
                            </span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
