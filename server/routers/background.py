"""THE CANDIDATE'S BACKGROUND — the Profile page's roles, projects and skills (tools/background.py),
plus the resume import that pre-fills them.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi_pagination import Page, Params
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from auth import require_user
from functions import parse_month
# Resume import — pre-fill the Profile page's roles + skills from an uploaded resume (nothing stored).
from resume_import import ResumeFileError, parse_resume_file
from tools.background import (
    create_experience,
    create_project,
    delete_experience,
    delete_project,
    list_experiences,
    list_profile_skills,
    list_projects,
    list_skills,
    set_profile_skills,
    update_experience,
    update_project,
)
from routers.common import envelope_result

router = APIRouter(tags=["background"])


# --- THE CANDIDATE'S BACKGROUND (the Profile page) — see tools/background.py. -----------------------
# Length caps live here (a 422 before the tool runs) because every one of these lands in a prompt that's
# replayed each turn. The count caps (how MANY roles/projects/skills) are the tool's.
BACKGROUND_DESCRIPTION_MAX = 1500
MonthField = Annotated[str, Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]   # "YYYY-MM"
# strip_whitespace runs BEFORE the length checks, so "   " is rejected as empty rather than stored blank.
NameField = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]
DescriptionField = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=BACKGROUND_DESCRIPTION_MAX)
]


# POST /api/profile/experiences and PUT /api/profile/experiences/{slug} body. PUT replaces the whole
# row, not a PATCH: `end = None` MEANS "current role", so None can't double as "leave this alone".
class ExperienceBody(BaseModel):
    title: NameField
    company: NameField
    start: MonthField
    end: MonthField | None = None
    description: DescriptionField = ""

    @model_validator(mode="after")
    def _end_not_before_start(self) -> ExperienceBody:
        # "YYYY-MM" strings compare correctly as text
        if self.end is not None and self.end < self.start:
            raise ValueError("end month must not be before the start month")
        return self


class ExperienceOut(BaseModel):
    slug: str
    title: str
    company: str
    start: str
    end: str | None
    description: str


# POST /api/profile/projects and PUT /api/profile/projects/{slug} body (full replace, url=None clears).
class ProjectBody(BaseModel):
    name: NameField
    # a plain checked string, not HttpUrl: HttpUrl normalizes (adds a trailing "/"), so the link the
    # user typed wouldn't round-trip. http(s) only, since it's rendered as a link on the Profile page.
    url: str | None = Field(default=None, max_length=512, pattern=r"^https?://\S+$")
    description: DescriptionField = ""


class ProjectOut(BaseModel):
    slug: str
    name: str
    url: str | None
    description: str


# PUT /api/profile/skills body — the whole selection, as slugs from GET /api/skills.
class SkillsUpdate(BaseModel):
    skills: list[str]


class SkillOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    slug: str
    name: str


# POST /api/profile/resume/parse response: SUGGESTIONS for the Profile page to review, not saved rows
# (so no slug). `start`/`end` may be None when the resume gives no date, so unlike ExperienceOut a None
# `end` doesn't by itself mean "current": `current` says that. A project's `url` is None when the resume
# has no usable link.
class ImportedExperienceOut(BaseModel):
    title: str
    company: str
    start: str | None
    end: str | None
    current: bool
    description: str


class ImportedProjectOut(BaseModel):
    name: str
    url: str | None
    description: str


class ResumeParseOut(BaseModel):
    experiences: list[ImportedExperienceOut]
    projects: list[ImportedProjectOut]
    skills: list[SkillOut]


# ===========================================================================
# THE CANDIDATE'S BACKGROUND — the Profile page's roles, projects and skills (tools/background.py).
#
# /api/profile/experiences  GET (list) · POST (add) · PUT/DELETE /{slug} (replace/remove one)
# /api/profile/projects     the same shape
# /api/profile/skills       GET · PUT {skills: [slug, ...]} replaces the whole selection
# /api/skills               the curated skill vocab, paginated + ?q= for the async picker
#
# Owner-scoped like the rest of /api/profile: the VERIFIED uid goes into every query, and a single-row
# lookup matches on slug AND that uid, so someone else's slug is just a 404, never a 403 leak.
# ===========================================================================


@router.get("/profile/experiences", response_model=list[ExperienceOut])
async def my_experiences(user_id: str = Depends(require_user)):
    return await list_experiences(user_id)


@router.post("/profile/experiences", response_model=ExperienceOut)
async def add_experience(body: ExperienceBody, user_id: str = Depends(require_user)):
    result = await create_experience(
        user_id,
        title=body.title,
        company=body.company,
        start=parse_month(body.start),
        end=parse_month(body.end) if body.end is not None else None,
        description=body.description,
    )
    return envelope_result(result, "experience")


@router.put("/profile/experiences/{slug}", response_model=ExperienceOut)
async def replace_experience(slug: str, body: ExperienceBody, user_id: str = Depends(require_user)):
    result = await update_experience(
        user_id,
        slug,
        title=body.title,
        company=body.company,
        start=parse_month(body.start),
        end=parse_month(body.end) if body.end is not None else None,
        description=body.description,
    )
    return envelope_result(result, "experience")


@router.delete("/profile/experiences/{slug}")
async def remove_experience(slug: str, user_id: str = Depends(require_user)) -> dict:
    return envelope_result(await delete_experience(user_id, slug))


@router.get("/profile/projects", response_model=list[ProjectOut])
async def my_projects(user_id: str = Depends(require_user)):
    return await list_projects(user_id)


@router.post("/profile/projects", response_model=ProjectOut)
async def add_project(body: ProjectBody, user_id: str = Depends(require_user)):
    result = await create_project(
        user_id, name=body.name, url=body.url, description=body.description
    )
    return envelope_result(result, "project")


@router.put("/profile/projects/{slug}", response_model=ProjectOut)
async def replace_project(slug: str, body: ProjectBody, user_id: str = Depends(require_user)):
    result = await update_project(
        user_id, slug, name=body.name, url=body.url, description=body.description
    )
    return envelope_result(result, "project")


@router.delete("/profile/projects/{slug}")
async def remove_project(slug: str, user_id: str = Depends(require_user)) -> dict:
    return envelope_result(await delete_project(user_id, slug))


@router.get("/profile/skills", response_model=list[SkillOut])
async def my_skills(user_id: str = Depends(require_user)):
    return await list_profile_skills(user_id)


@router.put("/profile/skills", response_model=list[SkillOut])
async def replace_skills(body: SkillsUpdate, user_id: str = Depends(require_user)):
    return envelope_result(await set_profile_skills(user_id, body.skills), "skills")


@router.get("/skills", response_model=Page[SkillOut])
async def skills(
    params: Params = Depends(),
    q: str | None = None,
    user_id: str = Depends(require_user),
):
    return await list_skills(params, search=q)


# POST /api/profile/resume/parse : read an uploaded resume and return roles, projects and skills for
# the Profile page to PRE-FILL (resume_import.py). Writes nothing: the candidate reviews and saves through the
# routes above. The file is never persisted either: the bytes live in this request only (Starlette's
# auto-deleted spool), and a PDF's Gemini Files API copy is deleted as soon as the parse ends.
#
# Wallet-gated behind require_user like /api/transcribe: every call is a paid Gemini run.
RESUME_MAX_MB = 5


@router.post("/profile/resume/parse", response_model=ResumeParseOut)
async def parse_resume(file: UploadFile = File(...), user_id: str = Depends(require_user)):
    # 1. size checks
    data = await file.read()
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="The file is empty")
    if len(data) > RESUME_MAX_MB * 1024**2:
        raise HTTPException(status_code=413, detail=f"Resumes can be up to {RESUME_MAX_MB} MB")

    # 2. the type comes from the file's own first bytes, not the client's content-type or extension
    if data.startswith(b"%PDF-"):
        kind = "pdf"
    elif data.startswith(b"PK\x03\x04"):
        kind = "docx"   # a zip; resume_import confirms it's really a Word document
    else:
        raise HTTPException(status_code=415, detail="Upload a PDF or Word (.docx) resume")

    # 3. parse
    try:
        return await parse_resume_file(data, kind)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except ResumeFileError as error:
        raise HTTPException(status_code=502, detail=str(error))
