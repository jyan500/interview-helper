/**
 * Inline expand/collapse for a long text cell: clamps to 2 lines and reveals the rest IN PLACE on
 * click, with a "Show more" / "Show less" toggle. Only rendered for questions (QuestionsTable) — the
 * prompt can run long — which is why it's its own component and not baked into QuestionsTable: the
 * InterviewsTable cells are short and deliberately don't get this.
 *
 * The toggle appears ONLY when the text is actually truncated (measured), so short questions stay a
 * plain line. Clicks stop propagation, so expanding never doubles as toggling the row's checkbox.
 */
import { useLayoutEffect, useRef, useState, type MouseEvent } from "react";

export default function ExpandableText({ text }: { text: string }) {
    const [expanded, setExpanded] = useState(false);
    const [overflowing, setOverflowing] = useState(false);
    const ref = useRef<HTMLParagraphElement>(null);

    // Measure whether the CLAMPED text is truncated (scrollHeight exceeds the 2-line clientHeight), so
    // the toggle only shows when it adds something. We don't re-measure while expanded (the clamp is
    // off, so they'd be equal) — `overflowing` sticks, keeping "Show less" available to collapse again.
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || expanded) return;
        setOverflowing(el.scrollHeight > el.clientHeight + 1);
    }, [text, expanded]);

    const canExpand = overflowing || expanded;

    const toggle = (e: MouseEvent) => {
        e.stopPropagation(); // expanding must never also toggle the row's selection
        setExpanded((v) => !v);
    };

    return (
        <div>
            <p
                ref={ref}
                className={`${expanded ? "" : "line-clamp-2"} ${canExpand ? "cursor-pointer" : ""}`}
                onClick={canExpand ? toggle : undefined}
            >
                {text}
            </p>
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
