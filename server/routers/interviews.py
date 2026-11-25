"""Interview routes: the turn loop (start -> answer -> final answer), grading, history and resume.

Every turn is load_interview_state -> turn_agent.run -> commit_turn, with no process-local state (see
api.py's module docstring for why), and every route checks exists (404) -> owns (403) before it spends
anything.
"""
from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, Depends, HTTPException
from fastapi_pagination import Params
from pydantic import BaseModel
# pydantic-ai owns the shape of `message_history`, so it also owns the (de)serialization.
# Never hand-roll it: dump_python(msgs, mode="json") out, validate_python(raw) back in.
# (Verified against pydantic-ai 2.13.0 — the repo's "check live API shapes" rule.)
from pydantic_ai.exceptions import AgentRunError
from pydantic_ai.messages import ModelMessagesTypeAdapter
from pydantic_ai.usage import UsageLimits

# The GRADER (a second agent + typed output) and the TURN agent. Separate jobs: the
# interviewer conducts, the grader scores. See grading.py for the output_type idea.
# Importing this also imports pydantic_agent, whose module-level load_dotenv is what puts
# GEMINI_API_KEY / OPENAI_API_KEY in the environment for this process.
from grading import AnswerGrade, aggregate, grade_one, turn_agent
# Interview simulation — the round generator.
from simulation import generate_round
from prompts import behavioral_interview, simulation_interview
# Phase B — identity. `require_user` turns the Authorization header into a user id (or 401);
# `require_ownership` is the second, separate question (403). See auth.py.
from auth import require_ownership, require_user
from tools.interview import (
    commit_turn,
    create_interview,
    get_interview,
    get_resumable_interview,
    get_scorecard,
    list_interviews,
    list_recent_round_questions,
    load_grading_context,
    load_interview_state,
    load_resume_payload,
    save_interview_state,
    save_open_turn_diagram,
    save_scorecard,
)
from tools.background import format_candidate_background
from tools.custom_questions import claim_job_question, claimed_question_slugs
from tools.rounds import get_round_type_by_slug
from tools.questions import get_question
# Per-stage latency lines for the voice pipeline (transcribe, answer, tts), gated behind PERF_LOG=1.
from perf import log_perf
# The system-design diagram canvas: the validated wire shape and its text form for the LLMs.
from diagram import DiagramDoc, serialize_diagram, serialize_stored
from routers.common import envelope_result, owned_job
from routers.questions import QuestionOut

router = APIRouter(tags=["interviews"])


# The time limits offered at kickoff, in minutes (the SPA's TIME_LIMIT_OPTIONS mirrors these).
TIME_LIMIT_MINUTES = {15, 30, 45, 60}


# --- request bodies. FastAPI validates+parses these from the JSON payload automatically.
class StartRequest(BaseModel):
    role: str = "backend-engineer"
    # the client's word for it. It's the `levels.slug` in the DB and the `seniority` argument
    # of the behavioral_interview template — one concept, two established names.
    seniority: str = "mid"
    # INTERVIEW SIMULATION — a saved job's slug + a round_types slug, sent together. When set, the
    # job supplies role + level (role/seniority above are ignored) and the round is GENERATED.
    job: str | None = None
    round: str | None = None
    # TIMED INTERVIEW — the limit picked at kickoff, in minutes (one of TIME_LIMIT_MINUTES), or None
    # for untimed. Frozen on the row; the clock runs only during the candidate's turns.
    time_limit_minutes: int | None = None


# What one candidate turn sends: shared by /api/answer and /api/interviews/{id}/final-answer.
class AnswerBody(BaseModel):
    text: str
    # A coding round's editor contents, sent with the turn when they changed. Appended to `text` as
    # a fenced block, so the model and the transcript both see the code. Nothing is executed.
    code: str | None = None
    language: str | None = None
    # A system-design question's canvas, sent with the turn when it changed (layout moves included,
    # so the stored positions stay current). Validated here (size caps, real edge endpoints), stored
    # on the open turn, and shown to the model as diagram.serialize_diagram text, never as JSON.
    diagram: DiagramDoc | None = None
    # A timed interview's clock: how long this turn was the CANDIDATE'S (the client measures it, and
    # stops it while the answer is transcribed or the interviewer thinks or speaks). Ignored when untimed.
    turn_ms: int | None = None


class AnswerRequest(AnswerBody):
    interview_id: str


