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


async def record_answer(interview_id: str, question_id: str, answer: str) -> dict:
    """Persist one interview turn (the question asked + the candidate's answer).

    Returns {"ok": True, "interview_id": ..., "turn_count": N}, or
    {"ok": False, "error": "..."} if the interview or question slug doesn't resolve.

    Both arguments arrive as SLUGS; `turns` stores integer foreign keys. Resolving them is
    the whole difference from the JSON version — and it's also the integrity win: a turn
    can no longer be filed under a question that doesn't exist.

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


async def list_interviews(profile_id: str) -> dict:
    """Every interview belonging to one user, newest first — backs GET /api/interviews.

    WORKED EXAMPLE — the owner-scoped LIST. The single new idea vs get_interview is the WHERE
    clause: `Interview.profile_id == profile_id`. That one predicate is the entire difference
    between "my history" and "everyone's interviews", so it is the line to get right. The
    caller (api.py) passes the *verified* uid from the JWT, never an id from the request body
    — otherwise "list interviews" becomes "list ANYONE's interviews by guessing a uuid".

    Returns {"ok": True, "interviews": [ {card}, ... ]}. Each card is the SUMMARY the History
    list renders — deliberately NOT the transcript (that's the detail view's job, one row at a
    time). `overall` is the interview's grade if it's been scored, else None: the 1:1
    `interview.scorecard` relationship is selectin-loaded, so reading it here costs no extra
    query per row.

    NOTE the sort: `updated_at` descending. `updated_at` doubles as "last active" (every
    /api/answer write bumps it), so most-recently-touched floats to the top — which is what a
    "resume / review" list wants, over creation order.
    """
    async with get_session() as db:
        result = await db.execute(
            select(Interview)
            .where(Interview.profile_id == profile_id)
            .order_by(Interview.updated_at.desc())
        )
        interviews = result.scalars().all()
        return {
            "ok": True,
            "interviews": [
                {
                    "interview_id": iv.slug,
                    # role/level as the human-readable NAME (the list shows it to a person);
                    # both relationships are selectin-loaded on the interview.
                    "role": iv.role.name,
                    "level": iv.level.name,
                    "created_at": iv.created_at.isoformat(),
                    "done": iv.done,
                    # the grade if graded, else None — the History list shows "—" for ungraded.
                    "overall": iv.scorecard.overall if iv.scorecard is not None else None,
                }
                for iv in interviews
            ],
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
