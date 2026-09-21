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

import random

from fastapi_pagination import Params
# `apaginate` is the ASYNC entry point (0.15.16 deprecated calling `paginate` on an AsyncSession
# in favour of it; it's removed in 0.16). Same contract — (session, select_stmt, params) ->
# Page(items, total, page, size, pages) — just the coroutine the async engine needs.
from fastapi_pagination.ext.sqlalchemy import apaginate
from sqlalchemy import delete, select

from db.engine import get_session
# ReferenceBrief added for Phase E's get_reference (pre-imported so the TODO body has it ready).
# QuestionRole is the question<->role join carrying per-role bank order (next_question orders on it).
# ProfileQuestion is the candidate's saved "My questions" set (the interview-plan source).
from db.models import (
    Level,
    ProfileQuestion,
    Question,
    QuestionRole,
    QuestionType,
    ReferenceBrief,
    Role,
    Rubric,
)

# How many questions a DEFAULT interview asks when the candidate hasn't saved any. Picked to be a
# short-but-real mock interview; the plan builder draws them at increasing seniority (see
# build_interview_plan). Not a stored column — the plan's LENGTH is the count.
DEFAULT_PLAN_SIZE = 3


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
        level_rank = None
        if level is not None:
            level_row = (await db.execute(select(Level).where(Level.slug == level))).scalar_one_or_none()
            if level_row is None:
                return {"status": "not_found", "role": role, "level": level}
            level_rank = level_row.rank
        # the role + at-or-below-level filter, ordered by per-role bank order, lives in one helper
        # now (build_interview_plan reuses it); here we just add the "not already asked" clause.
        stmt = _filtered_questions_stmt(role_row.id, level_rank)
        if asked:
            stmt = stmt.where(Question.slug.not_in(asked))
        res = await db.execute(stmt)
        question_result = res.scalars().first()
        if (question_result is None):
            return {"status": "exhausted", "role": role}
        return {"status": "ok", "question": _question_dict(question_result)}


def _filtered_questions_stmt(role_id: int, level_rank: int | None):
    """The bank query shared by next_question and the interview-plan builder: every question for a
    role, at or below a seniority, in that role's bank order.

    question<->role is N:N, so join the `question_roles` pairing to scope to this role and order by
    its `sort_order` (a shared question sits at a different place in each role's list). The level
    filter is the AT-OR-BELOW rule: questions whose level ranks at or beneath `level_rank` (a senior
    interview draws entry+mid+senior, an entry one only entry). A NULL-level question has no rank to
    compare and is excluded once a level is given — same as before. Pass `level_rank=None` for no
    level filter.
    """
    stmt = (
        select(Question)
        .join(QuestionRole, QuestionRole.question_id == Question.id)
        .where(QuestionRole.role_id == role_id)
        .order_by(QuestionRole.sort_order)
    )
    if level_rank is not None:
        allowed_level_ids = select(Level.id).where(Level.rank <= level_rank)
        stmt = stmt.where(Question.level_id.in_(allowed_level_ids))
    return stmt


def _default_plan(rows: list[Question], size: int = DEFAULT_PLAN_SIZE) -> list[Question]:
    """Pick up to `size` questions of INCREASING seniority from the at-or-below pool `rows`.

    `rows` arrives in bank order (per-role `sort_order`), each carrying its level. The rule the user
    asked for: draw one random question from each distinct level band, ascending (so a senior
    interview opens entry → mid → senior); if that yields fewer than `size` (a mid interview has only
    two bands), top up with more random questions from the pool; then order the result by seniority.
    Caps at whatever exists — a role+level with fewer than `size` questions just gets fewer.
    """
    if not rows:
        return []

    def rank(q: Question) -> int:
        return q.level.rank if q.level is not None else 0

    by_rank: dict[int, list[Question]] = {}
    for q in rows:
        by_rank.setdefault(rank(q), []).append(q)

    chosen: list[Question] = []
    chosen_ids: set[int] = set()
    # SELECTION: one random question per band, visiting bands LOW → HIGH. Ascending matters when
    # there are more bands than slots — we then cover the lowest `size` bands (start easy, ramp up).
    for r in sorted(by_rank):
        if len(chosen) >= size:
            break
        pick = random.choice(by_rank[r])
        chosen.append(pick)
        chosen_ids.add(pick.id)
    # TOP-UP: bands alone may not fill the quota (a mid interview has only two). Append extra random
    # questions from the rest of the pool — note these come in shuffled, i.e. at an arbitrary rank.
    if len(chosen) < size:
        remaining = [q for q in rows if q.id not in chosen_ids]
        random.shuffle(remaining)
        for q in remaining:
            if len(chosen) >= size:
                break
            chosen.append(q)
            chosen_ids.add(q.id)
    # FINAL ASK ORDER: the top-up appended at the end regardless of rank, so re-sort to guarantee
    # increasing seniority across the whole plan. (A no-op when no top-up fired.) Stable, so bank
    # order is preserved among questions sharing a level.
    chosen.sort(key=rank)
    return chosen


