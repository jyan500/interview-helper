/**
 * Experience card — the candidate's past and current roles, newest first (the server's order). Each row
 * edits in ExperienceModal or deletes behind a confirm. Behavioral interviews read these, so the card's
 * description says so.
 *
 * Self-contained like the other Profile cards: it owns its query, both modals and the delete mutation.
 * `editing` is the one piece of modal state: "new" opens an empty Add form, an Experience opens Edit,
 * null closes it.
 */
import { useState } from "react";
import { Plus } from "@phosphor-icons/react";
import { useDeleteExperienceMutation, useGetExperiencesQuery, type Experience } from "../../api";
import { MAX_EXPERIENCES } from "../../constants";
import { formatMonthRange } from "../../helpers";
import { useToast } from "../../toast/ToastProvider";
import Button from "../Button";
import ConfirmDeleteModal from "../ConfirmDeleteModal";
import SettingsCard from "../settings/SettingsCard";
import BackgroundRow from "./BackgroundRow";
import ExperienceModal from "./ExperienceModal";

export default function ExperienceCard() {
    const { toast } = useToast();
    const { data: experiences = [], isLoading } = useGetExperiencesQuery();
    const [deleteExperience, { isLoading: deleting }] = useDeleteExperienceMutation();
    const [editing, setEditing] = useState<Experience | "new" | null>(null);
    const [pendingDelete, setPendingDelete] = useState<Experience | null>(null);

    const atCap = experiences.length >= MAX_EXPERIENCES;

    async function confirmDelete() {
        if (!pendingDelete) return;
        try {
            await deleteExperience(pendingDelete.slug).unwrap();
            toast("Role deleted", { variant: "success" });
            setPendingDelete(null);
        } catch {
            toast("Couldn't delete this role. Try again.", { variant: "error" });
        }
    }

    return (
        <SettingsCard
            title="Experience"
            description="Roles you've held. Behavioral interviews can ask about what you did in them."
            action={
                <Button
                    variant="secondary"
                    onClick={() => setEditing("new")}
                    disabled={isLoading || atCap}
                    title={atCap ? `You can list up to ${MAX_EXPERIENCES} roles` : undefined}
                    className="flex items-center gap-1.5 text-[13.5px]"
                >
                    <Plus size={15} weight="regular" />
                    Add role
                </Button>
            }
        >
            {isLoading ? (
                <ul className="mt-2 divide-y divide-divider">
                    <BackgroundRow loading />
                    <BackgroundRow loading />
                </ul>
            ) : experiences.length === 0 ? (
                <p className="mt-4 text-[13.5px] text-neutral-500">No roles yet. Add the jobs you've held.</p>
            ) : (
                <ul className="mt-2 divide-y divide-divider">
                    {experiences.map((experience) => (
                        <BackgroundRow
                            key={experience.slug}
                            title={experience.title}
                            subtitle={`${experience.company} · ${formatMonthRange(experience.start, experience.end)}`}
                            description={experience.description}
                            onEdit={() => setEditing(experience)}
                            onDelete={() => setPendingDelete(experience)}
                        />
                    ))}
                </ul>
            )}

            {editing && (
                <ExperienceModal
                    experience={editing === "new" ? undefined : editing}
                    onClose={() => setEditing(null)}
                />
            )}

            <ConfirmDeleteModal
                open={pendingDelete !== null}
                title="Delete this role?"
                confirmLabel="Delete role"
                deleting={deleting}
                onClose={() => setPendingDelete(null)}
                onConfirm={confirmDelete}
            >
                <strong className="text-ink">
                    {pendingDelete?.title} at {pendingDelete?.company}
                </strong>{" "}
                will be removed from your profile. This can't be undone.
            </ConfirmDeleteModal>
        </SettingsCard>
    );
}
