"""A candidate's OWN practice questions: the data layer behind "Create question" on the Questions page.

A user-written question is an ordinary `questions` row (slug "user-<hex>", `profile_id` = the author)
with ordinary `question_roles` pairings and an ordinary `reference_briefs` row, so the whole existing
pipeline (browse, saved set, interview plan, grading) runs on it unchanged. What keeps it PRIVATE is the
bank-visibility clause (tools/questions._visible_to) every bank read applies.

The BRIEF is LLM-written (simulation.generate_brief) by the ROUTE, between check_custom_question_input
and the write here: this module stays data-only (no LLM import), and the input check runs first so bad
input never costs a paid call.

OWNERSHIP: like tools/background.py, every single-row lookup filters on BOTH the slug and the
author's profile_id (a guard param), so a bank question or another user's slug simply isn't found (404).

DELETE IS A SOFT DELETE (`archived_at`): turns and scorecard entries keep FKs to the question, so an
interview that asked it still resolves; the bank and new plans stop seeing it.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.orm import selectinload

from db.engine import get_session
from db.models import (
    Level,
    ProfileQuestion,
    Question,
    QuestionRole,
    QuestionType,
    ReferenceBrief,
    Role,
)
from tools.questions import QUESTION_LOADS, _question_out

# Each create is a paid LLM call (the brief), so a profile's live questions are bounded.
MAX_CUSTOM_QUESTIONS = 100


async def check_custom_question_input(
    profile_id: str, type_slug: str, level_slug: str, role_slugs: list[str], creating: bool
) -> dict:
    """Validate a create/update BEFORE the route pays for a brief. Resolves the vocab slugs and, on a
    create, checks the MAX_CUSTOM_QUESTIONS cap.

    Returns {"ok": True, "type_name", "level_name", "role_names"} (names feed the brief prompt) or
    {"ok": False, "error": ...}."""
    async with get_session() as db:
        question_type = (await db.execute(
            select(QuestionType).where(QuestionType.slug == type_slug)
        )).scalar_one_or_none()
        if question_type is None:
            return {"ok": False, "error": f"unknown question type: {type_slug}"}

        level = (await db.execute(select(Level).where(Level.slug == level_slug))).scalar_one_or_none()
        if level is None:
            return {"ok": False, "error": f"unknown level: {level_slug}"}

        roles = (await db.execute(select(Role).where(Role.slug.in_(role_slugs)))).scalars().all()
        # in the requested slugs but not among the roles found
        unknown_roles = set(role_slugs) - {role.slug for role in roles}
        if unknown_roles:
            return {"ok": False, "error": f"unknown role(s): {', '.join(sorted(unknown_roles))}"}

        if creating:
            count = (await db.execute(
                select(func.count()).select_from(Question).where(
                    Question.profile_id == profile_id, Question.archived_at.is_(None)
                )
            )).scalar_one()
            if count >= MAX_CUSTOM_QUESTIONS:
                return {"ok": False, "error": f"you can have at most {MAX_CUSTOM_QUESTIONS} questions"}

        return {
            "ok": True,
            "type_name": question_type.name,
            "level_name": level.name,
            "role_names": [role.name for role in roles],
        }


async def _load_owned(db, profile_id: str, slug: str) -> Question | None:
    """The author's live (unarchived) question by slug, with what the detail and browse shapes read."""
    return (await db.execute(
        select(Question)
        .where(
            Question.slug == slug,
            Question.profile_id == profile_id,
            Question.archived_at.is_(None),
        )
        .options(*QUESTION_LOADS, selectinload(Question.role_links).selectinload(QuestionRole.role))
    )).scalar_one_or_none()


def _detail_dict(question: Question) -> dict:
    """The edit form's shape: everything the author set, by slug + name (the pickers show names)."""
    return {
        "slug": question.slug,
        "title": question.title,
        "text": question.text,
        "type_slug": question.type.slug,
        "type_name": question.type.name,
        "level_slug": question.level.slug,
        "level_name": question.level.name,
        "roles": [{"slug": link.role.slug, "name": link.role.name} for link in question.role_links],
        "grading_notes": question.grading_notes,
    }


async def _set_roles(db, question: Question, role_slugs: list[str]) -> None:
    """Make the question's `question_roles` links match the roles picked in the form.

    Diffs instead of clear-and-re-add so a role that stays linked keeps its place in that role's list.
    """
    # 1. load the picked roles
    roles = (await db.execute(select(Role).where(Role.slug.in_(role_slugs)))).scalars().all()

    # 2. what the form asks for vs. what's linked now
    wanted_ids = {role.id for role in roles}
    current_ids = {link.role_id for link in question.role_links}

    # 3. remove links to roles that are no longer picked
    for link in list(question.role_links):
        if link.role_id not in wanted_ids:
            question.role_links.remove(link)

    # 4. add links for newly picked roles (in the wanted set but not the current one), each at the END
    #    of that role's list so a user's question never jumps ahead of the authored bank
    for role_id in wanted_ids - current_ids:
        max_order = (await db.execute(
            select(func.max(QuestionRole.sort_order)).where(QuestionRole.role_id == role_id)
        )).scalar_one()
        question.role_links.append(
            QuestionRole(role_id=role_id, sort_order=(max_order or 0) + 1)
        )

    # 5. roles in both sets are left alone, so their link (and sort_order) is unchanged


