/**
 * Review what a resume import found before any of it is saved: every parsed role and project as an
 * editable form with an "include" checkbox, and the skills the profile doesn't have yet as a picker.
 * "Add" saves the checked roles/projects one POST at a time and the kept skills in one PUT, through the
 * normal background endpoints (each invalidates its list, so the cards on the page refresh).
 *
 * ADD ALONGSIDE, NEVER REPLACE: imported entries are added next to the saved ones. An entry that looks
 * like one already on the profile starts UNCHECKED and is tagged (buildResumeDrafts), so re-importing
 * the same resume doesn't double everything; skills already saved aren't offered at all. Saved skills
 * are never edited here: PUT /api/profile/skills replaces the whole set, so it's sent the saved skills
 * PLUS the kept new ones. The count caps still hold (MAX_EXPERIENCES / MAX_PROJECTS / MAX_SKILLS).
 *
 * One RHF form across everything, provided to the extracted section components via FormProvider.
 * Validation only bites on checked rows. If some saves fail, what was saved leaves the form and the rest
 * stays, with the reasons in the root error, so a retry only re-sends what's left.
 */
import { useState } from "react";
import { FormProvider, useFieldArray, useForm } from "react-hook-form";
import {
    useCreateExperienceMutation,
    useCreateProjectMutation,
    useGetExperiencesQuery,
    useGetProfileSkillsQuery,
    useGetProjectsQuery,
    useSaveProfileSkillsMutation,
    type ResumeParseResponse,
} from "../../api";
import { MAX_EXPERIENCES, MAX_PROJECTS } from "../../constants";
import { buildResumeDrafts, countLabel, errorDetail, type ResumeReviewFields } from "../../helpers";
import { useToast } from "../../toast/ToastProvider";
import Button from "../Button";
import Modal from "../Modal";
import ImportedProjectFields from "./ImportedProjectFields";
import ImportedRoleFields from "./ImportedRoleFields";
import ImportedSkillsField from "./ImportedSkillsField";

