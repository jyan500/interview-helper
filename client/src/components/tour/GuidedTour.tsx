/**
 * The app's "Need help?" tour shell: tooltips one at a time, each beside the part of the page it
 * explains (react-joyride). Flow-agnostic: the caller hands in `buildSteps` (see ./steps.ts, one builder
 * per flow) and owns whether the tour is running. Callers mount this only while the tour runs, so every
 * run starts fresh at step 1, and unmount it through `onEnd`.
 */
import { useState } from "react";
import { ACTIONS, EVENTS, Joyride, ORIGIN, type EventData, type Step } from "react-joyride";

// Joyride parses primaryColor as hex (it derives tints from it), so these are the literal values of
// index.css's tokens rather than var(--…).
const SURFACE = "#232532"; // --color-surface
const INK = "#e9e9ed"; // --color-ink
const ACCENT = "#9184d9"; // --color-accent
const MUTED = "#a1a1aa"; // secondary button text

export default function GuidedTour({ buildSteps, onEnd }: { buildSteps: () => Step[]; onEnd: () => void }) {
    // Built once, when the tour opens: anything a builder reads off the page is decided then.
    const [steps] = useState(buildSteps);

    // The tour is over when Joyride says so (Done, Skip, or the X), or on Esc: Joyride's own Esc only
    // closes the current step and moves on, but Esc should end the whole tour, like closing a modal.
    function handleEvent(data: EventData) {
        const escaped = data.action === ACTIONS.CLOSE && data.origin === ORIGIN.KEYBOARD;
        if (data.type === EVENTS.TOUR_END || escaped) onEnd();
    }

    return (
        <Joyride
            run
            continuous
            steps={steps}
            onEvent={handleEvent}
            locale={{ last: "Done" }}
            options={{
                skipBeacon: true, // open each tooltip straight away, no pulsing dot to click first
                showProgress: true, // "Next (1 of 4)"
                buttons: ["back", "skip", "close", "primary"],
                closeButtonAction: "skip", // the X ends the tour (by default it just advances)
                overlayClickAction: false, // like our modals: X or Esc, never a backdrop click
                skipScroll: true, // everything is already on screen; don't scroll the page
                backgroundColor: SURFACE,
                arrowColor: SURFACE,
                textColor: INK,
                primaryColor: ACCENT,
                overlayColor: "rgba(0, 0, 0, 0.55)",
                spotlightPadding: 6,
                spotlightRadius: 8,
                width: 320,
            }}
            styles={{
                tooltip: {
                    borderRadius: 8,
                    border: "1px solid color-mix(in srgb, #e9e9ed 16%, transparent)",
                    fontSize: 13.5,
                    lineHeight: 1.55,
                },
                tooltipTitle: { fontSize: 14.5, fontWeight: 600, textAlign: "left" },
                tooltipContent: { textAlign: "left", padding: "10px 0 4px" },
                // The app's primary button is an accent outline, never a filled block.
                buttonPrimary: {
                    background: "transparent",
                    border: `1px solid ${ACCENT}`,
                    borderRadius: 6,
                    color: ACCENT,
                    fontSize: 13,
                },
                buttonBack: { color: MUTED, fontSize: 13 },
                buttonSkip: { color: MUTED, fontSize: 13 },
                buttonClose: { color: MUTED },
            }}
        />
    );
}
