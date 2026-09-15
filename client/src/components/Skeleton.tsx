import { SHIMMER } from "../constants";

/**
 * The atomic loading placeholder — ONE shimmer block, the shared unit every skeleton in the app is
 * built from. The shared LOOK (pulse + rounding + fill) lives in SHIMMER; the SHAPE (height, width,
 * aspect) is the caller's, passed via `className` — the same "a style constant holds no dimensions"
 * split the rest of the app follows. This is the one place the `SHIMMER` concatenation lives, so
 * callers stop hand-writing `className={"h-x w-y " + SHIMMER}` at every placeholder.
 *
 * `inline` renders a <span> (inline-block) instead of a <div>, for a bar that must sit inside a
 * text-aligned table cell and honour its alignment the way real content would (see SkeletonRow).
 */
interface SkeletonProps {
    className?: string;
    inline?: boolean;
}

export function Skeleton({ className = "", inline = false }: SkeletonProps) {
    const cls = [inline ? "inline-block" : "block", SHIMMER, className].filter(Boolean).join(" ");
    return inline ? <span className={cls} /> : <div className={cls} />;
}
