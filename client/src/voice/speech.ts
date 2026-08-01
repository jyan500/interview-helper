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
import { useEffect, useRef, useState } from "react";
import { useTranscribeMutation } from "../api";

// ============================ TTS — the OUTPUT adapter ============================
// SpeechSynthesis + SpeechSynthesisUtterance ARE in TypeScript's DOM lib, so no extra typing.
//
// Phase 5 polish: a bare `new SpeechSynthesisUtterance(text)` uses the OS *default* voice, which
// usually sounds robotic. Two levers make it better, and BOTH stay entirely inside this OUTPUT
// edge adapter — nothing above speak() (App.tsx's `speak(res.message)` calls) changes:
//   1. VOICE  — many OSes ship neural voices (Windows "… (Natural)", Chrome "Google …"). Pick one.
//   2. RATE / PITCH — tune delivery so it reads like an interviewer, not a screen reader.
//
// The prefs live at MODULE scope (below) so the two speak() call sites don't have to thread them
// through — the voice picker calls setVoicePrefs(), speak() reads them. Same seam, richer knobs.

type VoicePrefs = { voiceURI: string | null; rate: number; pitch: number };

// Sensible defaults: system-default voice until a preferred one is chosen; natural cadence.
let voicePrefs: VoicePrefs = { voiceURI: null, rate: 1, pitch: 1 };

// The UI (or App's auto-pick on mount) updates the shared prefs. Partial so callers can set just
// `rate`, just `voiceURI`, etc. without clobbering the rest.
export function setVoicePrefs(patch: Partial<VoicePrefs>): void {
    voicePrefs = { ...voicePrefs, ...patch };
}

export function speak(text: string): void {
    if (!("speechSynthesis" in window)) return; // unsupported browser -> silently no-op
    window.speechSynthesis.cancel(); // interrupt any utterance still playing
    const utterance = new SpeechSynthesisUtterance(text);
    // Match the chosen voice by URI (stable id) out of the live voice list. If it's not found
    // (e.g. voices not loaded yet, or null), leave utterance.voice unset -> OS default.
    const chosen = window.speechSynthesis
        .getVoices()
        .find((v) => v.voiceURI === voicePrefs.voiceURI);
    if (chosen) utterance.voice = chosen;
    utterance.rate = voicePrefs.rate;
    utterance.pitch = voicePrefs.pitch;
    window.speechSynthesis.speak(utterance);
}

/**
 * Subscribe to the browser's voice list. getVoices() is populated ASYNCHRONOUSLY: on first paint
 * it's often [], then the browser fires `voiceschanged` once the list is ready. This hook reads it
 * eagerly AND on that event, so a voice picker re-renders when the real voices arrive.
 */
export function useVoices(): SpeechSynthesisVoice[] {
    const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
    useEffect(() => {
        if (!("speechSynthesis" in window)) return;
        const load = () => setVoices(window.speechSynthesis.getVoices());
        load(); // some browsers already have them synchronously
        window.speechSynthesis.addEventListener("voiceschanged", load); // others fire later
        return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
    }, []);
    return voices;
}

/**
 * Pick the best-sounding English voice from the list, or null if none look good (caller then
 * falls back to the OS default). Heuristic, best-first: prefer voices whose name advertises a
 * neural engine ("Natural" on Windows, "Google" on Chrome), restricted to English locales.
 */
export function pickPreferredVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    const english = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
    const neural = english.find((v) => /natural|neural|google/i.test(v.name));
    return neural ?? english[0] ?? null;
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

// ============ STT #2 — the ROBUST INPUT adapter (Phase 5): capture here, transcribe on our server ============
// SAME { supported, listening, start, stop } CONTRACT as useSpeechRecognition above — and THAT is
// the whole lesson: App.tsx swaps ONE import and nothing else moves (handleSend, the transcript,
// the agent, MCP all untouched). Only the GUTS differ. Instead of leasing Chrome's Web Speech API
// (Chrome-only, no endpointing control, audio -> Google), we:
//   1. capture raw mic audio in the browser via getUserMedia + MediaRecorder, then
//   2. POST the recorded utterance to OUR /api/transcribe (OpenAI Whisper) and use the text back.
// Cross-browser, more accurate, and the audio goes to a vendor WE chose. Endpointing is still
// MANUAL (user clicks Stop) — same tradeoff as the Web Speech version; VAD auto-stop is a later add.

export function useWhisperRecognition(onResult: (text: string) => void) {
    const [listening, setListening] = useState(false);
    // The transcribe POST now goes through RTK Query (the "one place HTTP lives"), so `isLoading`
    // IS our "transcribing" flag — no hand-rolled useState/finally needed, RTK Query flips it back.
    const [transcribe, { isLoading: transcribing }] = useTranscribeMutation();
    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]); // audio chunks MediaRecorder emits as it records
    const streamRef = useRef<MediaStream | null>(null); // the live mic stream, to release on stop

    // getUserMedia + MediaRecorder are STANDARD and broadly supported (incl. Firefox/Safari),
    // unlike webkitSpeechRecognition. Both need a secure context (https or localhost). Guard for
    // ancient browsers where they're missing so the mic button hides instead of throwing.
    const supported =
        typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia &&
        typeof MediaRecorder !== "undefined";

    async function start(): Promise<void> {
        if (!supported || listening) return;
        try {
            // Prompts for mic permission the first time. Throws if denied -> we stay not-listening.
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            chunksRef.current = [];
            const recorder = new MediaRecorder(stream);
            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };
            recorder.onstop = async () => {
                try {
                    // release the mic so the browser's "recording" dot goes away
                    streamRef.current?.getTracks().forEach((t) => t.stop());
                    // glue the chunks into ONE utterance blob (webm/opus in Chrome; Whisper accepts it)
                    const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
                    // ship it through RTK Query, get text back, fill the draft — the SAME onResult the
                    // Web Speech path calls, just sourced from Whisper instead of Chrome. .unwrap()
                    // returns the payload OR throws — and it throws on HTTP errors too (413/500), so
                    // the server's "file too large" guard lands in the catch below, not silently.
                    const form = new FormData();
                    form.append("audio", blob, "answer.webm");
                    const data = await transcribe(form).unwrap();
                    onResult((data.text ?? "").trim());
                }
                catch (e) {
                    // TODO: need to add a toast notification in the future
                    console.error("Failed to transcribe...", e);
                }
                // no finally — RTK Query flips `isLoading` (our `transcribing`) back on its own.
            };
            recorderRef.current = recorder;
            recorder.start();
            setListening(true);
        } catch {
            // denied mic / no device -> leave listening false so the button resets to "Record".
            setListening(false);
        }
    }

    function stop(): void {
        recorderRef.current?.stop(); // fires onstop -> builds the blob, POSTs it, calls onResult
        setListening(false);
        // `transcribing` (set in onstop) covers the gap between here and the transcript arriving,
        // so App can show a "Transcribing…" hint during the Whisper round-trip.
    }

    return { supported, listening, start, stop, transcribing };
}
