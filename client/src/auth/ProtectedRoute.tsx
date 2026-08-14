/**
 * SCAFFOLD — the gate. Small file, three states, and getting their ORDER wrong is the whole
 * bug surface.
 *
 * WHAT IT IS: a LAYOUT ROUTE. In main.tsx it wraps other routes as a parent with no path of
 * its own, so it renders before its children and decides whether they render at all:
 *
 *      <Route element={<ProtectedRoute />}>
 *          <Route path="/" element={<App />} />      <- only reached if the gate allows it
 *      </Route>
 *
 * `<Outlet />` is where react-router renders the matched child. Returning <Outlet /> means
 * "carry on"; returning <Navigate /> means "go somewhere else instead".
 *
 * BE HONEST ABOUT WHAT THIS PROTECTS: nothing, from an attacker's point of view. It hides a
 * PAGE, and page-hiding is a UX nicety — anyone can edit React state in devtools. What
 * actually protects the data is `require_user` / `require_ownership` on the server, which is
 * why those came first. This exists so a signed-out visitor sees a login form instead of an
 * interview screen where every button 401s.
 *
 *
 *   1. LOADING FIRST. While `loading` is true we don't KNOW yet: `session` is null, but
 *      that's "haven't asked", not "signed out" (AuthProvider's getSession() is async).
 *      Return a placeholder — `null`, or a small "Loading…" div. Check this BEFORE the
 *      session check, or every page refresh flashes the login page on its way back to the
 *      app. That bug never appears while clicking around, only on refresh, which is exactly
 *      why it survives so long in so many codebases.
 *
 *   2. NO SESSION -> send them to login, remembering where they were:
 *          return <Navigate to="/login" replace state={{ from: location.pathname }} />;
 *      - `replace` keeps the protected URL out of history, so Back doesn't bounce between
 *        /login and a page they can't see.
 *      - `state.from` is the page they wanted; LoginPage already reads it (`const from =
 *        ...state?.from ?? "/"`) and returns them there after sign-in. Without it everyone
 *        lands on "/" no matter what they clicked.
 *
 *   3. OTHERWISE -> `return <Outlet />;`
 *
 * WORTH KNOWING: the session can vanish while the app is open — signing out in another tab
 * fires onAuthStateChange here too, the mirror updates, this component re-renders, and the
 * user is redirected mid-session. Correct behavior, and free because AuthProvider subscribed
 * rather than reading once.
 */
import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "./AuthProvider";

export default function ProtectedRoute() {
    const { session, loading } = useAuth();
    const location = useLocation();

    if (loading){
        return (
            <div>
                Loading...
            </div>
        )
    }
    if (!session){
        return <Navigate to="/login" replace state={{from: location.pathname }}/> 
    }
    return <Outlet />;
}
