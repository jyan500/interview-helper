"""The FastAPI backend 

Concept (unchanged since Phase 3.5): a web UI is the SAME kind of edge adapter as audio.
The agent, the tools, the templates are byte-for-byte the ones you already built — we just
put an HTTP boundary on the two ends of the loop instead of a terminal (or a mic).

PHASE A CHANGED TWO THINGS HERE.

1. THE STATE MOVED OUT OF THE PROCESS.

    Phase 3.5:   SESSIONS[session_id] = {history, persona, current_qid, ...}   # a dict
    Phase A:     the `interviews` row in Postgres                              # a table

   Phase 3.5 relocated the terminal loop's `history` local var into a module-level dict —
   that was the lesson then (control inverts; state lives behind the HTTP boundary). But a
   dict dies on restart and is invisible to a second process, so it survives neither a deploy
   nor horizontal scale. Phase A finishes the move: every turn now does

        load_interview_state(iid)  ->  turn_agent.run(...)  ->  save_interview_state(iid, ...)

   with NO process-local state at all. Any instance can serve any request, a restart
   mid-interview loses nothing, and "resume an interview later" (Phase C) falls out free.

   Deliberately NOT added: an in-memory write-through cache. The DB round-trip is noise next
   to the LLM call, so a cache would buy invalidation bugs and nothing else. If turn latency
   ever matters, Redis goes IN FRONT of this same Postgres-as-truth design — nothing here is
   thrown away.

2. THIS BACKEND STOPPED BEING AN MCP CLIENT OF ITS OWN SERVER.

   Every question and answer used to travel `direct_call_tool(...)` / `read_resource(...)` —
   a stdio round-trip to a subprocess, plus a `json.loads` to undo the serialization, to
   reach Python functions in this same repo. That indirection was EARNED in Phase 3, when the
   MODEL called those tools: MCP is how a model reaches a capability. The client-driven
   rewrite took that away — the model calls nothing now, so there was no model on the other
   side of the transport. Direct imports below.

   `mcp_server.py` is untouched and still runs: it's the surface for OTHER people's clients
   (Claude Desktop, `mcp_client_demo.py`, `--list`), which is what an MCP server is actually
   for. Same bodies, same templates, different door.

VOCABULARY (Phase A rename): what the app conducts is an INTERVIEW. "Session" now means
exactly one thing — a SQLAlchemy DB session, always the variable `db`, and it never appears
in this file. So: `interview_id` on the wire, `POST /api/interview`.

PHASE B ADDS ONE WORD TO EVERY ROUTE: `Depends(require_user)`.

   Phase A:  POST /api/answer  ->  load the row, run the turn, write it back
   Phase B:  POST /api/answer  ->  verify the JWT -> load the row -> IS IT THIS USER'S? ->
                                   run the turn, write it back

   Two separate questions, and it's worth keeping them separate in your head because they
   fail with different status codes:

       AUTHENTICATION (401) — who is calling? Answered by the signature on the token,
           in auth.py, before the route body runs at all.
       AUTHORIZATION (403) — may they touch THIS row? Answered by comparing the
           interview's `profile_id` to that user id, INSIDE the route, after the load.

   A route that does the first and forgets the second is the classic broken-access-control
   bug: everyone is a real user, and every real user can read everyone else's interviews by
   changing an id. `interview_id` being an unguessable uuid slug is not a defence — it's an
   obscurity that Phase C's History list will hand out on a plate.

   RLS on the Supabase tables is a SECOND line of defence, not this one: our backend
   connects as the `postgres` role, which bypasses RLS, so the check that actually protects
   your users today is the one in this file.

Run (from server/) — the FastAPI CLI auto-detects `app` and enables reload:
    .venv/Scripts/fastapi.exe dev api.py
Smoke-test with curl (no browser needed — prove the backend before the React side):
    curl -X POST localhost:8000/api/interview
    curl -X POST localhost:8000/api/answer -H "Content-Type: application/json" \\
         -d '{"interview_id":"<id-from-above>","text":"my answer"}'
Then prove the point of the whole phase: Ctrl-C the server mid-interview, start it again,
and POST another answer to the SAME interview_id. It keeps going.
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from openai import AsyncOpenAI
from pydantic import BaseModel
# pydantic-ai owns the shape of `message_history`, so it also owns the (de)serialization.
# Never hand-roll it: dump_python(msgs, mode="json") out, validate_python(raw) back in.
# (Verified against pydantic-ai 2.13.0 — the repo's "check live API shapes" rule.)
from pydantic_ai.messages import ModelMessagesTypeAdapter
from pydantic_ai.usage import UsageLimits

# The GRADER (a second agent + typed output) and the TURN agent. Separate jobs: the
# interviewer conducts, the grader scores. See grading.py for the output_type idea.
# Importing this also imports pydantic_agent, whose module-level load_dotenv is what puts
# GEMINI_API_KEY / OPENAI_API_KEY in the environment for this process.
from grading import aggregate, grade_one, turn_agent

# --- THE DATA LAYER + THE TEMPLATES, imported directly (see point 2 above). ------------
# Note the asymmetry, and that it's intentional: `record_answer` is a legitimate interview
# ACTION and stays registered as an MCP tool for external clients, while `create_interview`
# and the two state functions are backend bookkeeping that no model should ever reach. That
# line lives in mcp_server.py. From in here, they're all just functions.
from prompts import behavioral_interview
# Phase B — identity. `require_user` turns the Authorization header into a user id (or 401);
# `require_ownership` is the second, separate question (403). See auth.py.
from auth import require_ownership, require_user
from db.engine import engine
from tools.interview import (
    create_interview,
    get_interview,
    get_scorecard,
    list_interviews,
    load_interview_state,
    open_turn,
    record_answer,
    save_interview_state,
    save_scorecard,
)
from tools.questions import get_question, get_rubric, next_question


# --- LIFESPAN: the terminal loop opened `async with agent:` ONCE and ran the whole
#     conversation inside it, and until Phase A this block did the same to keep the MCP
#     subprocess alive across requests. There's no subprocess to hold open now — what has a
#     lifetime worth managing is the DB CONNECTION POOL, so shutdown closes it cleanly
#     instead of dropping sockets on Supabase's floor. (The pool itself is created lazily at
#     import; see db/engine.py for what a pool actually is.) ------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    yield                       # ...app serves requests here...
    await engine.dispose()      # close every pooled connection on shutdown


app = FastAPI(lifespan=lifespan)

# --- CORS: the Vite dev server (:6173) and this API (:8000) are different origins, so the
#     browser's preflight blocks fetch unless we opt in. Explicit origin, not "*", to stay
#     honest about who's calling. (Phase G makes this env-driven for the Vercel origin.) ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:6173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- request bodies. FastAPI validates+parses these from the JSON payload automatically.
class StartRequest(BaseModel):
    role: str = "backend-engineer"
    # the client's word for it. It's the `levels.slug` in the DB and the `seniority` argument
    # of the behavioral_interview template — one concept, two established names.
    seniority: str = "mid"


class AnswerRequest(BaseModel):
    interview_id: str
    text: str


class ScorecardRequest(BaseModel):
    interview_id: str
    role: str = "backend-engineer"   # which rubric to grade against (matches the interview)


# ===========================================================================
# WORKED EXAMPLE — POST /api/interview : start an interview, get the first question.
#
# CLIENT-DRIVEN KICKOFF (unchanged): the client (not the model) picks the first bank question
# and presents its text verbatim — no model call needed to start. That's the move that makes
# the model unable to invent questions: it never selects one.
#
# WHAT'S NEW: the `SESSIONS[session_id] = {...}` line became an INSERT plus an UPDATE. Two
# steps, not one, because the persona and the first question come from different places —
# and the row is deliberately valid in between (current_question_id is nullable exactly so
# this gap is legal). Note there's no `history` key to initialize: `message_history` defaults
# to [] on the model.
#
# PHASE B — this is also the WORKED EXAMPLE for auth, and the only route where authentication
# is the WHOLE story: there's no existing row to own yet, so there is nothing to authorize.
# The user id it captures here is what makes every OTHER route's ownership check possible.
# ===========================================================================
@app.post("/api/interview")
async def start_interview(
    req: StartRequest = StartRequest(),
    user_id: str = Depends(require_user),
) -> dict:
    # `= StartRequest()` makes the whole body OPTIONAL: a bodyless POST (or `{}`) starts
    # a default backend-engineer interview; passing {"role":..,"seniority":..} overrides.
    #
    # `Depends(require_user)` is not a parameter the CLIENT can send — FastAPI sees the
    # dependency and resolves it from the Authorization header instead of the body, before
    # this function is entered. So by line one, `user_id` is a verified auth uid or the
    # caller already got a 401 and this code never ran. (It doesn't appear in the OpenAPI
    # request body either; it shows up as a security scheme in /docs.)

    # the server still owns the persona — one definition, in prompts.py. Built once here and
    # STORED on the row, then replayed as `instructions` every turn. Storing it (rather than
    # rebuilding per turn) keeps the interviewer's character stable even if the template is
    # edited mid-interview.
    persona = behavioral_interview(role=req.role, seniority=req.seniority)

    # INSERT the row. create_interview mints the slug (the id the client holds) and resolves
    # the role/level slugs — an unknown one comes back as an envelope, not an exception.
    #
    # `profile_id=user_id` is the join that makes the whole phase real: this row now belongs
    # to somebody. The column has been sitting there nullable since Phase A waiting for it,
    # and `profiles.id` IS the auth uid, so the value goes straight in with no lookup — the
    # payoff for breaking the surrogate-key convention on that one table.
    created = await create_interview(req.role, req.seniority, persona, profile_id=user_id)
    if not created["ok"]:
        raise HTTPException(status_code=400, detail=created["error"])
    interview_id = created["interview_id"]

    # the CLIENT picks the first question...
    nq = await next_question(req.role, asked_ids=[])
    if nq.get("status") != "ok":
        raise HTTPException(status_code=400, detail=f"no questions for role: {req.role}")
    q = nq["question"]

    # ...and writes it onto the row. From here on, "which question is on the table" is a
    # column, not a dict key — which is why a restart can't lose the candidate's place.
    await save_interview_state(interview_id, current_qid=q["id"], followups_used=0)

    # OPEN the first turn: the question has been PRESENTED, no answer yet. This is the turn the
    # candidate's first /api/answer will complete. Opening it here (rather than at answer time)
    # is what lets the transcript record the exact prompt shown — see the Turn docstring.
    await open_turn(interview_id, q["id"], q["text"])

    # present the first question verbatim (short canned lead-in; the bank text is authoritative)
    return {"interview_id": interview_id, "message": f"Let's begin. {q['text']}", "done": False}


# ===========================================================================
# POST /api/answer : one turn of the CLIENT-DRIVEN loop — now LOAD -> RUN -> WRITE BACK.
#
# The Phase 3.5 control inversion still holds (the browser is the loop, each fetch is one
# iteration) and the client still owns the question spine, not the model. What changed is
# where the spine LIVES between iterations: Postgres, re-read at the top of every request.
#
#   1. LOAD    the spine + the agent's replay buffer from the row     (worked)
#   2. DECIDE  — the model reacts + flags whether to probe            (worked)
#   3. RECORD  the answer under the id the CLIENT is tracking         (worked)
#   4. BRANCH  — follow-up / advance / end, each WRITING BACK         (one worked, three TODO)
#
# THE RULE THAT MAKES IT CORRECT: *every* exit path must write `message_history` back. The
# dict version never had to think about this — mutating `sess["history"]` WAS the save. Now a
# `return` that skips save_interview_state silently discards the turn the model just spent
# tokens on, and the next request replays a conversation missing its last exchange. That's
# the one new failure mode of this design, and the clarification branch is where it's easiest
# to miss — which is why that's the worked one.
#
# the route where BOTH questions get asked:
#   - add `user_id: str = Depends(require_user)` to the signature (copy /api/interview's)
#   - right after the load, before anything else:
#         require_ownership(state["profile_id"], user_id)
#     which needs load_interview_state to start returning `profile_id` — do that first, in
#     tools/interview.py.
#   ORDER MATTERS: authorize BEFORE the turn_agent.run call, not after. The LLM call is the
#   expensive part of this route, so checking first means a stranger's request costs you one
#   indexed SELECT instead of tokens.
# ===========================================================================
@app.post("/api/answer")
async def submit_answer(
    req: AnswerRequest,
    user_id: str = Depends(require_user)
) -> dict:
    # 1. LOAD — replaces `SESSIONS.get(req.session_id)`. Same guard, realer 404: a row either
    #    exists or it doesn't (the JSON store used to invent an empty one for a bad id).
    state = await load_interview_state(req.interview_id)
    if not state["ok"]:
        raise HTTPException(status_code=404, detail="unknown interview")

    require_ownership(state["profile_id"], user_id)

    if state["done"]:
        # a finished interview is not a place to put another answer. Cheap to enforce now
        # that `done` is a column somebody else can read — it wasn't, when it was a dict key
        # that vanished with the process.
        raise HTTPException(status_code=409, detail="this interview is already finished")

    if not req.text.strip():
        # Reject a blank BEFORE the LLM call: it would otherwise close the open turn with "" and
        # spend tokens on nothing. The open turn stays open, so the candidate just answers again.
        # (PRODUCT choice, not a null-safety one — "" is a valid non-NULL answer as far as the
        # schema cares; drop this guard if a blank should count as an "I don't know".)
        raise HTTPException(status_code=400, detail="answer must not be empty")

    #    message_history comes back RAW (plain JSON out of JSONB) — tools/interview.py has no
    #    business importing pydantic-ai. Rehydrating it into real message objects is THIS
    #    layer's job, and it's the exact inverse of the dump on the way out.
    history = ModelMessagesTypeAdapter.validate_python(state["message_history"] or [])

    # 2. DECIDE FIRST — the model classifies the message (clarification vs answer) and reacts.
    #    We must know the INTENT before recording, so a clarifying question never lands in the
    #    store as an answer. We say "message" (not "answer") so we don't pre-bias the model.
    #    output_type=TurnReply is set on turn_agent.
    prompt = (f"The current interview question is: {state['current_qtext']}\n\n"
              f"The candidate's message: {req.text}")
    result = await turn_agent.run(
        prompt,
        instructions=state["persona"],
        message_history=history,
        usage_limits=UsageLimits(request_limit=3),
    )
    decision = result.output      # TurnReply(is_clarification, reaction, followup, ask_followup)
    #    Dump ONCE, here; every branch below writes this same value. mode="json" is what makes
    #    it asyncpg/JSONB-safe (plain dicts, ISO strings) — without it you'd hand the driver
    #    datetimes and pydantic objects it can't encode.
    new_history = ModelMessagesTypeAdapter.dump_python(result.all_messages(), mode="json")

    # 3. CLARIFICATION — the candidate asked ABOUT the question, didn't answer it. Clarify and
    #    STAY on the same question: do NOT record, do NOT advance, do NOT spend a follow-up.
    #    Clarifications are unbounded — the candidate can go back and forth as much as needed.
    #
    #    WORKED EXAMPLE of the write-back rule: nothing about the SPINE changed here, and it's
    #    still not a free `return` — the conversation grew, so the history must be persisted
    #    or the model forgets it ever clarified. "No state change" and "no write" stopped
    #    being the same thing the moment the state became a row.
    if decision.is_clarification:
        await save_interview_state(req.interview_id, message_history=new_history)
        return {"message": decision.reaction, "done": False}

    # 4. RECORD — it's a real answer, so COMPLETE the open turn (the one presented last, either
    #    the bank question at start/advance or the probe we opened in the follow-up branch).
    #    record_answer finds it by `answer IS NULL`; `current_qid` is passed as the guard that
    #    the open turn is for the question the client thinks it's answering. Correct BY
    #    CONSTRUCTION: the model never picked or labelled the question, so it can't be
    #    mislabelled, and the FK means an id that isn't a question can't reach the table.
    await record_answer(req.interview_id, state["current_qid"], req.text)

    # 5. BRANCH. The reaction is ALWAYS shown; what follows it is the client's call — the probe
    #    (if following up), the next bank question (if advancing), or a closing (if exhausted).
    #    Crucially the ADVANCE/END paths use `reaction` ONLY, never `followup` — so a probe the
    #    model wanted but we can't grant (cap reached) is dropped instead of being shown next to
    #    the next question (the two-questions-in-one-turn bug).
    #
    #    (a) FOLLOW-UP — probe once more on the SAME question, if wanted AND under the cap.
    #        current_qid stays put, so the next answer records under the SAME id and the
    #        scorecard's group-by-id logic combines the original + follow-up answers.
    #
    #    the write-back. Two fields move: the incremented `followups_used` and
    #      `new_history`. `current_qid` is deliberately NOT passed — save_interview_state reads
    #      None as "don't touch this column", so OMITTING a field is how you say "unchanged".
    #      One call, one UPDATE, one transaction: the spine can't end up out of step with the
    #      history sitting beside it in the same row.
    if decision.ask_followup and state["followups_used"] < state["max_followups"]:
        followups_used = state["followups_used"] + 1
        await save_interview_state(req.interview_id, followups_used=followups_used, message_history=new_history)
        # OPEN the next turn — the probe, filed under the SAME parent question (current_qid), so
        # the transcript stores the probe's text while the scorecard still groups it with the
        # original. Opened AFTER the answer above closed the prior turn (complete-then-open),
        # so the one-open-turn index is never violated.
        await open_turn(req.interview_id, state["current_qid"], decision.followup)
        return {"message": f"{decision.reaction}\n\n{decision.followup}", "done": False}

    #    (b) ADVANCE — the CLIENT pulls the next bank question (never the model).
    #        `asked_ids` is no longer a list we append to and hope stays right: load_interview_state
    #        DERIVES it from the turns + the current question every time, so it can't drift.
    nq = await next_question(state["role"], asked_ids=state["asked_ids"])
    if nq["status"] == "ok":
        q = nq["question"]
        # write back: `current_qid=q["id"]`, `followups_used=0` (the probe budget is
        #   per question, so a new question resets it), and `message_history=new_history`.
        #   Note what you DON'T write: `current_qtext` and `asked_ids` were dict keys with no
        #   column behind them — the text is read through `current_question.text` and the
        #   asked set is derived. Copies you have to keep in sync are exactly the bug class
        #   the normalized schema deleted.
        #
        # explicit transition so a NEW bank question can't be misread as a follow-up. The
        # CLIENT owns this marker (the model never announces "moving on" — it can't, it doesn't
        # know a new question is coming), so it's consistent regardless of the reaction's wording.
        await save_interview_state(req.interview_id, current_qid=q["id"], followups_used=0, message_history=new_history)
        # OPEN the next turn for the new bank question. This is INSIDE the `status == "ok"`
        # block on purpose: if the bank were exhausted we'd never get here, we'd fall to the END
        # branch below — so the interview ends with its last turn COMPLETED and no dangling open
        # turn. (That's what keeps a finished interview at zero open turns.)
        await open_turn(req.interview_id, q["id"], q["text"])
        return {"message": f"{decision.reaction}\n\nLet's move on to the next question. {q['text']}",
                "done": False}

    #    (c) END — status "exhausted": the bank is done, so conclude.
    #    write back `done=True` and `message_history=new_history`. Leave `current_qid`
    #      alone: it keeps pointing at the last question asked, which is fine precisely because
    #      every reader checks `done` first (the contract save_interview_state documents). This
    #      is also the flag that makes the 409 guard at the top of this function work.
    await save_interview_state(req.interview_id, message_history=new_history, done=True)
    return {"message": f"{decision.reaction}\n\nThat's the end of the interview. "
                       f"Thank you for your time!", "done": True}


# ===========================================================================
# WORKED EXAMPLE — POST /api/transcribe : the robust-STT INPUT edge adapter, server side.
#
# THE THESIS, ONE MORE TIME: the browser's built-in Web Speech API was swapped for a pipeline
# we own — capture in the browser, transcribe HERE. The interview loop above never learns
# which STT produced the text; `record_answer`, the agent, the transcript are all untouched.
# This route is the entire server-side cost of that swap: audio bytes in, text out.
#
# Why CLOUD Whisper (OpenAI) and not self-hosted faster-whisper? Deployability. Self-hosting
# means a GPU (or slow CPU), a multi-GB model in RAM, and a concurrency queue. Proxying one
# HTTP call to OpenAI keeps THIS server a thin, deploy-friendly relay — same $/min tradeoff
# an interview coach happily makes. The seam is identical either way (that's the point): the
# body of this function is the ONLY thing that would change to go self-hosted.

# Lazy singleton: AsyncOpenAI() reads OPENAI_API_KEY from the env (loaded by pydantic_agent's
# load_dotenv, which grading.py's import chain triggers). Built on first use, not at module
# load, so the app still boots for the text-only flow if the key isn't set yet — you only hit
# the error when you actually transcribe. AsyncOpenAI so the call `await`s without blocking
# the event loop.
_openai_client: AsyncOpenAI | None = None


def get_openai_client() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        if not os.environ.get("OPENAI_API_KEY"):
            raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not set in server/.env")
        _openai_client = AsyncOpenAI()
    return _openai_client


# add `user_id: str = Depends(require_user)` here too, and note this one is
# NOT about protecting data: there's no row and no owner, so there's nothing to authorize.
# It's about protecting your WALLET. An open transcribe endpoint is a stranger's free
# Whisper account billed to your OPENAI_API_KEY, found by anyone who scans your deployed
# origin. Any route that spends money on someone's behalf needs to know whose behalf.
# (`user_id` will be unused in the body — that's fine and normal for a gate. Once Phase F
# adds /api/tts, it gets the same treatment for the same reason.)
@app.post("/api/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    user_id: str = Depends(require_user)
) -> dict:
    # The browser records ONE utterance (MediaRecorder -> a webm/opus Blob) and POSTs it as
    # multipart form-data under the field name "audio". FastAPI hands it to us as an UploadFile.
    data = await audio.read()

    if len(data) == 0:
        return {"text": ""}

    megabytes = len(data) / (1024**2)   # data is bytes -> len() IS the payload size in bytes
    if megabytes > 10:
        raise HTTPException(status_code=413, detail="Audio file is too large to transcribe")

    # Whisper's file arg takes a (filename, bytes, content_type) tuple. The filename's extension
    # is how the API infers the container, so keep the browser's (e.g. "answer.webm").
    result = await get_openai_client().audio.transcriptions.create(
        model="whisper-1",   # cheap + solid ($0.006/min). gpt-4o-transcribe is the pricier upgrade.
        file=(audio.filename or "answer.webm", data, audio.content_type or "audio/webm"),
        language="en"
    )

    # Same shape the client's onResult(text) expects — mirrors the Web Speech path's output.
    return {"text": result.text}


# ===========================================================================
# WORKED EXAMPLE — POST /api/scorecard : grade the whole interview, return a scorecard.
#
# The END-OF-INTERVIEW PASS. It does NOT touch the conversational loop above — it reads what
# that loop already RECORDED (record_answer -> the `turns` table) and grades it separately.
# That decoupling is the design: the interviewer conducts, this grades.
#
# PHASE A DELETION: the `parent_question_id` normalizer that used to sit above this route is
# gone, along with the `questions://{role}` fetch that fed it. It existed because the MODEL
# logged follow-up answers under invented ids like "be-1-followup", which resolved to nothing
# and escaped grouping. Two changes killed that bug at the source — the CLIENT owns
# `current_qid`, and `turns.question_id` is a real FK — so there are no invalid ids left to
# normalize. Deleting a workaround because the thing it worked around became impossible is
# the good kind of cleanup.
#
# GROUPING STAYS, for a different reason: a question plus its follow-ups is still several
# turns under ONE id, and still deserves one grade.
# ===========================================================================
# the same pair as /api/answer, and the one where forgetting the ownership
# check leaks the most: this route returns somebody's entire transcript, question by question.
#   - `user_id: str = Depends(require_user)` on the signature
#   - after the get_interview load: require_ownership(interview["profile_id"], user_id)
#     (so get_interview must return `profile_id` too — see tools/interview.py)
# ===========================================================================
@app.post("/api/scorecard")
async def scorecard(
    req: ScorecardRequest,
    user_id: str = Depends(require_user)
) -> dict:
    # 1. the recorded transcript (written by record_answer during the interview)
    interview = await get_interview(req.interview_id)
    if interview.get("status") != "ok":
        raise HTTPException(status_code=404, detail="unknown interview")
    require_ownership(interview["profile_id"], user_id)
    turns = interview.get("turns", [])
    if not turns:
        # the interview exists but nothing was recorded — a thin store is a real dependency of
        # grade-at-end. Note this is a distinction the JSON store COULDN'T make: a missing file
        # and an empty one looked identical.
        raise HTTPException(status_code=404, detail="no recorded answers for this interview")

    # 2. the rubric for this role (dimensions + a human-readable text to hand the grader)
    rubric_env = await get_rubric(req.role)
    if rubric_env.get("status") != "ok":
        raise HTTPException(status_code=404, detail=f"unknown role: {req.role}")
    dimensions = rubric_env["rubric"]["dimensions"]
    rubric_text = f"Dimensions: {'; '.join(dimensions)}. {rubric_env['rubric']['scale']}"

    # 3. GROUP turns by question_id, then grade ONCE per question.
    #    A follow-up isn't a bank question — it has no id of its own — so its answer is recorded
    #    under the ORIGINAL question_id (the client never moves `current_qid` while probing).
    #    One question_id therefore owns SEVERAL turns. Grading per TURN would score a follow-up
    #    answer against the original question text AND double-count that question in the
    #    averages. Treating a question plus its probes as one exchange is also just how a real
    #    interviewer works: probe, then form a single assessment of the topic.
    answers: list[dict] = []
    grades = []
    grouped: dict[str, list[str]] = {}
    for turn in turns:
        # skip the OPEN turn (answer is None): a question that was presented but not answered
        # yet. A finished interview has none, but grading a still-running one would otherwise try
        # to score a NULL answer. NULL only — an empty-string answer is still a (blank) answer.
        if turn["answer"] is None:
            continue
        grouped.setdefault(turn["question_id"], []).append(turn["answer"])

    for question_id, answer_list in grouped.items():
        question = await get_question(question_id)
        question_text = (question["question"]["text"] if question.get("status") == "ok"
                         else "(unknown question)")
        first, followups = answer_list[0], answer_list[1:]
        combined = first
        if followups:
            combined += " (the following text is follow-up) " + "\n\n".join(followups)
        grade = await grade_one(question_text, combined, rubric_text)
        grades.append(grade)
        answers.append({"question_id": question_id, "question_text": question_text,
                        **grade.model_dump()})

    # 4. aggregate the per-answer grades into headline numbers (deterministic Python — the LLM
    #    already judged; this just averages).
    agg = aggregate(grades, dimensions)

    # 5. (Phase C) PERSIST the grade as rows so it OUTLIVES this request — the whole reason the
    #    History view can show a past interview's score without re-grading (re-paying, and
    #    getting a different number, since the model isn't deterministic). `answers` already
    #    carries exactly what save_scorecard reads. Persist AFTER computing, but the ownership
    #    check that guards this write ran back at the top (require_ownership above), so a
    #    stranger never reaches here. Idempotent: a second /api/scorecard replaces the row.
    saved = await save_scorecard(req.interview_id, agg["overall"], answers)
    if not saved["ok"]:
        # the grade was computed but couldn't be stored — surface it rather than pretend it
        # was remembered. (A role with no rubric is the realistic cause; see save_scorecard.)
        raise HTTPException(status_code=500, detail=f"could not save scorecard: {saved['error']}")

    return {
        "interview_id": req.interview_id,
        "role": req.role,
        "answers": answers,
        "dimension_averages": agg["dimension_averages"],
        "overall": agg["overall"],
    }


# ===========================================================================
# WORKED EXAMPLE — GET /api/interviews : the signed-in user's own interview history.
#
# NAMING (a deliberate choice, not the build plan's literal wording): Phase C's section was
# drafted before Phase A renamed *session -> interview* across the whole wire contract
# (`POST /api/interview`, `interview_id`). "One word for one thing" wins, so these are
# /api/interviews, not the plan's older /api/sessions. Same rows, consistent vocabulary.
#
# WHY THIS IS A GET (and a plain function, no request body): it's a cacheable READ of existing
# rows, the HTTP mirror of an MCP *resource* vs a tool — same instinct as queries-vs-mutations
# on the frontend. Nothing is created.
#
# THE ONE SECURITY LINE THAT MATTERS: the list is scoped by the VERIFIED uid from the token
# (`user_id`), passed straight into the WHERE clause in list_interviews. There is no id in the
# request for an attacker to tamper with — "my history" can't be widened to "someone else's"
# because the only identity in play is the one auth.py proved. That's why this route needs no
# separate require_ownership call: the ownership IS the query.
# ===========================================================================
@app.get("/api/interviews")
async def my_interviews(user_id: str = Depends(require_user)) -> dict:
    result = await list_interviews(user_id)
    return {"interviews": result["interviews"]}


# ===========================================================================
# GET /api/interviews/{interview_id} : one past interview — its transcript AND its grade.
#
# This is the History DETAIL view's data: the recorded turns (get_interview, which already
# backs the interview:// resource) plus the persisted scorecard (get_scorecard). Reusing
# get_interview here is the payoff of it returning `profile_id` since Phase B — the SAME load
# both reads the transcript and answers "may this caller see it?".
#
# GUARD ORDER, same as everywhere: exists (404) -> owns (403). The scorecard read comes AFTER
# ownership, so a stranger never learns whether an interview was even graded.
#
# ===========================================================================
@app.get("/api/interviews/{interview_id}")
async def interview_detail(
    interview_id: str,
    user_id: str = Depends(require_user),
) -> dict:
    interview = await get_interview(interview_id)
    if interview.get("status") != "ok":
        raise HTTPException(status_code=404, detail="unknown interview")
    require_ownership(interview["profile_id"], user_id)

    card = await get_scorecard(interview_id)
    return {
        "interview_id": interview["interview_id"],
        "turns": interview["turns"],
        "summary": interview["summary"],
        # null until this interview has been graded (or until get_scorecard is implemented).
        "scorecard": card if card.get("status") == "ok" else None,
    }