class ScorecardRequest(BaseModel):
    interview_id: str
    # IGNORED — the rubric is chosen from the interview ROW (its round for a simulation, else its
    # role). Kept optional so older clients that still send it don't 422.
    role: str | None = None


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
@router.post("/interview")
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
    #
    # THE PERSONA IS BUILT FROM THE PLAN'S QUESTION KINDS, which don't exist until create_interview
    # materializes the plan, so a BUILDER is handed down and create_interview calls it with them. Each
    # kind brings its own guidance (QuestionType.interviewer_guidance), the same in Practice and Job
    # interviews, so a coding question is probed the same way in both.
    role, seniority = req.role, req.seniority
    # a timed interview's limit must be one the picker offers (checked before any paid generation)
    if req.time_limit_minutes is not None and req.time_limit_minutes not in TIME_LIMIT_MINUTES:
        raise HTTPException(status_code=400, detail=f"unknown time limit: {req.time_limit_minutes} minutes")
    time_limit_seconds = req.time_limit_minutes * 60 if req.time_limit_minutes is not None else None
    # THE CANDIDATE'S BACKGROUND (Profile page roles/projects/skills), read once, as prompt text ("" when
    # they've filled in nothing, and every template then leaves its paragraph out). FROZEN with the
    # persona: it's baked into the stored string, so editing the profile mid-interview changes nothing
    # until the next interview. The templates include it only when a kind in the plan uses it
    # (QuestionType.uses_candidate_background, i.e. behavioral), scoped to those kinds in a mixed plan.
    candidate_background = await format_candidate_background(user_id)

    def build_persona(kinds: list[dict]) -> str:
        return behavioral_interview(role=role, seniority=seniority, kinds=kinds,
                                    candidate_background=candidate_background)

    simulation: dict = {}

    # INTERVIEW SIMULATION — `{job, round}`. The job supplies role + level, the round its guidance,
    # and the questions are GENERATED (with a brief each) instead of drawn from the bank. Guard order:
    # the job exists (404) and is the caller's (403), the round is real (400) — all BEFORE the paid
    # generation call, so a bad request costs a couple of SELECTs, not a round of tokens.
    if (req.job is None) != (req.round is None):
        raise HTTPException(status_code=400, detail="a simulation needs both a job and a round")
    if req.job is not None:
        job = await owned_job(req.job, user_id)
        round_row = await get_round_type_by_slug(req.round)
        if round_row is None:
            raise HTTPException(status_code=400, detail=f"unknown round type: {req.round}")
        role, seniority = job["role"], job["level"]
        # the GENERATOR grounds its questions in the background only for a round that opts in
        # (behavioral); the persona's own switch is the generated questions' kinds, as in Practice.
        round_background = candidate_background if round_row.uses_candidate_background else ""

        def build_persona(kinds: list[dict]) -> str:
            return simulation_interview(
                company=job["company"],
                title=job["title"],
                summary=job["summary"],
                round_name=round_row.name,
                round_guidance=round_row.interviewer_guidance,
                kinds=kinds,
                seniority=seniority,
                candidate_background=candidate_background,
            )

        # what this candidate was already asked in this kind of round, so the generator varies the
        # techniques instead of returning the same likeliest problems for every job. Only a round that
        # opts in: behavioral's fixed structure is meant to repeat.
        recent_questions = []
        if round_row.avoids_recent_questions:
            recent_questions = await list_recent_round_questions(user_id, round_row.id)
        try:
            generated = await generate_round(
                job, round_row, candidate_background=round_background, recent_questions=recent_questions
            )
        except AgentRunError as exc:
            # the model couldn't produce a valid round within its retries/limits — nothing was
            # written, so the candidate can simply try again.
            raise HTTPException(status_code=502, detail="could not generate this round, please try again") from exc
        simulation = {"job": req.job, "round_type": req.round, "generated": generated}

    # INSERT the row. create_interview mints the slug (the id the client holds) and resolves
    # the role/level slugs — an unknown one comes back as an envelope, not an exception.
    #
    # `profile_id=user_id` is the join that makes the whole phase real: this row now belongs
    # to somebody. The column has been sitting there nullable since Phase A waiting for it,
    # and `profiles.id` IS the auth uid, so the value goes straight in with no lookup — the
    # payoff for breaking the surrogate-key convention on that one table.
    # create_interview now also MATERIALIZES the question plan (Phase G): the candidate's saved
    # "My questions" for this role+level, or a random default of increasing seniority when they've
    # saved none. The FIRST plan question comes back on the envelope — the client still presents it
    # (the model never picks), exactly as it used to take it from next_question. What changed is the
    # SOURCE: a frozen, finite plan instead of "the first at-or-below-level bank question", which is
    # what stops the interview from walking the entire bank.
    created = await create_interview(role, seniority, build_persona, profile_id=user_id,
                                     time_limit_seconds=time_limit_seconds, **simulation)
    if not created["ok"]:
        raise HTTPException(status_code=400, detail=created["error"])
    interview_id = created["interview_id"]

    # an empty plan means the role+level has no questions at all — same failure the old
    # next_question "no questions" branch reported, just detected from the plan now.
    first_question = created["first_question"]
    if first_question is None:
        raise HTTPException(status_code=400, detail=f"no questions for role: {role}")
    first_qid, first_qtext = first_question["slug"], first_question["text"]

    # writes the first question onto the row. From here on, "which question is on the table" is a
    # column, not a dict key — which is why a restart can't lose the candidate's place.
    # AND OPEN the first turn (same transaction): the question has been PRESENTED, no answer yet.
    # This is the turn the candidate's first /api/answer will complete. Opening it here (rather than
    # at answer time) is what lets the transcript record the exact prompt shown — see the Turn docstring.
    await commit_turn(interview_id, current_qid=first_qid, followups_used=0,
                      open_qid=first_qid, open_prompt=first_qtext)

    # present the first question verbatim (short canned lead-in; the bank text is authoritative).
    # `default_selection` lets the SPA note that a default set was chosen (they'd saved nothing);
    # `plan_size` is how many questions this interview will ask. `question` is the plan question on
    # the table (not a probe) — the coding panel's problem statement — with its type's flags.
    return {
        "interview_id": interview_id,
        "message": f"Let's begin. {first_qtext}",
        "done": False,
        # a simulation's plan is generated, never a "default because nothing was saved"
        "default_selection": not created["from_saved"] and req.job is None,
        "plan_size": created["plan_size"],
        "question": first_question,
        # the limit the session's countdown starts from (None = untimed)
        "time_limit_seconds": time_limit_seconds,
    }


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
# A coding answer's code block ceiling — generous for a 20-minute interview solution, but it bounds
# what one turn (and every later replay of message_history) can cost.
ANSWER_CODE_MAX_CHARS = 20_000

