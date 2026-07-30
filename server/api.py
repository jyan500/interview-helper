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
# Phase 5 — the TURN agent (client-driven loop). The model no longer drives the interview;
# it just reacts to an answer and flags whether to probe (turn_agent -> TurnReply). The
# CLIENT below owns the question spine (next_question) and recording (record_answer).
from grading import turn_agent


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

# --- CORS: the Vite dev server (:6173) and this API (:8000) are different origins, so the
#     browser's preflight blocks fetch unless we opt in. Explicit origin, not "*", to stay
#     honest about who's calling (the build-plan decision). ------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:6173"],
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
# CLIENT-DRIVEN KICKOFF: the client (not the model) picks the first bank question via the
# next_question TOOL and presents its text verbatim — no model call needed to start. It also
# fetches the server-owned persona ONCE and stashes it for every turn's turn_agent.run, and
# initializes the question-spine state the client owns from here on.
# ===========================================================================
@app.post("/api/session")
async def start_session(req: StartRequest = StartRequest()) -> dict:
    # `= StartRequest()` makes the whole body OPTIONAL: a bodyless POST (or `{}`) starts
    # a default backend-engineer interview; passing {"role":..,"seniority":..} overrides.
    session_id = uuid.uuid4().hex[:8]

    # server owns the persona — fetched once here, replayed as `instructions` each turn
    pr = await interview_toolset.get_prompt(
        "behavioral_interview", {"role": req.role, "seniority": req.seniority}
    )
    persona = pr.messages[0].content.content   # PromptMessage -> TextContent -> .content

    # CLIENT picks the first question. direct_call_tool(name, args) runs a TOOL from client
    # code and returns its dict directly (unlike the agent-internal call_tool). This is the
    # move that makes the model unable to invent questions — it never selects one.
    nq = await interview_toolset.direct_call_tool(
        "next_question", {"role": req.role, "asked_ids": []}
    )
    if nq.get("status") != "ok":
        raise HTTPException(status_code=400, detail=f"no questions for role: {req.role}")
    q = nq["question"]

    # the question-spine state the CLIENT owns (relocated + extended from the old {persona,history})
    SESSIONS[session_id] = {
        "role": req.role,
        "persona": persona,
        "history": [],                 # accumulates from the first turn_agent.run onward
        "asked_ids": [q["id"]],        # bank questions already asked (feeds next_question)
        "current_qid": q["id"],        # the question the next answer belongs to
        "current_qtext": q["text"],    # kept so each turn's prompt can name the question
        "followups_used": 0,           # probes spent on the current question
        "max_followups": 3,            # backstop cap (not the throttle — the model's ask_followup
                                       # =false normally ends probing first). Clarifications don't
                                       # count toward this; only interviewer-initiated probes do.
    }
    # present the first question verbatim (short canned lead-in; the bank text is authoritative)
    return {"session_id": session_id, "message": f"Let's begin. {q['text']}", "done": False}


# ===========================================================================
# POST /api/answer : one turn of the CLIENT-DRIVEN loop.
# The control inversion of Phase 3.5 still holds (the browser is the loop, each fetch is one
# iteration) — but now the CLIENT owns the question spine, not the model. Each turn:
#   1. RECORD the answer under the id the client is tracking      (worked — the reliability win)
#   2. ask the model to REACT + decide whether to probe           (worked — turn_agent/TurnReply)
#   3. BRANCH on that decision: follow-up, advance, or end        (YOUR TODO)
# ===========================================================================
@app.post("/api/answer")
async def submit_answer(req: AnswerRequest) -> dict:
    sess = SESSIONS.get(req.session_id)
    if sess is None:
        raise HTTPException(status_code=404, detail="unknown session")

    # 1. DECIDE FIRST — the model classifies the message (clarification vs answer) and reacts.
    #    We must know the INTENT before recording, so a clarifying question never lands in the
    #    store as an answer. We say "message" (not "answer") so we don't pre-bias the model.
    #    output_type=TurnReply is set on turn_agent.
    prompt = (f"The current interview question is: {sess['current_qtext']}\n\n"
              f"The candidate's message: {req.text}")
    result = await turn_agent.run(
        prompt,
        instructions=sess["persona"],
        message_history=sess["history"],
        usage_limits=UsageLimits(request_limit=3),
    )
    sess["history"] = result.all_messages()
    decision = result.output          # TurnReply(is_clarification, reaction, followup, ask_followup)

    # 2. CLARIFICATION — the candidate asked ABOUT the question, didn't answer it. Clarify and
    #    STAY on the same question: do NOT record, do NOT advance, do NOT spend a follow-up.
    #    Clarifications are unbounded — the candidate can go back and forth as much as needed.
    if decision.is_clarification:
        return {"message": decision.reaction, "done": False}

    # 3. RECORD — it's a real answer, so log it under the id the CLIENT is tracking (current_qid).
    #    Correct BY CONSTRUCTION: the model never picked or labelled it, so it can't be mislabelled.
    await interview_toolset.direct_call_tool(
        "record_answer",
        {"session_id": req.session_id, "question_id": sess["current_qid"], "answer": req.text},
    )

    # 4. BRANCH. The reaction is ALWAYS shown; what follows it is the client's call — the probe
    #    (if following up), the next bank question (if advancing), or a closing (if exhausted).
    #    Crucially the ADVANCE/END paths use `reaction` ONLY, never `followup` — so a probe the
    #    model wanted but we can't grant (cap reached) is dropped instead of being shown next to
    #    the next question (the two-questions-in-one-turn bug).
    #
    #    (a) FOLLOW-UP — probe once more on the SAME question, if wanted AND under the cap.
    #        current_qid stays, so the next answer records under the SAME id and the scorecard's
    #        group-by-id logic combines the original + follow-up answers.
    if decision.ask_followup and sess["followups_used"] < sess["max_followups"]:
        sess["followups_used"] += 1
        return {"message": f"{decision.reaction}\n\n{decision.followup}", "done": False}

    #    (b) ADVANCE — the CLIENT pulls the next bank question (never the model).
    next_question = await interview_toolset.direct_call_tool(
        "next_question", {"role": sess["role"], "asked_ids": sess["asked_ids"]}
    )
    if next_question["status"] == "ok":
        q = next_question["question"]
        sess["current_qid"] = q["id"]
        sess["current_qtext"] = q["text"]
        sess["asked_ids"].append(q["id"])
        sess["followups_used"] = 0
        return {"message": f"{decision.reaction}\n\n{q['text']}", "done": False}

    #    (c) END — status "exhausted": the bank is done, so conclude.
    return {"message": f"{decision.reaction}\n\nThat's the end of the interview. "
                       f"Thank you for your time!", "done": True}