async def create_custom_question(
    profile_id: str,
    *,
    title: str,
    text: str,
    type_slug: str,
    level_slug: str,
    role_slugs: list[str],
    grading_notes: str | None,
    brief: str,
) -> dict:
    """INSERT the question, its role pairings, its brief, and a `profile_questions` row (a question
    you just wrote is one you want to practice), all in one transaction. Call after
    check_custom_question_input. Returns {"ok": True, "question": <browse shape>}."""
    async with get_session() as db:
        # 1. resolve the vocab (already validated by check_custom_question_input)
        type_id = (await db.execute(
            select(QuestionType.id).where(QuestionType.slug == type_slug)
        )).scalar_one()
        level_id = (await db.execute(select(Level.id).where(Level.slug == level_slug))).scalar_one()

        # 2. the question itself; role_links starts empty, so _set_roles can read it without a load
        question = Question(
            slug=f"user-{uuid.uuid4().hex[:12]}",
            type_id=type_id,
            level_id=level_id,
            title=title,
            text=text,
            profile_id=profile_id,
            grading_notes=grading_notes,
            role_links=[],
        )
        db.add(question)
        await _set_roles(db, question, role_slugs)
        # 3. flush for the autoincrement id the brief and the saved-set row reference
        await db.flush()
        db.add(ReferenceBrief(question_id=question.id, brief=brief))
        db.add(ProfileQuestion(profile_id=profile_id, question_id=question.id))
        await db.commit()

        # 4. reload with the relationships the browse shape reads
        created = await _load_owned(db, profile_id, question.slug)
        return {"ok": True, "question": _question_out(created, selected=True)}


async def get_custom_question(profile_id: str, slug: str) -> dict:
    """The edit form's detail. Returns {"ok": True, "question": {...}} or {"ok": False, "error":
    "not_found"} (unknown, archived, a bank question, or someone else's)."""
    async with get_session() as db:
        question = await _load_owned(db, profile_id, slug)
        if question is None:
            return {"ok": False, "error": "not_found"}
        return {"ok": True, "question": _detail_dict(question)}


async def update_custom_question(
    profile_id: str,
    slug: str,
    *,
    title: str,
    text: str,
    type_slug: str,
    level_slug: str,
    role_slugs: list[str],
    grading_notes: str | None,
    brief: str | None,
) -> dict:
    """Replace the question's fields (a full replace, like the PUT it backs). `brief` is the
    regenerated brief, or None when nothing the brief depends on changed (the route decides; a
    roles-only edit costs no LLM call). Returns {"ok": True, "question": <browse shape>} or
    {"ok": False, "error": "not_found"}."""
    async with get_session() as db:
        question = await _load_owned(db, profile_id, slug)
        if question is None:
            return {"ok": False, "error": "not_found"}

        question.title = title
        question.text = text
        question.type_id = (await db.execute(
            select(QuestionType.id).where(QuestionType.slug == type_slug)
        )).scalar_one()
        question.level_id = (await db.execute(
            select(Level.id).where(Level.slug == level_slug)
        )).scalar_one()
        question.grading_notes = grading_notes
        await _set_roles(db, question, role_slugs)

        if brief is not None:
            brief_row = (await db.execute(
                select(ReferenceBrief).where(ReferenceBrief.question_id == question.id)
            )).scalar_one_or_none()
            if brief_row is None:
                db.add(ReferenceBrief(question_id=question.id, brief=brief))
            else:
                brief_row.brief = brief
        await db.commit()

        # `selected` for the browse shape: is it (still) in the author's saved set
        saved = (await db.execute(
            select(ProfileQuestion.id).where(
                ProfileQuestion.profile_id == profile_id,
                ProfileQuestion.question_id == question.id,
            )
        )).scalar_one_or_none() is not None
        # reload: type/level changed by id, so the loaded relationships are stale
        db.expire(question)
        updated = await _load_owned(db, profile_id, slug)
        return {"ok": True, "question": _question_out(updated, selected=saved)}


async def archive_custom_question(profile_id: str, slug: str) -> dict:
    """Soft-delete: stamp `archived_at` and drop it from the author's saved set (so "My questions"
    doesn't count a question the bank no longer shows). Returns {"ok": True} or
    {"ok": False, "error": "not_found"}."""
    async with get_session() as db:
        question = await _load_owned(db, profile_id, slug)
        if question is None:
            return {"ok": False, "error": "not_found"}
        question.archived_at = datetime.now(timezone.utc)
        await db.execute(
            delete(ProfileQuestion).where(ProfileQuestion.question_id == question.id)
        )
        await db.commit()
        return {"ok": True}
