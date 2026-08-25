"""
Question-bank helpers (read-only) — now backed by Postgres. 

WHAT CHANGED, AND WHAT DIDN'T. The bodies used to `json.loads` a file; now they query
Supabase. That's the ONLY change. Every function keeps its name, its arguments, and — this
is the important part — the exact dict shape it returned before, because `mcp_server.py`,
the agent, and `api.py` all read those shapes. Swapping a JSON file for a database should
be invisible above this file. That's the same "edge adapter" idea the project keeps
proving, applied to storage instead of audio.

TWO THINGS THE DB VERSION HAS TO DO THAT THE JSON VERSION DIDN'T:

  1. RESOLVE SLUGS. Callers pass "backend-engineer" and "be-1" — the outside world's ids.
     Rows reference each other by integer id. So every body starts by looking up the row
     for a slug, and returns the not_found envelope if there isn't one.
  2. TRANSLATE BACK. A `Question` ORM object is not JSON. `_question_dict` below converts
     it into the same `{"id", "type", "text", "tags"}` the JSON bank produced — note `id`
     is the SLUG, keeping the wire contract identical to before.

EVERY BODY IS NOW `async def`, because the DB calls are awaited. FastMCP is happy to
register async tools, and `api.py` already awaits everything it calls. One consequence
worth knowing: you can't call these from plain sync code anymore — hence the
`asyncio.run(...)` in the smoke test at the bottom.

Quick test once filled in (from server/):
    .venv/Scripts/python.exe -m tools.questions
"""
from __future__ import annotations

from fastapi_pagination import Params
# `apaginate` is the ASYNC entry point (0.15.16 deprecated calling `paginate` on an AsyncSession
# in favour of it; it's removed in 0.16). Same contract — (session, select_stmt, params) ->
# Page(items, total, page, size, pages) — just the coroutine the async engine needs.
from fastapi_pagination.ext.sqlalchemy import apaginate
from sqlalchemy import select

from db.engine import get_session
# ReferenceBrief added for Phase E's get_reference (pre-imported so the TODO body has it ready).
from db.models import Level, Question, ReferenceBrief, Role, Rubric


def _question_dict(question: Question) -> dict:
    """ORM row -> the JSON-safe shape the rest of the app already expects.

    WORKED: this is the contract with everything above this file. `id` is the question's
    SLUG, not its integer primary key — the API, the MCP resource URI, and the interviewer
    have always spoken "be-1", and none of them should learn about surrogate keys.
    """
    return {
        "id": question.slug,
        "type": question.type.slug,
        "text": question.text,
        "tags": [tag.slug for tag in question.tags],
    }


async def list_roles(params: Params, search: str | None = None):
    """Return a PAGE of roles the picker can search — backs GET /api/roles.

    WORKED EXAMPLE — server-side pagination via fastapi-pagination. We build the statement
    (ordering + our own optional search filter), then hand it to `paginate`, which runs the
    COUNT and the LIMIT/OFFSET for us and returns a Page(items, total, page, size, pages). The
    DIVISION OF LABOUR is the thing to notice: the SEARCH is ours (a domain decision — match on
    name), the PAGING is the library's. We never write .limit()/.offset() by hand.

    `params` (page + size) is resolved by FastAPI from the query string in the route and passed
    straight through; `search` is our extra `?q=` filter. Returns a `Page[Role]` of ORM rows —
    the route's `response_model=Page[RoleOut]` coerces each row to JSON (see api.py). Only the
    scalar columns are read downstream, so serialization after this session closes is safe.
    """
    async with get_session() as db:
        stmt = select(Role).order_by(Role.name)
        if search:
            # ilike = case-insensitive LIKE. The %..% makes it a substring match, so "back"
            # finds "Backend engineer". Applied to the statement BEFORE paginate, so the COUNT
            # it runs counts only the matches — pagination is over the filtered set.
            stmt = stmt.where(Role.name.ilike(f"%{search}%"))
        return await apaginate(db, stmt, params)


async def get_rubric(role: str) -> dict:
    """Return the scoring rubric for a role (backs the rubric:// resource).

    WORKED EXAMPLE — the slug-resolution + relationship-traversal pattern, which the TODOs
    below all reuse. Note what it does NOT do: no join is written by hand. `Role.rubric` and
    `Rubric.dimensions` are selectin-loaded relationships, so touching them is free here —
    SQLAlchemy already fetched them.

    Returns {"status": "ok", "role": role, "rubric": {...}}, or
    {"status": "not_found", "role": role} for an unknown role.
    """
    async with get_session() as db:
        # slug -> row. scalar_one_or_none(): exactly one row or None, never an exception on
        # "no match" — which is what lets us return the not_found envelope instead of raising.
        result = await db.execute(select(Role).where(Role.slug == role))
        role_row = result.scalar_one_or_none()
        if role_row is None or role_row.rubric is None:
            return {"status": "not_found", "role": role}

        rubric: Rubric = role_row.rubric
        return {
            "status": "ok",
            "role": role,
            "rubric": {
                # dimensions are ROWS now, but the grader still wants a list of names —
                # the wire shape is unchanged from the JSON days.
                "dimensions": [dimension.name for dimension in rubric.dimensions],
                "scale": rubric.scale,
            },
        }


