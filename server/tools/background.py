"""The candidate's background — past roles, projects, skills. The data layer behind the Profile page.

Why it exists: a behavioral interviewer is far more useful when it can ask about the candidate's REAL
work ("you led the billing migration at Acme; how did you handle the rollback?") and tie it to the job
description. This module stores that background and renders it as one compact text block
(`format_candidate_background`) for the persona and the round generator to read.

OWNERSHIP: every read and write is scoped by the VERIFIED uid the route passes in, and a single-row
lookup filters on BOTH the slug and that profile_id (a guard param), so another user's slug simply
isn't found (404) — there's no separate ownership step to forget.

SKILLS are picked from the curated `skills` vocabulary (seeded from data/skills.json); a candidate
can't add to it, so an unknown slug is a 400, not a new row.

CAPS: everything here ends up in a prompt that's replayed every turn, so the counts are bounded
(MAX_* below; per-field lengths are enforced by the request schemas in api.py).

Quick test (from server/, needs a real profile uuid and a seeded skills table):
    .venv/Scripts/python.exe -m tools.background <profile-uuid>
"""
from __future__ import annotations

import asyncio
import sys
import uuid
from datetime import date

from fastapi_pagination import Params
from fastapi_pagination.ext.sqlalchemy import apaginate
from sqlalchemy import delete, func, select

from db.engine import get_session
from db.models import ProfileExperience, ProfileProject, ProfileSkill, Skill
from functions import format_month, month_label

MAX_EXPERIENCES = 15
MAX_PROJECTS = 15
MAX_SKILLS = 50


def _experience_dict(row: ProfileExperience) -> dict:
    return {
        "slug": row.slug,
        "title": row.title,
        "company": row.company,
        "start": format_month(row.start_date),
        "end": format_month(row.end_date),
        "description": row.description,
    }


def _project_dict(row: ProfileProject) -> dict:
    return {
        "slug": row.slug,
        "name": row.name,
        "url": row.url,
        "description": row.description,
    }


# Newest role first; a current role (no end date) sorts above an ended one with the same start.
EXPERIENCE_ORDER = (
    ProfileExperience.start_date.desc(),
    ProfileExperience.end_date.desc().nulls_first(),
    ProfileExperience.id,
)
PROJECT_ORDER = (ProfileProject.created_at.desc(), ProfileProject.id)


# --- experiences -------------------------------------------------------------------------------
async def list_experiences(profile_id: str) -> list[dict]:
    async with get_session() as db:
        rows = (await db.execute(
            select(ProfileExperience)
            .where(ProfileExperience.profile_id == profile_id)
            .order_by(*EXPERIENCE_ORDER)
        )).scalars().all()
        return [_experience_dict(row) for row in rows]


async def create_experience(
    profile_id: str,
    *,
    title: str,
    company: str,
    start: date,
    end: date | None,
    description: str,
) -> dict:
    """INSERT one role. Returns {"ok": True, "experience": {...}} or {"ok": False, "error": ...} when the
    profile is already at MAX_EXPERIENCES."""
    async with get_session() as db:
        count = (await db.execute(
            select(func.count()).select_from(ProfileExperience)
            .where(ProfileExperience.profile_id == profile_id)
        )).scalar_one()
        if count >= MAX_EXPERIENCES:
            return {"ok": False, "error": f"you can list at most {MAX_EXPERIENCES} roles"}
        row = ProfileExperience(
            slug=uuid.uuid4().hex[:8],
            profile_id=profile_id,
            title=title,
            company=company,
            start_date=start,
            end_date=end,
            description=description,
        )
        db.add(row)
        await db.commit()
        return {"ok": True, "experience": _experience_dict(row)}


async def update_experience(
    profile_id: str,
    slug: str,
    *,
    title: str,
    company: str,
    start: date,
    end: date | None,
    description: str,
) -> dict:
    """Replace one role's fields. A full replace (PUT), not a PATCH: `end=None` MEANS "current role",
    so None can't also mean "leave alone". Returns {"ok": True, "experience": {...}} or
    {"ok": False, "error": "not_found"}."""
    async with get_session() as db:
        row = (await db.execute(
            select(ProfileExperience).where(
                ProfileExperience.slug == slug,
                ProfileExperience.profile_id == profile_id,
            )
        )).scalar_one_or_none()
        if row is None:
            return {"ok": False, "error": "not_found"}
        row.title = title
        row.company = company
        row.start_date = start
        row.end_date = end
        row.description = description
        await db.commit()
        return {"ok": True, "experience": _experience_dict(row)}


