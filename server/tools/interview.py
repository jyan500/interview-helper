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

from sqlalchemy import select

from db.engine import get_session
from db.models import Interview, Level, Question, Role, Turn


async def create_interview(role: str, level: str, persona: str) -> dict:
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
    """
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

        # the same id scheme api.py always used — short enough to eyeball in a URL, random
        # enough that nobody guesses someone else's interview
        slug = uuid.uuid4().hex[:8]

        db.add(
            Interview(
                slug=slug,
                role_id=role_row.id,
                level_id=level_row.id,
                persona=persona,
                message_history=[],   # the agent hasn't said anything yet
                # profile_id stays NULL until Phase B has a signed-in user to attach
            )
        )
        await db.commit()

        return {"ok": True, "interview_id": slug}


async def get_interview(interview_id: str) -> dict:
    """Read back a whole recorded interview (backs the interview:// resource).

    WORKED EXAMPLE — the read pattern the writers below start with too: resolve the slug to
    a row, then walk selectin-loaded relationships and convert to JSON-safe values.

    Returns {"status": "ok", "interview_id": ..., "turns": [...], "summary": ...} or
    {"status": "not_found", "interview_id": ...}.

    NOTE A CONTRACT CHANGE: the JSON version invented an empty skeleton for an unknown id
    (a missing file just meant "no turns yet"). A row either exists or it doesn't, so this
    reports not_found instead — the caller in `api.py` can now tell "no such interview"
    apart from "interview with nothing recorded yet", which it couldn't before.
    """
    async with get_session() as db:
        result = await db.execute(select(Interview).where(Interview.slug == interview_id))
        interview = result.scalar_one_or_none()
        if interview is None:
            return {"status": "not_found", "interview_id": interview_id}

        return {
            "status": "ok",
            "interview_id": interview.slug,
            "turns": [
                {
                    # the wire shape keeps the SLUG under the key "question_id", exactly as
                    # the JSON store did — the grader groups on this
                    "question_id": turn.question.slug,
                    "answer": turn.answer,
                    "at": turn.created_at.isoformat(),
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

    TODO — the same read pattern as get_interview, returning different fields:
      - resolve the slug -> row; None -> {"ok": False, "error": "unknown interview"}
      - return a dict with:
            "persona":          interview.persona
            "current_qid":      the SLUG (interview.current_question.slug) or None —
                                current_question is selectin-loaded, but it's NULLABLE, so
                                guard before touching .slug
            "current_qtext":    interview.current_question.text or None
            "followups_used":   interview.followups_used
            "max_followups":    interview.max_followups
            "done":             interview.done
            "role":             interview.role.slug          # next_question needs this
            "asked_ids":        the SLUGS already asked. The ids live on
                                interview.asked_question_ids (the derived property in
                                models.py), but that returns integer ids and next_question
                                wants slugs — so build them from the loaded rows instead:
                                    {turn.question.slug for turn in interview.turns}
                                plus the current question's slug if there is one.
            "message_history":  interview.message_history — RAW, exactly as stored.
                                Do NOT deserialize it here: this module has no business
                                importing pydantic-ai. api.py turns it back into messages
                                with ModelMessagesTypeAdapter.validate_python(...).
    """
    async with get_session() as db:
        stmt = await db.execute(select(Interview).where(Interview.slug == interview_id)) 
        interview = stmt.scalar_one_or_none()
        if interview is None:
            return {"ok": False, "error": "Interview not found"}
        asked_ids = set()
        if interview.current_question is not None:
            asked_ids.add(interview.current_question.slug)
        for turn in interview.turns:
            asked_ids.add(turn.question.slug)
        return {
            "ok": True,
            "persona": interview.persona,
            "current_qid": interview.current_question.slug if interview.current_question is not None else None,
            "current_qtext": interview.current_question.text if interview.current_question is not None else None,
            "followups_used": interview.followups_used,
            "max_followups": interview.max_followups,
            "done": interview.done,
            "role": interview.role.slug,
            "asked_ids": list(asked_ids),
            "message_history": interview.message_history
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

    TODO:
      - resolve the interview slug -> row; None -> the {"ok": False} envelope
      - for each field, `if <field> is not None:` assign it to the row. No db.add() —
        the row is already tracked, so an attribute assignment IS the UPDATE (same as
        save_interview_summary).
      - `current_qid` arrives as a SLUG and the column holds an integer id, so resolve it:
        look up the Question by slug, and on an unknown slug return the error envelope
        rather than silently leaving the old question in place.
      - `message_history` arrives already JSON-ready (api.py dumped it with
        ModelMessagesTypeAdapter.dump_python(msgs, mode="json")) — assign it as-is. If you
        pass raw pydantic-ai objects here, asyncpg will reject them at the JSONB boundary.
        (Careful with the None check on this one: an EMPTY list is falsy but meaningful, so
        test `is not None`, never `if message_history:`.)
      - await db.commit()  (`updated_at` bumps itself)

    A NOTE ON WHY THIS IS ONE FUNCTION AND NOT FOUR SETTERS: everything it writes belongs to
    the same turn, so one call means one UPDATE in one transaction. Four setters would be
    four round-trips that could half-fail and leave the spine inconsistent with the history.
    """
    async with get_session() as db:
        stmt = await db.execute(select(Interview).where(Interview.slug == interview_id))
        interview = stmt.scalar_one_or_none()
        if interview is None:
            return {"ok": False, "error": "interview is not found"}
        if current_qid is not None:
            question_stmt = await db.execute(select(Question).where(Question.slug == current_qid))
            question = question_stmt.scalar_one_or_none()
            if question is None:
                return {"ok": False, "error": "question not found"}
            interview.current_question_id = question.id
        if message_history is not None:
            interview.message_history = message_history
        if done is not None:
            interview.done = done
        if followups_used is not None:
            interview.followups_used = followups_used
        await db.commit()
        return {"ok": True, "interview_id": interview_id}


async def record_answer(interview_id: str, question_id: str, answer: str) -> dict:
    """Persist one interview turn (the question asked + the candidate's answer).

    Returns {"ok": True, "interview_id": ..., "turn_count": N}, or
    {"ok": False, "error": "..."} if the interview or question slug doesn't resolve.

    Both arguments arrive as SLUGS; `turns` stores integer foreign keys. Resolving them is
    the whole difference from the JSON version — and it's also the integrity win: a turn
    can no longer be filed under a question that doesn't exist.

    TODO:
      - open a session; resolve BOTH slugs to rows:
            interview -> select(Interview).where(Interview.slug == interview_id)
            question   -> select(Question).where(Question.slug == question_id)
        if either is None, return the {"ok": False, "error": ...} envelope — don't raise;
        the MCP tool layer above wants a dict either way
      - db.add(Turn(interview_id=interview.id, question_id=question.id, answer=answer))
        (`created_at` fills itself — server_default on the mixin)
      - await db.commit()          # <- the step the JSON version didn't have
      - the turn count: `len(interview.turns) + 1` is the cheap answer, because turns were
        selectin-loaded with the interview and do NOT include the row you just added.
        (Re-querying with a COUNT is the pedantic alternative; either is fine here.)
    """
    async with get_session() as db:
        interview_stmt = await db.execute(select(Interview).where(Interview.slug == interview_id))
        question_stmt = await db.execute(select(Question).where(Question.slug == question_id))
        interview = interview_stmt.scalar_one_or_none()
        question = question_stmt.scalar_one_or_none()
        if (not interview or not question):
            return {"ok": False, "error": "interview or question does not exist"}
        interview.turns.append(Turn(interview_id=interview.id, question_id=question.id, answer=answer))
        await db.commit()
        return {"ok": True, "interview_id": interview_id, "turn_count": len(interview.turns)}


async def save_interview_summary(interview_id: str, feedback: str) -> dict:
    """Persist the final wrap-up feedback for an interview.

    Returns {"ok": True, "interview_id": ..., "status": "summarized"} or
    {"ok": False, "error": "..."}.

    TODO — an UPDATE rather than an INSERT, which in the ORM means: load it, assign, commit.
      - resolve the interview slug -> row; not found -> the {"ok": False} envelope
      - interview.summary = feedback
      - await db.commit()
      Note there's no db.add() here: the row is already tracked by the session, so changing
      an attribute is enough for the ORM to emit an UPDATE at commit. (`updated_at` bumps
      itself — that's the mixin's onupdate.)
    """
    async with get_session() as db:
        stmt = await db.execute(select(Interview).where(Interview.slug == interview_id))
        interview = stmt.scalar_one_or_none()
        if (not interview):
            return {"ok": False, "error": "interview session not found"}
        interview.summary = feedback
        await db.commit()
        return {"ok": True, "interview_id": interview_id, "status": "summarized"}


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
        print(await load_interview_state(slug))
        print(await record_answer(slug, "be-1", "I once traced a memory leak to..."))
        print(await save_interview_summary(slug, "Strong on debugging; work on brevity."))
        print(await get_interview(slug))

    asyncio.run(_smoke())