# --- TODO — normalize a follow-up's question_id back to its PARENT bank id. -----------
# WHY: the interviewer USUALLY logs a follow-up ANSWER under the parent's id (be-1), but it's
# not consistent — sometimes it invents a distinct id like "be-1-followup" (or "be-1-probe",
# "be-1-2", ...). Such an id (a) never resolves in the bank (question:// -> not_found, so the
# grade runs against "(unknown question)") and (b) escapes grouping, so the follow-up gets
# scored as its own stray entry instead of folding into its parent. Normalizing it back to the
# parent id before grouping fixes both.
#
# APPROACH (chosen over a literal "-followup" strip): anchor on the KNOWN-GOOD id set rather
# than guessing the suffix, so ANY invented suffix is caught. `valid_ids` is the set of real
# bank ids for this role (the endpoint builds it from questions://{role}).
#
# TODO — longest-prefix match against valid_ids:
#   - if question_id is itself a valid id, return it unchanged (the common case)
#   - otherwise find every valid id `vid` that question_id sits UNDER, at a boundary:
#         question_id == vid  or  question_id.startswith(vid + "-")
#     the `+ "-"` boundary is what stops "be-10-x" from matching "be-1" (its next char is "0",
#     not "-") — a plain substring/startswith without it would mis-collapse be-10 into be-1
#   - return the LONGEST match (max(matches, key=len)) so "be-10" wins over "be-1" when both fit
#   - if NOTHING matches (a truly unrecognizable id), return question_id unchanged — no worse
#     than today (it'll fall back to "(unknown question)"), never a crash
# Kept a PURE function (ids in, id out) so you can unit-test it with a hand-made set, no MCP.
def parent_question_id(question_id: str, valid_ids: set[str]) -> str:
    if question_id in valid_ids:
        return question_id
    matches = []
    for valid_id in valid_ids: 
        if question_id.startswith(valid_id + "-"):
            matches.append(valid_id)
    if matches:
        match = max(matches, key=len)
        return match
    return question_id



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

    # 3. TODO — GROUP turns by question_id, then grade ONCE per question (the follow-up fix).
    #
    #    THE BUG you're fixing: a follow-up question isn't a bank question — it has no id — so
    #    the interviewer logs the follow-up ANSWER under the ORIGINAL question_id. One
    #    question_id can therefore own SEVERAL turns (the original answer + each follow-up
    #    answer). The old per-turn loop graded each turn independently, which (a) graded a
    #    follow-up answer against the ORIGINAL question text — the wrong question — and (b)
    #    double-counted a question-with-follow-ups in the averages. The fix: treat a question
    #    plus its follow-ups as ONE exchange and grade it ONCE — how a real interviewer forms a
    #    single assessment per topic after probing it. Pure scorecard-side change (record_answer
    #    is untouched), and it corrects existing session files retroactively.

    answers: list[dict] = []
    grades = []
    #    The KNOWN-GOOD id set for this role — parent_question_id normalizes each turn's
    #    (possibly invented) id against it. Read the whole question list through MCP, same
    #    unwrap as the other resources; build a set of just the ids.
    qlist = json.loads(await interview_toolset.read_resource(f"questions://{req.role}"))
    valid_ids = {q["id"] for q in qlist["questions"]} if qlist.get("status") == "ok" else set()

    #    NOTE: group by the PARENT id (parent_question_id) so an invented "be-1-followup"
    #    folds into "be-1" instead of becoming its own unknown-question entry.
    grouped: dict[str, list[str]] = {}
    for turn in turns:
        parent_id = parent_question_id(turn["question_id"], valid_ids)
        grouped.setdefault(parent_id, []).append(turn["answer"])
    for question_id, answer_list in grouped.items():
        question = json.loads(await interview_toolset.read_resource(f"question://{question_id}"))
        question_text = question["question"]["text"] if question.get("status") == "ok" else "(unknown question)"
        first, followups = answer_list[0], answer_list[1:]
        combined = first
        if followups:
            combined += " (the following text is follow-up) " + "\n\n".join(followups)
        grade = await grade_one(interview_toolset, question_text, combined, rubric_text)
        grades.append(grade)
        answers.append({"question_id": question_id, "question_text": question_text, **grade.model_dump()})


    # 4. aggregate the per-answer grades into headline numbers (deterministic Python — the
    #    LLM already judged; this just averages). 
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

