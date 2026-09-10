/**
 * Session guard — a LAYOUT ROUTE (React Router), the same shape as ProtectedRoute. It sits above
 * /session in the route table and decides whether the child (SessionPage) is allowed to render at
 * all, based on whether a real interview arrived in navigation state.
 *
 * WHY A LAYOUT ROUTE AND NOT AN INLINE GUARD IN SessionPage:
 *   - The interview id only ever reaches /session as `location.state`, handed over by the producer
 *     (Dashboard "Start interview" / Interviews "New interview") right after POST /api/interview.
 *     A typed URL, a refresh that dropped state, or a stale bookmark arrives with NO interview —
 *     and that case wants its own screen, separate from the running session.
 *   - Keeping the check here means SessionPage never has to defend against a missing interview: by
 *     the time it renders, one is guaranteed, and it reads it through useOutletContext (typed).
 *   - It's the natural home for an "invalid interview" page later (see the TODO): swap the redirect
 *     for <InvalidInterview /> and nothing else in the tree changes.
 */
import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate, useOutletContext } from "react-router";

// What the producer hands over via navigate("/session", { state }). TWO producers, two shapes that
// share the same guard (interviewId + labels):
//   interviewId  — the slug the client holds; every /api/answer + /api/scorecard call is keyed to it.
//   firstMessage — FRESH START only: the OPENING question, i.e. the `message` field POST /api/interview
//                  returned. Carried here (not re-fetched) because /api/interview is a mutation —
//                  calling it again would start a second interview; the first question comes back once.
//   resume       — RESUME only: true when re-opening an in-progress interview (the ResumeBanner
//                  producer). There's no firstMessage then — SessionPage fetches the transcript +
//                  current question from GET /api/interviews/{id}/resume and redraws instead of seeding.
//   role / level — human-readable LABELS for the header (both flows carry them).
export type SessionNavState = {
    interviewId: string;
    firstMessage?: string;
    resume?: boolean;
    role: string;
    level: string;
};

export default function SessionLayout() {
    const location = useLocation();
    const navigate = useNavigate();

    // SNAPSHOT the handed-over interview ONCE, on mount. Everything below — and SessionPage, via
    // useOutletContext — reads this snapshot, NOT live location.state. That's what lets us strip the
    // state out of history immediately (below) without pulling the rug out from under the running
    // session. (The useState initializer runs once per mount, so a later render sees the same snapshot.)
    const [nav] = useState<SessionNavState | null>(
        () => (location.state as SessionNavState | null) ?? null,
    );

    // THE REFRESH GUARD. React Router keeps location.state in window.history.state, which the browser
    // PRESERVES across a hard refresh — so without this, refreshing mid-interview would remount
    // SessionPage against the SAME stale nav (re-seeding question 1 while the server is several turns
    // ahead, desyncing the open-turn bookkeeping). Having snapshotted the nav above, we now CLEAR it
    // from this history entry: the live session keeps running off the snapshot, but a refresh reloads
    // an entry with NO state -> the guard below bounces home, where the resume banner reattaches the
    // candidate to server truth. Replacing the SAME path keeps SessionPage mounted (no remount, no
    // lost transcript); it runs once on mount.
    useEffect(() => {
        if (nav?.interviewId) navigate(location.pathname, { replace: true, state: null });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // No interview in the snapshot -> nothing to run: a typed URL, a stale bookmark, or (now) a
    // refresh whose state we cleared. Bounce home; this is the one line to swap for a dedicated
    // <InvalidInterview /> page later. `replace` so the bad entry doesn't linger in history.
    if (!nav?.interviewId) return <Navigate to="/" replace />;

    // Valid — render the nested session route, handing the snapshot down as outlet context so
    // SessionPage doesn't re-read or re-validate location.state.
    return <Outlet context={nav} />;
}

// Typed accessor for the child route — SessionPage calls this instead of touching useLocation.
export function useSessionNav(): SessionNavState {
    return useOutletContext<SessionNavState>();
}
