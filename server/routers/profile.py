"""The signed-in user's profile row (default role/level, onboarding flag), avatar, and dashboard."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import SUPABASE_URL, require_user
from tools.interview import get_dashboard, get_profile, set_profile_avatar, set_profile_defaults

router = APIRouter(tags=["profile"])


# PATCH /api/profile body — the dashboard default, plus the onboarding checklist's hidden flag. All
# OPTIONAL: sending only some updates only those columns (the None = don't-touch convention
# set_profile_defaults follows), so the client can save role + level together (the usual case),
# either alone, or just hide (true) / restore (false) the "Getting started" checklist.
class ProfileUpdate(BaseModel):
    role: str | None = None
    level: str | None = None
    onboarding_dismissed: bool | None = None


# PUT /api/profile/avatar body — the profile picture's public URL, uploaded client-direct to the
# Supabase Storage `avatars` bucket. The avatar is its own sub-resource (PUT to set/replace, DELETE
# to remove) rather than a field on ProfileUpdate, so there's no "leave it alone" ambiguity — the
# route always writes exactly what it's given. The URL is VALIDATED against our own bucket before
# it's stored (see AVATAR_URL_PREFIX / put_profile_avatar).
class AvatarUpdate(BaseModel):
    avatar_url: str


# ===========================================================================
# DASHBOARD & PROFILE — the signal panel's data + the per-user default it opens on.
#
# GET  /api/profile        — this user's display name + default role/level (for the kickoff
#                            form's pre-fill and the panel's initial role).
# PATCH /api/profile       — set that default (the "Set as default" control).
# GET  /api/dashboard      — the signal over every graded interview (Practice and Job): scoped to one
#                            question KIND (optionally job-narrowed) — readiness / skill breakdown /
#                            work-on-next. The job picker's options come from GET /api/jobs?graded=true;
#                            the kind picker's from /api/question-types.
#
# All owner-scoped the same way as /api/interviews: the VERIFIED uid goes straight into the query,
# never an id from the request, so there's nothing to authorize separately — "my dashboard" can't
# be widened to someone else's.
# ===========================================================================
@router.get("/profile")
async def profile(user_id: str = Depends(require_user)) -> dict:
    result = await get_profile(user_id)
    if result.get("status") != "ok":
        # the signup trigger creates a profile for every auth user, so a verified token should
        # always have one; a miss here is a real inconsistency, not an expected empty state.
        raise HTTPException(status_code=404, detail="profile not found")
    return result


@router.patch("/profile")
async def update_profile(
    body: ProfileUpdate,
    user_id: str = Depends(require_user),
) -> dict:
    result = await set_profile_defaults(
        user_id,
        role_slug=body.role,
        level_slug=body.level,
        onboarding_dismissed=body.onboarding_dismissed,
    )
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


# The only avatar_url the backend will store: a PUBLIC object URL under OUR OWN Storage `avatars`
# bucket. The browser uploads client-direct (storage RLS lets it write only under its own <uid>/
# folder), then PUTs the resulting public URL here — but a PUT body is just a string a hostile client
# could set to anything, and this value is later rendered in an <img src>. Pinning it to this prefix
# means a user can only ever point their avatar at a file they were actually allowed to upload, not at
# an arbitrary third-party URL. SUPABASE_URL comes from auth.py already stripped of a trailing slash.
AVATAR_URL_PREFIX = f"{SUPABASE_URL}/storage/v1/object/public/avatars/"
AVATAR_URL_MAX_LEN = 512  # matches profiles.avatar_url's column width


# The profile picture as its own sub-resource. PUT sets/replaces it (idempotent — the client uploads
# to Storage, then hands us the URL, whether or not one existed before); DELETE removes it. Both are
# owner-scoped the same way as the rest of the profile routes: the VERIFIED uid is the only id
# touched, so there's nothing to authorize separately.
@router.put("/profile/avatar")
async def put_profile_avatar(
    body: AvatarUpdate,
    user_id: str = Depends(require_user),
) -> dict:
    url = body.avatar_url
    # Guard the pointer (see AVATAR_URL_PREFIX): reject anything that isn't a public URL in our bucket.
    if len(url) > AVATAR_URL_MAX_LEN or not url.startswith(AVATAR_URL_PREFIX):
        raise HTTPException(status_code=400, detail="avatar_url must be a public URL in the avatars bucket")
    result = await set_profile_avatar(user_id, url)
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.delete("/profile/avatar")
async def delete_profile_avatar(user_id: str = Depends(require_user)) -> dict:
    result = await set_profile_avatar(user_id, None)
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.get("/dashboard")
async def dashboard(
    question_type: str | None = None,  # question-type slug (omit => the most recently graded answer's kind)
    job: str | None = None,            # job slug (omit => every interview, Practice included)
    period: str | None = None,         # "week"|"month"|"year" — the time window (get_dashboard defaults it)
    user_id: str = Depends(require_user),
) -> dict:
    return await get_dashboard(user_id, question_type_slug=question_type, job_slug=job, period=period)
