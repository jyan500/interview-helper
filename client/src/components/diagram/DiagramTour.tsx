/**
 * The canvas's "Need help?" tour: four tooltips, one at a time, each beside the part of the canvas it
 * explains (react-joyride). DiagramPanel mounts this only while the tour runs, so every run starts
 * fresh at step 1, and unmounts it through `onEnd`.
 *
 * Steps find their targets in the DOM: `data-tour` attributes on the palette and the canvas, and class
 * names on React Flow's two <Controls> (which don't forward data attributes). There's one canvas on
 * the page at a time, so plain document selectors are enough.
 */
import { useState } from "react";
import { ACTIONS, EVENTS, Joyride, ORIGIN, type EventData, type Step } from "react-joyride";

// Joyride parses primaryColor as hex (it derives tints from it), so these are the literal values of
// index.css's tokens rather than var(--…).
const SURFACE = "#232532"; // --color-surface
const INK = "#e9e9ed"; // --color-ink
const ACCENT = "#9184d9"; // --color-accent
const MUTED = "#a1a1aa"; // secondary button text

const CANVAS = "[data-tour='diagram-canvas']";

// Step 2 points at a real component when there is one (so the handles it talks about are right
// there), and at the whole canvas, centered, when the canvas is still empty.
function buildSteps(firstNode: HTMLElement | null): Step[] {
    return [
        {
            target: "[data-tour='diagram-palette']",
            title: "Add components",
            content:
                "Drag a component onto the canvas to place it there, or click it to drop one in the middle of the view.",
            placement: "right",
        },
        {
            target: firstNode ?? CANVAS,
            title: "Connect and rename",
            content:
                "Hover a component to see the dots on its edges. Drag from a dot to another component to draw an " +
                "arrow. Double-click a component to rename it, or select it to edit its name and notes in the " +
                "panel on the right.",
            placement: firstNode ? "right" : "center",
        },
        {
            target: ".diagram-history-controls",
            title: "Undo and redo",
            content:
                "Undo or redo your last changes. Ctrl+Z and Ctrl+Shift+Z work too, and Ctrl+C / Ctrl+V copies " +
                "what's selected.",
            placement: "bottom-start",
        },
        {
            target: ".diagram-zoom-controls",
            title: "Move around",
            content:
                "Zoom in, zoom out, or fit the whole design on screen. Left-click and drag on empty canvas to " +
                "select several components; right-click and drag to move the canvas.",
            placement: "right",
        },
    ];
}

export default function DiagramTour({ onEnd }: { onEnd: () => void }) {
    // Built once, when the tour opens: whether there's a component to point at is decided then.
    const [steps] = useState(() =>
        buildSteps(document.querySelector<HTMLElement>(`${CANVAS} .react-flow__node`)),
    );

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
