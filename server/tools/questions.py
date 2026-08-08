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

from sqlalchemy import select

from db.engine import get_session
from db.models import Question, Role, Rubric


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


async def list_roles() -> dict:
    """Return the role slugs the bank knows about, e.g. ['backend-engineer', ...].

    WORKED EXAMPLE — the shape every function below follows:
      open a session -> SELECT -> convert rows to plain JSON-safe values -> return a dict.

    `select(Role.slug)` asks for one COLUMN, not whole rows, so `.scalars().all()` gives a
    list of strings directly. `async with` closes the session (returning its connection to
    the pool) even if the query raises.
    """
    async with get_session() as db:
        result = await db.execute(select(Role.slug).order_by(Role.slug))
        return {"roles": list(result.scalars().all())}


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


async def next_question(role: str, asked_ids: list[str] | None = None) -> dict:
    """Return the next unasked question for `role`.

    Same contract as before: {"status": "ok", "question": {...}} with the first question
    not in `asked_ids`, {"status": "exhausted", "role": role} once they're all asked, or
    {"status": "not_found", "role": role} for an unknown role.

    `asked_ids` is a list of SLUGS (that's what the caller tracks), not integer ids.

    TODO — same three moves as get_rubric, plus a filter:
      - resolve the role slug -> row; return not_found if there isn't one
      - build the query:
            stmt = (
                select(Question)
                .where(Question.role_id == role_row.id)
                .order_by(Question.sort_order)     # <- the explicit bank order
            )
        and exclude the ones already asked. Two ways, both fine:
          (a) let the DB do it:  .where(Question.slug.not_in(asked))  — but note an EMPTY
              list makes a `NOT IN ()` that some drivers dislike, so guard with `if asked:`
          (b) fetch all for the role and skip in Python — simpler, and the bank is tiny
      - take the first result (`.scalars().first()`); if it's None every question has been
        asked -> return the "exhausted" envelope
      - otherwise return {"status": "ok", "question": _question_dict(q)}
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
        res = await db.execute(stmt)
        question_result = res.scalars().first()
        if (question_result is None):
            return {"status": "exhausted", "role": role}
        return {"status": "ok", "question": _question_dict(question_result)}




async def get_question(question_id: str) -> dict:
    """Look up a single question by SLUG (backs the question:// resource).

    Returns {"status": "ok", "question": {...}}, or
    {"status": "not_found", "question_id": question_id}.

    TODO — the simplest one; it's `get_rubric` without the relationship walk:
      - select(Question).where(Question.slug == question_id)
      - scalar_one_or_none(); None -> the not_found envelope
      - otherwise {"status": "ok", "question": _question_dict(question)}
      (`question_id` is named for the wire contract, but it holds a slug — the whole app
      has always passed "be-1" here.)
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

    TODO — resolve the role, then use the relationship instead of a second query:
      - role_row.questions is selectin-loaded AND already ordered by sort_order (see the
        order_by on the relationship in models.py), so this is just a list comprehension
        over _question_dict
      - guard the unknown role the same way get_rubric does
    """
    async with get_session() as db:
        stmt = await db.execute(select(Role).where(Role.slug == role))
        result = stmt.scalar_one_or_none()
        if result is None:
            return {"status": "not_found", "role": role}
        return {"status": "ok", "role": role, "questions": [_question_dict(q) for q in result.questions]}


if __name__ == "__main__":
    # Smoke test with no LLM and no MCP — proves the DB reads work on their own.
    # asyncio.run is needed now that the bodies are async.
    import asyncio

    async def _smoke():
        print("roles:", await list_roles())
        print("rubric:", await get_rubric("backend-engineer"))
        print("unknown role:", await get_rubric("no-such-role"))
        # TODO: uncomment as you implement them
        print("next:", await next_question("backend-engineer", asked_ids=["be-1"]))
        print("q:", await get_question("be-2"))
        print("all:", await list_questions("product-manager"))

    asyncio.run(_smoke())
