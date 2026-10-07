"""
Interview tools (SIDE EFFECTS) — now backed by Postgres. SCAFFOLD: fill in the TODOs.

Replaces `tools/session.py`, which appended to `data/sessions/*.json`. Delete that file
once `mcp_server.py` imports this one instead.

WHY THE RENAME: "session" now means exactly one thing in this codebase — a SQLAlchemy DB
session, always the variable `db`. What the app conducts is an INTERVIEW, so the module,
the table, the tool arguments (`interview_id`), and the MCP resource all say interview.
`interview_id` is the interview's SLUG — the uuid4().hex[:8] the client already holds, and
what the HTTP API used to call `session_id`.

STILL THE SIDE-EFFECTING HALF of the split: `tools/questions.py` reads context, this writes
what happened. Nothing here is approval-gated — recording an answer is cheap and reversible.
(An irreversible action, e.g. emailing a transcript, is where an approval gate / MCP
elicitation would come back, as in mcp-helpdesk Phase 5.)

THE ONE NEW OBLIGATION vs the JSON version: a write must COMMIT. `db.add(...)` only stages
an object in the session; nothing reaches Postgres until `await db.commit()`. Forgetting it
is the classic first bug — the function returns ok and the row silently isn't there.

THIS MODULE IS THE DATA LAYER, NOT THE MCP SURFACE. `mcp_server.py` decides which of these
get registered, and it is deliberately not all of them:

    create_interview      -> NOT registered. Backend plumbing; api.py calls it directly.
    save_interview_state  -> NOT registered. Same — it's the per-turn write-back.
    record_answer         -> a TOOL (an action taken during the interview)
    save_interview_summary-> a TOOL
    get_interview         -> the interview://{id} RESOURCE (read-only context)

The line: the MODEL has no business creating an interview or setting `current_question_id`
— it can't invent an interview any more than it can invent a question (the whole point of
the client-driven rewrite). Those are the backend's own bookkeeping, so they stay off the
model's menu even though they live here beside the tools.

WHY create_interview TAKES `persona` INSTEAD OF FETCHING IT: the persona comes from the MCP
`behavioral_interview` prompt, and this module deliberately knows nothing about MCP. api.py
has the toolset, fetches the persona, and passes it down — keeping the data layer free of a
dependency on the thing that's supposed to sit above it.

Quick test once filled in (from server/):
    .venv/Scripts/python.exe -m tools.interview
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi_pagination import Params
from fastapi_pagination.ext.sqlalchemy import apaginate
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.orm import selectinload

from db.engine import get_session
from db.models import (
    Interview,
    InterviewQuestion,
    Job,
    Level,
    Profile,
    Question,
    QuestionType,
    ReferenceBrief,
    Role,
    RoundType,
    Rubric,
    Scorecard,
    ScorecardEntry,
    ScorecardEntryScore,
    Turn,
)
# build_interview_plan is the read-side helper that turns a role/level (+ the candidate's saved set)
# into the ordered question plan we freeze onto the interview at kickoff. It lives in the questions
# data-layer module, so importing it here keeps this module's data-layer-only posture (no MCP/LLM).
from tools.questions import build_interview_plan

# The shared score arithmetic (Phase C) — a pure leaf module, NOT grading.py. Importing from
# grading here would pull the LLM stack (pydantic_agent, the model) into the data layer just to
# reuse an average; the math moved to tools/scoring.py precisely so this import stays cheap.
from tools.scoring import aggregate_scores


async def _insert_generated_questions(
    db, generated: list[dict], job_row: Job, level_row: Level
) -> list[Question] | None:
    """Stage a simulation round's generated questions (+ one brief each) in `db`'s open transaction
    and return them in ask order — or None if an item's `type_slug` isn't a real question type (the
    generator's output is constrained to live slugs, so that's a vocab race, not an expected path).

    No `question_roles` rows, on purpose: every bank read (browse, default plan) joins through that
    table, so a generated question can never surface outside its own interview."""
    type_ids = dict((await db.execute(select(QuestionType.slug, QuestionType.id))).all())
    questions: list[Question] = []
    for item in generated:
        type_id = type_ids.get(item["type_slug"])
        if type_id is None:
            return None
        question = Question(
            slug=f"gen-{uuid.uuid4().hex[:12]}",
            type_id=type_id,
            text=item["text"],
            level_id=level_row.id,
            job_id=job_row.id,
        )
        db.add(question)
        questions.append(question)
    # FLUSH so Postgres assigns each question's autoincrement id — the briefs below and the caller's
    # InterviewQuestion rows both need it. The briefs themselves need no flush: nothing reads their
    # ids, and the caller's commit() flushes everything still pending, all in the one transaction.
    await db.flush()
    for question, item in zip(questions, generated):
        db.add(ReferenceBrief(question_id=question.id, brief=item["brief"]))
    return questions


async def create_interview(
    role: str,
    level: str,
    persona: str,
    profile_id: str | None = None,
    *,
    job: str | None = None,
    round_type: str | None = None,
    generated: list[dict] | None = None,
) -> dict:
    """Start an interview: mint its id and INSERT the row. Called by POST /api/interview.

    WORKED EXAMPLE — the write counterpart to get_interview, and the one function that
    creates rather than reads or updates. It replaces the line that used to be
    `SESSIONS[session_id] = {...}` in api.py: same act, except the state now outlives the
    process.

    Returns {"ok": True, "interview_id": <slug>} or {"ok": False, "error": ...} if the role
    or level slug doesn't resolve.

    Note what is NOT set here: `current_question_id` stays NULL until api.py picks the first
    question and calls save_interview_state. Creating the interview and choosing its first
    question are two separate steps, and the row is valid in between.

    PHASE B: `profile_id` is the verified auth uid (the JWT's `sub`), passed down from
    /api/interview. It stays OPTIONAL, defaulting to None, so the `python -m tools.interview`
    smoke test below still runs without a token — an owner-less interview is a legal row (the
    column is nullable), it's just one no signed-in user can reach, because require_ownership
    refuses a None owner. The string goes straight into a Uuid column; SQLAlchemy parses it.

    INTERVIEW SIMULATION: pass `job` + `round_type` (slugs) + `generated` (the round generator's
    questions, dicts of {text, type_slug, brief}) together. Then, in the SAME transaction, each
    generated item becomes a real `questions` row (slug `gen-<hex>`, its own type, this level, tagged
    with the job and paired with NO role — which is what keeps it out of every bank read) plus a
    `reference_briefs` row, and THOSE are the frozen plan instead of build_interview_plan's pick.
    The probe budget comes from the round. From here the turn loop and the grader can't tell a
    simulation from a bank interview. The caller checks job ownership before spending on generation.
    """
    if (job is None) != (round_type is None) or (job is not None and not generated):
        return {"ok": False, "error": "a simulation needs a job, a round, and generated questions"}

    async with get_session() as db:
        # both arrive as slugs from the HTTP request ("backend-engineer", "mid")
        role_row = (
            await db.execute(select(Role).where(Role.slug == role))
        ).scalar_one_or_none()
        level_row = (
            await db.execute(select(Level).where(Level.slug == level))
        ).scalar_one_or_none()
        if role_row is None or level_row is None:
            return {"ok": False, "error": f"unknown role or level: {role} / {level}"}

        job_row = round_row = None
        if job is not None:
            job_row = (await db.execute(select(Job).where(Job.slug == job))).scalar_one_or_none()
            round_row = (
                await db.execute(select(RoundType).where(RoundType.slug == round_type))
            ).scalar_one_or_none()
            if job_row is None or round_row is None:
                return {"ok": False, "error": f"unknown job or round: {job} / {round_type}"}

        # RETIRE the caller's other unfinished interviews — starting one abandons the resumable slot
        # for good (the SPA's overwrite modal promises exactly that). Recency alone can't keep that
        # promise: delete the newer interview (a job delete cascades its simulations) and the older
        # unfinished one would become "most recent" and resumable again. `done` is the marker every
        # reader already honours (resume and /api/answer 409, the banner skips it).
        # `updated_at` is pinned to itself: otherwise onupdate stamps now() — the same instant as
        # the new row's INSERT in this transaction — and the recency tie could pick a retired row.
        # Same transaction as the INSERT below, so a failed start retires nothing.
        if profile_id is not None:
            await db.execute(
                update(Interview)
                .where(Interview.profile_id == profile_id, Interview.done.is_(False))
                .values(done=True, updated_at=Interview.updated_at)
            )

        # the same id scheme api.py always used — short enough to eyeball in a URL, random
        # enough that nobody guesses someone else's interview
        slug = uuid.uuid4().hex[:8]

        interview = Interview(
            slug=slug,
            role_id=role_row.id,
            level_id=level_row.id,
            persona=persona,
            message_history=[],   # the agent hasn't said anything yet
            profile_id=profile_id,   # Phase B: whose interview this is (None = nobody's)
            job_id=job_row.id if job_row is not None else None,
            round_type_id=round_row.id if round_row is not None else None,
        )
        if round_row is not None:
            interview.max_followups = round_row.max_followups
        db.add(interview)
        # FLUSH (not commit): the INSERT runs and `interview.id` is assigned, but the transaction
        # stays open so the plan rows below land atomically with it. An interview is never valid
        # without its frozen plan, so they must commit together or not at all.
        await db.flush()

        if generated:
            # the round's plan IS what the generator wrote — there's no saved set to consult.
            plan = await _insert_generated_questions(db, generated, job_row, level_row)
            if plan is None:
                await db.rollback()
                return {"ok": False, "error": "generated question has an unknown type"}
            from_saved = False
        else:
            # MATERIALIZE THE PLAN — the ordered subset this interview will ask, from the candidate's
            # saved "My questions" for this role+level, or a random default of increasing seniority
            # when they've saved none. Frozen here so re-curating later can't move an in-flight
            # interview.
            plan, from_saved = await build_interview_plan(db, role_row, level_row, profile_id)
        for position, question in enumerate(plan):
            db.add(InterviewQuestion(
                interview_id=interview.id, question_id=question.id, position=position,
            ))

        await db.commit()

        # first plan question — the CLIENT presents it (create_interview picks it, not the model),
        # exactly as api.py used to take it from next_question. Safe to read after commit: the
        # session is expire_on_commit=False (see db/engine.py).
        first = plan[0] if plan else None
        first_has_diagram_canvas = False
        if first is not None:
            first_has_diagram_canvas = (await db.execute(
                select(QuestionType.has_diagram_canvas).where(QuestionType.id == first.type_id)
            )).scalar_one()
        return {
            "ok": True,
            "interview_id": slug,
            "plan_size": len(plan),
            # False when the default fired — the route surfaces this so the SPA can tell the
            # candidate a default set was chosen because they'd saved nothing.
            "from_saved": from_saved,
            "first_qid": first.slug if first is not None else None,
            "first_qtext": first.text if first is not None else None,
            # whether the SPA shows the diagram canvas for it (its question type's flag)
            "first_has_diagram_canvas": first_has_diagram_canvas,
        }


async def get_interview(interview_id: str) -> dict:
    """Read back a whole recorded interview (backs the interview:// resource).

    WORKED EXAMPLE — the read pattern the writers below start with too: resolve the slug to
    a row (loading the relationships it reads), then walk them and convert to JSON-safe values.

    Returns {"status": "ok", "interview_id": ..., "turns": [...], "summary": ...} or
    {"status": "not_found", "interview_id": ...}.

    NOTE A CONTRACT CHANGE: the JSON version invented an empty skeleton for an unknown id
    (a missing file just meant "no turns yet"). A row either exists or it doesn't, so this
    reports not_found instead — the caller in `api.py` can now tell "no such interview"
    apart from "interview with nothing recorded yet", which it couldn't before.
    """
    async with get_session() as db:
        result = await db.execute(
            select(Interview).where(Interview.slug == interview_id)
            .options(selectinload(Interview.role), selectinload(Interview.level),
                     *SIMULATION_LOADS, *TURN_LOADS)
        )
        interview = result.scalar_one_or_none()
        if interview is None:
            return {"status": "not_found", "interview_id": interview_id}

        return {
            "status": "ok",
            "interview_id": interview.slug,
            # Phase B — who owns it, so /api/scorecard can authorize before it hands back a
            # whole transcript. STRINGIFIED here, unlike load_interview_state below, because
            # this dict is also the `interview://` MCP resource payload and gets JSON-encoded
            # on the way out; a uuid.UUID isn't JSON-serializable.
            "profile_id": str(interview.profile_id) if interview.profile_id else None,
            # add the interview's level so /api/scorecard can grade at the right
            # bar. It's the levels.slug ("mid"), JSON-safe, exactly like `load_interview_state` already returns it:
            "level": interview.level.slug,
            # DISPLAY fields, for the History detail view's header (role · level, and the date).
            # `level` above stays the SLUG because grading calibration reads it; these carry the
            # human-readable NAMES + the created timestamp instead. All three come off the same
            # loaded relationships, so no extra query — the detail endpoint just forwards them.
            "role": interview.role.name,
            "level_name": interview.level.name,
            "created_at": interview.created_at.isoformat(),
            # simulation only (None on a bank interview): job slug, company, round name
            **_simulation_fields(interview),
            "turns": [
                {
                    # the wire shape keeps the SLUG under the key "question_id", exactly as
                    # the JSON store did — the grader groups on this
                    "question_id": turn.question.slug,
                    # the EXACT text presented — `prompt_text` (the probe, or the bank
                    # question's text) is what the candidate answered, so it reads correctly for
                    # a follow-up. Falls back to the parent question's text for pre-Phase-C rows
                    # that predate the column. Either way it's a readable transcript WITHOUT a
                    # scorecard — an ungraded interview still shows its questions.
                    "question_text": turn.prompt_text or turn.question.text,
                    # may be None for the OPEN turn (an in-progress interview's unanswered
                    # question). The scorecard skips those; the History transcript shows blank.
                    "answer": turn.answer,
                    "at": turn.created_at.isoformat(),
                    # the diagram sent while this turn was open (a DiagramDoc dump), or None. The
                    # grader takes each question's latest; the detail page draws it.
                    "diagram": turn.diagram,
                }
                for turn in interview.turns          # already ordered by created_at
            ],
            "summary": interview.summary,
        }


async def load_interview_state(interview_id: str) -> dict:
    """Everything `/api/answer` needs to run one turn. The READ half of the load -> run ->
    write-back cycle that replaced the SESSIONS dict.

    Returns {"ok": True, ...the spine...} or {"ok": False, "error": ...}.

    WHY THIS EXISTS SEPARATELY FROM get_interview: they serve different readers.
    `get_interview` backs the interview:// RESOURCE — what the grader and the model may see,
    i.e. the transcript. This is the backend's own working state, including
    `message_history`, which is the agent's replay buffer. Handing the model a copy of its
    own history through a resource would be both wasteful and confusing, so the two shapes
    stay apart.

    COLUMN QUERIES, NOT `select(Interview)`. This is the hot path (every turn), so it reads just the
    columns this dict needs: 3 statements. (Under the old always-eager lazy="selectin" models, loading
    the ORM row cascaded into 61 sequential statements, ~4-7s against Supabase, measured 2026-10-02.)
    """
    async with get_session() as db:
        # OUTER join on the current question: current_question_id is NULL before the first is picked.
        row = (await db.execute(
            select(
                Interview.id, Interview.profile_id, Interview.persona, Interview.followups_used,
                Interview.max_followups, Interview.done, Interview.message_history,
                Question.id, Question.slug, Question.text, QuestionType.has_diagram_canvas,
                Role.slug, Level.slug,
            )
            .outerjoin(Question, Interview.current_question_id == Question.id)
            .outerjoin(QuestionType, Question.type_id == QuestionType.id)
            .join(Role, Interview.role_id == Role.id)
            .join(Level, Interview.level_id == Level.id)
            .where(Interview.slug == interview_id)
        )).one_or_none()
        if row is None:
            return {"ok": False, "error": "Interview not found"}
        (pk, profile_id, persona, followups_used, max_followups, done, message_history,
         current_question_pk, current_qid, current_qtext, current_has_diagram_canvas,
         role_slug, level_slug) = row

        # asked = every question with a turn, plus the one on the table (as Interview.asked_question_ids)
        asked_ids = set((await db.execute(
            select(Question.slug).join(Turn, Turn.question_id == Question.id).where(Turn.interview_id == pk)
        )).scalars())
        if current_qid is not None:
            asked_ids.add(current_qid)

        # THE FROZEN PLAN drives advancing now (not next_question walking the whole bank): the next
        # question is the first one in the plan, by position, that hasn't been asked yet. None means
        # the plan is exhausted, which is the ADVANCE branch's cue to END the interview.
        plan = (await db.execute(
            select(Question.slug, Question.text, QuestionType.has_diagram_canvas)
            .join(InterviewQuestion, InterviewQuestion.question_id == Question.id)
            .join(QuestionType, Question.type_id == QuestionType.id)
            .where(InterviewQuestion.interview_id == pk)
            .order_by(InterviewQuestion.position)
        )).all()
        next_planned_qid = None
        next_planned_qtext = None
        next_planned_has_diagram_canvas = False
        for slug, text, has_diagram_canvas in plan:
            if slug not in asked_ids:
                next_planned_qid = slug
                next_planned_qtext = text
                next_planned_has_diagram_canvas = has_diagram_canvas
                break

        # THE CURRENT DIAGRAM — the question's newest non-NULL turns.diagram, the baseline /api/answer
        # compares an incoming diagram against. Only queried when the question has a canvas, so other
        # turns keep the 3-statement load.
        current_diagram = None
        if current_has_diagram_canvas:
            current_diagram = (await db.execute(
                select(Turn.diagram)
                .where(Turn.interview_id == pk, Turn.question_id == current_question_pk,
                       Turn.diagram.is_not(None))
                .order_by(Turn.id.desc())
                .limit(1)
            )).scalar_one_or_none()

        return {
            "ok": True,
            # Phase B — the owner, for require_ownership in /api/answer. RAW (a uuid.UUID or
            # None), not stringified: this dict is the backend's private working state and is
            # never serialized to anyone, so there's no JSON boundary to be safe for. The
            # comparison in auth.py stringifies both sides anyway.
            "profile_id": profile_id,
            "persona": persona,
            "current_qid": current_qid,
            "current_qtext": current_qtext,
            # the diagram canvas: whether the current question has one, and its latest diagram (a
            # DiagramDoc dump, or None if nothing has been sent for it yet)
            "current_has_diagram_canvas": bool(current_has_diagram_canvas),
            "current_diagram": current_diagram,
            "followups_used": followups_used,
            "max_followups": max_followups,
            "done": done,
            "role": role_slug,
            # Phase D — the interview's seniority (the `levels.slug`, e.g. "mid"), stored at kickoff.
            # (`role` above is the same idea for the role dimension.)
            "level": level_slug,
            "asked_ids": list(asked_ids),
            # the next plan question to advance to (slug + text), or None when the plan is spent.
            "next_planned_qid": next_planned_qid,
            "next_planned_qtext": next_planned_qtext,
            "next_planned_has_diagram_canvas": next_planned_has_diagram_canvas,
            "message_history": message_history
        }

# the * means that everything after it must be passed as a keyword,
# similar to *args, but *args also accepts additional keyword arguments that aren't listed,
# but * doesn't collect any additional arguments
async def save_interview_state(
    interview_id: str,
    *,
    current_qid: str | None = None,
    followups_used: int | None = None,
    message_history: list | None = None,
    done: bool | None = None,
) -> dict:
    """Write the spine back after a turn. The WRITE half of load -> run -> write-back.

    Returns {"ok": True, "interview_id": ...} or {"ok": False, "error": ...}.

    THE `*` IN THE SIGNATURE makes every field keyword-only, so calls read as
    `save_interview_state(iid, followups_used=2)` rather than a row of bare positional
    values whose meaning you'd have to count out. Each turn writes a DIFFERENT subset —
    a follow-up bumps `followups_used`, advancing sets `current_qid` and resets it to 0 —
    so passing "just the fields that changed" is the natural interface.

    None MEANS "DON'T TOUCH THIS COLUMN", for every field. That works because nothing ever
    needs to write NULL: when the bank runs out, the caller sets `done=True` and simply
    leaves `current_question_id` pointing at the last question asked. Any reader checks
    `done` first, so a stale current question is never ambiguous. (This holds because the
    ONLY caller is api.py — deterministic code that always knows which state it's in. If
    this ever became a general-purpose setter with many callers, "set to NULL" would need
    its own encoding, e.g. a sentinel default.)

    A NOTE ON WHY THIS IS ONE FUNCTION AND NOT FOUR SETTERS: everything it writes belongs to
    the same turn, so one call means one UPDATE in one transaction. Four setters would be
    four round-trips that could half-fail and leave the spine inconsistent with the history.
    """
    async with get_session() as db:
        interview_pk = await _interview_pk(db, interview_id)
        if interview_pk is None:
            return {"ok": False, "error": "interview is not found"}
        error = await _write_state(db, interview_pk, current_qid=current_qid, followups_used=followups_used,
                                   message_history=message_history, done=done)
        if error is not None:
            return {"ok": False, "error": error}
        await db.commit()
        return {"ok": True, "interview_id": interview_id}


# ===========================================================================
# THE PER-TURN WRITE HELPERS. Each takes an open `db` and does its part of a turn with ID-ONLY
# selects and plain UPDATE/INSERT statements: a write needs ids, not ORM rows, so it never pays
# for loading one. They don't commit, so commit_turn can run several in ONE transaction, and the public
# functions (save_interview_state, open_turn, record_answer) wrap each in its own.
# Each returns None on success, or an error string (the caller returns it without committing).
# ===========================================================================
async def _interview_pk(db, interview_id: str) -> int | None:
    """The interview's integer id from its slug, or None."""
    return (await db.execute(select(Interview.id).where(Interview.slug == interview_id))).scalar_one_or_none()


async def _question_pk(db, question_id: str) -> int | None:
    """The question's integer id from its slug, or None."""
    return (await db.execute(select(Question.id).where(Question.slug == question_id))).scalar_one_or_none()


async def _write_state(
    db,
    interview_pk: int,
    *,
    current_qid: str | None,
    followups_used: int | None,
    message_history: list | None,
    done: bool | None,
) -> str | None:
    """One UPDATE of the spine columns. None means "don't touch" (see save_interview_state)."""
    values = {}
    if current_qid is not None:
        question_pk = await _question_pk(db, current_qid)
        if question_pk is None:
            return "question not found"
        values["current_question_id"] = question_pk
    if followups_used is not None:
        values["followups_used"] = followups_used
    if message_history is not None:
        values["message_history"] = message_history
    if done is not None:
        values["done"] = done
    if values:
        # updated_at is bumped by the column's onupdate, which a Core UPDATE applies too
        await db.execute(update(Interview).where(Interview.id == interview_pk).values(**values))
    return None


async def _close_open_turn(db, interview_pk: int, question_id: str, answer: str) -> str | None:
    """Complete the one open turn with `answer`, guarded by `question_id` (see record_answer)."""
    question_pk = await _question_pk(db, question_id)
    if question_pk is None:
        return "interview or question does not exist"
    open_row = (await db.execute(
        select(Turn.id, Turn.question_id).where(Turn.interview_id == interview_pk, Turn.answer.is_(None))
    )).one_or_none()
    if open_row is None:
        # nothing was presented, or it was already answered — a real state error, not a
        # place to invent a turn (the client-driven flow always opens before it asks).
        return "no open turn to answer"
    if open_row.question_id != question_pk:
        # the open turn is for a different question than the caller thinks — refuse rather
        # than close the wrong one. This is the guard the question_id argument buys.
        return "open turn does not match the given question"
    await db.execute(update(Turn).where(Turn.id == open_row.id).values(answer=answer))
    return None


async def _add_open_turn(db, interview_pk: int, question_id: str, prompt_text: str) -> str | None:
    """Stage a new OPEN turn (answer NULL) for `question_id` (see open_turn)."""
    question_pk = await _question_pk(db, question_id)
    if question_pk is None:
        return "interview or question does not exist"
    db.add(Turn(
        interview_id=interview_pk,
        question_id=question_pk,
        prompt_text=prompt_text,
        answer=None,          # the defining mark of an OPEN turn
    ))
    # flush now, so the INSERT runs in order behind the UPDATEs above it (the one-open-turn index
    # needs the previous turn closed first)
    await db.flush()
    return None


async def commit_turn(
    interview_id: str,
    *,
    answered_qid: str | None = None,
    answer: str | None = None,
    current_qid: str | None = None,
    followups_used: int | None = None,
    message_history: list | None = None,
    done: bool | None = None,
    open_qid: str | None = None,
    open_prompt: str | None = None,
) -> dict:
    """Every write of one /api/answer turn, in ONE session and ONE transaction.

    In order, each step only when its arguments are given:
      1. CLOSE the open turn with `answer` (`answered_qid` is the guard, as in record_answer)
      2. WRITE the spine (current_qid / followups_used / message_history / done, as in
         save_interview_state, where None means "don't touch")
      3. OPEN the next turn (`open_qid` + `open_prompt`, as in open_turn)

    Close-before-open is what keeps the one-open-turn index satisfied. Doing all three in one
    transaction also means a failure leaves NOTHING half-written: either the turn is closed, the
    spine moved and the next turn opened, or none of it happened.

    Why it exists: record_answer + save_interview_state + open_turn each used to open a session and
    load the full ORM graph. This is ~5-6 small statements instead.

    Returns {"ok": True, "interview_id": ...} or {"ok": False, "error": ...} (nothing committed).
    """
    async with get_session() as db:
        interview_pk = await _interview_pk(db, interview_id)
        if interview_pk is None:
            return {"ok": False, "error": "interview is not found"}

        if answered_qid is not None:
            error = await _close_open_turn(db, interview_pk, answered_qid, answer or "")
            if error is not None:
                return {"ok": False, "error": error}

        error = await _write_state(db, interview_pk, current_qid=current_qid, followups_used=followups_used,
                                   message_history=message_history, done=done)
        if error is not None:
            return {"ok": False, "error": error}

        if open_qid is not None:
            error = await _add_open_turn(db, interview_pk, open_qid, open_prompt or "")
            if error is not None:
                return {"ok": False, "error": error}

        await db.commit()
        return {"ok": True, "interview_id": interview_id}


async def open_turn(interview_id: str, question_id: str, prompt_text: str) -> dict:
    """OPEN a turn: record that a prompt was PRESENTED, before any answer exists.

    Called whenever the interviewer puts a question or a follow-up probe to the candidate
    (POST /api/interview for the first question; the follow-up and advance branches of
    /api/answer for everything after). It writes a turn with `prompt_text` set and `answer`
    NULL — the "open" turn that record_answer will later complete.

    `question_id` is the PARENT bank question's slug (a probe has no id of its own, so its
    turn still files under the question it's probing — that's the grouping the scorecard
    relies on). `prompt_text` is the exact text shown: the bank question's text, or the probe.

    Returns {"ok": True, "interview_id": ...} or {"ok": False, "error": ...} if a slug doesn't
    resolve. The partial unique index means a SECOND open turn for the same interview raises
    instead of silently creating an ambiguous state — so always complete the current open turn
    (record_answer) before opening the next.
    """
    async with get_session() as db:
        interview_pk = await _interview_pk(db, interview_id)
        if interview_pk is None:
            return {"ok": False, "error": "interview or question does not exist"}
        error = await _add_open_turn(db, interview_pk, question_id, prompt_text)
        if error is not None:
            return {"ok": False, "error": error}
        await db.commit()
        return {"ok": True, "interview_id": interview_id}


async def save_open_turn_diagram(interview_id: str, question_id: str, diagram: dict) -> dict:
    """Store the candidate's diagram (a DiagramDoc dump) on the OPEN turn, replacing any earlier one
    sent during that turn.

    /api/answer calls this BEFORE the model decides what the message was, so the diagram lands on
    every path: a clarification or an answer request leaves the turn open, and the diagram stays on
    it until the turn closes. Writing it in commit_turn instead would lose it on those paths.
    `question_id` is the same guard as record_answer's.

    Returns {"ok": True, "interview_id": ...} or {"ok": False, "error": ...} (nothing written).
    """
    async with get_session() as db:
        interview_pk = await _interview_pk(db, interview_id)
        if interview_pk is None:
            return {"ok": False, "error": "interview is not found"}
        question_pk = await _question_pk(db, question_id)
        open_row = (await db.execute(
            select(Turn.id, Turn.question_id).where(Turn.interview_id == interview_pk, Turn.answer.is_(None))
        )).one_or_none()
        if open_row is None:
            return {"ok": False, "error": "no open turn to attach the diagram to"}
        if open_row.question_id != question_pk:
            return {"ok": False, "error": "open turn does not match the given question"}
        await db.execute(update(Turn).where(Turn.id == open_row.id).values(diagram=diagram))
        await db.commit()
        return {"ok": True, "interview_id": interview_id}


async def record_answer(interview_id: str, question_id: str, answer: str) -> dict:
    """COMPLETE the open turn with the candidate's answer — the write counterpart to open_turn.

    Finds the one open turn (`answer IS NULL`) for this interview and fills its answer. The
    partial unique index guarantees at most one open turn, so the lookup is unambiguous and the
    client never has to hand back a turn id (it only holds interview_id).

    `question_id` (the parent bank question slug) is NOT needed to find the turn — the open turn
    already knows its question — but it's kept as a GUARD: we verify the open turn is actually
    for the question the caller believes it's answering, and refuse on a mismatch rather than
    silently closing the wrong turn. Cheap insurance in a flow where the client and the server
    each track "the current question" independently.

    Returns {"ok": True, "interview_id": ..., "turn_count": N} (N = completed turns), or
    {"ok": False, "error": ...} if the interview/question is unknown, there's no open turn, or
    the open turn is for a different question.

    Note `answer` may be the empty string — a real (if blank) answer that still CLOSES the turn;
    NULL is reserved for "not yet answered". /api/answer guards truly empty input before here.
    """
    async with get_session() as db:
        interview_pk = await _interview_pk(db, interview_id)
        if interview_pk is None:
            return {"ok": False, "error": "interview or question does not exist"}
        error = await _close_open_turn(db, interview_pk, question_id, answer)
        if error is not None:
            return {"ok": False, "error": error}
        # completed turns, counted in the same transaction so it includes the one just closed
        completed = (await db.execute(
            select(func.count()).select_from(Turn)
            .where(Turn.interview_id == interview_pk, Turn.answer.is_not(None))
        )).scalar_one()
        await db.commit()
        return {"ok": True, "interview_id": interview_id, "turn_count": completed}


async def save_interview_summary(interview_id: str, feedback: str) -> dict:
    """Persist the final wrap-up feedback for an interview.

    Returns {"ok": True, "interview_id": ..., "status": "summarized"} or
    {"ok": False, "error": "..."}.

    """
    async with get_session() as db:
        stmt = await db.execute(select(Interview).where(Interview.slug == interview_id))
        interview = stmt.scalar_one_or_none()
        if (not interview):
            return {"ok": False, "error": "interview session not found"}
        interview.summary = feedback
        await db.commit()
        return {"ok": True, "interview_id": interview_id, "status": "summarized"}


# ===========================================================================
# PHASE C — SAVE & LIST INTERVIEWS PER USER.
#
# Phase B gave every interview an OWNER (`profile_id`). Phase C is what that ownership was
# FOR: a signed-in person can now (1) see the list of their own past interviews, and
# (2) reopen one — its transcript and its GRADE — without re-running (and re-paying for) the
# grader. Two of these three functions are the reads that back those two screens; the third
# is the write that finally makes a scorecard OUTLIVE the request that computed it.
#
# WHY THE GRADE HAS TO BE PERSISTED FOR ANY OF THIS TO WORK: today /api/scorecard computes a
# scorecard and returns it, and the moment the response is sent it's gone — re-opening the
# interview later would mean grading all over again (more LLM cost, and a DIFFERENT result,
# since the model isn't deterministic). save_scorecard below is the fix: the grade becomes
# rows, so "show me how I did on that interview last week" is a read, not a re-grade.
# ===========================================================================


# What _simulation_fields reads (job slug/company, round name).
SIMULATION_LOADS = (
    selectinload(Interview.job),
    selectinload(Interview.round_type),
)
# What _interview_card reads. Relationships are lazy="raise" (see db/models.py), so a query feeding
# cards loads exactly these: one batched query per relationship for the whole page, nothing deeper.
CARD_LOADS = (
    selectinload(Interview.role),
    selectinload(Interview.level),
    selectinload(Interview.scorecard),
    *SIMULATION_LOADS,
)
# What _interview_rubric reads: the round's rubric for a simulation, the role's for a bank interview,
# each with its dimensions. Both paths load (which one applies is only known per row).
RUBRIC_LOADS = (
    selectinload(Interview.role).selectinload(Role.rubric).selectinload(Rubric.dimensions),
    selectinload(Interview.round_type).selectinload(RoundType.rubric).selectinload(Rubric.dimensions),
)
# A graded interview's scores, down to each score's dimension name (get_scorecard, the dashboard).
SCORE_LOADS = (
    selectinload(Interview.scorecard).selectinload(Scorecard.entries)
    .selectinload(ScorecardEntry.scores).selectinload(ScorecardEntryScore.dimension),
)
# The transcript: each turn with its parent question (get_interview, load_resume_payload).
TURN_LOADS = (
    selectinload(Interview.turns).selectinload(Turn.question),
)


def _interview_card(iv: Interview) -> dict:
    """One interview as the History list / dashboard table renders it — the SUMMARY, not the
    transcript. Needs CARD_LOADS. role/level are the human-readable NAMES, and `overall` is the
    grade if scored else None (the 1:1 `interview.scorecard`). The ONE card shape, shared by the
    list, the `?resumable=true` narrowing, and get_resumable_interview so they can't drift apart.

    `job_id` / `company` / `round` are set only on a SIMULATION (None on a bank interview) — the
    badge the list shows and the link back to the job."""
    return {
        "interview_id": iv.slug,
        "role": iv.role.name,
        "level": iv.level.name,
        "created_at": iv.created_at.isoformat(),
        "done": iv.done,
        "overall": iv.scorecard.overall if iv.scorecard is not None else None,
        **_simulation_fields(iv),
    }


def _simulation_fields(iv: Interview) -> dict:
    """The simulation display fields shared by the list card, the detail view and resume: the job's
    slug + company and the round's name, all None for a bank interview. Needs SIMULATION_LOADS."""
    return {
        "job_id": iv.job.slug if iv.job is not None else None,
        "company": iv.job.company if iv.job is not None else None,
        "round": iv.round_type.name if iv.round_type is not None else None,
    }


async def list_interviews(
    profile_id: str,
    params: Params,
    *,
    q: str | None = None,
    role: str | None = None,
    level: str | None = None,
    sort: str | None = None,
    order: str | None = None,
    scored: bool = False,
    job: str | None = None,
    simulation: bool | None = None,
) -> dict:
    """A PAGE of one user's interviews, newest first, optionally filtered — backs GET /api/interviews.

    WORKED EXAMPLE — the owner-scoped LIST. The single line that matters for security is the WHERE
    clause `Interview.profile_id == profile_id`: that one predicate is the entire difference between
    "my history" and "everyone's interviews". The caller (api.py) passes the *verified* uid from the
    JWT, never an id from the request body — otherwise this becomes "list ANYONE's interviews".

    PAGING is the library's (fastapi-pagination's `apaginate` runs the COUNT + LIMIT/OFFSET over our
    statement), FILTERING is ours — the same division of labour as list_roles/list_levels:
      - role / level: the vocab SLUG (the wire's identifier everywhere). Matched via a join to the
        Role/Level table on its unique slug — the id stays internal.
      - q: a case-insensitive substring match on the role OR level NAME (deliberately narrow — not
        question/transcript text).
      - scored: when True, keep ONLY graded interviews (those with a scorecard). This is the
        Interviews list's default VIEW (the client sends scored=true) — an unfinished or abandoned
        interview has no grade to show, so the "Score" column would be blank and the row is just
        clutter; the page's "Show all" toggle drops the flag to reveal them. Expressed as
        `Interview.scorecard.has()`, an EXISTS subquery rather than a join, so it composes with the
        score-sort OUTER join below without turning that into an inner join or double-counting rows.
      - job: a job SLUG — only that job's simulations (the Job page's "Simulations" list). Also an
        EXISTS (`Interview.job.has(...)`), for the same reason as `scored`. Another user's job slug
        just matches nothing: the owner predicate above still applies.
      - simulation: tri-state on the interview's KIND — True = simulations only (`job_id IS NOT
        NULL`, the dashboard's Past interviews card, matching its simulation-only signal panel),
        False = bank interviews only, None = both. A plain column predicate, no join.
    Each relationship is joined AT MOST ONCE (guarded on whether any filter references it), which is
    why q + role can coexist without joining Role twice. The joins are 1:1 so they can't multiply
    rows; CARD_LOADS still loads role/level for display via its own query — these joins are WHERE-only.

    NOTE this is deliberately SEPARATE from get_resumable_interview: the resume banner never routes
    through here (the endpoint short-circuits `?resumable=true` before calling this), so hiding
    unscored interviews from the list can't affect which interview is resumable.

    Returns the Page envelope {items, total, page, size, pages} — items are `_interview_card` dicts.
    The SAME envelope the `?resumable=true` path returns (a 0-or-1 page), so one response type serves
    the whole endpoint.

    SORT: the default is `updated_at desc` — "last active" first, what a resume/review list wants. The
    Interviews page's Date and Score column arrows override it via `sort` ("date"|"score") + `order`
    ("asc"|"desc"); anything else falls back to the default. Score lives on the 1:1 scorecard, so that
    branch LEFT-joins it (ungraded interviews still appear) and keeps their NULL score at the bottom
    regardless of direction — an ungraded row is never "the best" or "the worst" score.
    """
    descending = order != "asc"  # default desc; only an explicit "asc" flips it
    async with get_session() as db:
        stmt = select(Interview).where(Interview.profile_id == profile_id).options(*CARD_LOADS)
        if q or role:
            stmt = stmt.join(Interview.role)
        if q or level:
            stmt = stmt.join(Interview.level)
        if role:
            stmt = stmt.where(Role.slug == role)
        if level:
            stmt = stmt.where(Level.slug == level)
        if q:
            stmt = stmt.where(or_(Role.name.ilike(f"%{q}%"), Level.name.ilike(f"%{q}%")))
        if scored:
            # EXISTS on the 1:1 scorecard — keeps graded interviews only, without a join (so the
            # score-sort outerjoin below stays an OUTER join and rows aren't multiplied).
            stmt = stmt.where(Interview.scorecard.has())
        if job:
            stmt = stmt.where(Interview.job.has(Job.slug == job))
        if simulation is not None:
            stmt = stmt.where(
                Interview.job_id.is_not(None) if simulation else Interview.job_id.is_(None)
            )
        if sort == "date":
            col = Interview.created_at
            stmt = stmt.order_by(col.desc() if descending else col.asc())
        elif sort == "score":
            stmt = stmt.outerjoin(Interview.scorecard)
            col = Scorecard.overall
            stmt = stmt.order_by((col.desc() if descending else col.asc()).nulls_last())
        else:
            stmt = stmt.order_by(Interview.updated_at.desc())
        page = await apaginate(db, stmt, params)
        return {
            "items": [_interview_card(iv) for iv in page.items],
            "total": page.total,
            "page": page.page,
            "size": page.size,
            "pages": page.pages,
        }


def _interview_rubric(iv: Interview) -> Rubric | None:
    """The rubric an interview is graded on: its ROUND's for a simulation (a behavioral answer must
    not be scored on "Technical depth"), its ROLE's for a bank interview. Read off the ROW, never
    from the request — one rule shared by grading and save_scorecard, so the dimension names the
    grader scores are exactly the ones the scorecard resolves. Needs RUBRIC_LOADS."""
    if iv.round_type is not None:
        return iv.round_type.rubric
    return iv.role.rubric


async def load_grading_context(interview_id: str) -> dict:
    """What /api/scorecard hands the grader beyond the transcript: the rubric (dimension names + a
    scale), plus — for a simulation — the job and round context the grading template frames the
    answer with. Returns {"status": "ok", "role", "dimensions", "scale", "job_context", "round_note"}
    or {"status": "not_found"} (unknown interview, or its role/round has no rubric)."""
    async with get_session() as db:
        interview = (
            await db.execute(
                select(Interview).where(Interview.slug == interview_id)
                .options(*RUBRIC_LOADS, selectinload(Interview.job))
            )
        ).scalar_one_or_none()
        if interview is None:
            return {"status": "not_found"}
        rubric = _interview_rubric(interview)
        if rubric is None:
            return {"status": "not_found"}
        job, round_row = interview.job, interview.round_type
        return {
            "status": "ok",
            "role": interview.role.slug,
            "dimensions": [dim.name for dim in rubric.dimensions],
            "scale": rubric.scale,
            "job_context": (f"{job.company} — {job.title}\n{job.summary}" if job is not None else ""),
            "round_note": (f"{round_row.name} round — {round_row.description}"
                           if round_row is not None else ""),
        }


async def save_scorecard(interview_id: str, overall: float, answers: list[dict]) -> dict:
    """Persist a computed scorecard as rows — the WRITE that makes a grade durable.

    WORKED EXAMPLE — and the one genuinely new shape in this phase: a THREE-LEVEL nested
    write (scorecard -> entries -> per-dimension scores) plus a NAME -> ID resolution the
    schema forces on us. Everything else in this module has been a single-table insert or a
    field assignment; this is the first time we build an object GRAPH.

    `answers` is exactly what api.py's /api/scorecard already assembles — one dict per graded
    question:
        {"question_id": <slug>, "question_text": ...,
         "dimension_scores": [{"dimension": <name>, "score": 1-5, "note": ...}, ...],
         "strength": ..., "gap": ..., "improvement": ...}
    (`question_text` and each `note` are IGNORED here on purpose — see the two notes below.)

    Returns {"ok": True, "interview_id": ...} or the {"ok": False, "error": ...} envelope.

    TWO THINGS THE NORMALIZED SCHEMA MAKES US DO, and both are the point of Phase A paying off:

      1. DIMENSION NAME -> rubric_dimensions.id. The grader hands back a dimension by its NAME
         ("Tradeoff reasoning"), because that's what we put in the rubric text it graded
         against. But ScorecardEntryScore points at a rubric_dimensions ROW, not a string —
         that's the whole reason a reworded dimension can't orphan old scores. So we resolve
         each name to its id via the role's rubric, and DROP any score whose name doesn't
         resolve rather than writing it under a guess (the same "don't invent an id" rule the
         turn loop follows). The map is built from the interview's rubric dimensions
         (RUBRIC_LOADS).

      2. THE per-dimension `note` IS NOT STORED. ScorecardEntryScore has `dimension_id` +
         `score` and nothing else — the schema chose to keep only the number, since the notes
         are long and were never queried. Consequence to know (it surfaces in get_scorecard):
         a scorecard re-read from the DB has the scores but not the sentence-per-dimension the
         LIVE grader produced. If History ever needs those notes, the fix is one `note` column
         here + a migration; today it's a deliberate omission, not a bug.

    IDEMPOTENCY: /api/scorecard can be hit more than once (the user clicks "End interview"
    again, or re-opens and re-grades). One interview should have ONE scorecard, so we delete
    any existing one first — a SQL DELETE, so the database's ON DELETE CASCADE on entries and
    their scores tears down the children in the same statement — then insert the fresh grade.
    """
    async with get_session() as db:
        interview = (
            await db.execute(
                select(Interview).where(Interview.slug == interview_id).options(*RUBRIC_LOADS)
            )
        ).scalar_one_or_none()
        if interview is None:
            return {"ok": False, "error": "unknown interview"}
        rubric = _interview_rubric(interview)
        if rubric is None:
            return {"ok": False, "error": f"interview {interview_id} has no rubric"}

        # (1) the NAME -> ID map, built once from this interview's rubric dimensions (the round's for
        #     a simulation, the role's otherwise — see _interview_rubric).
        name_to_id = {dim.name: dim.id for dim in rubric.dimensions}

        # idempotency: drop a prior scorecard for this interview. A SQL DELETE, not db.delete(row):
        # the ORM delete would LOAD entries + scores to cascade them in Python (relationships are
        # lazy="raise", so it can't), while the DB's ON DELETE CASCADE does it in one statement.
        # It runs now, in order, before the re-insert in this transaction.
        await db.execute(delete(Scorecard).where(Scorecard.interview_id == interview.id))

        # (2) build the object graph top-down. Appending to a cascaded relationship is all it
        #     takes — SQLAlchemy assigns the foreign keys (scorecard_id, entry_id) itself when
        #     it flushes, so we never touch them by hand.
        scorecard = Scorecard(interview_id=interview.id, overall=overall)
        for ans in answers:
            question_pk = await _question_pk(db, ans["question_id"])
            if question_pk is None:
                continue   # a slug that isn't a real question can't be graded onto a row
            entry = ScorecardEntry(
                question_id=question_pk,
                strength=ans["strength"],
                gap=ans["gap"],
                improvement=ans["improvement"],
            )
            for ds in ans.get("dimension_scores", []):
                dim_id = name_to_id.get(ds["dimension"])
                if dim_id is None:
                    continue   # unresolved dimension name -> drop, don't guess (see note 1)
                entry.scores.append(
                    ScorecardEntryScore(dimension_id=dim_id, score=ds["score"])
                )
            scorecard.entries.append(entry)

        db.add(scorecard)
        await db.commit()
        return {"ok": True, "interview_id": interview_id}


async def get_scorecard(interview_id: str) -> dict:
    """Read a PERSISTED scorecard back into the same shape /api/scorecard returns live.

    TODO — the read-back half of save_scorecard, and the reason History can show a past grade
    without re-running the grader. It walks the same three levels in reverse
    (scorecard -> entries -> scores) and rebuilds the wire shape the frontend already knows
    (see api.ts `Scorecard`), so the SAME <ScorecardView> component renders a live grade and a
    remembered one with no changes.

    Return contract:
      - no scorecard for this interview yet  -> {"status": "not_found"}
      - found -> {
            "status": "ok",
            "interview_id": interview_id,
            "overall": scorecard.overall,
            "answers": [ {                                   # one per ScorecardEntry
                "question_id":   entry.question.slug,
                "question_text": entry.question.text,        # join to questions for the text
                "strength": ..., "gap": ..., "improvement": ...,
                "dimension_scores": [ {                      # one per ScorecardEntryScore
                    "dimension": score.dimension.name,       # id -> name, back for display
                    "score": score.score,
                    "note": "",   # NOT STORED — see save_scorecard note (2). Empty on read-back.
                }, ... ],
            }, ... ],
            "dimension_averages": { <dimension name>: <avg>, ... },
        }

    POINTERS:
      - resolve the slug: select(Interview).where(Interview.slug == interview_id); if it or
        `interview.scorecard` is None, return {"status": "not_found"}.
      - the query loads the nested rows (SCORE_LOADS + each entry's question): `scorecard.entries`,
        each `entry.scores`, and `score.dimension` — no extra queries, just walk them.
      - `dimension_averages` is NOT a stored column (only `overall` is cached). Recompute it
        here the same way grading.aggregate does: bucket every ScorecardEntryScore by its
        dimension NAME, average each bucket, round(…, 2). This is a read, so a plain Python
        loop over the loaded rows is fine — no GROUP BY SQL needed.
      - `note` is gone (save_scorecard didn't store it): emit "" so <ScorecardView> still
        renders. If that emptiness ever matters, that's the signal to add the column.

    Once this returns real data, GET /api/interviews/{id} lights up and the History detail view
    shows the remembered grade.
    """
    async with get_session() as db:
        interview = (await db.execute(
            select(Interview).where(Interview.slug == interview_id)
            .options(*SCORE_LOADS,
                     selectinload(Interview.scorecard).selectinload(Scorecard.entries)
                     .selectinload(ScorecardEntry.question))
        )).scalar_one_or_none()
        if interview is None or interview.scorecard is None:
            return {"status": "not_found"}

        answers = []
        # flat (dimension_name, score) pairs across EVERY entry — the shape aggregate_scores
        # takes. No `dimensions` whitelist needed here: save_scorecard already dropped anything
        # that didn't resolve to a real rubric dimension, so the persisted rows are clean.
        all_pairs: list[tuple[str, int]] = []
        for entry in interview.scorecard.entries:
            dimension_scores = []
            for score in entry.scores:
                dimension_scores.append({
                    "dimension": score.dimension.name,
                    "score": score.score,
                    "note": "",   # NOT STORED — see save_scorecard note (2); empty on read-back
                })
                all_pairs.append((score.dimension.name, score.score))
            answers.append({
                "question_id": entry.question.slug,
                "question_text": entry.question.text,
                "strength": entry.strength,
                "gap": entry.gap,
                "improvement": entry.improvement,
                "dimension_scores": dimension_scores,
            })

        agg = aggregate_scores(all_pairs)
        return {
            "status": "ok",
            "interview_id": interview_id,
            "answers": answers,
            "dimension_averages": agg["dimension_averages"],
            # the PERSISTED overall is authoritative (it's what the History list sorts on and
            # what was cached at grade time) — use it rather than the recomputed agg["overall"],
            # which could differ if any score was dropped at write time.
            "overall": interview.scorecard.overall,
        }


    return {"status": "not_found"}


# ===========================================================================
# DASHBOARD & PROFILE — the signal panel's role-scoped aggregates, plus the per-user
# default the panel and the kickoff form open on.
#
# Everything the dashboard shows already EXISTS in the scorecard rows — this section only
# reads and reshapes it, no new stored facts. The three cards map straight onto the grade:
#   Readiness       -> each graded interview's `scorecards.overall`, oldest -> newest (a trend)
#   Skill breakdown -> per-dimension averages across those interviews' ScorecardEntryScore rows
#   Work on next    -> the `improvement` line off recent ScorecardEntry rows
# The dashboard tracks INTERVIEW SIMULATIONS (the app's main mode), and all THREE cards are scoped
# to ONE ROUND TYPE, because a simulation is graded on its round's rubric — averaging a coding
# round's "Code correctness" with a behavioral round's dimensions would blend two different bars.
# The round is the user's pick, else the round of their most recently graded simulation. An
# optional job narrows it further (one company's rounds); omitted = across every job.
# ===========================================================================

# How many "work on next" improvement lines the dashboard surfaces — the most recent few, so
# the list stays a short prompt to act on rather than a full backlog.
WORK_ON_NEXT_CAP = 5

# The selectable TIME WINDOW the dashboard aggregates over — the client picks one, so readiness is
# a recent-trend signal rather than a lifetime archive, and the query is bounded by date instead of
# an arbitrary count no matter how many interviews a heavy user has done. Each maps to a lookback
# from "now"; an unrecognised (or missing) value falls back to the default below.
DASHBOARD_PERIODS = {
    "week": timedelta(days=7),
    "month": timedelta(days=30),
    "year": timedelta(days=365),
}
DASHBOARD_DEFAULT_PERIOD = "month"


async def get_profile(profile_id: str) -> dict:
    """This user's profile row — display name + their default role/level (each as slug + name,
    or None if unset). Backs GET /api/profile, which seeds the kickoff form's pre-fill and the
    signal panel's initial role. Loads only `role`/`level` (it used to drag in every interview
    the user had, via the old always-eager Profile.interviews)."""
    async with get_session() as db:
        profile = (
            await db.execute(
                select(Profile).where(Profile.id == profile_id)
                .options(selectinload(Profile.role), selectinload(Profile.level))
            )
        ).scalar_one_or_none()
        if profile is None:
            return {"status": "not_found"}
        return {
            "status": "ok",
            "display_name": profile.display_name,
            "avatar_url": profile.avatar_url,  # None => the client renders initials instead
            "role": ({"slug": profile.role.slug, "name": profile.role.name}
                     if profile.role is not None else None),
            "level": ({"slug": profile.level.slug, "name": profile.level.name}
                      if profile.level is not None else None),
        }


async def set_profile_defaults(
    profile_id: str, role_slug: str | None = None, level_slug: str | None = None
) -> dict:
    """Set this user's default role and/or level — backs PATCH /api/profile. Each arg is a SLUG
    the route received; None means "leave this one alone" (same don't-touch convention as
    save_interview_state), so the caller can update role, level, or both. Resolves the slug to a
    row and refuses an unknown one rather than storing a dangling id.

    Returns {"ok": True} or {"ok": False, "error": ...}."""
    async with get_session() as db:
        profile = (
            await db.execute(select(Profile).where(Profile.id == profile_id))
        ).scalar_one_or_none()
        if profile is None:
            return {"ok": False, "error": "profile not found"}
        if role_slug is not None:
            role = (
                await db.execute(select(Role).where(Role.slug == role_slug))
            ).scalar_one_or_none()
            if role is None:
                return {"ok": False, "error": f"unknown role: {role_slug}"}
            profile.role_id = role.id
        if level_slug is not None:
            level = (
                await db.execute(select(Level).where(Level.slug == level_slug))
            ).scalar_one_or_none()
            if level is None:
                return {"ok": False, "error": f"unknown level: {level_slug}"}
            profile.level_id = level.id
        await db.commit()
        return {"ok": True}


async def set_profile_avatar(profile_id: str, avatar_url: str | None) -> dict:
    """Set or clear this user's profile picture URL — the avatar is a SINGLETON SUB-RESOURCE of the
    profile with its own endpoints, so this backs BOTH sides of it: PUT /api/profile/avatar passes a
    real URL (set/replace), DELETE passes None (remove). It's split out from set_profile_defaults on
    purpose: role/level use a None = "leave alone" convention, but clearing the avatar IS setting it
    to None, so the two meanings would collide. A dedicated endpoint has no "leave alone" case — it
    always writes exactly the value it was given — which is what lets it stay sentinel-free.

    The URL itself is validated by the route (it must point at our own Storage bucket) before we get
    here, so this just writes it. Returns {"ok": True} or {"ok": False, "error": ...}."""
    async with get_session() as db:
        profile = (
            await db.execute(select(Profile).where(Profile.id == profile_id))
        ).scalar_one_or_none()
        if profile is None:
            return {"ok": False, "error": "profile not found"}
        profile.avatar_url = avatar_url
        await db.commit()
        return {"ok": True}


def _empty_readiness() -> dict:
    """The readiness block when there's nothing graded for the selected round — no series, no
    latest, no delta. The client renders the empty-state placeholder from `count == 0`."""
    return {"series": [], "latest": None, "delta": None, "count": 0}


async def get_dashboard(
    profile_id: str,
    round_slug: str | None = None,
    job_slug: str | None = None,
    period: str | None = None,
) -> dict:
    """The signal panel's round-scoped aggregates over the user's SIMULATIONS — readiness trend,
    skill breakdown, work-on-next.

    ROUND RESOLUTION (the "effective round" the panel opens on):
      1. the slug the client asked for (the picker's current value), if given and real;
      2. else the round of the user's most-recently-graded simulation;
      3. else None — the user has no graded simulations at all (a first-visit empty state).
    The chosen round's slug + name are echoed back so the picker can seed its label without a
    second lookup. Resolution is NOT time-bounded — we pick a sensible round first, then the
    window filters its interviews (so a too-narrow window shows that round's empty state, not a
    different round's data).

    JOB FILTER: `job_slug` narrows to one job's simulations (an EXISTS on the job's slug, like
    list_interviews(job=)); omitted = across every job. The query is owner-scoped on the verified
    uid, so another user's job slug just matches nothing — no separate authorization needed. The
    job's "company · title" is echoed back (None when unfiltered or not the caller's).

    TIME WINDOW: `period` ("week"|"month"|"year", default "month") bounds the aggregates to
    interviews graded within that lookback — the client's window control. The effective period is
    echoed back so the client can reflect what was actually applied.

    Then, over this user's GRADED simulations OF THAT ROUND within the window, oldest -> newest:
      readiness       — `overall` per interview as a series (the sparkline), plus latest, the
                        delta across the window (latest - earliest, None with < 2), and the count.
      skill_breakdown — every ScorecardEntryScore averaged per dimension, in the ROUND rubric's own
                        dimension order (aggregate_scores with that whitelist both orders and drops
                        any stray name). One {dimension, average} per bar.
      work_on_next    — the `improvement` line off recent entries (newest interview first), capped.

    The queries load the nested rows (scorecard -> entries -> scores -> dimension via SCORE_LOADS,
    and the round's rubric -> dimensions), so this walks them in Python — no GROUP BY SQL — exactly
    like get_scorecard.

    BANK INTERVIEWS ARE EXCLUDED (`job_id IS NOT NULL` on every query here). A bank interview is
    graded on its ROLE's rubric, so its dimensions wouldn't line up with the round's skill bars.
    """
    period = period if period in DASHBOARD_PERIODS else DASHBOARD_DEFAULT_PERIOD
    cutoff = datetime.now(timezone.utc) - DASHBOARD_PERIODS[period]
    # the skill breakdown reads the round's rubric dimensions, whichever way the round resolves
    rubric_loads = selectinload(RoundType.rubric).selectinload(Rubric.dimensions)
    async with get_session() as db:
        # (1)-(3) resolve the effective round.
        round_row = None
        if round_slug:
            round_row = (
                await db.execute(
                    select(RoundType).where(RoundType.slug == round_slug).options(rubric_loads)
                )
            ).scalar_one_or_none()
        if round_row is None and not round_slug:
            recent = (
                await db.execute(
                    select(Interview)
                    .join(Interview.scorecard)   # inner join -> graded interviews only
                    .where(Interview.profile_id == profile_id, Interview.job_id.is_not(None))
                    .order_by(Interview.created_at.desc())
                    .limit(1)
                    .options(selectinload(Interview.round_type).options(rubric_loads))
                )
            ).scalar_one_or_none()
            if recent is not None:
                round_row = recent.round_type

        # the job filter's display name — owner-scoped, so a stranger's slug resolves to None.
        job_row = None
        if job_slug:
            job_row = (
                await db.execute(
                    select(Job).where(Job.slug == job_slug, Job.profile_id == profile_id)
                )
            ).scalar_one_or_none()
        job_name = f"{job_row.company} · {job_row.title}" if job_row is not None else None

        if round_row is None:
            return {
                "round": None,
                "round_name": None,
                "job": job_row.slug if job_row is not None else None,
                "job_name": job_name,
                "period": period,
                "readiness": _empty_readiness(),
                "skill_breakdown": [],
                "work_on_next": [],
            }

        # this round's graded simulations WITHIN THE WINDOW, oldest -> newest (the trend's natural
        # order). The `created_at >= cutoff` predicate is the time-window filter.
        stmt = (
            select(Interview)
            .join(Interview.scorecard)
            .where(
                Interview.profile_id == profile_id,
                Interview.job_id.is_not(None),
                Interview.round_type_id == round_row.id,
                Interview.created_at >= cutoff,
            )
        )
        if job_slug:
            stmt = stmt.where(Interview.job.has(Job.slug == job_slug))
        interviews = (
            await db.execute(stmt.order_by(Interview.created_at.asc()).options(*SCORE_LOADS))
        ).scalars().all()

        series = [iv.scorecard.overall for iv in interviews]
        readiness = _empty_readiness()
        if series:
            readiness = {
                "series": series,
                "latest": series[-1],
                # delta across the shown window; None until there are two points to compare.
                "delta": round(series[-1] - series[0], 2) if len(series) >= 2 else None,
                "count": len(series),
            }

        # skill breakdown — flatten every (dimension_name, score) pair, average per dimension in
        # the rubric's declared order (the whitelist also drops anything not in this rubric).
        pairs: list[tuple[str, int]] = []
        for iv in interviews:
            for entry in iv.scorecard.entries:
                for score in entry.scores:
                    pairs.append((score.dimension.name, score.score))
        dim_names = (
            [d.name for d in round_row.rubric.dimensions] if round_row.rubric is not None else None
        )
        agg = aggregate_scores(pairs, dim_names)
        skill_breakdown = [
            {"dimension": name, "average": avg}
            for name, avg in agg["dimension_averages"].items()
        ]

        # work on next — the improvement lines off the most recent interviews first, capped.
        work_on_next: list[str] = []
        for iv in reversed(interviews):          # newest first
            for entry in iv.scorecard.entries:
                if entry.improvement:
                    work_on_next.append(entry.improvement)
                    if len(work_on_next) >= WORK_ON_NEXT_CAP:
                        break
            if len(work_on_next) >= WORK_ON_NEXT_CAP:
                break

        return {
            "round": round_row.slug,
            "round_name": round_row.name,
            "job": job_row.slug if job_row is not None else None,
            "job_name": job_name,
            "period": period,
            "readiness": readiness,
            "skill_breakdown": skill_breakdown,
            "work_on_next": work_on_next,
        }


# ===========================================================================
# RESUME — reopen an in-progress interview where the candidate left off.
#
# The design leans entirely on the OPEN-TURN model already in place: a non-finished
# interview always has exactly one turn with `answer IS NULL` (the partial unique index
# guarantees it), and that turn's `prompt_text` IS "the last question the interviewer asked".
# So resuming is a pure READ — no state is mutated. The completed turns are the transcript to
# redraw; the open turn is where the candidate picks back up. The next POST /api/answer then
# continues from `message_history` + that same open turn, exactly as if the page had never
# closed. (Clarification back-and-forth isn't in `turns` — it lives only in message_history,
# which the model still replays — so the redrawn transcript shows the Q&A spine, matching the
# History detail view.)
#
# THE PRODUCT RULE: an unfinished interview is resumable ONLY while it's the user's single
# most-recent interview. Starting a NEW interview therefore RETIRES the previous unfinished one
# for good — the new row is now the most recent, and the old one can never be resumed again, even
# after the new interview finishes. That's enforced on the backend (not just hidden in the client)
# via get_resumable_interview below, so bypassing the UI can't reopen a stale interview.
# ===========================================================================


async def get_resumable_interview(profile_id: str) -> dict | None:
    """This user's ONE resumable interview — their most-recent interview, but only if it's still
    unfinished — or None.

    Backs `GET /api/interviews?resumable=true` (the banner asks for just this, so the client never
    pulls the whole history to find it) AND the guard in /api/interviews/{id}/resume (which compares
    the requested id against this one). One query answers "is there a resumable interview, and
    which?", so the two callers can't disagree.

    A single indexed `LIMIT 1` — not the full list — because that's all "the resumable one" needs.
    Ordered by `updated_at desc`, the SAME sort list_interviews uses, so this and the History list
    agree on recency. `updated_at` doubles as "last active" (every /api/answer write bumps it), so
    resuming-and-answering keeps an interview the resumable one, while STARTING a new interview
    makes the NEW row the most recent — and because we look at the most-recent interview REGARDLESS
    of `done` and bail unless it's unfinished, the superseded one is retired permanently, not merely
    demoted until the new interview finishes.

    Returns the SAME card shape list_interviews yields (so `?resumable=true` and the full list share
    one response type), or None when the most-recent interview is finished (or the user has none).
    On the returned card `done` is always False and `overall` is None (an unfinished interview isn't
    graded), but they're included so the shape matches exactly. Loads CARD_LOADS for the card.
    """
    async with get_session() as db:
        interview = (
            await db.execute(
                select(Interview)
                .where(Interview.profile_id == profile_id)
                .order_by(Interview.updated_at.desc())
                .limit(1)
                .options(*CARD_LOADS)
            )
        ).scalar_one_or_none()
        # Resumable ONLY if the user's single most-recent interview is itself unfinished. The
        # instant a NEWER interview exists — which starting a new one guarantees — this returns
        # None for the older unfinished one, and never resurfaces it even after that newer
        # interview finishes. (The old `done.is_(False)` filter picked the most-recent UNFINISHED
        # row, which reappeared once a newer finished one no longer masked it.)
        if interview is None or interview.done:
            return None
        return _interview_card(interview)


async def load_resume_payload(interview_id: str) -> dict:
    """Everything the frontend needs to REDRAW an in-progress interview and pick up the answer.

    A purpose-built read (kept separate from get_interview so the interview:// resource and
    /api/scorecard shapes don't move): it walks the turns ONCE and splits them into

        turns            — the COMPLETED exchanges (answer is not None), oldest-first, each the
                           exact prompt shown + the candidate's answer — i.e. the transcript.
        current_question — the OPEN turn's prompt (answer is None): the question on the table,
                           what the candidate resumes by answering. None if there somehow isn't
                           one (a finished interview, or a data slip — the endpoint guards done).

    Returns {"status": "ok", ...} with `role`/`level` as human-readable NAMES (the session
    header shows them) and `profile_id` STRINGIFIED for require_ownership, or
    {"status": "not_found"} for an unknown slug.
    """
    async with get_session() as db:
        interview = (
            await db.execute(
                select(Interview).where(Interview.slug == interview_id)
                .options(selectinload(Interview.role), selectinload(Interview.level),
                         selectinload(Interview.current_question).selectinload(Question.type),
                         *SIMULATION_LOADS, *TURN_LOADS)
            )
        ).scalar_one_or_none()
        if interview is None:
            return {"status": "not_found"}

        turns: list[dict] = []
        current_question: str | None = None
        # the current question's latest diagram (its newest non-NULL turns.diagram, the open turn's
        # included), which reseeds the canvas
        diagram: dict | None = None
        for turn in interview.turns:          # already ordered by created_at
            prompt = turn.prompt_text or turn.question.text
            if turn.question_id == interview.current_question_id and turn.diagram is not None:
                diagram = turn.diagram
            if turn.answer is None:
                # the OPEN turn — the question awaiting an answer (the resume point)
                current_question = prompt
            else:
                turns.append({
                    "question_id": turn.question.slug,
                    "question_text": prompt,
                    "answer": turn.answer,
                    "at": turn.created_at.isoformat(),
                })

        return {
            "status": "ok",
            "interview_id": interview.slug,
            "profile_id": str(interview.profile_id) if interview.profile_id else None,
            "done": interview.done,
            "role": interview.role.name,
            "level": interview.level.name,
            "turns": turns,
            "current_question": current_question,
            # INTERVIEW SIMULATION — so a round resumes into the right UI: the job/company/round for
            # the header, whether to show the code editor, and the PARENT question on the table (its
            # full text — the coding panel's problem statement — even while a probe is the open turn).
            **_simulation_fields(interview),
            "has_code_editor": (interview.round_type.has_code_editor
                                if interview.round_type is not None else False),
            # None for a bank interview (no round) — the SPA keeps its free manual/smart choice there.
            "allows_smart_voice": (interview.round_type.allows_smart_voice
                                   if interview.round_type is not None else None),
            "question": ({"slug": interview.current_question.slug,
                          "text": interview.current_question.text,
                          "has_diagram_canvas": interview.current_question.type.has_diagram_canvas}
                         if interview.current_question is not None else None),
            "diagram": diagram,
        }


if __name__ == "__main__":
    # Smoke test with no LLM and no MCP. Needs an interview row to exist — create one via
    # POST /api/interview once api.py is rewritten, or insert one by hand, then put its
    # slug here.
    import asyncio

    async def _smoke():
        print("unknown:", await get_interview("nope1234"))
        # create_interview works on its own — no api.py, no MCP, no LLM. The persona is
        # normally the behavioral_interview prompt; any string does for a smoke test.
        created = await create_interview("backend-engineer", "mid", "(test persona)")
        print("created:", created)
        # TODO: uncomment each as you implement it, using the slug just created
        slug = created["interview_id"]
        print(await save_interview_state(slug, current_qid="be-1", followups_used=0))
        # OPEN the turn (present the question) BEFORE recording an answer to it — the new flow.
        print(await open_turn(slug, "be-1", "Tell me about a tough bug you debugged."))
        print(await load_interview_state(slug))
        # record_answer now COMPLETES that open turn (no INSERT); question_id is the guard.
        print(await record_answer(slug, "be-1", "I once traced a memory leak to..."))
        print(await save_interview_summary(slug, "Strong on debugging; work on brevity."))
        print(await get_interview(slug))

    asyncio.run(_smoke())
