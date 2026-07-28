"""Phase 3.5 — a FastAPI backend for the SAME agent. SCAFFOLD. Fill in the TODO.

Concept: a web UI is the SAME kind of edge adapter as audio (Phase 4). The agent, MCP
server, tools, resources, and prompts are byte-for-byte the ones you already built — we
just put an HTTP boundary on the two ends of the loop instead of a terminal (or a mic).
That's why this file IMPORTS `agent`/`interview_toolset` from pydantic_agent.py rather
than rebuilding them: proving nothing about the AI core changes.

THE ONE GENUINELY NEW THING (see build-plan Phase 3.5):
    A browser can't call input()/print(). The terminal loop was ONE process that owned
    the whole conversation in a local `history` variable. HTTP is discrete request/
    response, so control INVERTS: the loop's state must live behind the boundary,
    stateless-per-request, keyed by session_id.

        terminal loop:  history = []                         # one conversation, local var
        web backend:    SESSIONS[session_id] = {history,...} # many conversations, stored

    That relocation is the whole lesson of this phase.

Run (from server/) — the FastAPI CLI auto-detects `app` and enables reload:
    .venv/Scripts/fastapi.exe dev api.py
  (equivalent to: .venv/Scripts/python.exe -m uvicorn api:app --reload --port 8000)
Smoke-test with curl (no browser needed yet — prove the backend before adding React):
    curl -X POST localhost:8000/api/session
    curl -X POST localhost:8000/api/answer -H "Content-Type: application/json" \\
         -d '{"session_id":"<id-from-above>","text":"my answer"}'
"""
from __future__ import annotations

import json
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pydantic_ai.usage import UsageLimits

# REUSE the AI core untouched. Importing runs pydantic_agent's module-level setup
# (model, toolset, agent) but NOT its main() (that's guarded by __main__). This import
# IS the thesis of the phase: HTTP is just a new adapter on the loop you already have.
from pydantic_agent import agent, interview_toolset

# Phase 5 — the GRADER (a second agent + typed output). Separate from the interviewer:
# the interviewer conducts, the grader scores. See grading.py for the output_type idea.
from grading import grade_one, aggregate


# --- SESSION STORE: the terminal loop's `history` local variable, relocated. In-memory
#     dict keyed by session_id. Learning-scale ON PURPOSE: lost on restart, single
#     process, not built for real multi-user scale (a real app: Redis / a DB). ----------
SESSIONS: dict[str, dict] = {}


# --- LIFESPAN: the new lifecycle piece. The terminal loop opened `async with agent:`
#     ONCE and ran the whole conversation inside it. Here we do the same ONCE for the
#     app's whole life, so the MCP server subprocess stays up across every request
#     instead of being spawned per-call. FastAPI enters this on startup, exits on
#     shutdown. --------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    async with agent:        # starts the MCP toolset subprocess; keeps it alive
        yield                # ...app serves requests here...
    # toolset torn down on shutdown


app = FastAPI(lifespan=lifespan)

# --- CORS: the Vite dev server (:5173) and this API (:8000) are different origins, so the
#     browser's preflight blocks fetch unless we opt in. Explicit origin, not "*", to stay
#     honest about who's calling (the build-plan decision). ------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- request bodies. FastAPI validates+parses these from the JSON payload automatically.
class StartRequest(BaseModel):
    role: str = "backend-engineer"
    seniority: str = "mid"


class AnswerRequest(BaseModel):
    session_id: str
    text: str


class ScorecardRequest(BaseModel):
    session_id: str
    role: str = "backend-engineer"   # which rubric to grade against (matches the interview)


# ===========================================================================
# WORKED EXAMPLE — POST /api/session : start an interview, get the first question.
# The HTTP translation of the terminal loop's KICKOFF (everything before the for-loop):
# make a session_id, fetch the server-owned persona, run once, store the history.
# ===========================================================================
@app.post("/api/session")
async def start_session(req: StartRequest = StartRequest()) -> dict:
    # `= StartRequest()` makes the whole body OPTIONAL: a bodyless POST (or `{}`) starts
    # a default backend-engineer interview; passing {"role":..,"seniority":..} overrides.
    # Safe shared default here because we only READ req, never mutate it.
    session_id = uuid.uuid4().hex[:8]

    # server owns the persona — the SAME get_prompt fetch as the terminal client
    pr = await interview_toolset.get_prompt(
        "behavioral_interview", {"role": req.role, "seniority": req.seniority}
    )
    persona = pr.messages[0].content.content   # PromptMessage -> TextContent -> .content

    result = await agent.run(
        f"Start the interview. Session id: {session_id}.",
        instructions=persona,
        message_history=[],
        usage_limits=UsageLimits(request_limit=8),
    )

    # relocate `history` into the session store instead of a local variable
    SESSIONS[session_id] = {"persona": persona, "history": result.all_messages()}
    return {"session_id": session_id, "message": result.output}


