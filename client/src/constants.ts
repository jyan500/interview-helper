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