async def build_interview_plan(
    db, role_row: Role, level_row: Level, profile_id
) -> tuple[list[Question], bool]:
    """Materialize the ordered question plan for a new interview.

    Runs inside create_interview's session (takes `db`) so the plan rows land in the same
    transaction as the interview. Returns `(questions, from_saved)` — `from_saved` is False when the
    default fired, which the route surfaces so the SPA can tell the candidate a default was used.

    Two sources, in priority order:
      1. the candidate's SAVED set (`profile_questions`) intersected with this role+level — if they
         have curated any, that IS the plan, ordered by seniority then bank order.
      2. otherwise the DEFAULT: `DEFAULT_PLAN_SIZE` random questions of increasing seniority, so a
         brand-new candidate still gets a bounded, sensibly-ramped interview.
    """
    base = _filtered_questions_stmt(role_row.id, level_row.rank)

    if profile_id is not None:
        saved_ids = select(ProfileQuestion.question_id).where(
            ProfileQuestion.profile_id == profile_id
        )
        saved_rows = (
            await db.execute(base.where(Question.id.in_(saved_ids)))
        ).scalars().all()
        if saved_rows:
            # stable sort by seniority; base already ordered by bank sort_order within a level.
            saved_rows = sorted(
                saved_rows, key=lambda q: q.level.rank if q.level is not None else 0
            )
            return list(saved_rows), True

    all_rows = (await db.execute(base)).scalars().all()
    return _default_plan(list(all_rows)), False


def _question_out(question: Question, selected: bool) -> dict:
    """The richer wire shape the BROWSE UI needs (vs. the terse _question_dict the agent uses).

    Carries the human-readable type/level NAMES and tag names for display, plus `selected` — whether
    this question is in the current user's saved set, so a checkbox renders in the right state.
    """
    return {
        "slug": question.slug,
        "text": question.text,
        "type_slug": question.type.slug,
        "type_name": question.type.name,
        "level_slug": question.level.slug if question.level is not None else None,
        "level_name": question.level.name if question.level is not None else None,
        "tags": [tag.name for tag in question.tags],
        "selected": selected,
    }


async def list_question_types(params: Params, search: str | None = None):
    """Return a PAGE of question types — backs GET /api/question-types.

    The third picker on the Questions-page filter (behavioral · system-design · technical · …),
    mirroring list_roles / list_levels exactly: server-side pagination, an optional case-insensitive
    `?q=` name search, ordered by name. Returns a `Page[QuestionType]` of ORM rows the route's
    `response_model=Page[QuestionTypeOut]` coerces to {slug, name}.
    """
    async with get_session() as db:
        stmt = select(QuestionType).order_by(QuestionType.name)
        if search:
            stmt = stmt.where(QuestionType.name.ilike(f"%{search}%"))
        return await apaginate(db, stmt, params)


async def get_question_type_by_slug(slug: str) -> QuestionType | None:
    """Resolve ONE question type by its slug — backs GET /api/question-types/{slug}.

    The type counterpart of get_role_by_slug / get_level_by_slug: the Questions-page filter carries
    the chosen type SLUG in the URL and hydrates its display NAME from here, so a deep link shows the
    live name rather than a copy cached in the URL. Returns the ORM row or None for an unknown slug.
    """
    async with get_session() as db:
        return (
            await db.execute(select(QuestionType).where(QuestionType.slug == slug))
        ).scalar_one_or_none()


