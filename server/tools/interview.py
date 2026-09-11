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

from fastapi_pagination import Params
from fastapi_pagination.ext.sqlalchemy import apaginate
from sqlalchemy import or_, select

from db.engine import get_session
from db.models import (
    Interview,
    Level,
    Question,
    Role,
    Scorecard,
    ScorecardEntry,
    ScorecardEntryScore,
    Turn,
)

# The shared score arithmetic (Phase C) — a pure leaf module, NOT grading.py. Importing from
# grading here would pull the LLM stack (pydantic_agent, the model) into the data layer just to
# reuse an average; the math moved to tools/scoring.py precisely so this import stays cheap.
from tools.scoring import aggregate_scores


async def create_interview(
    role: str, level: str, persona: str, profile_id: str | None = None
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
                profile_id=profile_id,   # Phase B: whose interview this is (None = nobody's)
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
            # Phase B — who owns it, so /api/scorecard can authorize before it hands back a
            # whole transcript. STRINGIFIED here, unlike load_interview_state below, because
            # this dict is also the `interview://` MCP resource payload and gets JSON-encoded
            # on the way out; a uuid.UUID isn't JSON-serializable.
            "profile_id": str(interview.profile_id) if interview.profile_id else None,
            # add the interview's level so /api/scorecard can grade at the right
            # bar. It's the levels.slug ("mid"), JSON-safe, and `interview.level` is selectin-
            # loaded (free), exactly like `load_interview_state` already returns it:
            "level": interview.level.slug,
            # DISPLAY fields, for the History detail view's header (role · level, and the date).
            # `level` above stays the SLUG because grading calibration reads it; these carry the
            # human-readable NAMES + the created timestamp instead. All three come off the same
            # selectin-loaded row, so no extra query — the detail endpoint just forwards them.
            "role": interview.role.name,
            "level_name": interview.level.name,
            "created_at": interview.created_at.isoformat(),
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
            # Phase B — the owner, for require_ownership in /api/answer. RAW (a uuid.UUID or
            # None), not stringified: this dict is the backend's private working state and is
            # never serialized to anyone, so there's no JSON boundary to be safe for. The
            # comparison in auth.py stringifies both sides anyway.
            "profile_id": interview.profile_id,
            "persona": interview.persona,
            "current_qid": interview.current_question.slug if interview.current_question is not None else None,
            "current_qtext": interview.current_question.text if interview.current_question is not None else None,
            "followups_used": interview.followups_used,
            "max_followups": interview.max_followups,
            "done": interview.done,
            "role": interview.role.slug,
            # Phase D — the interview's seniority, so the ADVANCE branch of /api/answer can ask
            # next_question for a level-appropriate question. It's the `levels.slug` ("mid"),
            # stored on the interview at kickoff; the relationship is selectin-loaded, so this
            # is free. (`role` above is the same idea for the role dimension.)
            "level": interview.level.slug,
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
        interview = (
            await db.execute(select(Interview).where(Interview.slug == interview_id))
        ).scalar_one_or_none()
        question = (
            await db.execute(select(Question).where(Question.slug == question_id))
        ).scalar_one_or_none()
        if interview is None or question is None:
            return {"ok": False, "error": "interview or question does not exist"}
        db.add(Turn(
            interview_id=interview.id,
            question_id=question.id,
            prompt_text=prompt_text,
            answer=None,          # the defining mark of an OPEN turn
        ))
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
        interview = (
            await db.execute(select(Interview).where(Interview.slug == interview_id))
        ).scalar_one_or_none()
        question = (
            await db.execute(select(Question).where(Question.slug == question_id))
        ).scalar_one_or_none()
        if interview is None or question is None:
            return {"ok": False, "error": "interview or question does not exist"}
        open_turn_row = (
            await db.execute(
                select(Turn).where(Turn.interview_id == interview.id, Turn.answer.is_(None))
            )
        ).scalar_one_or_none()
        if open_turn_row is None:
            # nothing was presented, or it was already answered — a real state error, not a
            # place to invent a turn (the client-driven flow always opens before it asks).
            return {"ok": False, "error": "no open turn to answer"}
        if open_turn_row.question_id != question.id:
            # the open turn is for a different question than the caller thinks — refuse rather
            # than close the wrong one. This is the guard the question_id argument buys.
            return {"ok": False, "error": "open turn does not match the given question"}
        open_turn_row.answer = answer
        await db.commit()
        # completed turns = every turn now that this one is closed and no other is open.
        completed = sum(1 for t in interview.turns if t.answer is not None)
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


def _interview_card(iv: Interview) -> dict:
    """One interview as the History list / dashboard table renders it — the SUMMARY, not the
    transcript. role/level are the human-readable NAMES (both relationships are selectin-loaded,
    so reading them is free), and `overall` is the grade if scored else None (the 1:1
    `interview.scorecard` is selectin-loaded too). The ONE card shape, shared by the list, the
    `?resumable=true` narrowing, and get_resumable_interview so they can't drift apart."""
    return {
        "interview_id": iv.slug,
        "role": iv.role.name,
        "level": iv.level.name,
        "created_at": iv.created_at.isoformat(),
        "done": iv.done,
        "overall": iv.scorecard.overall if iv.scorecard is not None else None,
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
    Each relationship is joined AT MOST ONCE (guarded on whether any filter references it), which is
    why q + role can coexist without joining Role twice. The joins are 1:1 so they can't multiply
    rows; selectin still loads role/level for display via its own query — these joins are WHERE-only.

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
        stmt = select(Interview).where(Interview.profile_id == profile_id)
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
         turn loop follows). The map is built from `interview.role.rubric.dimensions`, all
         selectin-loaded.

      2. THE per-dimension `note` IS NOT STORED. ScorecardEntryScore has `dimension_id` +
         `score` and nothing else — the schema chose to keep only the number, since the notes
         are long and were never queried. Consequence to know (it surfaces in get_scorecard):
         a scorecard re-read from the DB has the scores but not the sentence-per-dimension the
         LIVE grader produced. If History ever needs those notes, the fix is one `note` column
         here + a migration; today it's a deliberate omission, not a bug.

    IDEMPOTENCY: /api/scorecard can be hit more than once (the user clicks "End interview"
    again, or re-opens and re-grades). One interview should have ONE scorecard, so we delete
    any existing one first — the `all, delete-orphan` cascades on Scorecard.entries and
    ScorecardEntry.scores tear down its children with it — then insert the fresh grade.
    """
    async with get_session() as db:
        interview = (
            await db.execute(select(Interview).where(Interview.slug == interview_id))
        ).scalar_one_or_none()
        if interview is None:
            return {"ok": False, "error": "unknown interview"}
        if interview.role.rubric is None:
            return {"ok": False, "error": f"role {interview.role.slug} has no rubric"}

        # (1) the NAME -> ID map, built once from this role's rubric dimensions.
        name_to_id = {dim.name: dim.id for dim in interview.role.rubric.dimensions}

        # idempotency: drop a prior scorecard for this interview (cascades to its rows).
        existing = (
            await db.execute(select(Scorecard).where(Scorecard.interview_id == interview.id))
        ).scalar_one_or_none()
        if existing is not None:
            await db.delete(existing)
            await db.flush()   # make the delete happen before the re-insert in this txn

        # (2) build the object graph top-down. Appending to a cascaded relationship is all it
        #     takes — SQLAlchemy assigns the foreign keys (scorecard_id, entry_id) itself when
        #     it flushes, so we never touch them by hand.
        scorecard = Scorecard(interview_id=interview.id, overall=overall)
        for ans in answers:
            question = (
                await db.execute(select(Question).where(Question.slug == ans["question_id"]))
            ).scalar_one_or_none()
            if question is None:
                continue   # a slug that isn't a real question can't be graded onto a row
            entry = ScorecardEntry(
                question_id=question.id,
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
        `interview.scorecard` is None, return {"status": "not_found"}. (The 1:1 relationship is
        selectin-loaded, so `interview.scorecard` is right there.)
      - the nested rows are all selectin-loaded too: `scorecard.entries`, each `entry.scores`,
        and `score.dimension` — no extra queries, just walk them.
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
# THE PRODUCT RULE: only the MOST RECENT unfinished interview is resumable. That's enforced on
# the backend (not just hidden in the client) via most_recent_unfinished_id below, so bypassing
# the UI can't reopen a stale interview.
# ===========================================================================


async def get_resumable_interview(profile_id: str) -> dict | None:
    """This user's ONE resumable interview — the most-recently-active unfinished one — or None.

    Backs `GET /api/interviews?resumable=true` (the banner asks for just this, so the client never
    pulls the whole history to find it) AND the guard in /api/interviews/{id}/resume (which compares
    the requested id against this one). One query answers "is there a resumable interview, and
    which?", so the two callers can't disagree.

    A single indexed `LIMIT 1` — not the full list — because that's all "the resumable one" needs.
    Ordered by `updated_at desc`, the SAME sort list_interviews uses, so this and the History list
    agree on recency. `updated_at` doubles as "last active" (every /api/answer write bumps it), so
    resuming-and-answering keeps an interview the resumable one, while STARTING a new interview
    makes the new row the most recent and quietly demotes the old one — the intended behaviour.

    Returns the SAME card shape list_interviews yields (so `?resumable=true` and the full list share
    one response type), or None when the user has no unfinished interview. `done` is always False
    here and `overall` is None (an unfinished interview isn't graded), but they're included so the
    shape matches exactly. role/level (names) and the 1:1 scorecard are all selectin-loaded — free.
    """
    async with get_session() as db:
        interview = (
            await db.execute(
                select(Interview)
                .where(Interview.profile_id == profile_id, Interview.done.is_(False))
                .order_by(Interview.updated_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if interview is None:
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
            await db.execute(select(Interview).where(Interview.slug == interview_id))
        ).scalar_one_or_none()
        if interview is None:
            return {"status": "not_found"}

        turns: list[dict] = []
        current_question: str | None = None
        for turn in interview.turns:          # already ordered by created_at
            prompt = turn.prompt_text or turn.question.text
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
