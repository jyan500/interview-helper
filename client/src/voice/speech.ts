import { useCallback, useEffect, useRef, useState } from "react";
import { useTranscribeMutation, useTtsMutation } from "../api";
import { MicVAD } from "@ricky0123/vad-web";
import { VAD_SPEECH_THRESHOLD, VAD_REDEMPTION_MS, CONFIRM_COUNTDOWN_MS, VAD_ONNX_WASM_BASE } from "../constants";

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
    const speak = useCallback((text: string, onReady?: () => void): Promise<void> => {
        return engine === "browser"
            ? Promise.resolve(speakBrowser(text, onReady))
            : speakOpenAI(text, onReady)
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

// ============ VAD — the acoustic silence detector (smart-mode endpointing, layer 1) ============
// The "notice when they've gone quiet" half of smart mode. Everything else (record -> Whisper ->
// submit) is the useSmartVoiceTurn spine below; this hook only reports the acoustic edges.
//
// It is ACOUSTIC ONLY: it answers "is someone talking right now?", NOT "did they say something that
// MEANS they're done" (that's SEMANTIC endpointing = layer 2, deferred). Detection is delegated to the
// Silero VAD (@ricky0123/vad-web) rather than a hand-rolled RMS threshold — a small neural model is far
// more robust in a real room, and it ships its own hysteresis (redemptionFrames), which is the flappy
// "is this a real pause?" logic we'd otherwise have to get right by hand.
//
// MicVAD manages its OWN microphone (a second getUserMedia alongside the recorder's — one permission,
// shared). It loads an onnx model + wasm at runtime, by default from a CDN, so there's nothing to serve
// in dev. It exposes onSpeechStart / onSpeechEnd, which we forward as onSpeech / onSilence.
type VoiceActivityHandlers = {
    onSilence: () => void; // the model decided speech ended -> open the countdown
    onSpeech: () => void;  // speech (re)started -> cancel the countdown
};

export function useVoiceActivity(active: boolean, handlers: VoiceActivityHandlers) {
    // Keep the latest handlers in a ref so the VAD's callbacks always call the CURRENT closures (which
    // capture fresh state) without us tearing down and rebuilding the model every render.
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;

    useEffect(() => {
        if (!active) return; // not smart mode, or not listening -> don't hold a mic/model

        let vad: MicVAD | null = null;
        let cancelled = false; // guards the async gap: the effect can be torn down mid-load

        (async () => {
            try {
                const instance = await MicVAD.new({
                    // Worklet + Silero .onnx model: self-hosted from /vad/ (copied into public/vad by
                    // scripts/copy-vad-assets.mjs) — these are fetched/addModule'd, so Vite serves them fine.
                    // onnxruntime wasm: dev = CDN, prod = /vad/ — Vite's dev server 500s on /public files
                    // imported as JS modules (which is how ORT loads its wasm). See VAD_ONNX_WASM_BASE.
                    baseAssetPath: "/vad/",
                    onnxWASMBasePath: VAD_ONNX_WASM_BASE,
                    positiveSpeechThreshold: VAD_SPEECH_THRESHOLD,
                    redemptionMs: VAD_REDEMPTION_MS,
                    onSpeechStart: () => handlersRef.current.onSpeech(),
                    // onSpeechEnd also hands us the utterance audio (Float32Array @16k); we ignore it and
                    // keep MediaRecorder as the source for the Whisper blob (layer-1 scope).
                    onSpeechEnd: () => handlersRef.current.onSilence(),
                });
                if (cancelled) { instance.destroy(); return } // torn down before the model finished loading
                vad = instance;
                vad.start();
            } catch (e) {
                // A load failure (missing assets, unsupported browser) must be VISIBLE, not a silent
                // unhandled rejection — otherwise smart mode just quietly never detects speech.
                console.error("VAD failed to initialize:", e);
            }
        })();

        return () => {
            cancelled = true;
            vad?.destroy(); // releases MicVAD's mic + audio graph
        };
    }, [active]);
}

// ============ Smart voice turn-taking — the layer-1 controller (both modes) ============
// Evolves useWhisperRecognition for the turn-taking UX. SAME capture -> Whisper spine; what's new:
//   - it exposes the live `stream` in state so useVoiceActivity can watch it (smart mode),
//   - "stop" now means STOP + TRANSCRIBE + SUBMIT in one go (onFinalTranscript), so the UI drops the
//     separate "Send answer" click for the spoken path,
//   - a "still there?" countdown sits between VAD silence and the actual submit.
//
// Modes:
//   "manual" — user taps start, taps stop. No VAD, no countdown. (Good for long design answers where
//              you pause a lot to think — nothing auto-decides you're done.)
//   "smart"  — VAD watches for silence; silence opens the countdown; expiry submits. App auto-starts
//              this after the AI stops speaking (the mic-mute turn-taking effect lives up in App).
export type TurnMode = "manual" | "smart";

export function useSmartVoiceTurn(opts: {
    mode: TurnMode;
    onFinalTranscript: (text: string) => void; // App passes handleSend — the COMBINED stop+send
}) {
    const { mode, onFinalTranscript } = opts;
    const [transcribe, { isLoading: transcribing }] = useTranscribeMutation();

    const [listening, setListening] = useState(false);
    const [confirming, setConfirming] = useState(false); // in the "still there?" window
    const [countdownMs, setCountdownMs] = useState(0);   // remaining, for the UI number/ring
    // The live mic stream while recording, exposed so a consumer (useMicLevel) can meter the input
    // level — e.g. to light the candidate's waveform / mic border when actual sound comes in. null
    // whenever we're not recording; the recorder still owns capture, this is just a read-only handle.
    const [stream, setStream] = useState<MediaStream | null>(null);

    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const countdownRef = useRef<number | null>(null); // the setInterval id for the countdown

    // onFinalTranscript is a fresh closure each render (it captures draft/interviewId in App). Ref it
    // so `start` below doesn't need it in its dep list and never goes stale — same trick as handlersRef.
    const onFinalRef = useRef(onFinalTranscript);
    onFinalRef.current = onFinalTranscript;

    // Same broad-support guard as useWhisperRecognition (getUserMedia + MediaRecorder, secure context).
    const supported =
        typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia &&
        typeof MediaRecorder !== "undefined";

    // Start capture. Mirrors useWhisperRecognition.start; on stop it routes the final text to onFinalRef
    // (submit) instead of setDraft — the combined stop+send. The VAD runs off its OWN mic (see
    // useVoiceActivity), so we don't hand it this stream.
    const start = useCallback(async () => {
        if (!supported || listening) return;
        try {
            const s = await navigator.mediaDevices.getUserMedia({ audio: true });
            setStream(s); // publish the live stream for level-metering; cleared in onstop below
            chunksRef.current = [];
            const recorder = new MediaRecorder(s);
            recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
            recorder.onstop = async () => {
                s.getTracks().forEach((t) => t.stop()); // release the mic (the browser "recording" dot)
                setStream(null); // stream is dead now (tracks stopped) -> tear down any meter watching it
                try {
                    const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
                    const form = new FormData();
                    form.append("audio", blob, "answer.webm");
                    const data = await transcribe(form).unwrap();
                    const text = (data.text ?? "").trim();
                    // The COMBINED stop+send — but only if there's actually text. A pure-silence misfire
                    // (countdown expired with nothing said) must not POST an empty answer; in smart mode
                    // App's auto-restart effect just re-opens the mic.
                    if (text) onFinalRef.current(text);
                } catch (e) {
                    console.error("Failed to transcribe...", e);
                }
            };
            recorderRef.current = recorder;
            recorder.start();
            setListening(true);
        } catch {
            setListening(false); // denied mic / no device -> button resets to "Record"
        }
    }, [supported, listening, transcribe]);

    // Clear the countdown timer + its UI if one is running. Shared by stop and keepListening.
    const clearCountdown = useCallback(() => {
        if (countdownRef.current !== null) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
        }
        setConfirming(false);
        setCountdownMs(0);
    }, []);

    // stop = end the turn NOW: fires recorder.onstop -> transcribe -> submit. Called by the manual "stop"
    // tap AND by the countdown on expiry. Clear the countdown first so a near-simultaneous tick can't
    // re-enter stop().
    const stop = useCallback(() => {
        clearCountdown();
        recorderRef.current?.stop();
        setListening(false);
    }, [clearCountdown]);

    // onSilence (from the VAD) opens the "still there?" countdown; expiry submits via stop().
    const beginCountdown = useCallback(() => {
        if (countdownRef.current !== null) return; // already counting
        setConfirming(true);
        setCountdownMs(CONFIRM_COUNTDOWN_MS);
        const startedAt = Date.now();
        countdownRef.current = window.setInterval(() => {
            const remaining = CONFIRM_COUNTDOWN_MS - (Date.now() - startedAt);
            if (remaining <= 0) {
                stop(); // clears the interval, then stops + submits
            } else {
                setCountdownMs(remaining);
            }
        }, 100);
    }, [stop]);

    // The user tapped / pressed a key / the VAD heard speech again: cancel the countdown but DON'T stop
    // the recorder — the same audio keeps rolling so a resumed sentence stays one continuous answer.
    const keepListening = useCallback(() => {
        clearCountdown();
    }, [clearCountdown]);

    // Wire the VAD to the countdown — only in smart mode, and only while actually listening, so it never
    // holds a mic during the AI's turn or in manual mode (where silence must never auto-end a turn).
    useVoiceActivity(mode === "smart" && listening, {
        onSilence: beginCountdown,
        onSpeech: keepListening,
    });

    return { supported, listening, confirming, countdownMs, transcribing, stream, start, stop, keepListening };
}
