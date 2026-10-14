/**
 * Skills card — the candidate's skills, picked from the curated vocab (GET /api/skills, seeded server-side
 * from data/skills.json). Not creatable: a skill that isn't in the list can't be added, so the vocabulary
 * stays one spelling per skill.
 *
 * Applied on SUBMIT (a Save button), not on change, like the defaults card: the picker stages a selection
 * and Save sends the whole set (PUT /api/profile/skills replaces it).
 */
import { useForm } from "react-hook-form";
import { useGetProfileSkillsQuery, useLazyGetSkillsQuery, useSaveProfileSkillsMutation } from "../../api";
import { MAX_SKILLS } from "../../constants";
import { useSeededSelectFields } from "../../hooks";
import { useToast } from "../../toast/ToastProvider";
import type { SelectOption } from "../AsyncPaginateSelect";
import { ControlledAsyncPaginateMultiSelect } from "../ControlledAsyncPaginateMultiSelect";
import Button from "../Button";
import SettingsCard from "../settings/SettingsCard";

type SkillsFields = {
    skills: SelectOption[];
};

export default function SkillsCard() {
    const { toast } = useToast();
    const { control, handleSubmit, setValue, formState } = useForm<SkillsFields>({
        defaultValues: { skills: [] },
        mode: "onChange",
    });

    // PRE-FILL from the saved skills, keyed on their slugs: re-seeds when the saved set changes (e.g. after
    // a Save refetches it), never on a same-set refetch that would clobber a pick in progress.
    const { data: savedSkills, isLoading } = useGetProfileSkillsQuery();
    useSeededSelectFields(
        setValue,
        savedSkills ? savedSkills.map((skill) => skill.slug).join("|") : null,
        [{ name: "skills", option: (savedSkills ?? []).map((skill) => ({ value: skill.slug, label: skill.name })) }],
    );

    // the vocab picker's endpoint, injected as `fetchPage` (the select owns the paging)
    const [triggerSkills] = useLazyGetSkillsQuery();

    const [saveSkills, { isLoading: saving }] = useSaveProfileSkillsMutation();
    async function onSubmit({ skills }: SkillsFields) {
        try {
            await saveSkills(skills.map((skill) => skill.value)).unwrap();
            toast("Skills saved", { variant: "success" });
        } catch {
            toast("Couldn't save your skills. Try again.", { variant: "error" });
        }
    }

    return (
        <SettingsCard title="Skills" description="Languages, frameworks and tools you work with.">
            <form onSubmit={handleSubmit(onSubmit)} className="mt-5 flex flex-col gap-4">
                <div className="field">
                    <ControlledAsyncPaginateMultiSelect
                        control={control}
                        name="skills"
                        rules={{
                            // read from the form values: the generic wrapper types this field's value as
                            // a union of every path's type, so the first argument isn't a SelectOption[]
                            validate: (_value, { skills }) =>
                                skills.length <= MAX_SKILLS || `You can list up to ${MAX_SKILLS} skills.`,
                        }}
                        fetchPage={triggerSkills}
                        placeholder="Search skills…"
                        isLoading={isLoading}
                    />
                    <span className="text-[12.5px] text-gap">{formState.errors.skills?.message}</span>
                </div>

                <div className="flex justify-end">
                    <Button
                        type="submit"
                        variant="primary"
                        disabled={saving || isLoading || !formState.isValid}
                        className="text-[15px] disabled:opacity-50"
                    >
                        {saving ? "Saving…" : "Save skills"}
                    </Button>
                </div>
            </form>
        </SettingsCard>
    );
}
