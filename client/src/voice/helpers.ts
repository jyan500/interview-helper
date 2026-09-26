/**
 * Voice-capture helpers — pure, dependency-free functions shared by the two MediaRecorder-based
 * capture hook in speech.ts (useSmartVoiceTurn). No React, no network,
 * no module state, so they're trivial to reuse and unit-test.
 */

// Containers we ask MediaRecorder for, best-first. The FIRST one isTypeSupported() accepts wins.
// All of these decode cleanly on OpenAI Whisper (webm, ogg, mp4 are all on its accepted list).
const CANDIDATE_MIME_TYPES = [
    "audio/webm;codecs=opus", // Chrome, Edge — their native default
    "audio/ogg;codecs=opus",  // Firefox — its native default (the browser this bug showed up on)
    "audio/mp4",              // Safari — AAC in an MP4 container
    "audio/webm",             // bare fallback if the codec-qualified form isn't advertised
];

// audio/<subtype> -> the file extension Whisper recognizes for that container. Whisper accepts
// webm, ogg/oga, mp3, mp4/m4a, mpeg, wav, flac; we only ever emit the few MediaRecorder produces.
const EXTENSION_BY_SUBTYPE: Record<string, string> = {
    webm: "webm",
    ogg: "ogg",
    mp4: "mp4",
    mpeg: "mp3",
    wav: "wav",
    "x-wav": "wav",
};

/**
 * Choose a recording container this browser actually supports, to hand to `new MediaRecorder(stream,
 * { mimeType })`. Returns {} (no mimeType) when we can't probe — very old browsers lacking
 * isTypeSupported, or none of the candidates supported — so the caller lets MediaRecorder pick its
 * own default. Either way the FILENAME is derived later from recorder.mimeType, so an empty result
 * here is safe, not a silent webm assumption.
 */
export function pickRecordingType(): { mimeType?: string } {
    if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
        return {};
    }
    const supported = CANDIDATE_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    return supported ? { mimeType: supported } : {};
}

/**
 * Extract the file extension for a recorder mimeType, e.g. "audio/ogg;codecs=opus" -> "ogg". Strips
 * any ";codecs=..." parameter and the "audio/" prefix, then maps the subtype through the table above,
 * falling back to "webm" for anything unrecognized (Chrome's default, the safest single guess).
 */
export function extensionFor(mimeType: string): string {
    const subtype = mimeType.split(";")[0].trim().split("/")[1] ?? "";
    return EXTENSION_BY_SUBTYPE[subtype.toLowerCase()] ?? "webm";
}

/**
 * The multipart filename to upload for a given recorder mimeType, e.g. "answer.ogg". Whisper reads
 * the container from THIS extension, so it MUST agree with the blob's real bytes — pass
 * recorder.mimeType (the source of truth after recording), not the requested type.
 */
export function filenameFor(mimeType: string): string {
    return `answer.${extensionFor(mimeType)}`;
}

/**
 * The `audio` value for getUserMedia given a chosen input-device id. A falsy id (null/"" = "system
 * default") yields `true` — let the browser pick — while a real id pins that exact microphone. Used
 * by BOTH the recorder and the smart-mode VAD so the device picker steers the same mic everywhere.
 * `exact` (vs a plain deviceId) makes the request FAIL loudly if that device is gone, rather than
 * silently falling back to another mic — which is the wrong-mic silence we just chased down.
 */
export function audioConstraints(deviceId?: string | null): MediaTrackConstraints | boolean {
    return deviceId ? { deviceId: { exact: deviceId } } : true;
}

/**
 * The interviewer's message as it should be SPOKEN: the model writes markdown (`code`, *emphasis*,
 * **bold**, ``` fences), and a TTS voice reads that punctuation aloud ("backtick robot_ids backtick").
 * Strip the markup, keep the words. A fenced code block has no sensible spoken form, so it's dropped;
 * the transcript still shows it. Only the spoken copy changes. The caller keeps the original for display.
 */
export function toSpeechText(text: string): string {
    return text
        .replace(/```[^\n]*\n[\s\S]*?```/g, " ") // fenced code block -> nothing to read aloud
        .replace(/`([^`\n]+)`/g, "$1") // `inline code` -> inline code
        // **bold** (not __bold__: that form would eat Python dunders like __init__)
        .replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, "$1")
        .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, "$1$2") // *emphasis* (not a*b arithmetic)
        .replace(BIG_O_RE, (_, inner: string) => `O of ${speakComplexity(inner)}`)
        .replace(/[ \t]{2,}/g, " ")
        .trim();
}

// Big-O notation: O( … ), allowing one level of nested parens, e.g. O(n log(n)).
const BIG_O_RE = /\bO\(((?:[^()]|\([^()]*\))*)\)/g;

/**
 * The inside of a Big-O as it's said aloud. Browser voices mangle the written form (`O(N)` came out as
 * "oxygen mononitride": the voice's own text normalization reads it as a chemical formula), so we hand
 * both engines the spoken form instead: n^2 -> "n squared", n*m -> "n times m", log(n) -> "log n".
 */
function speakComplexity(inner: string): string {
    return inner
        .replace(/\(([^()]*)\)/g, " $1 ") // log(n) -> log n
        .replace(/\^\s*2\b|²/g, " squared")
        .replace(/\^\s*3\b|³/g, " cubed")
        .replace(/\^\s*(\w+)/g, " to the $1")
        .replace(/\s*\*\s*|\s*·\s*/g, " times ")
        .replace(/\s*\+\s*/g, " plus ")
        .replace(/\s+/g, " ")
        .trim();
}
