/**
 * RTK Query API slice — the ONE place HTTP lives in the frontend. SCAFFOLD. Fill in the TODO.
 *
 * RTK Query is the frontend mirror of the "edge adapter" idea: components never fetch()
 * directly, they call auto-generated hooks, and this slice owns the network + caching +
 * loading/error state. You define endpoints ONCE here; RTK Query generates a React hook
 * per endpoint (use<Name>Mutation / use<Name>Query).
 *
 * Endpoints map 1:1 to your FastAPI routes:
 *   POST /api/interview -> startInterview  (worked example below)
 *   POST /api/answer    -> submitAnswer
 *
 * PHASE A RENAME: `session_id` is now `interview_id` everywhere, and POST /api/session is
 * POST /api/interview. The backend reserved the word "session" for a database session, and
 * a wire contract that disagrees with the server's vocabulary is a bug waiting to happen.
 */
import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type { BaseQueryFn, FetchArgs, FetchBaseQueryError } from "@reduxjs/toolkit/query/react";
import { API_BASE_URL } from "./constants";
import { supabase } from "./supabase";

// These types mirror the FastAPI response/request bodies in server/api.py. There's no
// codegen wiring them together, so keep them in sync by hand (small enough for now).
export interface InterviewResponse {
    interview_id: string;
    message: string; // the first interview question
}
export interface AnswerResponse {
    message: string; // feedback + the next question
    done?: boolean; // true once the client-driven loop exhausts the question bank
}
export interface AnswerRequest {
    interview_id: string;
    text: string;
}

// Phase 5 — the scorecard shapes. These mirror server/grading.py's Pydantic models plus
// the assembly in api.py's /api/scorecard. Keep them in sync by hand (no codegen).
export interface DimensionScore {
    dimension: string;
    score: number; // 1-5
    note: string;
}
export interface AnswerGrade {
    question_id: string;
    question_text: string;
    dimension_scores: DimensionScore[];
    strength: string;
    gap: string;
    improvement: string;
}
export interface Scorecard {
    interview_id: string;
    role: string;
    answers: AnswerGrade[];
    dimension_averages: Record<string, number>; // dimension name -> average score
    overall: number;
}
export interface ScorecardRequest {
    interview_id: string;
    role?: string;
}

// Phase C — the History shapes. These mirror GET /api/interviews and GET /api/interviews/{id}
// in server/api.py. `InterviewSummary` is the LIST card (no transcript — that's the detail
// view's job); `overall` is null until the interview has been graded.
export interface InterviewSummary {
    interview_id: string;
    role: string; // human-readable name ("Backend Engineer")
    level: string; // human-readable name ("Mid level")
    created_at: string; // ISO timestamp
    done: boolean;
    overall: number | null; // the grade, or null if never scored
}
export interface MyInterviewsResponse {
    interviews: InterviewSummary[];
}
// One recorded answer, as get_interview returns it (slug under "question_id", exactly as stored).
export interface InterviewTurn {
    question_id: string;
    question_text: string; // the exact prompt shown (bank question or follow-up probe)
    answer: string | null; // null = the open turn (presented, not yet answered)
    at: string; // ISO timestamp
}
// The detail view's payload: transcript + the persisted grade (null until graded, or until the
// backend's get_scorecard read-back is implemented). The scorecard is the SAME `Scorecard` shape
// a live grade uses, so <ScorecardView> renders it unchanged.
export interface InterviewDetail {
    interview_id: string;
    turns: InterviewTurn[];
    summary: string | null;
    scorecard: Scorecard | null;
}

// Phase 5 robust STT — the /api/transcribe response. The REQUEST is a FormData (the recorded
// audio blob), not a JSON body, so there's no matching request interface: fetchBaseQuery detects
// a FormData body, leaves it un-stringified, and lets the browser set the multipart Content-Type.
export interface TranscribeResponse {
    text: string;
}

