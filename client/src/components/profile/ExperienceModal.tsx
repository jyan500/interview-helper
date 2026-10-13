/**
 * Add / edit one role on the Profile page. With `experience` it edits that row (a full-replace PUT);
 * without, it adds a new one (POST). Mounted only while open, so closing discards the draft.
 *
 * Dates are month inputs ("YYYY-MM", exactly what the API takes). "I currently work here" clears and
 * disables the end month, and is what sends `end: null`. The checks mirror the server (required fields,
 * lengths, end not before start) so a save never round-trips just to be rejected; a server rejection
 * still lands in the form's root error with the server's own wording.
 */
import { useForm } from "react-hook-form";
import { useCreateExperienceMutation, useUpdateExperienceMutation, type Experience } from "../../api";
import { BACKGROUND_DESCRIPTION_MAX_CHARS, BACKGROUND_NAME_MAX_CHARS } from "../../constants";
import { errorDetail } from "../../helpers";
import { useToast } from "../../toast/ToastProvider";
import Modal from "../Modal";
import Button from "../Button";

type ExperienceFields = {
    title: string;
    company: string;
    start: string;
    end: string;
    current: boolean;
    description: string;
};

export default function ExperienceModal({
    experience,
    onClose,
}: {
    experience?: Experience;
    onClose: () => void;
}) {
    const { toast } = useToast();
    const [createExperience] = useCreateExperienceMutation();
    const [updateExperience] = useUpdateExperienceMutation();
    const {
        register,
        handleSubmit,
        setError,
        watch,
        formState: { errors, isSubmitting },
    } = useForm<ExperienceFields>({
        defaultValues: {
            title: experience?.title ?? "",
            company: experience?.company ?? "",
            start: experience?.start ?? "",
            end: experience?.end ?? "",
            // an existing role with no end month IS a current one
            current: experience ? experience.end === null : false,
            description: experience?.description ?? "",
        },
    });

    const current = watch("current");
    const descriptionLength = watch("description").trim().length;

    async function onSubmit(fields: ExperienceFields) {
        const body = {
            title: fields.title.trim(),
            company: fields.company.trim(),
            start: fields.start,
            end: fields.current ? null : fields.end,
            description: fields.description.trim(),
        };
        try {
            if (experience) {
                await updateExperience({ slug: experience.slug, body }).unwrap();
            } else {
                await createExperience(body).unwrap();
            }
            toast(experience ? "Role updated" : "Role added", { variant: "success" });
            onClose();
        } catch (e) {
            setError("root", { message: errorDetail(e) ?? "Couldn't save this role. Try again." });
        }
    }

    const requiredText = (label: string) => ({
        validate: (value: string) => value.trim().length > 0 || `${label} is required.`,
        maxLength: { value: BACKGROUND_NAME_MAX_CHARS, message: `Keep it under ${BACKGROUND_NAME_MAX_CHARS} characters.` },
    });

    return (
        <Modal open onClose={onClose} title={experience ? "Edit role" : "Add role"} widthClass="w-[560px]">
            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="field">
                        <label>Title</label>
                        <input className="input" placeholder="Backend Engineer" {...register("title", requiredText("Title"))} />
                        <span className="text-[12.5px] text-gap">{errors.title?.message}</span>
                    </div>
                    <div className="field">
                        <label>Company</label>
                        <input className="input" placeholder="Acme" {...register("company", requiredText("Company"))} />
                        <span className="text-[12.5px] text-gap">{errors.company?.message}</span>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="field">
                        <label>Start</label>
                        <input
                            type="month"
                            className="input [color-scheme:dark]"
                            {...register("start", { required: "Start month is required." })}
                        />
                        <span className="text-[12.5px] text-gap">{errors.start?.message}</span>
                    </div>
                    <div className="field">
                        <label>End</label>
                        <input
                            type="month"
                            className="input [color-scheme:dark] disabled:opacity-50"
                            disabled={current}
                            {...register("end", {
                                // "YYYY-MM" strings compare correctly as text, so a plain < is a date check
                                validate: (end, { current, start }) => {
                                    if (current) return true;
                                    if (!end) return "End month is required (or check \"I currently work here\").";
                                    if (start && end < start) return "End can't be before the start.";
                                    return true;
                                },
                            })}
                        />
                        <span className="text-[12.5px] text-gap">{errors.end?.message}</span>
                    </div>
                </div>

                <label className="flex items-center gap-2 text-[13.5px] text-neutral-300">
                    <input type="checkbox" className="h-4 w-4 cursor-pointer accent-accent" {...register("current")} />
                    I currently work here
                </label>

                <div className="field">
                    <label>Description</label>
                    <textarea
                        className="input min-h-[140px] leading-[1.5]"
                        placeholder="What you owned, what you built, and the results. Interviews can ask about this."
                        {...register("description", {
                            validate: (value) =>
                                value.trim().length <= BACKGROUND_DESCRIPTION_MAX_CHARS ||
                                `Keep it under ${BACKGROUND_DESCRIPTION_MAX_CHARS.toLocaleString()} characters.`,
                        })}
                    />
                    <div className="mt-1 flex justify-between text-[12.5px]">
                        <span className="text-gap">{errors.description?.message}</span>
                        <span className={descriptionLength > BACKGROUND_DESCRIPTION_MAX_CHARS ? "text-gap" : "text-neutral-500"}>
                            {descriptionLength.toLocaleString()} / {BACKGROUND_DESCRIPTION_MAX_CHARS.toLocaleString()}
                        </span>
                    </div>
                </div>

                {errors.root && (
                    <div className="rounded-md border border-gap-border bg-gap-bg px-3.5 py-[11px] text-[13.5px] leading-[1.45] text-gap">
                        {errors.root.message}
                    </div>
                )}

                <div className="flex items-center justify-end gap-3">
                    <Button variant="secondary" onClick={onClose} disabled={isSubmitting} className="text-[15px]">
                        Cancel
                    </Button>
                    <Button type="submit" variant="primary" disabled={isSubmitting} className="text-[15px]">
                        {isSubmitting ? "Saving…" : experience ? "Save role" : "Add role"}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