# What the candidate sees when they fish for the answer (TurnReply.answer_request). FIXED text, not the
# model's reaction: the flag is the model's judgement, but what's shown can't leak what it never says.
ANSWER_REQUEST_REPLY = ("I can't give you the answer, since that part's yours. I'd like to hear how you'd "
                        "approach it: talk me through your thinking, even if it's rough.")


@router.post("/answer")
async def submit_answer(
    req: AnswerRequest,
    user_id: str = Depends(require_user)
) -> dict:
    started = time.perf_counter()
    # 1. LOAD — replaces `SESSIONS.get(req.session_id)`. Same guard, realer 404: a row either
    #    exists or it doesn't (the JSON store used to invent an empty one for a bad id).
    state = await load_interview_state(req.interview_id)
    loaded = time.perf_counter()
    if not state["ok"]:
        raise HTTPException(status_code=404, detail="unknown interview")

    require_ownership(state["profile_id"], user_id)

    if state["done"]:
        # a finished interview is not a place to put another answer. Cheap to enforce now
        # that `done` is a column somebody else can read — it wasn't, when it was a dict key
        # that vanished with the process.
        raise HTTPException(status_code=409, detail="this interview is already finished")

    if _time_is_up(state):
        # a timed interview's clock has run out: its last answer goes to /final-answer (no LLM call),
        # never through another interviewer turn
        raise HTTPException(status_code=409, detail="time is up for this interview")
    time_used_ms = _time_used_after(state, req.turn_ms)

    text, diagram_text = await _prepare_answer(req.interview_id, req, state)
    message = text
    if diagram_text is not None:
        message = f"{text}\n\nThe candidate updated their diagram on the canvas. Current version:\n{diagram_text}"

    #    message_history comes back RAW (plain JSON out of JSONB) — tools/interview.py has no
    #    business importing pydantic-ai. Rehydrating it into real message objects is THIS
    #    layer's job, and it's the exact inverse of the dump on the way out.
    history = ModelMessagesTypeAdapter.validate_python(state["message_history"] or [])

    # 2. DECIDE FIRST — the model classifies the message (clarification vs answer) and reacts.
    #    We must know the INTENT before recording, so a clarifying question never lands in the
    #    store as an answer. We say "message" (not "answer") so we don't pre-bias the model.
    #    output_type=TurnReply is set on turn_agent.
    #    On the LAST planned question, say so: otherwise a skip or a closing reaction says "let's move
    #    on to another topic" right before the client's "That's the end of the interview". It also pins the
    #    closing to this conversation: a Practice persona carries the profile background, and a closing
    #    after a coding question otherwise "recaps" profile projects that were never discussed.
    last_question_note = (
        "\n\nThis is the LAST question of the interview: nothing comes after it. If you aren't "
        "probing further, close warmly and never mention moving on, another question, or another topic. "
        "Refer only to what the candidate actually said in this conversation: never mention a project, "
        "role, or experience from their profile that didn't come up."
        if state["next_planned_question"] is None else ""
    )
    #    The question's KIND is named, so a mixed Practice persona follows that kind's guidance (and
    #    its background scope) instead of guessing the kind from the text.
    prompt = (f"The current interview question (a {state['current_kind'].lower()} question) is: "
              f"{state['current_qtext']}{last_question_note}\n\n"
              f"The candidate's message: {message}")
    llm_started = time.perf_counter()
    result = await turn_agent.run(
        prompt,
        instructions=state["persona"],
        message_history=history,
        usage_limits=UsageLimits(request_limit=3),
    )
    llm_done = time.perf_counter()
    try:
        return await _finish_turn(req, state, text, result, time_used_ms)
    finally:
        # One line per turn (PERF_LOG=1): where the wait went. requests > 1 means the reaction
        # validator retried, a full extra LLM round trip. db = every write after the LLM call.
        usage = result.usage
        log_perf(
            "answer: load=%.2fs llm=%.2fs db=%.2fs total=%.2fs requests=%s input_tokens=%s output_tokens=%s",
            loaded - started, llm_done - llm_started, time.perf_counter() - llm_done,
            time.perf_counter() - started, usage.requests, usage.input_tokens, usage.output_tokens,
        )


