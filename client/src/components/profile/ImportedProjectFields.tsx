/**
 * One imported project in ResumeReviewModal: an include checkbox and, while checked, the same fields as
 * ProjectModal (name, optional link, description). Reads the modal's form through useFormContext;
 * `projects.${index}` is this row.
 *
 * Same shape as ImportedRoleFields: the rules mirror ProjectModal's but only apply while the row is
 * checked, an unchecked row collapses to its header, and `canInclude` locks an unchecked box once the
 * free slots are used up.
 */
import { useFormContext, useWatch } from "react-hook-form";
import {
    BACKGROUND_DESCRIPTION_MAX_CHARS,
    BACKGROUND_NAME_MAX_CHARS,
    BACKGROUND_URL_MAX_CHARS,
} from "../../constants";
import type { ResumeReviewFields } from "../../helpers";

export default function ImportedProjectFields({ index, canInclude }: { index: number; canInclude: boolean }) {
    const {
        register,
        control,
        formState: { errors },
    } = useFormContext<ResumeReviewFields>();
    const project = useWatch({ control, name: `projects.${index}` });
    const rowErrors = errors.projects?.[index];
    const descriptionLength = project.description.trim().length;

    // a rule that only runs while this row is checked
    const whenIncluded = (check: (value: string) => true | string) => (value: string, values: ResumeReviewFields) =>
        !values.projects[index]?.include || check(value);

    return (
        <div className="rounded-md border border-divider px-4 py-3.5">
            <label
                className={`flex items-center gap-2.5 text-[14px] ${canInclude ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
                title={canInclude ? undefined : "No free slots left. Uncheck another project first."}
            >
                <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-accent disabled:cursor-not-allowed"
                    disabled={!canInclude}
                    {...register(`projects.${index}.include`)}
                />
                <span className="min-w-0 truncate text-ink">{project.name || "Untitled project"}</span>
                {project.duplicate && (
                    <span className="ml-auto flex-none text-[12px] text-neutral-500">Already on your profile</span>
                )}
            </label>

            {project.include && (
                <div className="mt-4 flex flex-col gap-4">
                    <div className="field">
                        <label>Name</label>
                        <input
                            className="input"
                            {...register(`projects.${index}.name`, {
                                validate: whenIncluded((value) => {
                                    if (value.trim().length === 0) return "Name is required.";
                                    if (value.trim().length > BACKGROUND_NAME_MAX_CHARS) return `Must be under ${BACKGROUND_NAME_MAX_CHARS} characters.`;
                                    return true;
                                }),
                            })}
                        />
                        <span className="text-[12.5px] text-gap">{rowErrors?.name?.message}</span>
                    </div>

                    <div className="field">
                        <label>Link (optional)</label>
                        <input
                            className="input"
                            placeholder="https://github.com/you/project"
                            {...register(`projects.${index}.url`, {
                                validate: whenIncluded((value) => {
                                    const url = value.trim();
                                    if (!url) return true;
                                    if (!/^https?:\/\/\S+$/.test(url)) return "Use a full link starting with http:// or https://.";
                                    if (url.length > BACKGROUND_URL_MAX_CHARS) return "That link is too long.";
                                    return true;
                                }),
                            })}
                        />
                        <span className="text-[12.5px] text-gap">{rowErrors?.url?.message}</span>
                    </div>

                    <div className="field">
                        <label>Description</label>
                        <textarea
                            className="input min-h-[120px] leading-[1.5]"
                            {...register(`projects.${index}.description`, {
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
