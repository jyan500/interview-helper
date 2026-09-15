/**
 * One toast row — its look, its enter/exit animation, and its own auto-dismiss timer.
 *
 * ANIMATION: slides in from the right into place (enter), and fades out where it sits (leaving). Three
 * phases drive it through the shared transition:
 *   enter   — off to the right, transparent (the pre-mount position)
 *   shown   — in place, opaque (flipped to on the frame after mount, so the transition actually runs)
 *   leaving — in place, transparent (a plain fade-out)
 *
 * LIFECYCLE: a timer starts the exit after `duration`; the close button starts it early. Either way
 * `beginExit` fades the row, then removes it (onDismiss) once the fade has finished — ANIM_MS is kept
 * in step with the transition duration below. A `dismissed` ref makes exit idempotent, so the timer
 * and a click can't both fire it.
 *
 * `motion-reduce:transition-none` respects a reduced-motion preference — the toast just appears and
 * disappears (still after ANIM_MS), no movement.
 */
import { useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import type { Toast, ToastVariant } from "./ToastProvider";

// Must match the transition duration in the className below — it's how long we wait after starting the
// fade before actually dropping the row.
const ANIM_MS = 260;

type Phase = "enter" | "shown" | "leaving";

// Per-phase transform + opacity. Enter comes from the right; leaving is a fade in place.
const PHASE_CLASS: Record<Phase, string> = {
    enter: "translate-x-[120%] opacity-0",
    shown: "translate-x-0 opacity-100",
    leaving: "translate-x-0 opacity-0",
};

// The variant dot's colour — success green, error amber (no red token), info accent.
const DOT_CLASS: Record<ToastVariant, string> = {
    success: "bg-strength",
    error: "bg-gap",
    info: "bg-accent",
};

export default function ToastItem({
    toast,
    onDismiss,
}: {
    toast: Toast;
    onDismiss: (id: number) => void;
}) {
    const [phase, setPhase] = useState<Phase>("enter");
    const dismissed = useRef(false);

    // flip enter -> shown on the next frame so the browser has painted the "enter" position first and
    // the transition to "shown" actually animates (a same-tick change would just jump).
    useEffect(() => {
        const raf = requestAnimationFrame(() => setPhase("shown"));
        return () => cancelAnimationFrame(raf);
    }, []);

    // auto-dismiss after the toast's duration.
    useEffect(() => {
        const timer = setTimeout(() => beginExit(), toast.duration);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function beginExit() {
        if (dismissed.current) return; // the timer and the close button must not both fire this
        dismissed.current = true;
        setPhase("leaving");
        setTimeout(() => onDismiss(toast.id), ANIM_MS);
    }

    return (
        <div
            role="status"
            className={
                "pointer-events-auto flex w-[300px] max-w-[calc(100vw-2rem)] items-start gap-2.5 " +
                "rounded-md bg-surface px-3.5 py-3 shadow-md transition-all duration-[260ms] ease-out " +
                "motion-reduce:transition-none " +
                PHASE_CLASS[phase]
            }
        >
            <span className={"mt-[5px] h-2 w-2 flex-none rounded-full " + DOT_CLASS[toast.variant]} />
            <p className="flex-1 text-[13px] leading-[1.4] text-ink">{toast.message}</p>
            <button
                type="button"
                onClick={beginExit}
                aria-label="Dismiss"
                className="-mr-1 flex-none text-neutral-400 hover:text-ink"
            >
                <X size={14} weight="bold" />
            </button>
        </div>
    );
}
