/**
 * Toasts — transient, self-dismissing notifications, stacked in the bottom-left corner. The app's
 * one place for "that worked" / "that failed" feedback that shouldn't hijack the page (no modal, no
 * inline banner that shifts layout).
 *
 * SHAPE, mirroring AuthProvider: a context holds the live list, `useToast()` hands any component the
 * `toast()` trigger, and <ToastContainer> (rendered here, once) draws them. A component calls
 * `toast("Saved", { variant: "success" })` and forgets about it — the toast animates in, waits out
 * its duration, animates out, and removes itself.
 *
 * MULTIPLE AT ONCE is the default: `toast()` appends, so several can be on screen together (newest
 * nearest the corner). Each carries its own id, so dismissing one never disturbs the others.
 *
 * WHO OWNS DISMISSAL: the provider only ever ADDS and hard-REMOVES (dismiss). The exit ANIMATION is
 * ToastItem's job — it plays the fade-out, then calls dismiss to drop the row. Keeping removal here
 * a plain filter (no timers, no animation state) is what keeps this file trivial.
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import ToastContainer from "./ToastContainer";

export type ToastVariant = "success" | "error" | "info";

export interface Toast {
    id: number;
    message: string;
    variant: ToastVariant;
    duration: number; // ms on screen before it auto-dismisses
}

interface ToastOptions {
    variant?: ToastVariant;
    duration?: number;
}

interface ToastContextValue {
    toast: (message: string, options?: ToastOptions) => number;
    dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue>({
    toast: () => 0,
    dismiss: () => {},
});

// Default time on screen. Long enough to read a short line, short enough not to pile up.
const DEFAULT_DURATION = 3500;

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);
    // a monotonic counter for ids — a ref, so bumping it never triggers a render (unlike state).
    const nextId = useRef(1);

    const dismiss = useCallback((id: number) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const toast = useCallback((message: string, options?: ToastOptions) => {
        const id = nextId.current++;
        setToasts((prev) => [
            ...prev,
            {
                id,
                message,
                variant: options?.variant ?? "info",
                duration: options?.duration ?? DEFAULT_DURATION,
            },
        ]);
        return id;
    }, []);

    return (
        <ToastContext.Provider value={{ toast, dismiss }}>
            {children}
            <ToastContainer toasts={toasts} onDismiss={dismiss} />
        </ToastContext.Provider>
    );
}

/** The hook every component uses: `const { toast } = useToast()`. */
export function useToast(): ToastContextValue {
    return useContext(ToastContext);
}
