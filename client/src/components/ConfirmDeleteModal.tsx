/**
 * Confirm-before-delete — the Modal shell with a message (`children`) and Cancel / Delete buttons. Generic:
 * the caller writes what's being deleted and owns the mutation (`onConfirm`) and its in-flight flag
 * (`deleting`). First consumers: the Profile page's role and project rows.
 */
import type { ReactNode } from "react";
import Modal from "./Modal";
import Button from "./Button";

export default function ConfirmDeleteModal({
    open,
    title,
    confirmLabel,
    deleting,
    onClose,
    onConfirm,
    children,
}: {
    open: boolean;
    title: string;
    confirmLabel: string;
    deleting: boolean;
    onClose: () => void;
    onConfirm: () => void;
    children: ReactNode;
}) {
    return (
        <Modal open={open} onClose={onClose} title={title}>
            <div className="text-[15px] leading-relaxed text-neutral-300">{children}</div>

            <div className="mt-6 flex items-center justify-end gap-3">
                <Button variant="secondary" onClick={onClose} disabled={deleting} className="text-[15px]">
                    Cancel
                </Button>
                <Button variant="primary" onClick={onConfirm} disabled={deleting} className="text-[15px]">
                    {deleting ? "Deleting…" : confirmLabel}
                </Button>
            </div>
        </Modal>
    );
}