export default function ResumeReviewModal({
    parsed,
    onClose,
}: {
    parsed: ResumeParseResponse;
    onClose: () => void;
}) {
    const { toast } = useToast();
    // already loaded by the Experience, Projects and Skills cards on the same page, so these are cache reads
    const { data: savedExperiences = [] } = useGetExperiencesQuery();
    const { data: savedProjects = [] } = useGetProjectsQuery();
    const { data: savedSkills = [] } = useGetProfileSkillsQuery();
    const [createExperience] = useCreateExperienceMutation();
    const [createProject] = useCreateProjectMutation();
    const [saveProfileSkills] = useSaveProfileSkillsMutation();

    // the free slots as of opening; the saved lists grow as rows are added, but those rows leave the form
    const rolesRemaining = Math.max(0, MAX_EXPERIENCES - savedExperiences.length);
    const projectsRemaining = Math.max(0, MAX_PROJECTS - savedProjects.length);

    // Built ONCE, at mount. `drafts.skills` also stays as the picker's options: the form value is the
    // skills still kept, so one removed by mistake can be picked again from the menu.
    const [drafts] = useState(() =>
        buildResumeDrafts(
            parsed,
            { experiences: savedExperiences, projects: savedProjects, skills: savedSkills },
            { roles: rolesRemaining, projects: projectsRemaining },
        ),
    );
    const alreadySavedSkills = parsed.skills.length - drafts.skills.length;

    const form = useForm<ResumeReviewFields>({ defaultValues: drafts, mode: "onChange" });
    const {
        control,
        handleSubmit,
        setError,
        setValue,
        clearErrors,
        watch,
        formState: { errors, isSubmitting },
    } = form;
    const { fields: roleFields, remove: removeRoles } = useFieldArray({ control, name: "roles" });
    const { fields: projectFields, remove: removeProjects } = useFieldArray({ control, name: "projects" });

    // watch() re-renders this modal (and so every row) on any change; fine at <= 15 roles + 15 projects
    const roles = watch("roles");
    const projectRows = watch("projects");
    const keptSkills = watch("skills");
    const includedRoles = roles.filter((role) => role.include).length;
    const includedProjects = projectRows.filter((project) => project.include).length;

    async function onSubmit(values: ResumeReviewFields) {
        clearErrors("root");
        const savedRoleIndexes: number[] = [];
        const savedProjectIndexes: number[] = [];
        let skillsAdded = 0;
        const failures: string[] = [];

        // 1. Save the checked rows in order, collecting failures instead of stopping at the first one.
        for (const [index, role] of values.roles.entries()) {
            if (!role.include) continue;
            try {
                await createExperience({
                    title: role.title.trim(),
                    company: role.company.trim(),
                    start: role.start,
                    end: role.current ? null : role.end,
                    description: role.description.trim(),
                }).unwrap();
                savedRoleIndexes.push(index);
            } catch (e) {
                failures.push(`${role.title.trim()}: ${errorDetail(e) ?? "couldn't be added"}`);
            }
        }
        for (const [index, project] of values.projects.entries()) {
            if (!project.include) continue;
            try {
                await createProject({
                    name: project.name.trim(),
                    url: project.url.trim() || null,
                    description: project.description.trim(),
                }).unwrap();
                savedProjectIndexes.push(index);
            } catch (e) {
                failures.push(`${project.name.trim()}: ${errorDetail(e) ?? "couldn't be added"}`);
            }
        }

        // 2. The skills: one PUT of the saved set plus the kept new ones (it replaces the whole set).
        if (values.skills.length > 0) {
            try {
                await saveProfileSkills([
                    ...savedSkills.map((skill) => skill.slug),
                    ...values.skills.map((skill) => skill.value),
                ]).unwrap();
                skillsAdded = values.skills.length;
            } catch (e) {
                failures.push(`Skills: ${errorDetail(e) ?? "couldn't be added"}`);
            }
        }

        // 3. Toast what was added.
        const added = [
            savedRoleIndexes.length > 0 ? countLabel(savedRoleIndexes.length, "role") : null,
            savedProjectIndexes.length > 0 ? countLabel(savedProjectIndexes.length, "project") : null,
            skillsAdded > 0 ? countLabel(skillsAdded, "skill") : null,
        ].filter((part) => part !== null);
        if (added.length > 0) toast(`Added ${added.join(", ")}`, { variant: "success" });

        // 4. All saved: close. Some failed: drop what was saved, keep the rest open with the reasons.
        if (failures.length === 0) {
            onClose();
            return;
        }
        removeRoles(savedRoleIndexes);
        removeProjects(savedProjectIndexes);
        if (skillsAdded > 0) setValue("skills", []);
        setError("root", { message: `Some entries couldn't be added. ${failures.join(". ")}.` });
    }

    const submitParts = [
        includedRoles > 0 ? countLabel(includedRoles, "role") : null,
        includedProjects > 0 ? countLabel(includedProjects, "project") : null,
        keptSkills.length > 0 ? countLabel(keptSkills.length, "skill") : null,
    ].filter((part) => part !== null);

    return (
        <Modal open onClose={onClose} title="Review your resume" widthClass="w-[680px]">
            <FormProvider {...form}>
                <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
                    <p className="text-[13.5px] leading-[1.5] text-neutral-400">
                        Please verify that the information we imported is correct, or modify any fields that are incorrect. 
                        Check off the experiences and projects that you'd like to add to your profile.
                    </p>

                    <div className="-mr-2 flex max-h-[60vh] flex-col gap-6 overflow-y-auto pr-2">
                        {roleFields.length > 0 && (
                            <section className="flex flex-col gap-3">
                                <div className="flex items-baseline justify-between gap-3">
                                    <h3 className="font-heading text-[17px] font-medium">Experience</h3>
                                    <span className="text-[12.5px] text-neutral-500">
                                        {rolesRemaining === 0
                                            ? `Your profile already has the maximum of ${MAX_EXPERIENCES} roles.`
                                            : `${includedRoles} of ${countLabel(rolesRemaining, "free slot")} used`}
                                    </span>
                                </div>
                                {roleFields.map((field, index) => (
                                    <ImportedRoleFields
                                        key={field.id}
                                        index={index}
                                        canInclude={roles[index]?.include || includedRoles < rolesRemaining}
                                    />
                                ))}
                            </section>
                        )}

                        {projectFields.length > 0 && (
                            <section className="flex flex-col gap-3">
                                <div className="flex items-baseline justify-between gap-3">
                                    <h3 className="font-heading text-[17px] font-medium">Projects</h3>
                                    <span className="text-[12.5px] text-neutral-500">
                                        {projectsRemaining === 0
                                            ? `Your profile already has the maximum of ${MAX_PROJECTS} projects.`
                                            : `${includedProjects} of ${countLabel(projectsRemaining, "free slot")} used`}
                                    </span>
                                </div>
                                {projectFields.map((field, index) => (
                                    <ImportedProjectFields
                                        key={field.id}
                                        index={index}
                                        canInclude={projectRows[index]?.include || includedProjects < projectsRemaining}
                                    />
                                ))}
                            </section>
                        )}

                        {drafts.skills.length > 0 && (
                            <section className="flex flex-col gap-3">
                                <div className="flex items-baseline justify-between gap-3">
                                    <h3 className="font-heading text-[17px] font-medium">Skills</h3>
                                    {alreadySavedSkills > 0 && (
                                        <span className="text-[12.5px] text-neutral-500">
                                            {countLabel(parsed.skills.length, "skill")} found,{" "}
                                            {alreadySavedSkills} already on your profile
                                        </span>
                                    )}
                                </div>
                                <ImportedSkillsField options={drafts.skills} savedCount={savedSkills.length} />
                            </section>
                        )}
                    </div>

                    {errors.root && (
                        <div className="rounded-md border border-gap-border bg-gap-bg px-3.5 py-[11px] text-[13.5px] leading-[1.45] text-gap">
                            {errors.root.message}
                        </div>
                    )}

                    <div className="flex items-center justify-end gap-3">
                        {/* what Save will add, beside the buttons rather than inside one */}
                        <span className="text-[13px] text-neutral-500">
                            {submitParts.length > 0 ? `${submitParts.join(", ")} selected` : "Nothing selected"}
                        </span>
                        <Button variant="secondary" onClick={onClose} disabled={isSubmitting} className="text-[15px]">
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            variant="primary"
                            disabled={isSubmitting || submitParts.length === 0}
                            className="text-[15px] disabled:opacity-50"
                        >
                            {isSubmitting ? "Saving…" : "Save"}
                        </Button>
                    </div>
                </form>
            </FormProvider>
        </Modal>
    );
}
