/**
 * The Supabase browser client — ONE instance for the whole app.
 *
 * This object is the frontend's entire relationship with Supabase, and it is worth being
 * precise about how small that relationship is: we use it for AUTH ONLY. It can also query
 * tables directly (that's the PostgREST "Data API" your RLS policies guard), and we
 * deliberately don't — every piece of interview data comes from FastAPI, which owns the
 * rules. See the Phase B notes in server/api.py for why that split is the design.
 *
 * WHAT IT DOES FOR YOU, and why you should not reimplement any of it:
 *   - signs in / signs up against Supabase Auth
 *   - PERSISTS the session in localStorage, so a refresh (or a new tab) stays signed in
 *   - REFRESHES the access token before it expires (they live ~1 hour) using the longer-
 *     lived refresh token, in the background
 *   - notifies subscribers on every change via onAuthStateChange (see auth/AuthProvider)
 *
 * The consequence to internalize: THIS is the source of truth for "am I signed in", not
 * React state and not Redux. Components mirror it for rendering; nobody copies the token.
 * Same instinct as the backend owning `message_history` — one owner, everyone else reads.
 *
 * A SINGLE INSTANCE MATTERS. Two clients in one tab means two auto-refresh timers racing to
 * rotate the same refresh token, and supabase-js will warn about it. Import this module;
 * never call createClient() anywhere else.
 */
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./constants";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    // Fail here, at startup, with a sentence that names the fix — rather than 40 lines
    // deep in a login handler with a "fetch failed to undefined/auth/v1/token".
    throw new Error(
        "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in client/.env — copy them " +
        "from the Supabase dashboard (Project Settings -> API), then restart `npm run dev` " +
        "(Vite only reads .env at startup)."
    );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