async def list_questions_page(
    params: Params,
    role: str,
    level: str | None = None,
    profile_id=None,
    search: str | None = None,
    saved: bool | None = None,
    type_slug: str | None = None,
    exact_level: bool = False,
):
    """A PAGE of bank questions for the browse UI — backs GET /api/questions.

    Same server-side pagination as list_roles, over the role (+ level) filter. `search` matches
    question text. `saved` is a TRI-STATE against the caller's saved set: True → only saved
    ("My questions"), False → only NOT saved (the Questions page's "everything else" table), None →
    the whole bank (the Add-question modal). `type_slug` narrows to one question KIND. Every returned
    row carries a computed `selected` flag so the checkbox renders right. An unknown role/level/type
    yields an empty page rather than an error.

    LEVEL has two modes. By default it's the AT-OR-BELOW rule an interview plan uses (a senior view
    draws entry+mid+senior) — what the dashboard "My questions" table and the Add-question modal
    want. The Questions-page filter passes `exact_level=True` to instead match ONLY the chosen level,
    which is what a browse filter reads intuitively (and mirrors the Interviews-page level filter).
    """
    async with get_session() as db:
        role_row = (
            await db.execute(select(Role).where(Role.slug == role))
        ).scalar_one_or_none()
        level_row = None
        if level is not None:
            level_row = (
                await db.execute(select(Level).where(Level.slug == level))
            ).scalar_one_or_none()

        # Role scoping (+ at-or-below level for the plan/modal view). For an EXACT-level filter we
        # pass no rank to the shared helper and add an exact level_id clause below instead.
        at_or_below_rank: int | None = None
        if level is not None and not exact_level:
            # unknown level -> a rank nothing can be at-or-below, i.e. an empty result.
            at_or_below_rank = level_row.rank if level_row is not None else -1
        # unknown role -> a role_id nothing pairs with, again an empty page.
        stmt = _filtered_questions_stmt(role_row.id if role_row else -1, at_or_below_rank)

        if level is not None and exact_level:
            # exact seniority: only this level's questions. Unknown level -> -1, matching nothing.
            stmt = stmt.where(Question.level_id == (level_row.id if level_row is not None else -1))

        if type_slug is not None:
            # filter by question KIND. .has() is an EXISTS subquery, so it composes without a join
            # that could multiply rows; an unknown slug simply matches nothing (an empty page).
            stmt = stmt.where(Question.type.has(QuestionType.slug == type_slug))

        if search:
            stmt = stmt.where(Question.text.ilike(f"%{search}%"))
        if saved is not None and profile_id is not None:
            saved_ids = select(ProfileQuestion.question_id).where(
                ProfileQuestion.profile_id == profile_id
            )
            stmt = stmt.where(
                Question.id.in_(saved_ids) if saved else Question.id.not_in(saved_ids)
            )

        # apaginate returns page.items as the full Question ORM rows for this page (COUNT +
        # LIMIT/OFFSET handled for us). What it CAN'T give us is `selected` — that's not a column on
        # Question but a fact in profile_questions — so we stamp it below.
        page = await apaginate(db, stmt, params)

        # `selected` per row = is this question in the caller's saved set. When the query already
        # filtered by membership the answer is known for free (all saved / none saved); otherwise do
        # ONE lookup over just this page's ids (indexed), not one per row.
        if saved is True:
            saved_set: set[int] = {q.id for q in page.items}
        elif saved is False:
            saved_set = set()
        else:
            saved_set = set()
            if profile_id is not None and page.items:
                ids = [q.id for q in page.items]
                saved_set = set(
                    (
                        await db.execute(
                            select(ProfileQuestion.question_id).where(
                                ProfileQuestion.profile_id == profile_id,
                                ProfileQuestion.question_id.in_(ids),
                            )
                        )
                    ).scalars().all()
                )
        page.items = [_question_out(q, q.id in saved_set) for q in page.items]
        return page


async def save_saved_questions(
    profile_id, add: list[str] | None = None, remove: list[str] | None = None
) -> dict:
    """Apply a staged "My questions" edit in one transaction — backs PUT /api/profile/questions.

    `add`/`remove` are question SLUGS (what the client holds). Adds are idempotent (an already-saved
    question is skipped, so re-saving never errors on the unique constraint); removes that aren't
    saved are simply no-ops. Unknown slugs are ignored — the bank is authoritative, and a stale slug
    from the client shouldn't 500 a save. Returns {"ok": True, "added": n, "removed": m}.
    """
    add = add or []
    remove = remove or []
    slugs = set(add) | set(remove)
    if not slugs:
        return {"ok": True, "added": 0, "removed": 0}

    async with get_session() as db:
        id_by_slug = dict(
            (
                await db.execute(
                    select(Question.slug, Question.id).where(Question.slug.in_(slugs))
                )
            ).all()
        )
        add_ids = [id_by_slug[s] for s in add if s in id_by_slug]
        remove_ids = [id_by_slug[s] for s in remove if s in id_by_slug]

        removed = 0
        if remove_ids:
            res = await db.execute(
                delete(ProfileQuestion).where(
                    ProfileQuestion.profile_id == profile_id,
                    ProfileQuestion.question_id.in_(remove_ids),
                )
            )
            removed = res.rowcount or 0

        added = 0
        if add_ids:
            existing = set(
                (
                    await db.execute(
                        select(ProfileQuestion.question_id).where(
                            ProfileQuestion.profile_id == profile_id,
                            ProfileQuestion.question_id.in_(add_ids),
                        )
                    )
                ).scalars().all()
            )
            for qid in add_ids:
                if qid not in existing:
                    db.add(ProfileQuestion(profile_id=profile_id, question_id=qid))
                    added += 1

        await db.commit()
        return {"ok": True, "added": added, "removed": removed}


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


# get_role_by_slug / get_level_by_slug — resolve ONE vocab row by its slug, backing GET
# /api/roles/{slug} and /api/levels/{slug}. These exist for the Interviews-page filter: its URL carries
# the role/level slug, and the picker needs the current NAME to display — fetched fresh here rather than
# cached in the URL, so a renamed role shows its new name. Return the ORM row (the route's response_model
# coerces it) or None for an unknown slug; only scalar columns are read, so use after the session closes
# is safe. `slug` is unique+indexed, so this is a single index seek, not a scan.
async def get_role_by_slug(slug: str) -> Role | None:
    async with get_session() as db:
        return (
            await db.execute(select(Role).where(Role.slug == slug))
        ).scalar_one_or_none()


async def get_level_by_slug(slug: str) -> Level | None:
    async with get_session() as db:
        return (
            await db.execute(select(Level).where(Level.slug == slug))
        ).scalar_one_or_none()


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