# ===========================================================================
# TODO — POST /api/answer : submit an answer, get feedback + the next question.
# The HTTP translation of ONE ITERATION of the terminal for-loop. Pointers:
#   - look up the session:
#       sess = SESSIONS.get(req.session_id)
#       if sess is None:
#           raise HTTPException(status_code=404, detail="unknown session")
#   - run the agent with the STORED persona + history (stateless-per-request: the history
#     lives in SESSIONS, not on the agent):
#       result = await agent.run(
#           req.text,
#           instructions=sess["persona"],
#           message_history=sess["history"],
#           usage_limits=UsageLimits(request_limit=8),
#       )
#   - write the grown transcript back:  sess["history"] = result.all_messages()
#   - return {"message": result.output}
# Notice what's GONE: no `for` loop, no listen()/speak(). The BROWSER is the loop now —
# each fetch is one iteration. That's the control inversion this phase is about.
# ===========================================================================
@app.post("/api/answer")
async def submit_answer(req: AnswerRequest) -> dict:
    session = SESSIONS.get(req.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="unknown session")
    result = await agent.run(
        req.text,
        instructions=session["persona"],
        message_history=session["history"],
        usage_limits=UsageLimits(request_limit=8)
    )
    session["history"] = result.all_messages()
    return {"message": result.output}


# ===========================================================================
# WORKED EXAMPLE — POST /api/scorecard : grade the whole session, return a scorecard.
# This is the Phase 5 END-OF-SESSION PASS. It does NOT touch the conversational loop
# above — it reads what that loop already RECORDED (record_answer -> the store) and
# grades it separately. That decoupling is the design: the interviewer conducts, this
# grades. Everything it needs it pulls THROUGH MCP (server owns the data):
#   session://{id}     -> the recorded turns (question_id + answer)
#   rubric://{role}    -> the dimensions to score against
#   question://{id}    -> the question text for each turn
# Note the unwrap: MCPToolset.read_resource returns the JSON STRING directly, so it's
# just json.loads(...) — no content-block list to dig through.
# ===========================================================================
@app.post("/api/scorecard")
async def scorecard(req: ScorecardRequest) -> dict:
    # 1. the recorded transcript (written by record_answer during the interview)
    sess = json.loads(await interview_toolset.read_resource(f"session://{req.session_id}"))
    turns = sess.get("turns", [])
    if not turns:
        # nothing was recorded — the interviewer may not have called record_answer, or
        # the session id is wrong. A thin store is a real dependency of grade-at-end.
        raise HTTPException(status_code=404, detail="no recorded answers for this session")

    # 2. the rubric for this role (dimensions + a human-readable text to hand the grader)
    rubric_env = json.loads(await interview_toolset.read_resource(f"rubric://{req.role}"))
    if rubric_env.get("status") != "ok":
        raise HTTPException(status_code=404, detail=f"unknown role: {req.role}")
    dimensions = rubric_env["rubric"]["dimensions"]
    rubric_text = f"Dimensions: {'; '.join(dimensions)}. {rubric_env['rubric']['scale']}"

    # 3. grade EACH recorded answer — the per-turn loop. Look up the question text, then
    #    call the grader (grade_one runs the typed grader_agent). We attach question_id/text
    #    ourselves; the model only judges (see AnswerGrade — no id field on purpose).
    answers: list[dict] = []
    grades = []
    for turn in turns:
        q_env = json.loads(await interview_toolset.read_resource(f"question://{turn['question_id']}"))
        q_text = q_env["question"]["text"] if q_env.get("status") == "ok" else "(unknown question)"
        grade = await grade_one(interview_toolset, q_text, turn["answer"], rubric_text)
        grades.append(grade)
        answers.append({
            "question_id": turn["question_id"],
            "question_text": q_text,
            **grade.model_dump(),   # dimension_scores, strength, gap, improvement
        })

    # 4. aggregate the per-answer grades into headline numbers (deterministic Python — the
    #    LLM already judged; this just averages). aggregate() is your grading.py TODO.
    agg = aggregate(grades, dimensions)

    # (optional, later) persist a one-line wrap-up via the save_session_summary TOOL:
    #   await interview_toolset.call_tool("save_session_summary",
    #       {"session_id": req.session_id, "feedback": f"Overall {agg['overall']}/5 ..."})

    return {
        "session_id": req.session_id,
        "role": req.role,
        "answers": answers,
        "dimension_averages": agg["dimension_averages"],
        "overall": agg["overall"],
    }

