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
export const VAD_REDEMPTION_MS = 800;
export const CONFIRM_COUNTDOWN_MS = 6000;

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
