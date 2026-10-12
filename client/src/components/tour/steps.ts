/**
 * The steps for each "Need help?" tour, one builder per flow; GuidedTour runs whichever a panel hands it.
 * A builder runs once, when its tour opens, so it can look at the page to pick its targets.
 *
 * Steps find their targets in the DOM: `data-tour` attributes where we render the element, class names
 * where a library's component doesn't forward data attributes. There's one of each target on the page
 * at a time, so plain document selectors are enough.
 */
import type { Step } from "react-joyride";
import type { AnswerMode } from "../../constants";

const CANVAS = "[data-tour='diagram-canvas']";

// The system-design canvas. Step 2 points at a real component when there is one (so the handles it
// talks about are right there), and at the whole canvas, centered, when the canvas is still empty.
export function diagramTourSteps(mode: AnswerMode): Step[] {
    const firstNode = document.querySelector<HTMLElement>(`${CANVAS} .react-flow__node`);
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
        //  React Flow's <Controls> don't pass data attributes through, so React Joyride needs to detect these components
        // using classnames
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
        answerStep(mode, "diagram", "your design choices, trade-offs and how it scales"),
    ];
}

// A round's last step: the deliverable (the code, the diagram) alone isn't the answer, the candidate has
// to explain it. Points at whichever answer button the current mode shows (both carry
// data-tour="answer-button"; only one column renders at a time).
//   deliverable — what goes with the answer, e.g. "code"
//   explain     — what to talk through, e.g. "your approach, trade-offs and complexity"
function answerStep(mode: AnswerMode, deliverable: string, explain: string): Step {
    if (mode === "voice") {
        return {
            target: "[data-tour='answer-button']",
            title: "Talk it through",
            content:
                `Your ${deliverable} alone isn't the answer. Press Record your answer and explain ${explain} ` +
                `out loud. Your latest ${deliverable} goes with it.`,
            placement: "top",
        };
    }
    return {
        target: "[data-tour='answer-button']",
        title: "Explain your thinking",
        content:
            `Your ${deliverable} alone isn't the answer. Type ${explain} in the box, then press Send answer. ` +
            `Your latest ${deliverable} goes with it.`,
        placement: "top",
    };
}

// The coding round.
export function codingTourSteps(mode: AnswerMode): Step[] {
    return [
        {
            target: "[data-tour='code-editor']",
            title: "Write your code",
            content:
                "Write your solution here. It isn't run: the interviewer reads it like a whiteboard, along with " +
                "what you say about it.",
            placement: "left",
        },
        {
            target: "[data-tour='code-language']",
            title: "Pick a language",
            content:
                "Choose the language you're writing in. The gear beside it sets font size, tab width, and vim or " +
                "emacs keys.",
            placement: "bottom",
        },
        answerStep(mode, "code", "your approach, trade-offs and complexity"),
    ];
}
