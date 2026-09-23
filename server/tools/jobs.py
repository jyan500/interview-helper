"""Jobs — the saved job descriptions an interview simulation runs against. The data layer.

A job is pasted once and reused across rounds (behavioral today, coding next week), so it's a row
with a lifecycle: create (after the JD-extraction agent has read it), list, read, edit the extracted
fields, delete. No LLM in here — `simulation.py` does the extraction and api.py hands its output
down, the same split as create_interview taking `persona` rather than fetching it.

OWNERSHIP follows the interviews pattern exactly: the LIST is owner-scoped by a WHERE on the
verified uid (so there's nothing to authorize), while a single-job read returns `profile_id` so the
ROUTE can run `require_ownership` — exists (404) -> owns (403) — before touching the row.

`job_id` on the wire is the job's SLUG (a uuid hex, like `interview_id`); the int id stays internal.

Quick test (from server/, needs a real profile uuid):
    .venv/Scripts/python.exe -m tools.jobs <profile-uuid>
"""
from __future__ import annotations

import asyncio
import sys
import uuid

from fastapi_pagination import Params
from fastapi_pagination.ext.sqlalchemy import apaginate
from sqlalchemy import or_, select

from db.engine import get_session
from db.models import Job, Level, Role


def _job_dict(job: Job, *, detail: bool = False) -> dict:
    """One job as the API returns it. role/level carry BOTH slug (what the edit form's pickers and
    the start path use) and name (what the page shows). The raw `description` is detail-only — it
    can be thousands of characters, and the list never shows it."""
    out = {
        "job_id": job.slug,
        "company": job.company,
        "title": job.title,
        "role": job.role.slug,
        "role_name": job.role.name,
        "level": job.level.slug,
        "level_name": job.level.name,
        "created_at": job.created_at.isoformat(),
    }
    if detail:
        out["summary"] = job.summary
        out["description"] = job.description
    return out


async def _resolve_role_level(db, role: str | None, level: str | None):
    """slug -> row for whichever of role/level was given. Returns (role_row, level_row, error)."""
    role_row = level_row = None
    if role is not None:
        role_row = (await db.execute(select(Role).where(Role.slug == role))).scalar_one_or_none()
        if role_row is None:
            return None, None, f"unknown role: {role}"
    if level is not None:
        level_row = (await db.execute(select(Level).where(Level.slug == level))).scalar_one_or_none()
        if level_row is None:
            return None, None, f"unknown level: {level}"
    return role_row, level_row, None


async def create_job(
    profile_id: str,
    *,
    description: str,
    company: str,
    title: str,
    summary: str,
    role: str,
    level: str,
) -> dict:
    """INSERT a job from a pasted JD + what the extractor pulled out of it. Called by POST /api/jobs.

    Returns {"ok": True, "job": <detail dict>} or {"ok": False, "error": ...} for an unknown
    role/level slug (the extractor's output is constrained to live slugs, so that's a race with a
    vocab change, not an expected path)."""
    async with get_session() as db:
        role_row, level_row, error = await _resolve_role_level(db, role, level)
        if error:
            return {"ok": False, "error": error}
        job = Job(
            slug=uuid.uuid4().hex[:8],
            profile_id=profile_id,
            company=company,
            title=title,
            description=description,
            summary=summary,
            role_id=role_row.id,
            level_id=level_row.id,
        )
        db.add(job)
        await db.commit()
        # Re-read so the selectin relationships (role/level) and the DB-filled timestamps load —
        # a freshly constructed row has neither (see the tags note in db/seed.py).
        job = (await db.execute(select(Job).where(Job.id == job.id))).scalar_one()
        return {"ok": True, "job": _job_dict(job, detail=True)}


async def get_job(job_id: str) -> dict:
    """Read one job by slug. Returns {"status": "ok", "profile_id": <uuid>, "job": <detail dict>}
    or {"status": "not_found"}. `profile_id` is returned RAW for the route's require_ownership
    (it compares as strings), and is deliberately not part of the `job` payload that leaves the
    server."""
    async with get_session() as db:
        job = (await db.execute(select(Job).where(Job.slug == job_id))).scalar_one_or_none()
        if job is None:
            return {"status": "not_found", "job_id": job_id}
        return {"status": "ok", "profile_id": job.profile_id, "job": _job_dict(job, detail=True)}


