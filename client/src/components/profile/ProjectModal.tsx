/**
 * Add / edit one project on the Profile page. Same shape as ExperienceModal: `project` = edit (a
 * full-replace PUT, where an empty link sends `url: null` to clear it), none = add (POST). Mounted only
 * while open, so closing discards the draft. The checks mirror the server's (name required, lengths,
 * an http(s) link) so a save never round-trips just to be rejected.
 */
import { useForm } from "react-hook-form";
import { useCreateProjectMutation, useUpdateProjectMutation, type Project } from "../../api";
import {
    BACKGROUND_DESCRIPTION_MAX_CHARS,
    BACKGROUND_NAME_MAX_CHARS,
    BACKGROUND_URL_MAX_CHARS,
} from "../../constants";
import { errorDetail } from "../../helpers";
import { useToast } from "../../toast/ToastProvider";
import Modal from "../Modal";
import Button from "../Button";

type ProjectFields = {
    name: string;
    url: string;
    description: string;
};

export default function ProjectModal({ project, onClose }: { project?: Project; onClose: () => void }) {
    const { toast } = useToast();
    const [createProject] = useCreateProjectMutation();
    const [updateProject] = useUpdateProjectMutation();
    const {
        register,
        handleSubmit,
        setError,
        watch,
        formState: { errors, isSubmitting },
    } = useForm<ProjectFields>({
        defaultValues: {
            name: project?.name ?? "",
            url: project?.url ?? "",
            description: project?.description ?? "",
        },
    });

    const descriptionLength = watch("description").trim().length;

    async function onSubmit(fields: ProjectFields) {
        const url = fields.url.trim();
        const body = {
            name: fields.name.trim(),
            url: url || null,
            description: fields.description.trim(),
        };
        try {
            if (project) {
                await updateProject({ slug: project.slug, body }).unwrap();
            } else {
                await createProject(body).unwrap();
            }
            toast(project ? "Project updated" : "Project added", { variant: "success" });
            onClose();
        } catch (e) {
            setError("root", { message: errorDetail(e) ?? "Couldn't save this project. Try again." });
        }
    }

    return (
        <Modal open onClose={onClose} title={project ? "Edit project" : "Add project"} widthClass="w-[560px]">
            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
                <div className="field">
                    <label>Name</label>
                    <input
                        className="input"
                        placeholder="Payments ledger rewrite"
                        {...register("name", {
                            validate: (value) => value.trim().length > 0 || "Name is required.",
                            maxLength: {
                                value: BACKGROUND_NAME_MAX_CHARS,
                                message: `Keep it under ${BACKGROUND_NAME_MAX_CHARS} characters.`,
                            },
                        })}
                    />
                    <span className="text-[12.5px] text-gap">{errors.name?.message}</span>
                </div>

                <div className="field">
                    <label>Link (optional)</label>
                    <input
                        className="input"
                        placeholder="https://github.com/you/project"
                        {...register("url", {
                            validate: (value) => {
                                const url = value.trim();
                                if (!url) return true;
                                if (!/^https?:\/\/\S+$/.test(url)) return "Use a full link starting with http:// or https://.";
                                if (url.length > BACKGROUND_URL_MAX_CHARS) return "That link is too long.";
                                return true;
                            },
                        })}
                    />
                    <span className="text-[12.5px] text-gap">{errors.url?.message}</span>
                </div>

                <div className="field">
                    <label>Description</label>
                    <textarea
                        className="input min-h-[140px] leading-[1.5]"
                        placeholder="What it does, your part in it, and what was hard. Interviews can ask about this."
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
                        {isSubmitting ? "Saving…" : project ? "Save project" : "Add project"}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