async def _finish_turn(req: AnswerRequest, state: dict, text: str, result, time_used_ms: int | None) -> dict:
    """Steps 3-5 of /api/answer: act on the model's decision and write the turn back.

    Split out of submit_answer only so the route can time everything after the LLM call as one
    `db` stage, across every exit path, with a single try/finally.

    `time_used_ms` is a timed interview's clock after this turn (None = untimed): EVERY exit writes it,
    since the candidate spent the time whatever the model decided.
    """
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
    #    ANSWER REQUEST — the candidate asked for the answer, or asked the question back at us. Decline
    #    with the FIXED line and STAY on the question: nothing recorded, no follow-up spent.
    #
    #    THE ONE EXIT THAT DELIBERATELY DOESN'T WRITE `new_history` BACK. That history holds the model's
    #    own reaction, which the candidate never saw and which could contain the very answer we're
    #    withholding. Saving it would put that text in every later turn's replay, and the model's memory
    #    would disagree with the transcript. Dropping the exchange means the model never saw the
    #    attempt, and the next turn replays the conversation the candidate actually had.
    #
    #    A SKIP wins over this: "just tell me and move on" closes the question, so it advances below.
    if decision.answer_request and not decision.skip_requested:
        # only the clock moves (and only when timed, so an untimed turn here stays write-free)
        if time_used_ms is not None:
            await save_interview_state(req.interview_id, time_used_ms=time_used_ms)
        return {"message": ANSWER_REQUEST_REPLY, "done": False}

    #    A SKIP request is never a clarification, whatever the model set: it falls through to record +
    #    advance below, so "let's move on" can't strand the candidate on the question.
    if decision.is_clarification and not decision.skip_requested:
        await save_interview_state(req.interview_id, message_history=new_history, time_used_ms=time_used_ms)
        return {"message": decision.reaction, "done": False}

    # 4. RECORD — it's a real answer, so COMPLETE the open turn (the one presented last, either
    #    the bank question at start/advance or the probe we opened in the follow-up branch).
    #    record_answer finds it by `answer IS NULL`; `current_qid` is passed as the guard that
    #    the open turn is for the question the client thinks it's answering. Correct BY
    #    CONSTRUCTION: the model never picked or labelled the question, so it can't be
    #    mislabelled, and the FK means an id that isn't a question can't reach the table.
    #
    #    The record itself rides in each branch's ONE commit_turn call below (answered_qid + answer),
    #    together with that branch's state write and next-turn open: one transaction per turn
    #    instead of three separate sessions. Close-then-open order is commit_turn's job.

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
    #        A SKIP request always advances. The candidate's "let's move on" is recorded above as the
    #        question's answer, so the question is never presented-then-skipped without one (the
    #        invariant Interview.asked_ids rests on), and the grader sees that they passed on it.
    if (decision.ask_followup and not decision.skip_requested
            and state["followups_used"] < state["max_followups"]):
        followups_used = state["followups_used"] + 1
        # OPEN the next turn — the probe, filed under the SAME parent question (current_qid), so
        # the transcript stores the probe's text while the scorecard still groups it with the
        # original. commit_turn closes the answered turn first (complete-then-open), so the
        # one-open-turn index is never violated.
        await commit_turn(req.interview_id,
                          answered_qid=state["current_qid"], answer=text,
                          followups_used=followups_used, message_history=new_history,
                          time_used_ms=time_used_ms,
                          open_qid=state["current_qid"], open_prompt=decision.followup)
        return {"message": f"{decision.reaction}\n\n{decision.followup}", "done": False}

    #    (b) ADVANCE — the CLIENT moves to the next question in the FROZEN PLAN (never the model).
    #        Phase G: the plan replaced "the next unasked at-or-below-level bank question". The next
    #        question is `state["next_planned_question"]` — load_interview_state walked the plan (by
    #        position, skipping already-asked) and handed us the first one still owed, or None if the
    #        plan is spent. The plan is a column set, so it survives a restart just like `level` did.
    next_question = state["next_planned_question"]
    if next_question is not None:
        next_qid = next_question["slug"]
        # write back: `current_qid=next_qid`, `followups_used=0` (the probe budget is per question,
        #   so a new question resets it), and `message_history=new_history`. Note what you DON'T
        #   write: `current_qtext` and `asked_ids` were dict keys with no column behind them — the
        #   text is read through `current_question.text` and the asked set is derived. Copies you
        #   have to keep in sync are exactly the bug class the normalized schema deleted.
        #
        # explicit transition so a NEW bank question can't be misread as a follow-up. The
        # CLIENT owns this marker (the model never announces "moving on" — it can't, it doesn't
        # know a new question is coming), so it's consistent regardless of the reaction's wording.
        # OPEN the next turn for the new plan question. This is INSIDE the `next_qid is not None`
        # block on purpose: if the plan were exhausted we'd never get here, we'd fall to the END
        # branch below — so the interview ends with its last turn COMPLETED and no dangling open
        # turn. (That's what keeps a finished interview at zero open turns.)
        await commit_turn(req.interview_id,
                          answered_qid=state["current_qid"], answer=text,
                          current_qid=next_qid, followups_used=0, message_history=new_history,
                          time_used_ms=time_used_ms,
                          open_qid=next_qid, open_prompt=next_question["text"])
        return {"message": f"{decision.reaction}\n\nLet's move on to the next question. {next_question['text']}",
                "done": False,
                # the new plan question (the coding panel swaps its problem statement to this), with
                # its type's flags: the workspace and the voice mode follow it
                "question": next_question}

    #    (c) END — the plan is exhausted, so conclude.
    #    write back `done=True` and `message_history=new_history`. Leave `current_qid`
    #      alone: it keeps pointing at the last question asked, which is fine precisely because
    #      every reader checks `done` first (the contract save_interview_state documents). This
    #      is also the flag that makes the 409 guard at the top of this function work.
    await commit_turn(req.interview_id,
                      answered_qid=state["current_qid"], answer=text,
                      message_history=new_history, done=True, time_used_ms=time_used_ms)
    return {"message": f"{decision.reaction}\n\nThat's the end of the interview. "
                       f"Thank you for your time!", "done": True}


