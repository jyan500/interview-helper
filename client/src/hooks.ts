/**
 * Small, reusable React hooks shared across pages. (Distinct from helpers.ts, which is pure,
 * React-free functions — anything that calls useState/useEffect/etc. lives here.)
 */
import { useCallback, useEffect, useState } from "react";
import hark from "hark";
import { audioConstraints } from "./voice/helpers";
import {
    HARK_POLL_INTERVAL_MS,
    HARK_SPEAKING_THRESHOLD_DB,
    MIC_LEVEL_FLOOR_DB,
    MIC_LEVEL_CEIL_DB,
    MIC_SILENCE_LEVEL,
    MIC_SILENCE_MS,
} from "./constants";

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

/**
 * The available audio-input devices (microphones), for a device picker. Returns the list plus a
 * `refresh` the caller invokes once mic permission is granted.
 *
 * THE PERMISSION CATCH: before the user grants mic access, enumerateDevices() still lists the devices
 * but every `label` is BLANK (a privacy measure) — so the picker can only show generic "Microphone N"
 * until then. After the first getUserMedia grant the labels populate, but no event necessarily fires,
 * so the consumer calls refresh() when its stream opens to re-read them. We also listen for
 * `devicechange` (mic plugged/unplugged) to keep the list live.
 */
export function useAudioInputDevices(): { devices: MediaDeviceInfo[]; refresh: () => void } {
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

    const refresh = useCallback(async () => {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        try {
            const all = await navigator.mediaDevices.enumerateDevices();
            setDevices(all.filter((d) => d.kind === "audioinput"));
        } catch (e) {
            console.error("Failed to enumerate audio input devices:", e);
        }
    }, []);

    useEffect(() => {
        refresh();
        const md = navigator.mediaDevices;
        md?.addEventListener?.("devicechange", refresh);
        return () => md?.removeEventListener?.("devicechange", refresh);
    }, [refresh]);

    return { devices, refresh };
}

/**
 * Turn a getUserMedia rejection into one line a candidate can act on. The DOMException `name` is the
 * stable signal (the human message is browser-specific); the two we actually hit are a denied permission
 * prompt and a chosen device that's since been unplugged (our `exact` deviceId constraint makes that
 * fail loudly by design — see audioConstraints).
 */
function micErrorMessage(e: unknown): string {
    const name = (e as { name?: string })?.name;
    if (name === "NotAllowedError" || name === "SecurityError")
        return "Microphone access is blocked. Allow it in your browser settings.";
    if (name === "NotFoundError" || name === "OverconstrainedError")
        return "That microphone isn't available. Pick another.";
    return "Couldn't open the microphone.";
}

/**
 * A live microphone INPUT-LEVEL meter for the Settings modal's "test your mic" bar. While `active`, it
 * opens its OWN getUserMedia stream on `deviceId` (independent of the recorder — a mic can back several
 * readers at once) and hands it to `hark`, the same loudness library useSpeaking uses. hark's
 * volume_change reports the input level in dBFS; we map it to a 0..1 bar and watch for sustained quiet:
 *
 *   level  — 0..1, hark's dB mapped onto [MIC_LEVEL_FLOOR_DB, MIC_LEVEL_CEIL_DB]. ~0 when quiet, climbs
 *            toward 1 as you talk: the bar that "shoots to the right" when speaking.
 *   silent — true once the level has stayed below MIC_SILENCE_LEVEL for MIC_SILENCE_MS: drives the
 *            "no audio detected" warning (wrong mic, muted hardware, a permission that opened a dead
 *            track). Starts false so a freshly-opened meter isn't accusatory before you've spoken.
 *   ready  — true once the stream is live. The consumer re-reads its device list on this edge, because
 *            enumerateDevices() only returns real mic LABELS after a getUserMedia grant.
 *   error  — a human-readable reason the meter couldn't open (denied permission, device gone), else null.
 *
 * Everything is torn down when `active` goes false, `deviceId` changes, or the component unmounts —
 * hark releases its AudioContext and we stop the stream's tracks, so the browser's "recording" dot
 * clears when the modal closes.
 */
export function useMicLevel(
    deviceId: string,
    active: boolean,
): { level: number; silent: boolean; ready: boolean; error: string | null } {
    const [level, setLevel] = useState(0);
    const [silent, setSilent] = useState(false);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!active) {
            setLevel(0);
            setSilent(false);
            setReady(false);
            setError(null);
            return;
        }

        let cancelled = false; // guards the async getUserMedia gap: the effect can tear down mid-open
        let stream: MediaStream | null = null;
        let harker: ReturnType<typeof hark> | null = null;
        let lastLoud = Date.now(); // last moment the input rose above the silence floor

        (async () => {
            try {
                // `exact` deviceId (falsy -> system default) matches the recorder/VAD, so the meter tests
                // the SAME mic the interview will capture from.
                stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(deviceId || null) });
                if (cancelled) {
                    stream.getTracks().forEach((t) => t.stop());
                    return;
                }
                setReady(true); // stream is live -> caller can now re-read real device labels

                harker = hark(stream, { interval: HARK_POLL_INTERVAL_MS, play: false });
                harker.on("volume_change", (dB: number) => {
                    // Map hark's dBFS onto the bar's 0..1 width; below the floor / above the ceiling clamp.
                    const mapped = (dB - MIC_LEVEL_FLOOR_DB) / (MIC_LEVEL_CEIL_DB - MIC_LEVEL_FLOOR_DB);
                    const clamped = Math.max(0, Math.min(1, mapped));
                    setLevel(clamped);

                    const now = Date.now();
                    if (clamped > MIC_SILENCE_LEVEL) lastLoud = now;
                    setSilent(now - lastLoud > MIC_SILENCE_MS);
                });
            } catch (e) {
                if (!cancelled) setError(micErrorMessage(e));
            }
        })();

        return () => {
            cancelled = true;
            harker?.stop(); // tears down hark's listeners + its AudioContext
            stream?.getTracks().forEach((t) => t.stop()); // release the mic (hark doesn't own the stream)
        };
    }, [deviceId, active]);

    return { level, silent, ready, error };
}
