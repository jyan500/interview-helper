"""The read-only picker vocab: roles, levels, question types and round types.

Each is a paginated + `?q=` searchable list and a by-slug lookup (a 404 for an unknown slug). Gated by
require_user for consistency with every other route: they spend no money and touch no user data.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi_pagination import Page, Params
from pydantic import BaseModel, ConfigDict

from auth import require_user
from tools.rounds import get_round_type_by_slug, list_round_types
from tools.questions import (
    get_level_by_slug,
    get_question_type_by_slug,
    get_role_by_slug,
    list_levels,
    list_question_types,
    list_roles,
)

router = APIRouter(tags=["vocab"])


# --- response models for the paginated picker endpoints (Phase D). Page[T] is generic and
#     needs a concrete item type to know how to serialize each row: list_roles/list_levels
#     paginate `select(Role)` / `select(Level)`, which yield ORM objects, and these schemas are
#     what turns those rows into JSON. `from_attributes=True` lets pydantic read straight off
#     the ORM object's attributes (role.slug, role.name) rather than needing a dict. They also
#     pin the wire contract — exactly which columns leave the server — and show up in /docs.
class RoleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    slug: str
    name: str


class LevelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    slug: str
    name: str
    rank: int


# The Questions-page filter's third picker — question KIND (behavioral · system-design · …). Same
# {slug, name} contract as RoleOut: the slug is what the client filters by, the name is what it shows.
class QuestionTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    slug: str
    name: str


# INTERVIEW SIMULATION — the round cards on a Job page. Coerced off the RoundType ORM row. Only what
# the client needs to render: the generator/interviewer guidance prose stays server-side. The voice
# mode and the workspace aren't round flags: each plan question's TYPE says (PlanQuestion).
class RoundTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    slug: str
    name: str
    description: str


# ===========================================================================
# PHASE D — GET /api/roles + GET /api/levels : the picker's options.
#
# The SPA can't hardcode the role/level lists without duplicating vocabulary that lives in the
# DB — the exact "a copy that can silently disagree" trap models.py argues against. So the
# picker READS them from here instead: two tiny cacheable GETs, the same read-vs-write instinct
# as /api/interviews. Each returns {slug, name} per row — the slug is what the client sends
# back to POST /api/interview, the name is what it shows a person.
#
# WHY require_user even though this is public-ish vocab: the picker only appears once you're
# signed in (it's behind <ProtectedRoute>), so gating these matches every other route and costs
# nothing. They spend no money and touch no user data — this is consistency, not protection.
# ===========================================================================
# `Params = Depends()` is the fastapi-pagination dependency — FastAPI fills page/size from the
# query string (?page=&size=), so the client controls the window. `q` is OUR extra search
# filter, threaded into the tool. `response_model=Page[RoleOut]` is what coerces the ORM rows
# the tool returns into JSON (see RoleOut). The route bodies stay one line — all the paging
# lives in list_roles/list_levels.
@router.get("/roles", response_model=Page[RoleOut])
async def roles(
    params: Params = Depends(),
    q: str | None = None,
    user_id: str = Depends(require_user),
):
    return await list_roles(params, search=q)


@router.get("/levels", response_model=Page[LevelOut])
async def levels(
    params: Params = Depends(),
    q: str | None = None,
    user_id: str = Depends(require_user),
):
    return await list_levels(params, search=q)


# GET /api/roles/{slug} + /api/levels/{slug} : resolve ONE vocab row by its slug. These back the
# Interviews-page filter, whose URL carries the role/level slug — the picker fetches the current NAME to
# display from here rather than caching it in the URL, so the label always reflects the live row. A slug
# with no row is a 404. Same require_user gate as the list routes (behind <ProtectedRoute>, touches no
# user data).
@router.get("/roles/{slug}", response_model=RoleOut)
async def role_by_slug(slug: str, user_id: str = Depends(require_user)):
    row = await get_role_by_slug(slug)
    if row is None:
        raise HTTPException(status_code=404, detail="unknown role")
    return row


@router.get("/levels/{slug}", response_model=LevelOut)
async def level_by_slug(slug: str, user_id: str = Depends(require_user)):
    row = await get_level_by_slug(slug)
    if row is None:
        raise HTTPException(status_code=404, detail="unknown level")
    return row


# GET /api/question-types (+ /{slug}) : the Questions-page filter's type picker, backing an
# async-paginate select exactly like /api/roles. The list is paginated + `?q=` searchable; the
# by-slug lookup hydrates the picker's label from the URL slug (a 404 for an unknown slug). Same
# require_user gate as the other vocab routes — behind <ProtectedRoute>, touches no user data.
@router.get("/question-types", response_model=Page[QuestionTypeOut])
async def question_types(
    params: Params = Depends(),
    q: str | None = None,
    user_id: str = Depends(require_user),
):
    return await list_question_types(params, search=q)


@router.get("/question-types/{slug}", response_model=QuestionTypeOut)
async def question_type_by_slug(slug: str, user_id: str = Depends(require_user)):
    row = await get_question_type_by_slug(slug)
    if row is None:
        raise HTTPException(status_code=404, detail="unknown question type")
    return row


@router.get("/round-types", response_model=Page[RoundTypeOut])
async def round_types(
    params: Params = Depends(),
    q: str | None = None,
    user_id: str = Depends(require_user),
):
    return await list_round_types(params, search=q)


@router.get("/round-types/{slug}", response_model=RoundTypeOut)
async def round_type_by_slug(slug: str, user_id: str = Depends(require_user)):
    row = await get_round_type_by_slug(slug)
    if row is None:
        raise HTTPException(status_code=404, detail="unknown round type")
    return row
