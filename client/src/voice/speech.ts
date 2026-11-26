import { useCallback, useEffect, useRef, useState } from "react";
import { useTranscribeMutation, useTtsMutation } from "../api";
import { pickRecordingType, filenameFor, audioConstraints, toSpeechText } from "./helpers";

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

// The two TTS engines the user can choose between: "openai" = neural /api/tts (spends tokens),
// "browser" = free local SpeechSynthesis (robotic, good for debugging). useSpeak(engine) dispatches.
export type TtsEngine = "openai" | "browser";

// ============================ Phase F — useSpeak() (engine-switchable TTS) ============================
// speak() used to be a bare module function driving the OS SpeechSynthesis. Phase F routes TTS
// through OUR /api/tts proxy, and per the "one place HTTP lives" rule that call goes through RTK
// Query (useTtsMutation) — the same path the transcribe adapter takes. RTK Query hooks can only be
// called during render, so speak() becomes a HOOK: useSpeak() returns the imperative speak(text) fn.
//
// THE CONTRACT IS PRESERVED WHERE IT MATTERS — the CALL SITES. App.tsx changes exactly ONE line
// (`const speak = useSpeak()` instead of `import { speak }`); after that every `speak(res.message)`
// is byte-for-byte the same and the loop still never learns the interviewer's turn was spoken. Auth
// (the Bearer JWT) and the origin come FREE from api.ts's prepareHeaders/baseUrl — no token handling
// lives here. That centralization is the whole reason this beats a raw fetch in a module function.
export function useSpeak(engine: TtsEngine): { speak: (text: string, onReady?: () => void) => Promise<void>; speaking: boolean } {
    // isLoading covers the SYNTHESIS gap — the exact "text is up but no audio yet" window (#5) we're
    // masking. `playing` extends the signal through actual playback so the indicator reads as
    // "the interviewer is speaking" for the whole utterance, not just the wait.
    const [tts, { isLoading: synthesizing }] = useTtsMutation();
    const [playing, setPlaying] = useState(false);
    // Barge-in + leak-free cleanup: hold the playing clip AND its object URL together, so replacing
    // it can revoke the url it's dropping. pause() never fires `ended`, so an interrupted clip can't
    // self-clean via onended — pairing the url here (Option A) is what closes that leak. A ref (not
    // state) because nothing renders it.
    const currentRef = useRef<{ audio: HTMLAudioElement; url: string } | null>(null);
    // Cancels a DEFERRED first browser utterance (one still waiting on `voiceschanged`, below) if a newer
    // speak supersedes it before it starts — barge-in for that wait window. null when nothing is pending.
    const pendingBrowserSpeakRef = useRef<(() => void) | null>(null);

    // --- Engine A: OpenAI neural TTS (spends tokens). The Phase F path, unchanged.
    // useCallback so the returned fn identity is stable across renders (safe to list in effect deps
    // and to pass down without causing churn).
    // onReady fires the moment audio ACTUALLY starts (or, on any failure, right away). The caller uses
    // it to REVEAL the interviewer's text in sync with the voice — instead of showing text 1-2s before
    // the sound. It MUST fire on every exit path below, or a "thinking…" bubble would hang forever.
    const speakOpenAI = useCallback(async (text: string, onReady?: () => void): Promise<void> => {
        if (!text.trim()) { onReady?.(); return } // nothing to say -> reveal immediately

        // 1) SYNTHESIZE. If this fails, return WITHOUT touching the clip that may still be playing —
        //    a synth error for the next line must not kill the current one. `synthesizing` is true
        //    for this whole await (useTtsMutation's isLoading) — that IS the masked gap.
        let blob: Blob
        try{
            blob = await tts({text}).unwrap()
        }
        catch (e){
            console.error(e)
            onReady?.() // synth failed -> reveal the text anyway (this turn just has no audio)
            return
        }

        // 2) BARGE-IN. Stop the previous clip and revoke ITS url now: pause() never fires `ended`,
        //    so that clip's onended (below) would never run to clean it up. Leave `playing` true —
        //    the new clip takes over immediately, so the indicator shouldn't flicker off between them.
        if (currentRef.current){
            currentRef.current.audio.pause()
            URL.revokeObjectURL(currentRef.current.url)
            currentRef.current = null
        }

        // 3) PLAY the new clip.
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        // Natural completion cleans itself up. The guard avoids nulling a ref a LATER clip installed
        // (same reason it avoids a stale clip switching the indicator off mid-utterance).
        audio.onended = () => {
            URL.revokeObjectURL(url)
            if (currentRef.current?.audio === audio){
                currentRef.current = null
                setPlaying(false)
            }
        }
        currentRef.current = {audio, url}
        try{
            await audio.play()
            onReady?.() // playing NOW -> reveal the text at the same instant the voice starts
            setPlaying(true)
        }
        catch (e){
            // Autoplay blocked / interrupted before playback -> this clip won't reach `ended`; revoke now.
            URL.revokeObjectURL(url)
            if (currentRef.current?.audio === audio){
                currentRef.current = null
                setPlaying(false)
            }
            onReady?.() // couldn't play -> still reveal the text so the bubble doesn't hang on "thinking…"
            console.error(e)
        }
    }, [tts]);

    // --- Engine B: browser SpeechSynthesis (FREE, robotic). The pre-Phase-F path, restored as the
    // token-saving / debug option. No network, so onReady fires on the utterance's `start` event — the
    // "thinking…" gap is effectively instant. Reads the shared voicePrefs the auto-pick effect sets.
    const speakBrowser = useCallback((text: string, onReady?: () => void): void => {
        if (!("speechSynthesis" in window)) { onReady?.(); return } // unsupported -> just reveal the text
        const synth = window.speechSynthesis
        // Barge-in: drop any utterance still queued/speaking AND any first utterance still WAITING on
        // voices (below), so a newer line supersedes cleanly.
        pendingBrowserSpeakRef.current?.()
        pendingBrowserSpeakRef.current = null
        synth.cancel()

        // Build + speak, resolving the voice off the LIVE list at the moment we actually speak. Prefer
        // the explicitly-set voicePrefs (auto-pick effect / a picker); else fall back to the same
        // pickPreferredVoice heuristic so we still get a good voice, not the OS default.
        const speakNow = () => {
            const utterance = new SpeechSynthesisUtterance(text)
            const voices = synth.getVoices()
            const chosen = voices.find(v => v.voiceURI === voicePrefs.voiceURI) ?? pickPreferredVoice(voices)
            if (chosen) utterance.voice = chosen
            utterance.rate = voicePrefs.rate
            utterance.pitch = voicePrefs.pitch
            utterance.onstart = () => { setPlaying(true); onReady?.() } // reveal text as speech begins
            utterance.onend = () => setPlaying(false)
            utterance.onerror = () => { setPlaying(false); onReady?.() } // reveal even if it fails to speak
            synth.speak(utterance)
        }

        // getVoices() is populated ASYNCHRONOUSLY and is often [] for the very first call right after
        // load — which is exactly the first interview question, so speaking then uses the OS default.
        // If the list isn't ready, DEFER until `voiceschanged` actually reports voices (with a timeout
        // fallback so we never hang if the event doesn't come), then speak with the preferred voice.
        if (synth.getVoices().length > 0) {
            speakNow()
            return
        }
        let settled = false
        const finish = (proceed: boolean) => {
            if (settled) return
            settled = true
            synth.removeEventListener("voiceschanged", onVoices)
            window.clearTimeout(timer)
            pendingBrowserSpeakRef.current = null
            if (proceed) speakNow()
            else onReady?.() // superseded before speaking -> reveal the text so the bubble doesn't hang
        }
        const onVoices = () => { if (synth.getVoices().length > 0) finish(true) }
        const timer = window.setTimeout(() => finish(true), 1500) // fallback: speak anyway, best-effort voice
        synth.addEventListener("voiceschanged", onVoices)
        pendingBrowserSpeakRef.current = () => finish(false) // barge-in canceller for the wait window
    }, []);

    // Dispatch on the chosen engine — SAME (text, onReady) contract either way, so App stays engine-blind
    // (the whole edge-adapter thesis: the loop never learns WHICH voice engine spoke). Wrap the browser
    // path in Promise.resolve so both branches satisfy the Promise<void> return.
    // The markdown is stripped HERE, once, for both engines: the model's `code` / *emphasis* marks are
    // formatting for the eye, and a voice reads them out literally ("backtick … backtick").
    const speak = useCallback((text: string, onReady?: () => void): Promise<void> => {
        const spoken = toSpeechText(text)
        // All code, nothing to say -> reveal now (an empty utterance may never fire the browser's onstart)
        if (!spoken) { onReady?.(); return Promise.resolve() }
        return engine === "browser"
            ? Promise.resolve(speakBrowser(spoken, onReady))
            : speakOpenAI(spoken, onReady)
    }, [engine, speakOpenAI, speakBrowser]);

    // speaking = the whole audible window (synth wait OR playback). The synth half masks the latency
    // you saw; the playback half just keeps the indicator honest until the voice actually stops.
    return { speak, speaking: synthesizing || playing };
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

// ============ Voice turn — record one spoken answer, transcribe it, hand it back ============
// Capture raw mic audio -> POST to /api/transcribe (Whisper) -> use the text. On top of that spine:
//   - it exposes the live `stream` in state so the page can watch it (useSpeaking's pulsing mic icon,
//     useNoInputPrompt's "check your mic"),
//   - "stop" means STOP + TRANSCRIBE + SUBMIT in one go (onFinalTranscript), so the UI drops the
//     separate "Send answer" click for the spoken path.
// The candidate always ends the turn: tap to start, tap to stop. Nothing auto-decides they're done.
export function useVoiceTurn(opts: {
    onFinalTranscript: (text: string) => void; // the page passes handleSend — the COMBINED stop+send
    deviceId?: string | null; // chosen mic; null/undefined = system default (see audioConstraints)
    // Fires the instant the recorder stops — i.e. the moment the candidate's answer ENDS, BEFORE
    // transcription starts. Lets the page raise its single "interviewer is preparing" flag at the true
    // start of the flow, spanning transcription too.
    onCaptureStopped?: () => void;
}) {
    const { onFinalTranscript, deviceId, onCaptureStopped } = opts;
    const [transcribe, { isLoading: transcribing }] = useTranscribeMutation();

    const [listening, setListening] = useState(false);
    // The live mic stream while recording, exposed so a consumer (useSpeaking) can watch the input
    // level — e.g. to pulse the candidate's mic icon when actual sound comes in. null whenever we're
    // not recording; the recorder still owns capture, this is just a read-only handle.
    const [stream, setStream] = useState<MediaStream | null>(null);

    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);

    // onFinalTranscript is a fresh closure each render (it captures draft/interviewId on the page). Ref
    // it so `start` below doesn't need it in its dep list and never goes stale.
    const onFinalRef = useRef(onFinalTranscript);
    onFinalRef.current = onFinalTranscript;
    // Same treatment for onCaptureStopped, so `start`'s recorder.onstop closure always calls the latest.
    const onCaptureStoppedRef = useRef(onCaptureStopped);
    onCaptureStoppedRef.current = onCaptureStopped;

    // Broad-support guard: getUserMedia + MediaRecorder (both need a secure context: https or localhost).
    const supported =
        typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia &&
        typeof MediaRecorder !== "undefined";

    // Open the mic + MediaRecorder on the CURRENT deviceId and wire its stop -> transcribe -> submit
    // tail. Extracted from start() so restartCapture (mic swapped mid-turn) can re-open WITHOUT
    // re-tripping the `listening` guard. Throws on a getUserMedia failure so the caller resets the button.
    // On stop it routes the final text to onFinalRef (submit), NOT setDraft — the combined stop+send.
    const beginCapture = useCallback(async () => {
        // Pin the user-chosen mic (or system default). `exact` fails loudly if it's gone rather
        // than silently recording the wrong device — the silent-capture bug we debugged.
        const s = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(deviceId) });
        setStream(s); // publish the live stream for level-metering; cleared in onstop below
        chunksRef.current = [];
        // Cross-browser container pick (Chrome->webm, Firefox->ogg, Safari->mp4); see helpers.ts.
        const { mimeType } = pickRecordingType();
        const recorder = new MediaRecorder(s, mimeType ? { mimeType } : undefined);
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
        recorder.onstop = async () => {
            s.getTracks().forEach((t) => t.stop()); // release the mic (the browser "recording" dot)
            // Clear the stream ONLY if a restart hasn't already swapped a fresh one in (guarding against a
            // late onstop nulling the new capture's stream); a normal stop always matches -> null.
            setStream((prev) => (prev === s ? null : prev));
            onCaptureStoppedRef.current?.(); // answer ENDED, transcription about to begin -> flow start
            try {
                // recorder.mimeType is the source of truth; filename extension must match it (else
                // Whisper mis-decodes -> "you" hallucination). See helpers.ts.
                const type = recorder.mimeType || mimeType || "audio/webm";
                const blob = new Blob(chunksRef.current, { type });
                const form = new FormData();
                form.append("audio", blob, filenameFor(type));
                const data = await transcribe(form).unwrap();
                onFinalRef.current((data.text ?? "").trim());
            } catch (e) {
                console.error("Failed to transcribe...", e);
                onFinalRef.current(""); // failed -> hand back empty so the consumer releases its flow flag
            }
            // ALWAYS hand the result back (even ""). The consumer guards empty (a pure-silence misfire
            // must not POST) AND uses the call to end its "preparing" flag; swallowing empty here would
            // strand that flag on. Keeping the no-empty-POST rule is the consumer's job now, not ours.
        };
        recorderRef.current = recorder;
        recorder.start();
    }, [deviceId, transcribe]);

    const start = useCallback(async () => {
        if (!supported || listening) return;
        try {
            await beginCapture();
            setListening(true);
        } catch {
            setListening(false); // denied mic / no device -> button resets to "Record"
        }
    }, [supported, listening, beginCapture]);

    // Swap the recording onto a newly-chosen mic mid-turn WITHOUT submitting what was captured so far —
    // the candidate is fixing a wrong/silent mic (the "check your mic" prompt sent them to Settings), so
    // the audio up to now is unusable. A MediaRecorder is bound to the stream it opened with, so a mic
    // change is otherwise ignored until the next turn. We DETACH the old recorder's onstop (its
    // transcribe+submit tail) and release its mic by hand, then re-open on the new device. `listening`
    // never drops, so the mic UI stays "recording" across the swap.
    const restartCapture = useCallback(async () => {
        const old = recorderRef.current;
        if (old && old.state !== "inactive") {
            old.onstop = null; // bypass transcribe+submit — this clip is pre-fix silence, throw it away
            old.stop();
            old.stream.getTracks().forEach((t) => t.stop()); // release the old mic (onstop normally does this)
        }
        try {
            await beginCapture();
        } catch {
            setListening(false); // the new device failed to open -> drop to idle
        }
    }, [beginCapture]);

    // Re-open capture when the mic device changes WHILE recording — only case: a swap made in Settings,
    // typically to fix a wrong mic the "check your mic" prompt flagged. The first render just records the
    // initial device; a change while idle is picked up by the next start() (beginCapture reads deviceId).
    const prevDeviceRef = useRef(deviceId);
    useEffect(() => {
        const changed = prevDeviceRef.current !== deviceId;
        prevDeviceRef.current = deviceId;
        if (changed && listening) restartCapture();
    }, [deviceId, listening, restartCapture]);

    // stop = end the turn NOW: fires recorder.onstop -> transcribe -> submit. Called by the "stop" tap
    // and by a timed interview running out of time.
    const stop = useCallback(() => {
        recorderRef.current?.stop();
        setListening(false);
    }, []);

    // cancel = abandon the in-progress recording WITHOUT transcribing or submitting. This is the "pause
    // the mic" the candidate wants when switching from voice to text mid-recording: stop() would fire the
    // transcribe+submit tail (posting a half-answer while they're typing), so instead we DETACH that tail
    // — the same onstop-nulling trick restartCapture uses to throw away pre-fix audio — and end at idle.
    // Switching back to voice waits for the next tap, like every other turn.
    const cancel = useCallback(() => {
        const rec = recorderRef.current;
        if (rec && rec.state !== "inactive") {
            rec.onstop = null; // bypass transcribe+submit — this audio is discarded, not sent
            rec.stop();
            rec.stream.getTracks().forEach((t) => t.stop()); // release the mic (onstop normally does this)
        }
        recorderRef.current = null;
        setStream(null); // no live stream to meter while paused
        setListening(false);
    }, []);

    return { supported, listening, transcribing, stream, start, stop, cancel };
}
