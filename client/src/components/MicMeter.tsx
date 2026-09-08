/**
 * The live input-level bar under the Settings modal's mic picker — the "test your mic" affordance:
 * confirm the right device is picked and it's actually hearing you, BEFORE it's your turn to answer.
 *
 * It's its own component (not nested in SettingsModal) so useMicLevel's ~10Hz updates re-render only
 * this bar, not the whole dialog. `active` runs the meter (it opens its own mic stream, independent of
 * the recorder); switching the picker changes `deviceId` and re-points it at the new mic.
 */
import { useEffect } from "react";
import { useMicLevel } from "../hooks";

export default function MicMeter({
    deviceId,
    active,
    onReady,
}: {
    deviceId: string;
    active: boolean;
    // Called once the meter's stream is live — the moment real device LABELS become readable.
    onReady: () => void;
}) {
    const { level, silent, ready, error } = useMicLevel(deviceId, active);

    // Real device LABELS only appear after a getUserMedia grant; the meter's stream IS that grant, so
    // tell the parent to re-enumerate once it's live (swaps "Microphone N" for the true names).
    useEffect(() => {
        if (ready) onReady();
    }, [ready, onReady]);

    return (
        <>
            <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-neutral-800">
                {/* width tracks the live level; the CSS transition smooths hark's stepped updates. */}
                <div
                    className="h-full rounded-full bg-accent-300 transition-[width] duration-100 ease-out"
                    style={{ width: `${Math.round(level * 100)}%` }}
                />
            </div>
            <p className={"mt-1.5 text-[12.5px] " + micStatusClass(error, silent)}>
                {micStatusText(error, silent)}
            </p>
        </>
    );
}

// The one line under the bar: an open error wins, then sustained silence, else the neutral prompt.
function micStatusText(error: string | null, silent: boolean): string {
    if (error) return error;
    if (silent) return "No audio detected — check the right mic is selected and unmuted.";
    return "Speak to test — the bar moves with your voice.";
}

function micStatusClass(error: string | null, silent: boolean): string {
    return error || silent ? "text-accent-300" : "text-neutral-400";
}
