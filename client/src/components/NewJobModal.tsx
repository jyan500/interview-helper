/**
 * "New job" dialog — paste a job description; the backend's extractor reads it (a paid LLM call) and
 * saves the job with the company, title, summary, role and level it found. On success we go straight
 * to the new job's page, where the candidate can correct the extraction and pick a round.
 *
 * The length window is checked here (JD_MIN_CHARS / JD_MAX_CHARS, mirroring the server) so a paste the
 * server would reject never costs a round trip. A server-side rejection still lands in the form's root
 * error with the server's own wording. Mounted only while open, so closing discards the draft.
 */
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { useCreateJobMutation } from "../api";
import { JD_MAX_CHARS, JD_MIN_CHARS } from "../constants";
import { errorDetail } from "../helpers";
import { useToast } from "../toast/ToastProvider";
import Modal from "./Modal";
import Button from "./Button";

type NewJobFields = {
    description: string;
};

export default function NewJobModal({ onClose }: { onClose: () => void }) {
    const navigate = useNavigate();
    const { toast } = useToast();
    const [createJob] = useCreateJobMutation();
    const {
        register,
        handleSubmit,
        setError,
        watch,
        formState: { errors, isSubmitting },
    } = useForm<NewJobFields>({ defaultValues: { description: "" } });

    const length = watch("description").trim().length;

    async function onSubmit({ description }: NewJobFields) {
        try {
            const job = await createJob({ description: description.trim() }).unwrap();
            toast(`Saved ${job.company} · ${job.title}`, { variant: "success" });
            navigate(`/jobs/${job.job_id}`);
        } catch (e) {
            setError("root", { message: errorDetail(e) ?? "Couldn't read that job description. Try again." });
        }
    }

    return (
        <Modal open onClose={onClose} title="New job" widthClass="w-[720px]">
            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
                <p className="text-[13.5px] text-neutral-400">
                    Paste the full job posting. We'll pick out the company, title, role and level, and
                    tailor each interview round to it. You can correct anything we get wrong afterwards.
                </p>

                <div className="field">
                    <label>Job description</label>
                    <textarea
                        className="input min-h-[300px] resize-y leading-[1.5]"
                        placeholder="Paste the job description…"
                        disabled={isSubmitting}
                        {...register("description", {
                            validate: (v) => {
                                const n = v.trim().length;
                                if (n < JD_MIN_CHARS) return `Paste the full job description (at least ${JD_MIN_CHARS} characters).`;
                                if (n > JD_MAX_CHARS) return `That's too long (max ${JD_MAX_CHARS.toLocaleString()} characters).`;
                                return true;
                            },
                        })}
                    />
                    <div className="mt-1 flex justify-between text-[12.5px]">
                        <span className="text-gap">{errors.description?.message}</span>
                        <span className={length > JD_MAX_CHARS ? "text-gap" : "text-neutral-500"}>
                            {length.toLocaleString()} / {JD_MAX_CHARS.toLocaleString()}
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
                        {isSubmitting ? "Reading the posting…" : "Save job"}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