// ===========================================================================
// PHASE B — THE JWT, ATTACHED IN ONE PLACE.
//
// `prepareHeaders` runs before EVERY request this slice makes, so authentication is wired
// once here instead of being remembered at four call sites. It's the frontend mirror of
// `Depends(require_user)` on the backend: one declaration, applied to everything. Nothing in
// App.tsx changes — components keep calling the same hooks and never learn that requests are
// now signed.
//
// WHY ASK supabase-js EVERY TIME rather than caching the token in Redux (or in a variable up
// here): access tokens expire in about an hour, and supabase-js rotates them in the
// background. `getSession()` hands back the CURRENT one, refreshing first if it has expired.
// A cached copy is a 401 waiting to happen an hour into a long interview — the "never copy
// the token" rule from auth/AuthProvider.tsx, in the one place it would actually bite. This
// is a local read (memory / localStorage), not a network call, so awaiting it per request
// costs nothing.
//
// NO `Content-Type` HERE, deliberately: fetchBaseQuery sets `application/json` for plain
// object bodies on its own, AND leaves it off for the FormData that /api/transcribe sends —
// only the browser knows the multipart boundary string. Setting it globally would break
// audio uploads with a baffling 422 from FastAPI.
// ===========================================================================
const rawBaseQuery = fetchBaseQuery({
    // FULL origin, not a relative path, because we use CORS (not a Vite proxy). This is the
    // one concrete consequence of that decision — see vite.config.ts. Shared with voice/speech.ts
    // via constants.ts (sourced from client/.env) so the backend origin is written down once.
    baseUrl: API_BASE_URL,
    prepareHeaders: async (headers) => {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        if (token) headers.set("Authorization", `Bearer ${token}`)
        return headers;
    },
});

// ===========================================================================
// SCAFFOLD — SURVIVING A DEAD TOKEN MID-INTERVIEW.
//
// FIRST, WHAT THIS IS *NOT* FOR. Ordinary expiry is already handled twice over and never
// reaches this code: supabase-js refreshes on a background timer while the tab is open, and
// `getSession()` above refreshes on demand if the token is stale. A three-hour interview
// sails through both. This wrapper exists for the case where the REFRESH ITSELF FAILS —
// laptop asleep past the session's inactivity window, refresh token revoked by a password
// change or a sign-out in another tab, offline at the wrong moment. The credential is
// genuinely gone, and no retry conjures it back.
//
// SO WHY WRAP AT ALL? Because the alternative is silent breakage: every button 401s, the UI
// shows nothing in particular, and the candidate keeps typing into a form that will never
// submit. A wrapper turns "quietly broken forever" into "one honest retry, then a login
// screen" — which is the whole difference in how this feels to use.
//
// WHY IT CAN'T LIVE IN prepareHeaders: headers go out hopeful. The only way to learn a token
// is no longer accepted is to send it and read the answer. Requests can only be fixed on the
// way back, which is exactly what a baseQuery wrapper gets to see.
//
// WHAT SURVIVES REGARDLESS — the payoff for Phase A: the interview itself is a Postgres row.
// Signing out loses the SCREEN, not the interview; `message_history`, `current_question_id`
// and the probe budget are all still sitting in `interviews`. Reattaching a returning user to
// it needs Phase C's GET /api/sessions/{id}, which is why "resume" isn't in scope here — but
// nothing is destroyed in the meantime, and that was a deliberate design choice, not luck.
//
//   1. let result = await rawBaseQuery(args, api, extraOptions);
//   2. if (result.error?.status !== 401) return result;      // the overwhelmingly common path
//   3. otherwise force the issue:
//          const { data, error } = await supabase.auth.refreshSession();
//      - SUCCESS (no error and data.session) -> retry ONCE:
//            result = await rawBaseQuery(args, api, extraOptions);
//        Once, not in a loop. If a freshly minted token is also refused, the problem isn't
//        the token, and a retry loop against your own API is a self-inflicted outage.
//      - FAILURE -> `await supabase.auth.signOut();` and fall through, returning the 401.
//        Note you do NOT navigate here: signOut fires onAuthStateChange, AuthProvider's
//        mirror goes null, <ProtectedRoute> re-renders and redirects. This module has no
//        business knowing routes exist — the same one-owner rule as the mirror itself.
//   4. return result;
//
// ONE SUBTLETY WORTH KNOWING (not worth building today): if three requests are in flight and
// all three 401, all three call refreshSession. supabase-js serializes refreshes internally,
// so this is safe here — but the canonical RTK Query version of this pattern guards it with a
// mutex, and that's why. If you ever swap in an auth library without that lock, the three
// refreshes race to rotate one refresh token and two of them lose.
// ===========================================================================
const baseQueryWithReauth: BaseQueryFn<
    string | FetchArgs,          // what an endpoint's `query()` returns
    unknown,                     // the success payload (per-endpoint, so unknown here)
    FetchBaseQueryError          // the error shape RTK Query hands your components
