/**
 * Small, reusable React hooks shared across pages. (Distinct from helpers.ts, which is pure,
 * React-free functions — anything that calls useState/useEffect/etc. lives here.)
 */
import { useEffect, useState } from "react";
import hark from "hark";
import { HARK_POLL_INTERVAL_MS, HARK_SPEAKING_THRESHOLD_DB } from "./constants";

/**
 * A running "mm:ss" clock that starts when the hook mounts and ticks every second. Used by the
 * interview session header to show elapsed time. Returns the formatted string directly so callers
 * don't repeat the padding; the interval is cleaned up on unmount.
 */
export function useElapsedClock(): string {
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        const id = window.setInterval(() => setElapsed((s) => s + 1), 1000);
        return () => window.clearInterval(id);
    }, []);
    const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const ss = String(elapsed % 60).padStart(2, "0");
    return `${mm}:${ss}`;
}

/**
 * Is the candidate speaking right now? A boolean driven by `hark` watching the live mic stream — the
 * analog of the AI's `speaking` (which tracks real TTS playback), so the candidate's mic icon can
 * pulse on actual speech instead of merely on "the mic is armed" (`listening`).
 *
 * hark is a pure OBSERVER: it attaches to the stream we already own (exposed by useSmartVoiceTurn) and
 * emits speaking / stopped_speaking with its own hysteresis, so no second getUserMedia, no conflict
 * with our recorder/VAD, and no on/off flicker to debounce ourselves. Deliberately NOT the Silero VAD
 * (useVoiceActivity), which does turn-taking and only runs in smart mode.
 *
 * Pass the stream from useSmartVoiceTurn; pass null while not recording and this resets to false. The
 * harker (and its AudioContext) is stopped when the stream changes or on unmount.
 */
export function useSpeaking(stream: MediaStream | null): boolean {
    const [speaking, setSpeaking] = useState(false);

    useEffect(() => {
        if (!stream) {
            setSpeaking(false);
            return;
        }
        const harker = hark(stream, {
            threshold: HARK_SPEAKING_THRESHOLD_DB,
            interval: HARK_POLL_INTERVAL_MS,
            play: false, // never route the mic back to the speakers
        });
        harker.on("speaking", () => setSpeaking(true));
        harker.on("stopped_speaking", () => setSpeaking(false));
        return () => {
            harker.stop(); // tears down hark's listeners + its AudioContext
            setSpeaking(false);
        };
    }, [stream]);

    return speaking;
}