async def list_jobs_page(profile_id: str, params: Params, *, q: str | None = None) -> dict:
    """A PAGE of one user's jobs, newest first — backs GET /api/jobs.

    Owner-scoped by the WHERE on `profile_id` (the verified uid, never a request field). `q` is a
    case-insensitive substring match on company OR title — the two things a person remembers a
    posting by. Returns the {items, total, page, size, pages} envelope with list-shaped items."""
    async with get_session() as db:
        stmt = select(Job).where(Job.profile_id == profile_id)
        if q:
            stmt = stmt.where(or_(Job.company.ilike(f"%{q}%"), Job.title.ilike(f"%{q}%")))
        stmt = stmt.order_by(Job.created_at.desc())
        page = await apaginate(db, stmt, params)
        return {
            "items": [_job_dict(job) for job in page.items],
            "total": page.total,
            "page": page.page,
            "size": page.size,
            "pages": page.pages,
        }


async def update_job(
    job_id: str,
    *,
    company: str | None = None,
    title: str | None = None,
    role: str | None = None,
    level: str | None = None,
) -> dict:
    """Edit the extracted fields (the user correcting the extractor). None = leave that column alone
    — the same convention as set_profile_defaults, so the form can PATCH only what changed. The
    raw description and the summary are not editable: they're the source and its digest.

    Callers check ownership first (the route loads the job via get_job). Returns
    {"ok": True, "job": <detail dict>} or {"ok": False, "error": ...}."""
    async with get_session() as db:
        job = (await db.execute(select(Job).where(Job.slug == job_id))).scalar_one_or_none()
        if job is None:
            return {"ok": False, "error": f"unknown job: {job_id}"}
        role_row, level_row, error = await _resolve_role_level(db, role, level)
        if error:
            return {"ok": False, "error": error}
        if company is not None:
            job.company = company
        if title is not None:
            job.title = title
        # Assign the RELATIONSHIP, not the `_id` column: `job.role`/`job.level` were already
        # selectin-loaded with the row, and setting only `level_id` leaves that loaded object stale
        # (the identity map hands back the same instance on re-select), so the response would echo
        # the OLD level. Setting the relationship keeps both sides in step and sets the FK on flush.
        if role_row is not None:
            job.role = role_row
        if level_row is not None:
            job.level = level_row
        await db.commit()
        return {"ok": True, "job": _job_dict(job, detail=True)}


async def delete_job(job_id: str) -> dict:
    """Delete a job. The FKs do the rest in the same statement: its simulation interviews (and their
    turns, plans, scorecards) and its generated questions all CASCADE. Callers check ownership first.
    Returns {"ok": True} or {"ok": False, "error": ...}."""
    async with get_session() as db:
        job = (await db.execute(select(Job).where(Job.slug == job_id))).scalar_one_or_none()
        if job is None:
            return {"ok": False, "error": f"unknown job: {job_id}"}
        await db.delete(job)
        await db.commit()
        return {"ok": True}


if __name__ == "__main__":
    async def _smoke(profile_id: str) -> None:
        made = await create_job(
            profile_id,
            description="(smoke test) We're hiring a backend engineer to build payment APIs.",
            company="Smoke Co",
            title="Backend Engineer",
            summary="Payments APIs.",
            role="backend-engineer",
            level="mid",
        )
        print("create ->", made)
        job_id = made["job"]["job_id"]
        print("get    ->", (await get_job(job_id))["job"]["company"])
        print("list   ->", (await list_jobs_page(profile_id, Params(page=1, size=10), q="smoke"))["total"])
        print("update ->", (await update_job(job_id, level="senior"))["job"]["level"])
        print("delete ->", await delete_job(job_id))
        print("gone   ->", (await get_job(job_id))["status"])

    asyncio.run(_smoke(sys.argv[1]))
