/**
 * Reusable modal SHELL — the backdrop, the centered panel, and the close plumbing (the header's close
 * button plus Esc). It owns NONE of the content: callers pass whatever the dialog shows as `children`,
 * so the same shell backs any modal (SettingsModal is the first consumer).
 *
 * Closing is deliberate-only: the X (or Esc). A backdrop click does NOT close — so a stray click while
 * reading or fiddling with a control can't dump you out of the dialog.
 */
import { useEffect, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";

export default function Modal({
    open,
    onClose,
    title,
    children,
}: {
    open: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
}) {
    // Esc closes while open.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div
                className="w-[440px] max-w-full rounded-md border border-divider bg-bg p-6"
                role="dialog"
                aria-modal="true"
                aria-label={title}
            >
                <div className="mb-5 flex items-center justify-between">
                    <h2 className="font-heading text-[21px] font-medium">{title}</h2>
                    <button className="btn btn-ghost btn-icon" aria-label="Close" onClick={onClose}>
                        <X size={18} weight="regular" />
                    </button>
                </div>
                {children}
            </div>
        </div>
    );
}