def _time_is_up(state: dict) -> bool:
    """Whether a timed interview has spent its whole limit (always False when untimed)."""
    limit = state["time_limit_seconds"]
    return limit is not None and state["time_used_ms"] >= limit * 1000


def _time_used_after(state: dict, turn_ms: int | None) -> int | None:
    """A timed interview's clock after a turn of `turn_ms`, or None when untimed (nothing to write).

    The client measures the turn, so it's clamped: never negative, never past the limit. A missing
    turn_ms counts as 0, so an old client can't break the clock, only fail to run it.
    e.g. limit 900s, used 899_000ms, turn_ms 5_000  ->  900_000 (only the 1s that was left)
    """
    limit = state["time_limit_seconds"]
    if limit is None:
        return None
    remaining_ms = max(limit * 1000 - state["time_used_ms"], 0)
    return state["time_used_ms"] + min(max(turn_ms or 0, 0), remaining_ms)


async def _prepare_answer(interview_id: str, body: AnswerBody, state: dict) -> tuple[str, str | None]:
    """The answer half of a turn, shared by /api/answer and /final-answer: fold the code into the text,
    reject a blank, and store a changed diagram on the open turn.

    Returns (text, diagram_text): `text` is what the turn records, and `diagram_text` is the diagram's
    serialized text when the DESIGN changed (for the model's prompt), else None.
    """
    # CODING ROUNDS — the editor's contents ride along with the turn. They're folded into the message
    # as a fenced block, so ONE string is what the model reads, what record_answer stores, and what
    # the grader later sees (its template notices the fence and grades the code as typed, not spoken).
    # Code alone is a valid turn ("here's my solution"), so the blank check runs on the combined text.
    text = body.text
    if body.code is not None and body.code.strip():
        if len(body.code) > ANSWER_CODE_MAX_CHARS:
            raise HTTPException(status_code=413, detail=f"code is too long (max {ANSWER_CODE_MAX_CHARS} characters)")
        fence = f"```{body.language or ''}\n{body.code.rstrip()}\n```"
        text = f"{text.rstrip()}\n\n{fence}" if text.strip() else fence

    # SYSTEM-DESIGN CANVAS — unlike code, the diagram is NOT folded into `text`: it's stored on the
    # open turn (turns.diagram), and the model reads its serialize_diagram text. That text is added to
    # the prompt only when it differs from the question's last diagram, so a turn that only moved
    # nodes around neither costs tokens nor replays the same block into message_history.
    # A diagram for a question without a canvas (a stale client) is ignored.
    diagram = body.diagram if state["current_has_diagram_canvas"] else None
    diagram_text = None
    if diagram is not None:
        serialized = serialize_diagram(diagram)
        if serialized != serialize_stored(state["current_diagram"]):
            diagram_text = serialized

    if not text.strip() and diagram_text is None:
        # Reject a blank BEFORE the LLM call: it would otherwise close the open turn with "" and
        # spend tokens on nothing. The open turn stays open, so the candidate just answers again.
        # (PRODUCT choice, not a null-safety one — "" is a valid non-NULL answer as far as the
        # schema cares; drop this guard if a blank should count as an "I don't know".)
        raise HTTPException(status_code=400, detail="answer must not be empty")

    if diagram is not None:
        # Store it BEFORE the model decides, so it lands on every path (a clarification leaves the
        # turn open, and the diagram rides on it until it closes). See save_open_turn_diagram.
        saved = await save_open_turn_diagram(interview_id, state["current_qid"],
                                             diagram.model_dump(mode="json"))
        if not saved["ok"]:
            raise HTTPException(status_code=409, detail=saved["error"])

    # A diagram-only turn ("here's my updated design") is valid. It's recorded as a short marker, so
    # the transcript and the grader read a turn rather than a blank answer.
    if not text.strip():
        text = "(updated the diagram)"
    return text, diagram_text


