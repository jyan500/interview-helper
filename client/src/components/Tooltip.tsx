/**
 * Tooltip.tsx — a small hover/focus tooltip shell.
 *
 * Wraps a trigger (passed as `children`) and reveals `content` in a floating bubble above it on
 * hover OR keyboard focus. Pure CSS: Tailwind's group-hover / group-focus-within toggle the bubble's
 * opacity, so there's no JS state, ref, or positioning library — the bubble is absolutely positioned
 * against the inline-flex wrapper. group-focus-within (not just hover) means a keyboard user who tabs
 * onto a focusable trigger sees it too.
 *
 * `align` picks the horizontal anchor so a trigger near a screen edge doesn't clip off-screen:
 *   - "center" (default) — centered over the trigger
 *   - "end"              — right-aligned, so the bubble opens leftward (what a right-edge trigger wants)
 *   - "start"            — left-aligned, opens rightward
 *
 * The bubble is pointer-events-none so it never intercepts a click meant for whatever is beneath it,
 * and role="tooltip" names it for assistive tech — give the trigger an aria-label describing it.
 */
import type { ReactNode } from "react";

type Align = "center" | "start" | "end";

const ALIGN: Record<Align, string> = {
    center: "left-1/2 -translate-x-1/2",
    start: "left-0",
    end: "right-0",
};

export default function Tooltip({
    content,
    align = "center",
    children,
    className = "",
}: {
    content: ReactNode;
    align?: Align;
    children: ReactNode;
    className?: string;
}) {
    return (
        <span className={"group relative inline-flex " + className}>
            {children}
            <span
                role="tooltip"
                className={
                    "pointer-events-none absolute bottom-full z-20 mb-2 w-max max-w-[240px] rounded-md " +
                    "border border-divider bg-surface px-3 py-2 text-[12.5px] leading-snug text-neutral-300 " +
                    "opacity-0 shadow-lg transition-opacity duration-150 " +
                    "group-hover:opacity-100 group-focus-within:opacity-100 " +
                    ALIGN[align]
                }
            >
                {content}
            </span>
        </span>
    );
}