> = async (args, api, extraOptions) => {
    let result = await rawBaseQuery(args, api, extraOptions);
    if (result.error?.status !== 401){
        return result
    }
    const { data, error } = await supabase.auth.refreshSession()
    if (!error && data.session){
        result = await rawBaseQuery(args, api, extraOptions)
    }
    else {
        await supabase.auth.signOut()
    }
    return result
};

export const interviewApi = createApi({
    reducerPath: "interviewApi",
    baseQuery: baseQueryWithReauth,
    endpoints: (builder) => ({
        // WORKED EXAMPLE — start an interview.
        // It's a MUTATION, not a query. Even though it "gets" the first question, the POST
        // CREATES server-side state — a row in `interviews` (a side effect). Rule of thumb:
        // queries = cacheable reads (GET), mutations = writes/actions (POST/PUT/DELETE). Same
        // tools-vs-resources instinct as the MCP server, one layer up.
        startInterview: builder.mutation<InterviewResponse, void>({
            query: () => ({ url: "/interview", method: "POST" }),
        }),
        submitAnswer: builder.mutation<AnswerResponse, AnswerRequest>({
            query: (body) => ({ url: "/answer", method: "POST", body }),
        }),
        // Phase 5 — grade the whole interview. A mutation (not a query): it's a POST that
        // kicks off server-side grading work, same instinct as startInterview/submitAnswer.
        getScorecard: builder.mutation<Scorecard, ScorecardRequest>({
            query: (body) => ({ url: "/scorecard", method: "POST", body }),
        }),
        // Phase 5 robust STT — transcribe one recorded utterance via /api/transcribe (OpenAI
        // Whisper). A mutation: it's a POST with a side effect (an API call), same instinct as the
        // others. The arg is the FormData holding the audio blob; fetchBaseQuery ships it as-is.
        transcribe: builder.mutation<TranscribeResponse, FormData>({
            query: (body) => ({ url: "/transcribe", method: "POST", body }),
        }),
        // Phase C — the History LIST. A QUERY, not a mutation: it's a cacheable GET of existing
        // rows (no side effect), the frontend mirror of the read-vs-write split the backend draws
        // between /api/interviews and /api/interview. RTK Query caches it and re-fetches on mount,
        // so finishing an interview and clicking History shows it without a manual refresh.
        getMyInterviews: builder.query<MyInterviewsResponse, void>({
            query: () => "/interviews",
        }),
        // Phase C — the History DETAIL: one interview by id. Also a query; the arg is the slug,
        // interpolated into the path. Backs the drill-in transcript + remembered scorecard.
        getInterviewDetail: builder.query<InterviewDetail, string>({
            query: (interviewId) => `/interviews/${interviewId}`,
        }),
    }),
});

// RTK Query generates one hook per endpoint. Export the ones the UI consumes.
export const {
    useStartInterviewMutation,
    useSubmitAnswerMutation,
    useGetScorecardMutation,
    useTranscribeMutation,
    useGetMyInterviewsQuery,
    useGetInterviewDetailQuery,
} = interviewApi;
