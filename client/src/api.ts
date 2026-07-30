/**
 * RTK Query API slice — the ONE place HTTP lives in the frontend. SCAFFOLD. Fill in the TODO.
 *
 * RTK Query is the frontend mirror of the "edge adapter" idea: components never fetch()
 * directly, they call auto-generated hooks, and this slice owns the network + caching +
 * loading/error state. You define endpoints ONCE here; RTK Query generates a React hook
 * per endpoint (use<Name>Mutation / use<Name>Query).
 *
 * Endpoints map 1:1 to your FastAPI routes:
 *   POST /api/session  -> startSession   (worked example below)
 *   POST /api/answer   -> submitAnswer   (your TODO)
 */
import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";

// These types mirror the FastAPI response/request bodies in server/api.py. There's no
// codegen wiring them together, so keep them in sync by hand (small enough for now).
export interface SessionResponse {
    session_id: string;
    message: string; // the first interview question
}
export interface AnswerResponse {
    message: string; // feedback + the next question
    done?: boolean; // true once the client-driven loop exhausts the question bank
}
export interface AnswerRequest {
    session_id: string;
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
    session_id: string;
    role: string;
    answers: AnswerGrade[];
    dimension_averages: Record<string, number>; // dimension name -> average score
    overall: number;
}
export interface ScorecardRequest {
    session_id: string;
    role?: string;
}

export const interviewApi = createApi({
    reducerPath: "interviewApi",
    // FULL origin, not a relative path, because we use CORS (not a Vite proxy). This is the
    // one concrete consequence of that decision — see vite.config.ts.
    baseQuery: fetchBaseQuery({ baseUrl: "http://localhost:8000/api" }),
    endpoints: (builder) => ({
        // WORKED EXAMPLE — start a session.
        // It's a MUTATION, not a query. Even though it "gets" the first question, the POST
        // CREATES server-side session state (a side effect). Rule of thumb: queries = cacheable
        // reads (GET), mutations = writes/actions (POST/PUT/DELETE). Same tools-vs-resources
        // instinct as the MCP server, one layer up.
        startSession: builder.mutation<SessionResponse, void>({
            query: () => ({ url: "/session", method: "POST" }),
        }),
        submitAnswer: builder.mutation<AnswerResponse, AnswerRequest>({
            query: (body) => ({ url: "/answer", method: "POST", body }),
        }),
        // Phase 5 — grade the whole session. A mutation (not a query): it's a POST that
        // kicks off server-side grading work, same instinct as startSession/submitAnswer.
        getScorecard: builder.mutation<Scorecard, ScorecardRequest>({
            query: (body) => ({ url: "/scorecard", method: "POST", body }),
        }),
    }),
});

// RTK Query generates one hook per endpoint. Export the ones the UI consumes.
export const {
    useStartSessionMutation,
    useSubmitAnswerMutation,
    useGetScorecardMutation,
} = interviewApi;