async def delete_experience(profile_id: str, slug: str) -> dict:
    async with get_session() as db:
        result = await db.execute(
            delete(ProfileExperience).where(
                ProfileExperience.slug == slug,
                ProfileExperience.profile_id == profile_id,
            )
        )
        await db.commit()
        if result.rowcount == 0:
            return {"ok": False, "error": "not_found"}
        return {"ok": True}


# --- projects ----------------------------------------------------------------------------------
async def list_projects(profile_id: str) -> list[dict]:
    async with get_session() as db:
        rows = (await db.execute(
            select(ProfileProject)
            .where(ProfileProject.profile_id == profile_id)
            .order_by(*PROJECT_ORDER)
        )).scalars().all()
        return [_project_dict(row) for row in rows]


async def create_project(profile_id: str, *, name: str, url: str | None, description: str) -> dict:
    async with get_session() as db:
        count = (await db.execute(
            select(func.count()).select_from(ProfileProject)
            .where(ProfileProject.profile_id == profile_id)
        )).scalar_one()
        if count >= MAX_PROJECTS:
            return {"ok": False, "error": f"you can list at most {MAX_PROJECTS} projects"}
        row = ProfileProject(
            slug=uuid.uuid4().hex[:8],
            profile_id=profile_id,
            name=name,
            url=url,
            description=description,
        )
        db.add(row)
        await db.commit()
        return {"ok": True, "project": _project_dict(row)}


async def update_project(
    profile_id: str, slug: str, *, name: str, url: str | None, description: str
) -> dict:
    """Replace one project's fields (a full PUT, same reason as update_experience: url=None clears it)."""
    async with get_session() as db:
        row = (await db.execute(
            select(ProfileProject).where(
                ProfileProject.slug == slug,
                ProfileProject.profile_id == profile_id,
            )
        )).scalar_one_or_none()
        if row is None:
            return {"ok": False, "error": "not_found"}
        row.name = name
        row.url = url
        row.description = description
        await db.commit()
        return {"ok": True, "project": _project_dict(row)}


async def delete_project(profile_id: str, slug: str) -> dict:
    async with get_session() as db:
        result = await db.execute(
            delete(ProfileProject).where(
                ProfileProject.slug == slug,
                ProfileProject.profile_id == profile_id,
            )
        )
        await db.commit()
        if result.rowcount == 0:
            return {"ok": False, "error": "not_found"}
        return {"ok": True}


# --- skills ------------------------------------------------------------------------------------
async def list_skills(params: Params, search: str | None = None):
    """A PAGE of the skill vocab for the picker — backs GET /api/skills. Same shape as
    tools.questions.list_roles: the search is ours, the paging is fastapi-pagination's."""
    async with get_session() as db:
        stmt = select(Skill).order_by(func.lower(Skill.name), Skill.id)
        if search:
            stmt = stmt.where(Skill.name.ilike(f"%{search}%"))
        return await apaginate(db, stmt, params)


async def list_skill_vocab() -> list[dict]:
    """The WHOLE skill vocab as [{slug, name}, ...], unpaginated. For the resume importer, which
    constrains its output to these slugs (see resume_import.py). The vocab is ~200 rows."""
    async with get_session() as db:
        rows = (await db.execute(
            select(Skill.slug, Skill.name).order_by(func.lower(Skill.name), Skill.id)
        )).all()
        return [{"slug": row.slug, "name": row.name} for row in rows]


async def list_profile_skills(profile_id: str) -> list[dict]:
    async with get_session() as db:
        rows = (await db.execute(
            select(Skill.slug, Skill.name)
            .join(ProfileSkill, ProfileSkill.skill_id == Skill.id)
            .where(ProfileSkill.profile_id == profile_id)
            .order_by(func.lower(Skill.name))
        )).all()
        return [{"slug": row.slug, "name": row.name} for row in rows]


