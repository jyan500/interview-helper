/**
 * Projects card — the projects the candidate wants to talk about (work, side or school), newest first.
 * The same self-contained shape as ExperienceCard: its own query, an Add/Edit modal (ProjectModal) and a
 * confirm-before-delete. A project's link shows as its subtitle and opens in a new tab.
 */
import { useState } from "react";
import { Plus } from "@phosphor-icons/react";
import { useDeleteProjectMutation, useGetProjectsQuery, type Project } from "../../api";
import { MAX_PROJECTS } from "../../constants";
import { useToast } from "../../toast/ToastProvider";
import Button from "../Button";
import ConfirmDeleteModal from "../ConfirmDeleteModal";
import SettingsCard from "../settings/SettingsCard";
import BackgroundRow from "./BackgroundRow";
import ProjectModal from "./ProjectModal";

export default function ProjectsCard() {
    const { toast } = useToast();
    const { data: projects = [], isLoading } = useGetProjectsQuery();
    const [deleteProject, { isLoading: deleting }] = useDeleteProjectMutation();
    const [editing, setEditing] = useState<Project | "new" | null>(null);
    const [pendingDelete, setPendingDelete] = useState<Project | null>(null);

    const atCap = projects.length >= MAX_PROJECTS;

    async function confirmDelete() {
        if (!pendingDelete) return;
        try {
            await deleteProject(pendingDelete.slug).unwrap();
            toast("Project deleted", { variant: "success" });
            setPendingDelete(null);
        } catch {
            toast("Couldn't delete this project. Try again.", { variant: "error" });
        }
    }

    return (
        <SettingsCard
            title="Projects"
            description="Work, side or school projects you'd like to be asked about."
            action={
                <Button
                    variant="secondary"
                    onClick={() => setEditing("new")}
                    disabled={isLoading || atCap}
                    title={atCap ? `You can list up to ${MAX_PROJECTS} projects` : undefined}
                    className="flex items-center gap-1.5 text-[13.5px]"
                >
                    <Plus size={15} weight="regular" />
                    Add project
                </Button>
            }
        >
            {isLoading ? (
                <ul className="mt-2 divide-y divide-divider">
                    <BackgroundRow loading />
                    <BackgroundRow loading />
                </ul>
            ) : projects.length === 0 ? (
                <p className="mt-4 text-[13.5px] text-neutral-500">No projects yet.</p>
            ) : (
                <ul className="mt-2 divide-y divide-divider">
                    {projects.map((project) => (
                        <BackgroundRow
                            key={project.slug}
                            title={project.name}
                            subtitle={
                                project.url ? (
                                    <a
                                        href={project.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="break-all hover:text-accent"
                                    >
                                        {project.url}
                                    </a>
                                ) : undefined
                            }
                            description={project.description}
                            onEdit={() => setEditing(project)}
                            onDelete={() => setPendingDelete(project)}
                        />
                    ))}
                </ul>
            )}

            {editing && (
                <ProjectModal project={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />
            )}

            <ConfirmDeleteModal
                open={pendingDelete !== null}
                title="Delete this project?"
                confirmLabel="Delete project"
                deleting={deleting}
                onClose={() => setPendingDelete(null)}
                onConfirm={confirmDelete}
            >
                <strong className="text-ink">{pendingDelete?.name}</strong> will be removed from your profile.
                This can't be undone.
            </ConfirmDeleteModal>
        </SettingsCard>
    );
}
