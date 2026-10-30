/**
 * The NEW skills a resume import found, in ResumeReviewModal: a multi-select whose options are only those
 * skills (never the saved ones, which this modal doesn't edit). It starts with all of them picked; one
 * removed by mistake is still in the menu to pick again. Reads the modal's form through useFormContext.
 *
 * The cap is on the TOTAL: the saved skills plus these must fit in MAX_SKILLS, since saving sends both.
 */
import Select from "react-select";
import { Controller, useFormContext } from "react-hook-form";
import { MAX_SKILLS } from "../../constants";
import type { ResumeReviewFields } from "../../helpers";
import { nocturneSelectStyles } from "../../selectStyles";
import type { SelectOption } from "../AsyncPaginateSelect";

export default function ImportedSkillsField({ options, savedCount }: { options: SelectOption[]; savedCount: number }) {
    const {
        control,
        formState: { errors },
    } = useFormContext<ResumeReviewFields>();

    return (
        <div className="field">
            <Controller
                control={control}
                name="skills"
                rules={{
                    validate: (skills) =>
                        savedCount + skills.length <= MAX_SKILLS ||
                        `You can list up to ${MAX_SKILLS} skills, and ${savedCount} are already on your profile.`,
                }}
                render={({ field }) => (
                    <Select<SelectOption, true>
                        isMulti
                        aria-label="Skills to add"
                        options={options}
                        value={field.value}
                        // react-select hands back a readonly array; copy it so the form holds a plain SelectOption[]
                        onChange={(picked) => field.onChange([...picked])}
                        onBlur={field.onBlur}
                        placeholder="No new skills selected"
                        closeMenuOnSelect={false}
                        styles={nocturneSelectStyles}
                    />
                )}
            />
            <span className="text-[12.5px] text-gap">{errors.skills?.message}</span>
        </div>
    );
}
