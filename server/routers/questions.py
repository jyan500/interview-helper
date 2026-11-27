"""Questions: browse the bank, write your own, and edit the saved "My questions" set."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi_pagination import Page, Params
from pydantic import BaseModel, Field, StringConstraints

from auth import require_user
# The brief writer for a candidate's own question (grader-only reference).
from simulation import generate_brief
from tools.custom_questions import (
    archive_custom_question,
    check_custom_question_input,
    create_custom_question,
    get_custom_question,
    update_custom_question,
)
from tools.questions import list_questions_page, save_saved_questions
from routers.common import envelope_result

router = APIRouter(tags=["questions"])


# GET /api/questions row shape (Phase G — the browse / "My questions" UI). Unlike RoleOut/LevelOut
# this is NOT coerced straight off an ORM row: `list_questions_page` returns plain dicts (from
# _question_out) because `selected` is computed, not a column, and type/level are flattened to their
# NAMES for display. `selected` = is this question in the CALLING user's saved set, so a checkbox
# renders in the right state. `level_*` are nullable — an unleveled question has no band.
class QuestionOut(BaseModel):
    slug: str
    title: str
    text: str
    type_slug: str
    type_name: str
    level_slug: str | None = None
    level_name: str | None = None
    tags: list[str]
    selected: bool
    is_custom: bool = False
    is_claimed: bool = False   # saved from a job interview: the user's, but read-only


# POST /api/questions and PUT /api/questions/{slug} body — a candidate's OWN practice question (see
# tools/custom_questions.py). A full replace on PUT, like the background routes. Length caps are a 422
# before anything runs, so bad input never reaches the paid brief call. `grading_notes` "" or omitted
# both mean "no guidance": the brief is written from the question alone.
CUSTOM_QUESTION_TITLE_MAX = 100
CUSTOM_QUESTION_TEXT_MAX = 2000
CUSTOM_QUESTION_NOTES_MAX = 2000


class CustomQuestionBody(BaseModel):
    title: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=CUSTOM_QUESTION_TITLE_MAX)
    ]
    text: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=CUSTOM_QUESTION_TEXT_MAX)
    ]
    # aliased so the wire stays `type` while the Python name doesn't shadow the builtin
    question_type: str = Field(alias="type")
    level: str
    roles: list[str] = Field(min_length=1)
    grading_notes: Annotated[
        str, StringConstraints(strip_whitespace=True, max_length=CUSTOM_QUESTION_NOTES_MAX)
    ] = ""


class NamedSlugOut(BaseModel):
    slug: str
    name: str


# GET /api/questions/{slug} — the edit form's detail of the caller's own question.
class CustomQuestionOut(BaseModel):
    slug: str
    title: str
    text: str
    type_slug: str
    type_name: str
    level_slug: str
    level_name: str
    roles: list[NamedSlugOut]
    grading_notes: str | None
    is_claimed: bool = False


# PUT /api/profile/questions body — a bulk "My questions" edit committed in one batch. The SPA sends
# a table's selected rows when its action is applied (add/remove lists of question slugs), rather than
# a per-row PUT/DELETE, so a whole selection lands in one transaction. Both default to empty so a body
# may carry only adds or only removes.
class SaveQuestionsRequest(BaseModel):
    add: list[str] = []
    remove: list[str] = []


# GET /api/questions : a PAGE of bank questions for the browse UI and the dashboard "My questions"
# table (Phase G). Same paginated shape as /api/roles — `params` (page/size) + our own filters:
#   role/level  scope to a role and at-or-below seniority (the same filter interviews use).
#   q           substring match on the question text.
#   saved       TRI-STATE against the caller's saved set: true -> only saved ("My questions"),
#               false -> only NOT saved (the Questions page's "everything else" table), omitted ->
#               the whole role+level bank (the Add-question modal).
# `require_user` gives us the uid so each row can carry `selected` (is it in THIS user's set) — the
# uid is never taken from the request, so there's nothing to authorize separately.
#   type        filter to one question KIND (behavioral / system-design / …), a question_types.slug.
#   exact_level when true, `level` matches ONLY that seniority (the Questions-page browse filter)
#               instead of the default at-or-below plan rule (the dashboard table / Add-question modal).
@router.get("/questions", response_model=Page[QuestionOut])
async def questions(
    params: Params = Depends(),
    # omitted = every role (the create form's prefill search); the browse tables always pass one
    role: str | None = None,
    level: str | None = None,
    q: str | None = None,
    saved: bool | None = None,
    # aliased so the wire stays `?type=` while the Python name doesn't shadow the builtin.
    question_type: str | None = Query(default=None, alias="type"),
    exact_level: bool = False,
    authored: bool | None = None,
    user_id: str = Depends(require_user),
):
    return await list_questions_page(
        params,
        role=role,
        level=level,
        profile_id=user_id,
        search=q,
        saved=saved,
        type_slug=question_type,
        exact_level=exact_level,
        authored=authored,
    )


# ===========================================================================
# THE CANDIDATE'S OWN QUESTIONS — see tools/custom_questions.py.
#
# POST   /api/questions         write one: check input, LLM-write its brief, insert (+ save it)
# GET    /api/questions/{slug}  the edit form's detail
# PUT    /api/questions/{slug}  replace it; the brief is rewritten only if what it depends on changed
# DELETE /api/questions/{slug}  archive it (soft delete: past interviews still resolve it)
#
# Owner-scoped by the VERIFIED uid: a bank question or someone else's slug is a 404, never a 403, so
# a slug's existence isn't leaked. Wallet-gated: POST and PUT can make a paid LLM call.

@router.post("/questions", response_model=QuestionOut)
async def add_custom_question(body: CustomQuestionBody, user_id: str = Depends(require_user)):
    # 1. validate the vocab + the count cap BEFORE the paid call
    check = envelope_result(await check_custom_question_input(
        user_id, body.question_type, body.level, body.roles, creating=True
    ))
    # 2. write the grader-only brief, steered by the author's notes when given
    brief = await generate_brief(
        body.text, check["type_name"], check["level_name"], check["role_names"], body.grading_notes
    )
    # 3. insert the question, its roles, its brief, and the saved-set row
    result = await create_custom_question(
        user_id,
        title=body.title,
        text=body.text,
        type_slug=body.question_type,
        level_slug=body.level,
        role_slugs=body.roles,
        grading_notes=body.grading_notes or None,
        brief=brief,
    )
    return envelope_result(result, "question")


@router.get("/questions/{slug}", response_model=CustomQuestionOut)
async def custom_question_detail(slug: str, user_id: str = Depends(require_user)):
    return envelope_result(await get_custom_question(user_id, slug), "question")


@router.put("/questions/{slug}", response_model=QuestionOut)
async def replace_custom_question(
    slug: str, body: CustomQuestionBody, user_id: str = Depends(require_user)
):
    # 1. the current version (404 if it isn't the caller's), to tell whether the brief is stale. A
    #    question claimed from a job interview is read-only (that interview still reads this row), so
    #    it's refused here, before the paid brief call.
    current = envelope_result(await get_custom_question(user_id, slug), "question")
    if current["is_claimed"]:
        raise HTTPException(status_code=400, detail="a question saved from a job interview can't be edited")
    check = envelope_result(await check_custom_question_input(
        user_id, body.question_type, body.level, body.roles, creating=False
    ))

    # 2. rewrite the brief only when something it's written FROM changed. Roles are context, not
    #    substance, and the title is only a display name, so a roles- or title-only edit costs no LLM call.
    notes = body.grading_notes or None
    brief_inputs_changed = (
        body.text != current["text"]
        or body.question_type != current["type_slug"]
        or body.level != current["level_slug"]
        or notes != current["grading_notes"]
    )
    brief = None
    if brief_inputs_changed:
        brief = await generate_brief(
            body.text, check["type_name"], check["level_name"], check["role_names"], notes
        )

    # 3. write it back
    result = await update_custom_question(
        user_id,
        slug,
        title=body.title,
        text=body.text,
        type_slug=body.question_type,
        level_slug=body.level,
        role_slugs=body.roles,
        grading_notes=notes,
        brief=brief,
    )
    return envelope_result(result, "question")


@router.delete("/questions/{slug}")
async def remove_custom_question(slug: str, user_id: str = Depends(require_user)) -> dict:
    return envelope_result(await archive_custom_question(user_id, slug))


# PUT /api/profile/questions : commit a bulk "My questions" edit (add/remove question slugs) in one
# batch. Owner-scoped like the rest of /api/profile — the VERIFIED uid is what the saved rows are
# written under, never an id from the body, so "my saved questions" can't be widened to someone else.
# A batch (not per-slug PUT/DELETE) because the UI applies a whole selection of rows at once.
@router.put("/profile/questions")
async def save_profile_questions(
    body: SaveQuestionsRequest,
    user_id: str = Depends(require_user),
) -> dict:
    return await save_saved_questions(user_id, add=body.add, remove=body.remove)