# ===========================================================================
# POST /api/interviews/{interview_id}/final-answer : a TIMED interview's last word.
#
# When the clock runs out mid-answer, what the candidate had (the recording, a typed draft, the code
# or the diagram) is still theirs to be graded on. This records it on the open turn and ENDS the
# interview, with NO LLM call: there's no interviewer reply to give, and the client goes straight
# to /api/scorecard. A dedicated route rather than a flag on /api/answer, since it skips everything
# that route is for. With nothing in progress the client skips this and just calls /api/scorecard
# (which ignores open turns and marks the interview done itself).
# ===========================================================================
@router.post("/interviews/{interview_id}/final-answer")
async def submit_final_answer(
    interview_id: str,
    body: AnswerBody,
    user_id: str = Depends(require_user),
) -> dict:
    state = await load_interview_state(interview_id)
    if not state["ok"]:
        raise HTTPException(status_code=404, detail="unknown interview")
    require_ownership(state["profile_id"], user_id)
    if state["done"]:
        raise HTTPException(status_code=409, detail="this interview is already finished")

    text, _ = await _prepare_answer(interview_id, body, state)
    committed = await commit_turn(interview_id, answered_qid=state["current_qid"], answer=text,
                                  done=True, time_used_ms=_time_used_after(state, body.turn_ms))
    if not committed["ok"]:
        raise HTTPException(status_code=409, detail=committed["error"])
    return {"done": True}


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
@router.post("/scorecard")
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

    # 2. the rubrics, per question KIND: each answer is graded on its QUESTION TYPE's rubric, the same
    #    in a Practice and a Job interview (a coding answer on Code correctness and Complexity
    #    wherever it was asked). Read off the DB, never the request. The same context carries a
    #    simulation's job + round framing for the grader.
    context = await load_grading_context(req.interview_id)
    if context["status"] != "ok":
        raise HTTPException(status_code=404, detail="unknown interview")
    rubrics = context["rubrics"]
    kind_dimensions = {kind: rubric["dimensions"] for kind, rubric in rubrics.items()}

    # PHASE E — the interview's seniority, so the grader calibrates each grade to the right bar
    # (the same answer clears entry but not senior). TODO: get_interview must start returning
    # `level` (see the TODO in tools/interview.py); until it does, this is None and grade_one
    # grades un-leveled — safe, just not calibrated.
    level = interview.get("level")

    # 3. GROUP turns by question_id, then grade ONCE per question.
    #    A follow-up isn't a bank question — it has no id of its own — so its answer is recorded
    #    under the ORIGINAL question_id (the client never moves `current_qid` while probing).
    #    One question_id therefore owns SEVERAL turns. Grading per TURN would score a follow-up
    #    answer against the original question text AND double-count that question in the
    #    averages. Treating a question plus its probes as one exchange is also just how a real
    #    interviewer works: probe, then form a single assessment of the topic.
    #    Each group keeps the PROMPT alongside the answer: a follow-up turn's `question_text` is the
    #    probe the candidate was answering, and the grader needs it to judge that answer fairly.
    grouped: dict[str, list[tuple[str, str]]] = {}
    # SYSTEM-DESIGN CANVAS — each question's diagram versions as serialize_diagram text, in order,
    # counting only real changes (a layout-only resend serializes the same). The grader gets the last
    # one plus the count. The open turn's diagram counts too: it's work the candidate did, even when
    # "End session" grades before that turn closed.
    diagram_versions: dict[str, list[str]] = {}
    for turn in turns:
        diagram_text = serialize_stored(turn["diagram"])
        if diagram_text is not None:
            versions = diagram_versions.setdefault(turn["question_id"], [])
            if not versions or versions[-1] != diagram_text:
                versions.append(diagram_text)
        # skip the OPEN turn (answer is None): a question that was presented but not answered
        # yet. A finished interview has none, but grading a still-running one would otherwise try
        # to score a NULL answer. NULL only — an empty-string answer is still a (blank) answer.
        if turn["answer"] is None:
            continue
        grouped.setdefault(turn["question_id"], []).append((turn["question_text"], turn["answer"]))

    async def grade_question(question_id: str, exchanges: list[tuple[str, str]]) -> tuple[str, AnswerGrade, dict]:
        question = await get_question(question_id)
        found = question.get("status") == "ok"
        question_title = question["question"]["title"] if found else "(unknown question)"
        question_text = question["question"]["text"] if found else "(unknown question)"
        # this question's KIND picks its rubric (dimensions + a human-readable text for the grader)
        kind = context["question_kinds"][question_id]
        rubric = rubrics[kind]
        rubric_text = f"Dimensions: {'; '.join(rubric['dimensions'])}. {rubric['scale']}"
        # the first exchange answered the question itself; the rest answered probes on it
        first_answer, followups = exchanges[0][1], exchanges[1:]
        versions = diagram_versions.get(question_id, [])
        # Phase E — pass the question SLUG (so grade_one fetches this question's brief) and the
        # interview level (so scoring is calibrated). grade_one tolerates an un-briefed question.
        grade = await grade_one(
            question_id, question_text, first_answer, rubric_text, rubric["dimensions"], level=level,
            job_context=context["job_context"], round_note=context["round_note"],
            followups=followups,
            diagram=versions[-1] if versions else "", diagram_revisions=len(versions),
        )
        return kind, grade, {"question_id": question_id, "question_title": question_title,
                             "question_text": question_text, "kind": kind, **grade.model_dump()}

    # The questions are graded independently, so grade them CONCURRENTLY: the scorecard waits for
    # the slowest grade instead of the sum of all of them. gather keeps input order, so `answers`
    # still follows the interview's question order.
    results = await asyncio.gather(
        *(grade_question(qid, exchanges) for qid, exchanges in grouped.items())
    )
    graded = [(kind, grade) for kind, grade, _ in results]
    answers = [answer for _, _, answer in results]

    # 4. aggregate the per-answer grades into headline numbers (deterministic Python — the LLM
    #    already judged; this just averages), grouped by kind since each kind has its own rubric.
    agg = aggregate(graded, kind_dimensions)

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

    # 6. mark the interview DONE. The conversational loop only reaches done=True when the bank
    #    runs out (see /api/answer), but "End session" grades early via this route and would
    #    otherwise leave a fully-graded interview flagged unfinished — so a scorecard existing IS
    #    the interview being finished. Idempotent: re-grading a done interview leaves it done.
    await save_interview_state(req.interview_id, done=True)

    return {
        "interview_id": req.interview_id,
        "role": context["role"],
        "answers": answers,
        # per question kind, its rubric's dimension averages (the same shape get_scorecard reads back)
        "kind_averages": agg["by_kind"],
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
#
# `?resumable=true` NARROWS this same route to the ONE resumable interview (the resume banner's
# question), so the client asks the backend "which one can I resume?" rather than pulling the whole
# history and filtering. It reuses this endpoint (not a new one) and returns the SAME
# {"interviews": [...]} shape — a 0-or-1-element list — so the frontend reads `interviews[0]`.
# ===========================================================================
@router.get("/interviews")
async def my_interviews(
    params: Params = Depends(),
    user_id: str = Depends(require_user),
    resumable: bool = False,
    q: str | None = None,
    role: str | None = None,
    level: str | None = None,
    sort: str | None = None,
    order: str | None = None,
    scored: bool = False,
    job: str | None = None,
    simulation: bool | None = None,   # True = simulations only, False = bank only, omit = both
) -> dict:
    # `?resumable=true` NARROWS to the ONE resumable interview (the banner's question). It returns the
    # SAME page envelope as the full list — a 0-or-1-item page — so the client reads `items[0]` and the
    # endpoint has one response shape. `params`/`q`/`role`/`level`/`scored` don't apply to this branch,
    # so hiding unscored interviews from the list can never change which interview is resumable.
    if resumable:
        card = await get_resumable_interview(user_id)
        items = [card] if card is not None else []
        return {"items": items, "total": len(items), "page": 1, "size": params.size, "pages": 1 if items else 0}
    # The full history: server-side paged (page/size from the query string via `params`) and filtered
    # by role/level SLUG + search — see list_interviews. `?scored=true` keeps only graded interviews
    # (the list's default view; the "Show all" toggle drops it). `?job=<slug>` keeps one job's
    # simulations (the Job page's list). `?simulation=true|false` keeps one KIND (the dashboard card
    # asks for simulations only). Same {items,...} envelope.
    return await list_interviews(
        user_id, params, q=q, role=role, level=level, sort=sort, order=order, scored=scored,
        job=job, simulation=simulation,
    )


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
@router.get("/interviews/{interview_id}")
async def interview_detail(
    interview_id: str,
    user_id: str = Depends(require_user),
) -> dict:
    interview = await get_interview(interview_id)
    if interview.get("status") != "ok":
        raise HTTPException(status_code=404, detail="unknown interview")
    require_ownership(interview["profile_id"], user_id)

    card = await get_scorecard(interview_id)
    saved_question_ids = []
    if interview["job_id"]:
        asked = list({turn["question_id"] for turn in interview["turns"]})
        saved_question_ids = await claimed_question_slugs(user_id, asked)
    return {
        "interview_id": interview["interview_id"],
        # display fields for the detail header (role · level, and the date). `level_name` is the
        # human-readable name; get_interview's `level` is the slug (grading needs that), so the
        # wire contract carries the name under the plain `level` the frontend header reads.
        "role": interview["role"],
        "level": interview["level_name"],
        "created_at": interview["created_at"],
        # simulation header fields (all null for a bank interview)
        "job_id": interview["job_id"],
        "company": interview["company"],
        "round": interview["round"],
        "turns": interview["turns"],
        "summary": interview["summary"],
        # null until this interview has been graded (or until get_scorecard is implemented).
        "scorecard": card if card.get("status") == "ok" else None,
        # a job interview's questions the caller has saved to "My questions" (claimed); [] for a bank
        # interview, whose questions are saved from the Questions page instead
        "saved_question_ids": saved_question_ids,
    }


# ===========================================================================
# POST /api/interviews/{interview_id}/questions/{slug}/claim : "Save to My questions" for a question a
# job interview asked. The generated question MOVES to the caller (see claim_job_question): no copy, no
# LLM call, and idempotent (re-saving returns the same question).
#
# GUARD ORDER: exists (404) -> owns (403) -> the slug was actually asked in THIS interview (404, a guard
# param: you can only claim a question you were asked) -> claim_job_question, which re-checks the
# job's owner and 404s anything that isn't a generated question.
# ===========================================================================
@router.post("/interviews/{interview_id}/questions/{slug}/claim", response_model=QuestionOut)
async def claim_interview_question(
    interview_id: str,
    slug: str,
    user_id: str = Depends(require_user),
):
    interview = await get_interview(interview_id)
    if interview.get("status") != "ok":
        raise HTTPException(status_code=404, detail="unknown interview")
    require_ownership(interview["profile_id"], user_id)

    asked = {turn["question_id"] for turn in interview["turns"]}
    if slug not in asked:
        raise HTTPException(status_code=404, detail="question not asked in this interview")

    return envelope_result(await claim_job_question(user_id, slug), "question")


# ===========================================================================
# GET /api/interviews/{interview_id}/resume : reopen an in-progress interview.
#
# The counterpart to the History detail view above, for the OTHER kind of "reopen": not a
# finished interview to review, but an UNFINISHED one to keep answering. It returns exactly
# what SessionPage needs to redraw the screen — the transcript so far + the question currently
# on the table (the open turn) — after which the normal /api/answer loop continues untouched,
# because the interview's whole state (message_history, the open turn, the probe budget) has
# been sitting in Postgres the entire time. Resume is a READ; it mutates nothing.
#
# GUARD ORDER extends the usual exists -> owns -> state ladder with the PRODUCT RULE:
#   exists (404) -> owns (403) -> not already finished (409) -> IS the user's single most-recent
#   interview, and still unfinished (409).
# That last check is why this can't just be the detail route with a flag: detail must serve
# ANY owned interview (History reviews old, finished ones), whereas resume is deliberately
# narrowed to the single most-recent interview while it's unfinished. Enforcing it HERE (not only
# by hiding the button in the UI) means a hand-crafted request can't reopen a stale interview —
# once the user has started a newer interview, this one is retired for good.
# ===========================================================================
@router.get("/interviews/{interview_id}/resume")
async def resume_interview(
    interview_id: str,
    user_id: str = Depends(require_user),
) -> dict:
    payload = await load_resume_payload(interview_id)
    if payload["status"] != "ok":
        raise HTTPException(status_code=404, detail="unknown interview")
    require_ownership(payload["profile_id"], user_id)
    if payload["done"]:
        raise HTTPException(status_code=409, detail="this interview is already finished")

    # THE PRODUCT RULE, enforced server-side: an interview is resumable only while it's the user's
    # single most-recent one and still unfinished. The SAME query the banner uses
    # (get_resumable_interview) decides which that is, so the affordance and the guard can't
    # disagree; a mismatch means a newer interview has superseded this one (e.g. the user started
    # another), so this one is retired and can no longer be resumed.
    resumable = await get_resumable_interview(user_id)
    if resumable is None or resumable["interview_id"] != interview_id:
        raise HTTPException(
            status_code=409,
            detail="only the most recent unfinished interview can be resumed",
        )

    return {
        "interview_id": payload["interview_id"],
        "role": payload["role"],
        "level": payload["level"],
        "turns": payload["turns"],
        "current_question": payload["current_question"],
        # resume into the right UI: header (company · round), and the plan question on the table (the
        # problem statement, even mid-probe), whose type flags pick the code editor / diagram canvas
        # and whether smart voice is offered.
        "job_id": payload["job_id"],
        "company": payload["company"],
        "round": payload["round"],
        "question": payload["question"],
        # the current question's latest diagram (reseeds the canvas), or None
        "diagram": payload["diagram"],
        # a timed interview's limit (None = untimed) and the candidate-turn time already spent
        "time_limit_seconds": payload["time_limit_seconds"],
        "time_used_ms": payload["time_used_ms"],
    }
