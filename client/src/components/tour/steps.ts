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

// The interview session itself, for every kind of interview (the header's "How it works"). The answer
// controls follow the mode: voice shows the mic and the smart/manual toggle, text shows Send answer.
//   smartVoiceLocked — the round turns smart mode off (coding, system design), so the toggle can't flip
export function sessionTourSteps(mode: AnswerMode, smartVoiceLocked: boolean): Step[] {
    const answerSteps: Step[] =
        mode === "voice"
            ? [
                  {
                      target: "[data-tour='answer-button']",
                      title: "Record your answer",
                      content:
                          "Press Record your answer when you're ready to speak. The interviewer hears your answer " +
                          "once it's sent, and replies with a follow-up or the next question.",
                      placement: "top",
                  },
                  {
                      target: "[data-tour='voice-mode']",
                      title: "Smart or manual",
                      content: smartVoiceLocked
                          ? "This round uses manual mode: press the button again when you're done to send your " +
                            "answer. Smart mode is off here, since you'll pause to write."
                          : "In manual mode, press the button again when you're done to send your answer. In smart " +
                            "mode, recording starts on its own after each question, and your answer is sent " +
                            "automatically after a short silence. A countdown lets you keep talking if you were " +
                            "only pausing.",
                      placement: "top",
                  },
              ]
            : [
                  {
                      target: "[data-tour='answer-button']",
                      title: "Send your answer",
                      content:
                          "Type your answer in the box, then press Send answer or Enter. Shift + Enter adds a new line.",
                      placement: "top",
                  },
              ];
    const steps: Step[] = [
        ...answerSteps,
        {
            target: "[data-tour='switch-mode']",
            title: mode === "voice" ? "Prefer typing?" : "Prefer speaking?",
            content:
                mode === "voice"
                    ? "Switch to text to type your answers instead. You can switch back at any time."
                    : "Switch to voice to speak your answers instead. You can switch back at any time.",
            placement: "top",
        },
        {
            target: "[data-tour='end-session']",
            title: "End early",
            content:
                "End the session whenever you like. Your answers up to that point are graded, and you get a " +
                "scorecard for them.",
            placement: "top",
        },
    ];
    // The scratchpad lives in the right rail, which only shows beside a behavioral interview (a coding or
    // system-design panel takes its place) and only on wide screens; skip the step when it isn't visible.
    const scratchpad = document.querySelector<HTMLElement>("[data-tour='scratchpad']");
    if (scratchpad?.offsetParent) {
        steps.push({
            target: scratchpad,
            title: "Scratchpad",
            content:
                "Jot notes here while you think. It's private: it isn't sent to the interviewer or saved.",
            placement: "left",
        });
    }
    steps.push({
        target: "[data-tour='session-settings']",
        title: "Settings",
        content: "Pick and test your microphone, choose the interviewer's voice, or switch between voice and text.",
        placement: "bottom-end",
    });
    return steps;
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
