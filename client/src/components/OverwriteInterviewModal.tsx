/**
 * Confirm-before-overwrite dialog for the dashboard's "Start interview". Shown only when the user
 * already has an unfinished (resumable) interview: starting a new one abandons that session, and the
 * backend keeps a single resumable slot, so the old one can no longer be resumed once this fires.
 *
 * Presentational — owns no interview state. Confirming CLOSES this modal and hands off to the page's
 * <StartingOverlay> (which blocks the page while the POST is in flight); the actual POST + navigate
 * lives in DashboardPage.
 */
import Modal from "./Modal";
import Button from "./Button";

export default function OverwriteInterviewModal({
    open,
    onClose,
    onConfirm,
}: {
    open: boolean;
    onClose: () => void;
    onConfirm: () => void;
}) {
    return (
        <Modal open={open} onClose={onClose} title="Start a new interview?">
            <p className="text-[15px] leading-relaxed text-neutral-300">
                You have an unfinished interview in progress. Starting a new one will overwrite it so the
                session can’t be resumed afterward.
            </p>

            <div className="mt-6 flex items-center justify-end gap-3">
                <Button
                    variant="secondary"
                    onClick={onClose}
                    className="text-[15px]"
                    style={{ padding: "11px 20px" }}
                >
                    Cancel
                </Button>
                <Button
                    variant="primary"
                    onClick={onConfirm}
                    className="text-[15px]"
                    style={{ padding: "11px 26px" }}
                >
                    Start new interview
                </Button>
            </div>
        </Modal>
    );
}
