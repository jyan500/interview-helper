/**
 * App-wide constants. The ONE place the backend origin is written down, so the RTK Query
 * slice (api.ts) and the voice adapters (voice/speech.ts) can't drift apart.
 *
 * FULL origin, not a relative path, because the frontend (Vite :6173) and API (:8000) are
 * different origins and we use CORS, not a Vite proxy (see server/api.py's CORSMiddleware).
 *
 * The value comes from client/.env (VITE_API_BASE_URL) so a deploy can point at a real backend
 * without a code change. The `||` fallback keeps a fresh clone (no .env) running against local.
 */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";

/**
 * Phase B — Supabase. Both values are PUBLIC BY DESIGN and ship inside the JS bundle;
 * anyone can read them out of devtools, and that is fine:
 *
 *   the URL      is just an address.
 *   the ANON KEY is a JWT that says "an anonymous visitor to this project". It grants
 *                exactly the access your Row-Level Security policies grant the `anon` role,
 *                and nothing more. It is NOT a password, and it is NOT the service_role key
 *                (which bypasses RLS and must never reach the browser or client/.env).
 *
 * That's the link between this file and the RLS migration: shipping this key is only safe
 * BECAUSE those policies exist. You proved it from the terminal — a plain GET to
 * <SUPABASE_URL>/rest/v1/questions with this key returns [] rather than the question bank.
 *
 * No `||` fallback here, unlike API_BASE_URL: a missing backend origin has a sane local
 * default, but a missing/wrong Supabase project does not — better to fail loudly in
 * supabase.ts than to point at nothing.
 */
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Smart voice turn-taking (layer 1) — the tunables for the VAD auto-endpoint experience. They live
 * here, not inline in voice/speech.ts, so the "feel" of the mic is adjustable in ONE place (same rule
 * as API_BASE_URL). All three encode ONE tradeoff: end the turn promptly vs. don't cut someone off
 * mid-thought. Start here if smart mode feels twitchy or sluggish.
 *
 * Acoustic detection is delegated to the Silero VAD (@ricky0123/vad-web), so the first two map onto
 * that library's MicVAD options rather than a hand-rolled RMS threshold:
 *
 *   VAD_SPEECH_THRESHOLD  — MicVAD `positiveSpeechThreshold` (0..1): Silero's speech-probability above
 *                           which a frame counts as speech. ~0.5 is the library default; raise it in a
 *                           noisy room so background hum doesn't read as talking, lower it if soft
 *                           speech gets missed.
 *   VAD_REDEMPTION_MS     — MicVAD `redemptionMs`: how long (ms) of below-threshold audio to wait (the
 *                           model's own hysteresis) before declaring speech ended. Higher = more forgiving
 *                           of short pauses mid-sentence before we even reach the countdown below.
 *   CONFIRM_COUNTDOWN_MS  — the "still there?" grace window. A tap or keypress cancels it; on expiry we
 *                           stop + transcribe + submit. This is the human-scale safety net against a
 *                           thinking pause, layered on top of the model's short redemption window.
 */
export const VAD_SPEECH_THRESHOLD = 0.5;
export const VAD_REDEMPTION_MS = 3000;
export const CONFIRM_COUNTDOWN_MS = 6000;

/**
 * The "check your mic" watchdog. When the mic is armed but NO sound at all comes through it for this
 * long, we raise the "Still there? — check your mic" prompt (useNoInputPrompt). This is a DIFFERENT
 * failure from CONFIRM_COUNTDOWN_MS above: that one ends a turn after the candidate has spoken and then
 * gone quiet; THIS one fires when nothing was ever heard — a candidate who never started, or (the case
 * it really catches) a wrong/dead mic that isn't picking their voice up at all. Keep it generously
 * longer than the countdown so a candidate simply composing their first sentence isn't nagged.
 */
export const NO_INPUT_TIMEOUT_MS = 10000;

/**
 * Tunables for the candidate's "speaking" indicator (the pulsing mic icon), driven by `hark`
 * watching the live mic stream — see useSpeaking (hooks.ts). This is a DISPLAY signal, unrelated to
 * the Silero VAD above (which does turn-taking); hark just answers "is there speech right now?" with
 * its own built-in hysteresis so the icon doesn't flicker.
 *
 *   HARK_SPEAKING_THRESHOLD_DB — loudness (dBFS, negative) above which hark counts audio as speech.
 *                                hark's default is -50; RAISE toward 0 (e.g. -45) if room noise makes
 *                                the icon pulse when you're silent, LOWER (e.g. -60) if quiet speech
 *                                doesn't register.
 *   HARK_POLL_INTERVAL_MS       — how often (ms) hark samples the level. 100ms is its default — snappy
 *                                enough for an indicator without churning.
 */
export const HARK_SPEAKING_THRESHOLD_DB = -50;
export const HARK_POLL_INTERVAL_MS = 100;

/**
 * Where MicVAD loads the onnxruntime-web wasm from (its `onnxWASMBasePath`). ORT pulls its wasm glue
 * via a dynamic `import()`, and Vite's DEV server refuses to serve /public files as JS modules ("...
 * should not be imported from source code" → 500) — so in dev we point at a cross-origin CDN, which
 * Vite never intercepts. The prod build serves /public statically with no such block, so it uses the
 * self-hosted copy in /vad/ (from scripts/copy-vad-assets.mjs). The worklet + Silero .onnx model still
 * come from /vad/ in BOTH modes (they're fetched / addModule'd, not imported, so Vite serves them fine).
 *
 * PIN the CDN version to the installed onnxruntime-web (it must match the ORT JS bundled by
 * @ricky0123/vad-web, or the wasm/JS handshake fails) — bump it whenever that dependency upgrades.
 */
export const VAD_ONNX_WASM_BASE = import.meta.env.DEV
    ? "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/"
    : "/vad/";

/**
 * The chosen microphone persists across sessions in localStorage under this key, so a mic picked once
 * (in the in-session Settings modal) becomes the DEFAULT the next interview opens with — the fix for
 * "the mic doesn't take effect until a turn passes". SessionPage seeds micDeviceId from it and writes it
 * back on change; the stored value is a MediaDeviceInfo.deviceId, or "" for the system default.
 */
export const MIC_DEVICE_STORAGE_KEY = "ih.micDeviceId";

/**
 * The resume banner's "Ignore" button dismisses the unfinished-session banner for a specific
 * interview WITHOUT abandoning it — the interview stays resumable, the banner just stops nagging.
 * The set of ignored interview ids is persisted here (a JSON array of slugs) so the dismissal
 * survives reloads; a NEWER unfinished interview isn't in the set, so it still surfaces. See
 * loadIgnoredInterviewIds / addIgnoredInterviewId in helpers.ts.
 */
export const IGNORED_INTERVIEWS_STORAGE_KEY = "ih.ignoredInterviewIds";

/**
 * Tunables for the Settings modal's live mic-test meter (useMicLevel). The meter is driven by `hark`
 * (the same loudness library useSpeaking uses), whose volume_change reports the input level in dBFS
 * (~-100 silent .. 0 loud). We map that dB range onto the bar's 0..1 width, so it sits left when you're
 * quiet and "shoots right" as you talk. They live here, not inline, so the meter's feel is adjustable in
 * ONE place (same rule as the VAD/hark tunables above). The bar's motion is smoothed by a CSS width
 * transition, so there's no JS smoothing factor to tune.
 *
 *   MIC_LEVEL_FLOOR_DB — dB mapped to an EMPTY bar (0%). At/below this reads as silence. RAISE toward 0
 *                        (e.g. -55) if room noise keeps the bar off the floor when you're not talking.
 *   MIC_LEVEL_CEIL_DB  — dB mapped to a FULL bar (100%). LOWER toward the floor if a normal speaking
 *                        volume never fills the bar; RAISE toward 0 if it pins to the right too easily.
 *   MIC_SILENCE_LEVEL  — mapped level (0..1) below which the input counts as "quiet". Sustained quiet
 *                        flips the "no audio detected" warning.
 *   MIC_SILENCE_MS     — how long (ms) the level must stay below MIC_SILENCE_LEVEL before we show
 *                        "no audio detected" — long enough not to fire in the gaps between words.
 */
export const MIC_LEVEL_FLOOR_DB = -60;
export const MIC_LEVEL_CEIL_DB = -10;
export const MIC_SILENCE_LEVEL = 0.05;
export const MIC_SILENCE_MS = 2500;

export const PAGE_SIZE = 12
