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
}
export interface AnswerRequest {
    session_id: string;
    text: string;
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
    }),
});

// RTK Query generates one hook per endpoint. Export the ones the UI consumes.
export const { useStartSessionMutation, useSubmitAnswerMutation } = interviewApi;
