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
import { API_BASE_URL } from "./constants";

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

// Phase 5 robust STT — the /api/transcribe response. The REQUEST is a FormData (the recorded
// audio blob), not a JSON body, so there's no matching request interface: fetchBaseQuery detects
// a FormData body, leaves it un-stringified, and lets the browser set the multipart Content-Type.
export interface TranscribeResponse {
    text: string;
}

export const interviewApi = createApi({
    reducerPath: "interviewApi",
    // FULL origin, not a relative path, because we use CORS (not a Vite proxy). This is the
    // one concrete consequence of that decision — see vite.config.ts. Shared with voice/speech.ts
    // via constants.ts (sourced from client/.env) so the backend origin is written down once.
    baseQuery: fetchBaseQuery({ baseUrl: API_BASE_URL }),
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
    }),
});

// RTK Query generates one hook per endpoint. Export the ones the UI consumes.
export const {
    useStartInterviewMutation,
    useSubmitAnswerMutation,
    useGetScorecardMutation,
    useTranscribeMutation,
} = interviewApi;
