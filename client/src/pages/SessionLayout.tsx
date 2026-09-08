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
import { Navigate, Outlet, useLocation, useOutletContext } from "react-router";

// What the producer hands over via navigate("/session", { state }).
//   interviewId  — the slug the client holds; every /api/answer + /api/scorecard call is keyed to it.
//   firstMessage — the OPENING question, i.e. the `message` field POST /api/interview returned. Carried
//                  here (not re-fetched) because /api/interview is a mutation — calling it again would
//                  start a second interview; the first question comes back exactly once.
//   role / level — human-readable LABELS for the header; the slugs already did their job in the
//                  /api/interview call that minted `interviewId` + `firstMessage`.
export type SessionNavState = {
    interviewId: string;
    firstMessage: string;
    role: string;
    level: string;
};

export default function SessionLayout() {
    const location = useLocation();
    const nav = location.state as SessionNavState | null;

    // No interview in state -> nothing to run. For now we bounce home; this is the one line to swap
    // for a dedicated <InvalidInterview /> page ("this interview link is no longer valid") when we
    // want to explain the redirect instead of silently performing it. `replace` so the bad entry
    // doesn't linger in history.
    if (!nav?.interviewId) return <Navigate to="/" replace />;

    // Valid — render the nested session route, handing the validated interview down as outlet
    // context so SessionPage doesn't re-read or re-validate location.state.
    return <Outlet context={nav} />;
}

// Typed accessor for the child route — SessionPage calls this instead of touching useLocation.
export function useSessionNav(): SessionNavState {
    return useOutletContext<SessionNavState>();
}
