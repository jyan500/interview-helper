/**
 * The three-dot "thinking…" indicator, shared by the session's text and voice modes. A colour wave
 * sweeps across the dots in quick succession (muted -> bright accent -> muted), each dot offset from
 * the last — the standard app loading animation, replacing the old static-dots row (text mode) and
 * the literal "…" character (voice mode).
 *
 * The dots are sized in `em`, so the CALLER sets the scale purely via font-size: the text-mode typing
 * row renders them tiny inline, the voice-mode headline renders them large. The colour cycle and the
 * reduced-motion fallback live in index.css (.loading-dots / @keyframes dot-cycle).
 */
export default function LoadingDots({ className = "" }: { className?: string }) {
    return (
        <span className={"loading-dots " + className} aria-hidden="true">
            <span />
            <span />
            <span />
        </span>
    );
}