async def next_question(
    role: str, level: str | None = None, asked_ids: list[str] | None = None
) -> dict:
    """Return the next unasked question for `role`, optionally filtered by `level`.

    Same contract as before: {"status": "ok", "question": {...}} with the first question
    not in `asked_ids`, {"status": "exhausted", "role": role} once they're all asked, or
    {"status": "not_found", "role": role} for an unknown role.

    `asked_ids` is a list of SLUGS (that's what the caller tracks), not integer ids.

    PHASE D — the `level` argument (a slug: "entry" | "mid" | "senior"). It is OPTIONAL and
    defaults to None, which means "no level filter" — exactly the pre-Phase-D behaviour, so
    the MCP tool, `mcp_client_demo.py`, and the smoke test below all keep working untouched.
    When api.py passes a level, we filter with the AT-OR-BELOW rule you chose: an interview
    at a given level draws every question whose level ranks at or beneath it (a senior
    interview gets entry + mid + senior; an entry interview only entry). `levels.rank` is the
    column that makes "at or below" expressible — a plain string level couldn't be ordered.

    NOTE on unassigned questions: a question with `level_id` NULL has no rank to compare, so
    the at-or-below filter EXCLUDES it. That's intended — an unleveled question isn't part of
    any level's set until the bank author assigns it one (see the Phase D seed).

    """
    async with get_session() as db:
        result = await db.execute(select(Role).where(Role.slug == role))
        role_row = result.scalar_one_or_none()
        asked = asked_ids or []
        if role_row is None:
            return {"status": "not_found", "role": role}
        stmt = (
            select(Question).where(Question.role_id == role_row.id)
            .order_by(Question.sort_order)
        )
        if (asked):
            stmt = stmt.where(Question.slug.not_in(asked))
        if level is not None:
            level_row = (await db.execute(select(Level).where(Level.slug == level))).scalar_one_or_none()
            if level_row is None:
                return {"status": "not_found", "role": role, "level": level}
            allowed_level_ids = select(Level.id).where(Level.rank <= level_row.rank)
            stmt = stmt.where(Question.level_id.in_(allowed_level_ids)) 
        res = await db.execute(stmt)
        question_result = res.scalars().first()
        if (question_result is None):
            return {"status": "exhausted", "role": role}
        return {"status": "ok", "question": _question_dict(question_result)}


async def list_levels(params: Params, search: str | None = None):
    """Return a PAGE of seniority levels — backs GET /api/levels.

    Same server-side pagination shape as list_roles, ordered by `Level.rank` so entry/mid/
    senior come back in ladder order (the reason `rank` is a column and not insertion order).
    Returns a `Page[Level]`; the route's `response_model=Page[LevelOut]` carries `rank` through
    to the client too, in case the UI ever wants to order or badge by it.
    """
    async with get_session() as db:
        stmt = select(Level).order_by(Level.rank)
        if search:
            stmt = stmt.where(Level.name.ilike(f"%{search}%"))
        return await apaginate(db, stmt, params)




async def get_question(question_id: str) -> dict:
    """Look up a single question by SLUG (backs the question:// resource).

    Returns {"status": "ok", "question": {...}}, or
    {"status": "not_found", "question_id": question_id}.
    """
    async with get_session() as db:
        stmt = await db.execute(select(Question).where(Question.slug == question_id))
        result = stmt.scalar_one_or_none()
        if result is None:
            return {"status": "not_found", "question_id": question_id}
        return {"status": "ok", "question": _question_dict(result)}


async def list_questions(role: str) -> dict:
    """Return ALL questions for a role (backs the questions://{role} resource).

    Returns {"status": "ok", "role": role, "questions": [...]}, or
    {"status": "not_found", "role": role}.
    """
    async with get_session() as db:
        stmt = await db.execute(select(Role).where(Role.slug == role))
        result = stmt.scalar_one_or_none()
        if result is None:
            return {"status": "not_found", "role": role}
        return {"status": "ok", "role": role, "questions": [_question_dict(q) for q in result.questions]}


