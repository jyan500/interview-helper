/**
 * CountdownClock — a timed interview's "mm:ss left" in the session header (an untimed interview shows
 * no clock at all). The clock only runs on the candidate's turn, so while it's paused (the interviewer is
 * thinking or speaking) it dims and shows a pause icon; under TIME_LOW_WARNING_MS it turns amber.
 */
import { Pause, Timer } from "@phosphor-icons/react";
import { TIME_LOW_WARNING_MS } from "../constants";
import { formatCountdown } from "../helpers";

export default function CountdownClock({ remainingMs, paused }: { remainingMs: number; paused: boolean }) {
    const low = remainingMs < TIME_LOW_WARNING_MS;
    const color = paused ? "text-neutral-400" : low ? "text-gap" : "text-ink";
    const StatusIcon = paused ? Pause : Timer;
    return (
        <span
            className={"flex items-center gap-1.5 font-heading text-[18px] " + color}
            aria-label={paused ? "Time left, paused during the interviewer's turn" : "Time left"}
        >
            <StatusIcon size={16} weight="regular" />
            {/* Fixed-width digits: the heading font's numerals are proportional ("1" is narrower than
                "0"), so without this every tick resizes the text and shifts the icon beside it.
                tabular-nums makes each digit the same width, and the 5ch box ("mm:ss") holds the
                width steady even where the font lacks tabular figures. */}
            <span className="inline-block w-[5ch] tabular-nums">{formatCountdown(remainingMs)}</span>
        </span>
    );
}