async def set_profile_skills(profile_id: str, slugs: list[str]) -> dict:
    """REPLACE the profile's skill set with `slugs` (picked from the vocab).

    1. Dedupe and enforce MAX_SKILLS.
    2. Resolve the slugs to skill rows; any that don't exist is an error (the vocab is curated, so a
       candidate can't mint a skill by sending a new slug).
    3. Diff the links: delete the ones no longer listed, insert the new ones. One transaction.

    Returns {"ok": True, "skills": [{slug, name}, ...]} or {"ok": False, "error": ...}."""
    # 1. dedupe, keeping the order they were sent in
    wanted: list[str] = []
    for slug in slugs:
        if slug not in wanted:
            wanted.append(slug)
    if len(wanted) > MAX_SKILLS:
        return {"ok": False, "error": f"you can list at most {MAX_SKILLS} skills"}

    async with get_session() as db:
        # 2. resolve
        skill_ids_by_slug: dict[str, int] = {}
        if wanted:
            rows = (await db.execute(
                select(Skill.id, Skill.slug).where(Skill.slug.in_(wanted))
            )).all()
            for row in rows:
                skill_ids_by_slug[row.slug] = row.id
        unknown = [slug for slug in wanted if slug not in skill_ids_by_slug]
        if unknown:
            return {"ok": False, "error": f"unknown skill: {', '.join(unknown)}"}
        wanted_ids = set(skill_ids_by_slug.values())

        # 3. diff the links
        current_ids = set((await db.execute(
            select(ProfileSkill.skill_id).where(ProfileSkill.profile_id == profile_id)
        )).scalars().all())
        # set subtraction keeps what's in the FIRST set but not the second: skills the profile has
        # now that the new selection dropped -> delete those links.
        stale_ids = current_ids - wanted_ids
        if stale_ids:
            await db.execute(
                delete(ProfileSkill).where(
                    ProfileSkill.profile_id == profile_id,
                    ProfileSkill.skill_id.in_(stale_ids),
                )
            )
        # and the reverse: skills in the new selection the profile doesn't have yet -> insert those.
        # Skills in both sets are left untouched.
        for skill_id in wanted_ids - current_ids:
            db.add(ProfileSkill(profile_id=profile_id, skill_id=skill_id))
        await db.commit()

    return {"ok": True, "skills": await list_profile_skills(profile_id)}


# --- the prompt block --------------------------------------------------------------------------
async def format_candidate_background(profile_id: str) -> str:
    """The candidate's background as one compact plain-text block for a prompt, or "" when they've
    filled in nothing (callers then leave the paragraph out entirely).

    Roles newest first, then projects, then skills, the order a résumé reads in."""
    async with get_session() as db:
        experiences = (await db.execute(
            select(ProfileExperience)
            .where(ProfileExperience.profile_id == profile_id)
            .order_by(*EXPERIENCE_ORDER)
        )).scalars().all()
        projects = (await db.execute(
            select(ProfileProject)
            .where(ProfileProject.profile_id == profile_id)
            .order_by(*PROJECT_ORDER)
        )).scalars().all()
        skill_names = (await db.execute(
            select(Skill.name)
            .join(ProfileSkill, ProfileSkill.skill_id == Skill.id)
            .where(ProfileSkill.profile_id == profile_id)
            .order_by(func.lower(Skill.name))
        )).scalars().all()

    sections: list[str] = []
    if experiences:
        lines = ["Roles (most recent first):"]
        for row in experiences:
            line = (f"- {row.title} at {row.company} "
                    f"({month_label(row.start_date)} to {month_label(row.end_date)})")
            if row.description:
                line += f": {row.description}"
            lines.append(line)
        sections.append("\n".join(lines))
    if projects:
        lines = ["Projects:"]
        for row in projects:
            line = f"- {row.name}"
            if row.url:
                line += f" ({row.url})"
            if row.description:
                line += f": {row.description}"
            lines.append(line)
        sections.append("\n".join(lines))
    if skill_names:
        sections.append("Skills: " + ", ".join(skill_names))
    return "\n\n".join(sections)


if __name__ == "__main__":
    async def _smoke(profile_id: str) -> None:
        made = await create_experience(
            profile_id, title="Backend Engineer", company="Smoke Co",
            start=date(2022, 1, 1), end=None, description="(smoke test) Built payment APIs.",
        )
        print("create exp  ->", made)
        slug = made["experience"]["slug"]
        print("update exp  ->", await update_experience(
            profile_id, slug, title="Senior Backend Engineer", company="Smoke Co",
            start=date(2022, 1, 1), end=date(2024, 6, 1), description="Led the payments rewrite.",
        ))
        print("other user  ->", await delete_experience(str(uuid.uuid4()), slug))
        proj = await create_project(profile_id, name="Smoke Project", url=None, description="A CLI.")
        print("create proj ->", proj)
        print("skills      ->", await set_profile_skills(profile_id, ["python", "cpp", "cpp"]))
        print("bad skill   ->", await set_profile_skills(profile_id, ["not-a-skill"]))
        print("block       ->\n" + await format_candidate_background(profile_id))
        print("delete exp  ->", await delete_experience(profile_id, slug))
        print("delete proj ->", await delete_project(profile_id, proj["project"]["slug"]))
        print("skills off  ->", await set_profile_skills(profile_id, []))
        print("empty block ->", repr(await format_candidate_background(profile_id)))

    asyncio.run(_smoke(sys.argv[1]))