async def get_reference(question_id: str) -> dict:
    """Return the authored reference brief for a question (backs the reference:// resource).

    PHASE E — SCAFFOLD, fill in the body. The brief is the grader's ANSWER KEY: leveling bands +
    tiered (bad/good/great) concept anchors, authored per question (see data/reference_briefs/).
    This is a read helper shaped EXACTLY like get_question / get_rubric above — resolve the slug
    to a row, translate the ORM object back to a JSON-safe dict, return an envelope. Reuse those
    as your template; the only new wrinkle is the design choice flagged below.

    Contract to return:
      {"status": "ok", "question_id": question_id, "brief": <text>}                on success
      {"status": "not_found", "question_id": question_id}                          otherwise

    IMPORTANT — "not_found" covers TWO cases, and both must be graceful (envelope, never an
    exception): the question slug is unknown, OR the question exists but has NO brief authored
    yet. Most of the bank is un-briefed until someone writes one, so an absent brief is a normal
    state the grader has to tolerate — grade_one will just fall back to the model's priors.

    THE ONE DESIGN CHOICE (yours to make in the body):
      ReferenceBrief is a 1:1 keyed by `question_id`, but Question has NO relationship to it yet.
      So you either
        (a) add `brief: Mapped[ReferenceBrief | None] = relationship(lazy="selectin")` to the
            Question model and read `question.brief` (consistent with how get_rubric reads
            role.rubric — but ALWAYS loads a brief on every question fetch, everywhere), or
        (b) query ReferenceBrief directly by `question.id` here (no model change; the brief is
            loaded only when this function asks for it).
      Pick one and leave a one-line comment saying why. (b) keeps the hot question-fetch paths —
      next_question, the transcript — from dragging brief text they never use; (a) is tidier if
      you expect most reads to want the brief. Given only the grader reads briefs, (b) is the
      lean default, but it's your call.

    TODO:
      * async with get_session() as db:
      * resolve the slug -> Question row (scalar_one_or_none); not_found if None.
      * get the brief via (a) or (b); not_found if there's no brief row.
      * return the ok envelope with the brief text.
    """
    async with get_session() as db:
        stmt = await db.execute(select(Question).where(Question.slug == question_id))
        result = stmt.scalar_one_or_none()
        if result is None:
            return {"status": "not_found", "question_id": question_id}
        # only loads the reference brief when looking for it specifically rather than fetching it on each question via
        # the model relationship (i.e question.brief)
        ref_brief = await db.execute(select(ReferenceBrief).where(ReferenceBrief.question_id == result.id))
        ref_brief_result = ref_brief.scalar_one_or_none()
        if ref_brief_result is None:
            return {"status": "not_found", "question_id": question_id}
        return {"status": "ok", "question_id": question_id, "brief": ref_brief_result.brief}



if __name__ == "__main__":
    # Smoke test with no LLM and no MCP — proves the DB reads work on their own.
    # asyncio.run is needed now that the bodies are async.
    import asyncio

    async def _smoke():
        # list_roles/list_levels paginate now, so they need a Params(page, size). Off a
        # request FastAPI builds this from ?page=&size=; here we construct it by hand. The
        # result is a Page(items, total, page, size, pages) — .items holds the ORM rows.
        print("roles:", (await list_roles(Params(page=1, size=50))).items)
        print("levels:", (await list_levels(Params(page=1, size=50))).items)
        print("rubric:", await get_rubric("backend-engineer"))
        print("unknown role:", await get_rubric("no-such-role"))
        # no level filter (pre-Phase-D behaviour): every question for the role
        print("next (any level):", await next_question("backend-engineer", asked_ids=["be-1"]))
        # Phase D — once the level TODO is filled, these two should differ: an entry interview
        # sees fewer questions than a senior one (at-or-below by rank).
        print("next (entry):", await next_question("backend-engineer", level="entry"))
        print("next (senior):", await next_question("backend-engineer", level="senior"))
        print("next be-1 asked (entry):", await next_question("backend-engineer", level="entry", asked_ids=["be-1"]))
        print("next be-1 asked (senior):", await next_question("backend-engineer", level="senior", asked_ids=["be-1"]))
        print("next be-1, be-2 asked (senior):", await next_question("backend-engineer", level="senior", asked_ids=["be-1", "be-2"]))
        print("q:", await get_question("be-2"))
        print("all:", await list_questions("product-manager"))
        # Phase E — once get_reference is filled AND `python -m db.seed` has loaded the briefs:
        # be-2 has an authored brief; be-1 does not yet (should come back not_found, gracefully).
        print("reference be-2:", await get_reference("be-2"))
        print("reference be-1 (unbriefed):", await get_reference("be-1"))

    asyncio.run(_smoke())
