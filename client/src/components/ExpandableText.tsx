/**
 * Inline expand/collapse for long content: clamps it and reveals the rest IN PLACE on click, with a
 * "Show more" / "Show less" toggle. Used for the job description (JobDetailPage) and each question's text
 * on the interview scorecard (InterviewDetailPage).
 *
 * `clampClass` is how the collapsed state is cut. The default `line-clamp-2` suits plain text; content
 * with block children (FormattedText, which can hold a code block) can't be line-clamped, so it passes a
 * max height instead.
 *
 * The toggle appears ONLY when the content is actually truncated (measured), so short content stays
 * plain. Clicks stop propagation, so expanding never doubles as a click on whatever contains it.
 */
import { useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

export default function ExpandableText({
    children,
    clampClass = "line-clamp-2",
}: {
    children: ReactNode;
    clampClass?: string;
}) {
    const [expanded, setExpanded] = useState(false);
    const [overflowing, setOverflowing] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // Measure whether the CLAMPED content is truncated (scrollHeight exceeds the clamped clientHeight), so
    // the toggle only shows when it adds something. We don't re-measure while expanded (the clamp is
    // off, so they'd be equal) — `overflowing` sticks, keeping "Show less" available to collapse again.
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || expanded) return;
        setOverflowing(el.scrollHeight > el.clientHeight + 1);
    }, [children, expanded]);

    const canExpand = overflowing || expanded;

    const toggle = (e: MouseEvent) => {
        e.stopPropagation(); // expanding must never also count as a click on the container
        setExpanded((v) => !v);
    };

    return (
        <div>
            <div
                ref={ref}
                className={`${expanded ? "" : clampClass} ${canExpand ? "cursor-pointer" : ""}`}
                onClick={canExpand ? toggle : undefined}
            >
                {children}
            </div>
            {canExpand && (
                <button
                    type="button"
                    onClick={toggle}
                    className="mt-0.5 text-[12px] text-accent-300 hover:underline"
                >
                    {expanded ? "Show less" : "Show more"}
                </button>
            )}
        </div>
    );
}
