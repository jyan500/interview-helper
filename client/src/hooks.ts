/**
 * Small, reusable React hooks shared across pages. (Distinct from helpers.ts, which is pure,
 * React-free functions — anything that calls useState/useEffect/etc. lives here.)
 */
import { useEffect, useState } from "react";

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
