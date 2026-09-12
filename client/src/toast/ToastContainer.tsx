/**
 * The fixed bottom-left stack the toasts live in. Purely positional: it anchors the column to the
 * corner and lets ToastItem handle each row's look and animation.
 *
 * `pointer-events-none` on the stack so it never blocks clicks on the page behind an empty corner;
 * each ToastItem re-enables pointer events on itself (so its close button is clickable). New toasts
 * append, and the column is anchored at the bottom, so the newest sits nearest the corner and older
 * ones ride up above it.
 */
import ToastItem from "./ToastItem";
import type { Toast } from "./ToastProvider";

export default function ToastContainer({
    toasts,
    onDismiss,
}: {
    toasts: Toast[];
    onDismiss: (id: number) => void;
}) {
    if (toasts.length === 0) return null;

    return (
        <div className="pointer-events-none fixed bottom-4 left-4 z-50 flex flex-col gap-2.5">
            {toasts.map((t) => (
                <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
            ))}
        </div>
    );
}
