"""Helpers shared by more than one router: the tool-envelope -> HTTP mapping and the job guard."""
from __future__ import annotations

from fastapi import HTTPException

from auth import require_ownership
from tools.jobs import get_job


def envelope_result(result: dict, key: str | None = None):
    """Map an {"ok", "error"} tool envelope (tools/background, tools/custom_questions) onto HTTP:
    not_found -> 404, any other error -> 400."""
    if not result["ok"]:
        status = 404 if result["error"] == "not_found" else 400
        raise HTTPException(status_code=status, detail=result["error"])
    return result[key] if key else result


async def owned_job(job_id: str, user_id: str) -> dict:
    """The shared guard for the single-job routes: exists (404) -> owns (403). Returns the job dict."""
    found = await get_job(job_id)
    if found["status"] != "ok":
        raise HTTPException(status_code=404, detail="unknown job")
    require_ownership(found["profile_id"], user_id)
    return found["job"]
