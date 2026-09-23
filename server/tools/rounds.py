"""Round-type vocabulary (read-only) — the interview-simulation round FORMATS.

Backs GET /api/round-types (+ /{slug}) — the Job page's round cards — and gives the simulation
start path its round row (plan size, probe budget, guidance, rubric). Same shape as the other vocab
readers in tools/questions.py (list_question_types / get_question_type_by_slug): server-side
pagination with an optional `?q=` name search, and a by-slug resolver returning the ORM row or None.

Quick test (from server/):
    .venv/Scripts/python.exe -m tools.rounds
"""
from __future__ import annotations

import asyncio

from fastapi_pagination import Params
from fastapi_pagination.ext.sqlalchemy import apaginate
from sqlalchemy import select

from db.engine import get_session
from db.models import RoundType


async def list_round_types(params: Params, search: str | None = None):
    """Return a PAGE of round types, ordered by id (the seed's authored order: behavioral, coding,
    system-design — the order a real loop runs them in, which is how the round cards should read).
    The route's `response_model=Page[RoundTypeOut]` coerces the ORM rows and leaves `guidance`
    server-side."""
    async with get_session() as db:
        stmt = select(RoundType).order_by(RoundType.id)
        if search:
            stmt = stmt.where(RoundType.name.ilike(f"%{search}%"))
        return await apaginate(db, stmt, params)


async def get_round_type_by_slug(slug: str) -> RoundType | None:
    """Resolve ONE round type by slug, or None. Its `rubric` (and the rubric's dimensions) are
    selectin-loaded with it, so the simulation path can read the round's rubric after the session
    closes."""
    async with get_session() as db:
        return (
            await db.execute(select(RoundType).where(RoundType.slug == slug))
        ).scalar_one_or_none()


if __name__ == "__main__":
    async def _smoke() -> None:
        page = await list_round_types(Params(page=1, size=50))
        for row in page.items:
            dims = [d.name for d in row.rubric.dimensions] if row.rubric else None
            print(row.slug, row.plan_size, row.max_followups, row.has_code_editor, dims)
        print("unknown ->", await get_round_type_by_slug("nope"))

    asyncio.run(_smoke())
