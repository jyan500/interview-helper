/**
 * Confirm-before-delete for a saved job. Deleting a job also deletes every simulation interview run
 * from it (and their transcripts and scorecards) — the backend cascades them — so the dialog says so.
 * Presentational: the page owns the mutation and the navigation away.
 */
import Modal from "./Modal";
import Button from "./Button";

export default function DeleteJobModal({
    open,
    jobName,
    deleting,
    onClose,
    onConfirm,
}: {
    open: boolean;
    jobName: string;
    deleting: boolean;
    onClose: () => void;
    onConfirm: () => void;
}) {
    return (
        <Modal open={open} onClose={onClose} title="Delete this job?">
            <p className="text-[15px] leading-relaxed text-neutral-300">
                <strong className="text-ink">{jobName}</strong> and every interview you've run from it,
                including transcripts and scorecards, will be deleted. This can't be undone.
            </p>

            <div className="mt-6 flex items-center justify-end gap-3">
                <Button variant="secondary" onClick={onClose} disabled={deleting} className="text-[15px]" style={{ padding: "11px 20px" }}>
                    Cancel
                </Button>
                <Button variant="primary" onClick={onConfirm} disabled={deleting} className="text-[15px]" style={{ padding: "11px 26px" }}>
                    {deleting ? "Deleting…" : "Delete job"}
                </Button>
            </div>
        </Modal>
    );
}
