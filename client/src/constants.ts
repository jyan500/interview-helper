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
