/**
 * WORKED EXAMPLE — the session MIRROR. The one genuinely new idea on the frontend.
 *
 * supabase-js already holds the session, persists it to localStorage, and refreshes the
 * access token in the background. So this component does NOT own the session — it owns a
 * copy of it in React state, for the only thing React needs it for: deciding what to
 * render. Two rules follow, and they're the whole file:
 *
 *   1. NEVER copy the access token into React state, Redux, or a prop. Tokens expire and
 *      get rotated; a copy goes stale silently and you end up debugging a 401 that the
 *      library had already fixed. Ask supabase-js for the current one at the moment you
 *      need it (see prepareHeaders in api.ts).
 *   2. Mirror only what you RENDER — "is someone signed in", "what's their email".
 *
 * If that sounds familiar, it's the same rule the backend follows with `message_history`:
 * one owner, everyone else reads through it.
 *
 * WHY BOTH getSession() AND onAuthStateChange() — they answer different questions:
 *
 *      getSession()          "is there a session RIGHT NOW?"  — asked once, on mount.
 *                            Answers the page-refresh case: the session is sitting in
 *                            localStorage and nothing has happened to fire an event.
 *      onAuthStateChange()   "tell me when it CHANGES"        — sign-in, sign-out, token
 *                            refresh, and another TAB signing out (it's cross-tab).
 *
 * Use only the first and the UI never reacts to a login. Use only the second and a refresh
 * lands you on the login page despite being signed in.
 *
 * `loading` EXISTS FOR EXACTLY ONE BUG: getSession() is async, so for the first tick after
 * a refresh `session` is null and indistinguishable from "signed out". Without this flag,
 * <ProtectedRoute> would bounce a signed-in user to /login on every refresh. Anything that
 * gates on auth must wait for `loading` to be false first.
 *
 * THE RTK QUERY CACHE BELONGS TO ONE USER. Its keys are endpoint + args, with nothing about who asked
 * (GET /api/profile is the same key for everyone), and it lives in memory across sign-out. So when a
 * user leaves, this wipes it, or the next account to sign in on this tab is served the last one's
 * data. Keyed on the user ID, not the session, because a token refresh changes the session and must
 * not throw away the cache.
 */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { interviewApi } from "../api";
import { useAppDispatch } from "../store";
import { supabase } from "../supabase";

type AuthState = {
    session: Session | null;      // null = signed out. Its `.user.email` is what the UI shows.
    loading: boolean;             // true until the initial getSession() resolves. See above.
    signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
    session: null,
    loading: true,
    signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // 1. the session that ALREADY exists (page refresh, new tab, returning visitor).
        supabase.auth.getSession().then(({ data }) => {
            setSession(data.session);
            setLoading(false);
        });

        // 2. every change from here on. The callback must stay SYNCHRONOUS and trivial:
        //    supabase-js invokes it while holding an internal lock, so `await`ing another
        //    supabase call inside it can deadlock. Set state and get out. (If you ever need
        //    to do real work on sign-in — fetch a profile, say — schedule it with
        //    setTimeout(..., 0) so it runs after the callback returns.)
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
            setSession(next);
        });

        // 3. unsubscribe on unmount. StrictMode mounts every component twice in dev, so
        //    without this you'd have two live subscriptions after the first render.
        return () => subscription.unsubscribe();
    }, []);

    // Wipe the cache when a user leaves. A null -> user change is skipped, since a signed-out app has
    // nothing cached to wipe. It runs here rather than in the auth callback so the pages have already
    // unmounted on sign-out, and nothing refetches without a token. The reset also aborts in-flight
    // requests, so a late response can't land afterwards.
    //
    // WHY A LAYOUT EFFECT: the direct swap, from user A to user B with no signed-out state in between
    // (e.g. another tab signing in as a different account). The page stays mounted through that swap,
    // so its first render under B still holds A's cached data. A layout effect runs before the browser
    // paints, so that render never reaches the screen; useEffect could show it for a frame.
    const dispatch = useAppDispatch();
    const userId = session?.user.id ?? null;
    const previousUserId = useRef<string | null>(null);
    useLayoutEffect(() => {
        if (previousUserId.current && previousUserId.current !== userId) {
            dispatch(interviewApi.util.resetApiState());
        }
        previousUserId.current = userId;
    }, [userId, dispatch]);

    const value: AuthState = {
        session,
        loading,
        // The `onAuthStateChange` above is what actually clears `session` — this just asks
        // supabase-js to end the session (which also wipes localStorage and stops the
        // refresh timer). Note we do NOT setSession(null) here: one code path updates the
        // mirror, and it's the subscription. Two paths is how mirrors drift.
        signOut: async () => { await supabase.auth.signOut(); },
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** The hook every component uses: `const { session, loading, signOut } = useAuth()`. */
export function useAuth(): AuthState {
    return useContext(AuthContext);
}
