"""INTERVIEW SIMULATION — the caller's saved job descriptions.

/api/jobs : CRUD over the caller's saved job descriptions.
    POST   {description}  -> the JD-extraction agent reads it, then the row is written. PAID (one
                             LLM call), so behind require_user like every cloud-spending route, and
                             length-capped before the model ever sees it.
    GET    ?q=&page=&size= -> the caller's jobs, owner-scoped by the verified uid.
    GET/PATCH/DELETE /{job_id} -> guard order exists (404) -> owns (403), the same as interviews
                             (routers.common.owned_job).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi_pagination import Page, Params
from pydantic import BaseModel

from auth import require_user
# Interview simulation — the JD extractor.
from simulation import extract_job
from tools.jobs import create_job, delete_job, list_jobs_page, update_job
from routers.common import owned_job

router = APIRouter(tags=["jobs"])


# POST /api/jobs body — just the pasted posting; everything else is extracted from it.
class JobCreate(BaseModel):
    description: str


# PATCH /api/jobs/{job_id} body — the user correcting the extractor. All OPTIONAL: None = leave that
# field alone (update_job's convention, same as ProfileUpdate), so the form sends only what changed.
class JobUpdate(BaseModel):
    company: str | None = None
    title: str | None = None
    role: str | None = None
    level: str | None = None


# A job as listed (tools/jobs._job_dict). role/level carry the SLUG (for the edit pickers and the
# start path) and the NAME (for display). JobDetailOut adds the long fields the list never shows.
class JobOut(BaseModel):
    job_id: str
    company: str
    title: str
    role: str
    role_name: str
    level: str
    level_name: str
    created_at: str


class JobDetailOut(JobOut):
    summary: str
    description: str


# The JD length window. The floor catches an accidental paste of a title alone (nothing to tailor a
# round from); the ceiling caps what one extraction can cost — real postings run 2-8k characters, so
# 20k leaves room for a long one plus pasted boilerplate without letting a runaway paste through.
JD_MIN_CHARS = 100
JD_MAX_CHARS = 20_000


@router.post("/jobs", response_model=JobDetailOut)
async def new_job(body: JobCreate, user_id: str = Depends(require_user)):
    description = body.description.strip()
    if len(description) < JD_MIN_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"paste the full job description (at least {JD_MIN_CHARS} characters)",
        )
    if len(description) > JD_MAX_CHARS:
        raise HTTPException(
            status_code=413,
            detail=f"job description is too long (max {JD_MAX_CHARS} characters)",
        )

    extraction = await extract_job(description)
    result = await create_job(
        user_id,
        description=description,
        company=extraction.company,
        title=extraction.title,
        summary=extraction.summary,
        role=extraction.role_slug,
        level=extraction.level_slug,
    )
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result["job"]


@router.get("/jobs", response_model=Page[JobOut])
async def my_jobs(
    params: Params = Depends(),
    q: str | None = None,
    graded: bool | None = None,   # only jobs with a graded simulation (the signal panel's picker)
    sort: str | None = None,      # "name" = alphabetical by company, title; omit = newest first
    user_id: str = Depends(require_user),
):
    return await list_jobs_page(user_id, params, q=q, graded=graded, sort=sort)


@router.get("/jobs/{job_id}", response_model=JobDetailOut)
async def job_detail(job_id: str, user_id: str = Depends(require_user)):
    return await owned_job(job_id, user_id)


@router.patch("/jobs/{job_id}", response_model=JobDetailOut)
async def edit_job(job_id: str, body: JobUpdate, user_id: str = Depends(require_user)):
    await owned_job(job_id, user_id)
    # a blank company/title would leave the job unnamed on every list — reject rather than store it
    for field in ("company", "title"):
        value = getattr(body, field)
        if value is not None and not value.strip():
            raise HTTPException(status_code=400, detail=f"{field} must not be empty")
    result = await update_job(
        job_id,
        company=body.company.strip() if body.company is not None else None,
        title=body.title.strip() if body.title is not None else None,
        role=body.role,
        level=body.level,
    )
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result["job"]


@router.delete("/jobs/{job_id}")
async def remove_job(job_id: str, user_id: str = Depends(require_user)) -> dict:
    await owned_job(job_id, user_id)
    return await delete_job(job_id)
