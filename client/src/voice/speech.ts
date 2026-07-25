/**
 * Browser voice adapters — Phase 4 (the last slice). The audio "edge adapters", in the browser.
 *
 * The whole thesis of the project, made concrete: audio is an EDGE ADAPTER, not part of the
 * loop. In Phase 3.5 the browser BECAME the loop (one fetch per turn). Phase 4 only bolts
 * audio onto the two ENDS of that loop:
 *
 *     speak(text)             -> TTS: say the interviewer's turn out loud    (OUTPUT seam)
 *     useSpeechRecognition()  -> STT: fill the answer box from the mic        (INPUT seam)
 *
 * Nothing in handleStart / handleSend, the RTK Query calls, or the transcript state changes.
 * You only (a) call speak() where interviewer text appears, and (b) add a mic button that
 * writes into `draft`. "The loop never learns whether the answer was typed or spoken" is the
 * headline lesson — the same seam as the server's voice/adapters.py listen()/speak(), now in
 * the browser via the free, built-in Web Speech API (no npm packages).
 *
 * Support: SpeechSynthesis (TTS) is broadly supported. SpeechRecognition (STT) is Chrome/Edge
 * only (webkit-prefixed), not Firefox, and prompts for mic permission on first use.
 *
 * --- How to wire into App.tsx (your fill-in) --------------------------------------------
 *   OUTPUT: after each `setTranscript(t => [...t, { who: "interviewer", text: msg }])`,
 *           also call `speak(msg)`.
 *   INPUT:  const { supported, listening, start, stop } = useSpeechRecognition(setDraft);
 *           render a 🎤 button (only when `supported`) that toggles start()/stop(); the hook
 *           writes the transcript into `draft`, and you Send it exactly as a typed answer.
 */
import { useRef, useState } from "react";

// ============================ TTS — the OUTPUT adapter ============================
// SpeechSynthesis + SpeechSynthesisUtterance ARE in TypeScript's DOM lib, so no extra typing.
export function speak(text: string): void {
    if (!("speechSynthesis" in window)) return; // unsupported browser -> silently no-op
    window.speechSynthesis.cancel(); // interrupt any utterance still playing
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

// ============================ STT — the INPUT adapter ============================
// SpeechRecognition is NON-standard, so it's not in TypeScript's DOM lib. We read the
// constructor off `window` (webkit-prefixed on Chrome) and treat instances as `any` — the
// pragmatic cost of a browser API the type system doesn't know about.
function getRecognitionCtor(): any {
    const w = window as any;
    return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/**
 * Turn speech into text, ACCUMULATED across pauses so multi-sentence answers survive.
 * Calls `onResult(text)` with the full running transcript (wire it to setDraft). Returns
 * { supported, listening, start, stop } to drive a mic button.
 *
 * This solves two things the naive single-utterance version didn't:
 *
 *   1. ACCUMULATION — with `continuous = true` the browser fires `onresult` repeatedly as
 *      you talk. `event.results` accumulates WITHIN a session, but a session can restart
 *      (see #2), so we keep `committedRef` = finalized text that survives restarts, and
 *      rebuild the whole string each event = committed + this session's final + the
 *      in-progress ("interim") guess.
 *
 *   2. PAUSE HANDLING — the Web Speech API exposes NO silence-threshold setting. Even with
 *      `continuous = true`, Chrome auto-fires `onend` after a stretch of silence, which
 *      would cut a mid-answer thinking pause off as "done". So when `onend` fires and the
 *      user did NOT press Stop, we immediately restart. Endpointing is therefore MANUAL:
 *      the recording ends only when the user clicks Stop (`stoppedByUserRef`). Nothing
 *      auto-decides "done" — that's the deliberate tradeoff of option 1.
 */
export function useSpeechRecognition(onResult: (text: string) => void) {
    const [listening, setListening] = useState(false);
    const recognitionRef = useRef<any>(null);
    const committedRef = useRef(""); // finalized text across ALL (re)starts of a recording
    const sessionFinalRef = useRef(""); // finalized text within the CURRENT session
    const stoppedByUserRef = useRef(false); // did the user click Stop (vs. a silence auto-end)?
    const supported = getRecognitionCtor() !== null;

    // Start ONE recognition session. onend calls this again to defeat the silence timeout.
    function beginSession(): void {
        const recognition = new (getRecognitionCtor())();
        recognition.lang = "en-US";
        recognition.continuous = true; // don't end at the first pause
        recognition.interimResults = true; // stream partial words for a live preview

        recognition.onresult = (event: any) => {
            // event.results accumulates within THIS session; split final vs. in-progress.
            let sessionFinal = "";
            let interim = "";
            for (let i = 0; i < event.results.length; i++) {
                const r = event.results[i];
                if (r.isFinal) sessionFinal += r[0].transcript;
                else interim += r[0].transcript;
            }
            sessionFinalRef.current = sessionFinal; // remembered so onend can commit it
            onResult((committedRef.current + sessionFinal + interim).trim());
        };

        recognition.onerror = (event: any) => {
            // "no-speech" is just silence — let onend auto-restart. A denied mic is fatal.
            if (event.error === "not-allowed" || event.error === "service-not-allowed") {
                stoppedByUserRef.current = true;
            }
        };

        recognition.onend = () => {
            // Bank this session's finalized text so a restart doesn't drop it.
            committedRef.current += sessionFinalRef.current;
            sessionFinalRef.current = "";
            if (stoppedByUserRef.current) {
                setListening(false); // user (or a fatal error) asked to stop -> done
            } else {
                beginSession(); // silence auto-ended us -> resume immediately
            }
        };

        recognitionRef.current = recognition;
        recognition.start();
    }

    function start(): void {
        if (!supported || listening) return;
        committedRef.current = "";
        sessionFinalRef.current = "";
        stoppedByUserRef.current = false;
        beginSession();
        setListening(true);
    }

    function stop(): void {
        stoppedByUserRef.current = true; // tell onend NOT to auto-restart
        recognitionRef.current?.stop();
        setListening(false);
    }

    return { supported, listening, start, stop };
}
