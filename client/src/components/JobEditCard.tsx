/**
 * The Job page's edit form — the candidate correcting what the extractor read off the posting: company,
 * title, and the role + level the rounds are pitched at (the async pickers the kickoff form uses).
 * Saves on submit via PATCH /api/jobs/{id}; the "Jobs" tag invalidation refetches the page, and the
 * reset effect below re-seeds the form from the saved row.
 */
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useLazyGetLevelsQuery, useLazyGetRolesQuery, useUpdateJobMutation, type JobDetail } from "../api";
import { errorDetail } from "../helpers";
import { useToast } from "../toast/ToastProvider";
import type { SelectOption } from "./AsyncPaginateSelect";
import { ControlledAsyncPaginateSelect } from "./ControlledAsyncPaginateSelect";
import SettingsCard from "./settings/SettingsCard";
import Button from "./Button";

type JobFields = {
    company: string;
    title: string;
    role: SelectOption | null;
    level: SelectOption | null;
};

function fieldsFrom(job: JobDetail): JobFields {
    return {
        company: job.company,
        title: job.title,
        role: { value: job.role, label: job.role_name },
        level: { value: job.level, label: job.level_name },
    };
}

export default function JobEditCard({ job }: { job: JobDetail }) {
    const { toast } = useToast();
    const [updateJob] = useUpdateJobMutation();
    const [triggerRoles] = useLazyGetRolesQuery();
    const [triggerLevels] = useLazyGetLevelsQuery();
    const {
        control,
        register,
        handleSubmit,
        reset,
        formState: { errors, isDirty, isSubmitting },
    } = useForm<JobFields>({ defaultValues: fieldsFrom(job) });

    // Re-seed from the server row whenever it changes (a save's refetch, or navigating between jobs).
    useEffect(() => {
        reset(fieldsFrom(job));
    }, [job, reset]);

    async function onSubmit({ company, title, role, level }: JobFields) {
        if (!role || !level) return; // `required` already guarantees both
        try {
            await updateJob({
                jobId: job.job_id,
                body: { company: company.trim(), title: title.trim(), role: role.value, level: level.value },
            }).unwrap();
            toast("Job updated", { variant: "success" });
        } catch (e) {
            toast(errorDetail(e) ?? "Couldn't save the job. Try again.", { variant: "error" });
        }
    }

    const notBlank = (v: string) => v.trim().length > 0 || "Required";

    return (
        <SettingsCard title="Details" description="Fix anything we read wrong. Role and level set the bar for new rounds.">
            <form onSubmit={handleSubmit(onSubmit)} className="mt-5 flex flex-col gap-4">
                <div className="field">
                    <label>Company</label>
                    <input className="input" {...register("company", { validate: notBlank })} />
                    {errors.company && <p className="mt-1 text-[12.5px] text-gap">{errors.company.message}</p>}
                </div>
                <div className="field">
                    <label>Title</label>
                    <input className="input" {...register("title", { validate: notBlank })} />
                    {errors.title && <p className="mt-1 text-[12.5px] text-gap">{errors.title.message}</p>}
                </div>
                <div className="field">
                    <label>Role</label>
                    <ControlledAsyncPaginateSelect
                        control={control}
                        name="role"
                        rules={{ required: true }}
                        fetchPage={triggerRoles}
                        placeholder="Search roles…"
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
                    />
                </div>
                <div className="flex justify-end">
                    <Button
                        type="submit"
                        variant="primary"
                        disabled={!isDirty || isSubmitting}
                        className="text-[15px] disabled:opacity-50"
                    >
                        {isSubmitting ? "Saving…" : "Save changes"}
                    </Button>
                </div>
            </form>
        </SettingsCard>
    );
}
