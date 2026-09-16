/**
 * The user's avatar — their uploaded profile picture if they have one, otherwise their initials.
 * ONE component behind every place the "You" avatar shows (the nav, the session participant cell,
 * the transcript "You" rows), so "picture if uploaded, else initials" is decided in exactly one
 * spot. Before profile pictures, each of those sites drew its own initials box (and one even
 * hard-coded "JY"); this collapses them.
 *
 * Sizing and framing are the CALLER's, passed as `className` on the box (height/width/border) plus a
 * `textClassName` for the initials' font/size/color — the same box is reused for both the <img> and
 * the initials, so a picture drops into the exact shape the initials occupied. (Dimensions stay per
 * call site by convention; this component ships none of its own.)
 *
 * INTERVIEWER avatars are NOT this component — they're a fixed Sparkle glyph, a different thing.
 */
type Props = {
    // The picture's public URL, or null/undefined to fall back to initials.
    avatarUrl?: string | null;
    initials: string;
    // Box classes: height + width + border (+ any text color for the initials fallback).
    className?: string;
    // Initials-only classes: font family / size. Ignored when a picture is shown.
    textClassName?: string;
    alt?: string;
};

export default function Avatar({ avatarUrl, initials, className = "", textClassName = "", alt = "Your avatar" }: Props) {
    return (
        <div className={"flex flex-none items-center justify-center overflow-hidden rounded-md border " + className}>
            {avatarUrl ? (
                <img src={avatarUrl} alt={alt} className="h-full w-full object-cover" />
            ) : (
                <span className={textClassName}>{initials}</span>
            )}
        </div>
    );
}
