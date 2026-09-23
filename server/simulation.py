"""Interview SIMULATION — the LLM work behind "paste a job description, run that company's round".

Two agents live here (the same `output_type` idea as grading.py — the model fills a typed shape,
no prose to parse):

    jd_agent     reads a pasted JD once, at job creation, and extracts company / title / a short
                 summary, plus the role and level MAPPED ONTO OUR EXISTING VOCAB. Cheap model
                 (the interviewer's flash-lite): it's extraction, not judgement.
    round_agent  (Phase 2) writes a round's questions + their grading briefs from the job.

WHY THE ROLE/LEVEL ARE CONSTRAINED, NOT FREE TEXT. A job's role/level are FKs — they pick the level
calibration for grading and let simulations sit beside bank interviews. A free-text "Senior Backend
Engineer II" can't be an FK. So the output type is built PER RUN with `Literal[...]` over the LIVE
slugs (pydantic-ai 2.13's `run(output_type=...)` override): the model's JSON schema only admits real
slugs, and pydantic rejects anything else — it can't invent vocab, the same "the model never picks an
id we didn't give it" rule as the turn loop.

COST GUARDRAILS (CLAUDE.md): max_tokens capped, request_limit capped, and every run logs its token
counts + latency. The JD itself is length-capped by the route before it gets here.

Smoke test (from server/, 1 LLM call — needs .env GEMINI_API_KEY):
    .venv/Scripts/python.exe simulation.py
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Literal

from fastapi_pagination import Params
from pydantic import BaseModel, Field, create_model
from pydantic_ai import Agent
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import UsageLimits

# Importing pydantic_agent runs its load_dotenv (GEMINI_API_KEY) and gives us the cheap model.
from pydantic_agent import model
from tools.questions import list_levels, list_roles

# uvicorn's logger, so these lines land in the same console as the request log.
log = logging.getLogger("uvicorn.error")


def log_run(label: str, result, started: float) -> None:
    """One line per LLM call: tokens in/out + wall-clock latency (the per-turn cost visibility the
    guardrails ask for). `result.usage` is a property on pydantic-ai 2.13's run result."""
    usage = result.usage
    log.info(
        "%s: input_tokens=%s output_tokens=%s latency=%.2fs",
        label, usage.input_tokens, usage.output_tokens, time.perf_counter() - started,
    )


# --- JD EXTRACTION -------------------------------------------------------------------------
class _JobExtractionBase(BaseModel):
    """The free-text half of the extraction. `role_slug`/`level_slug` are added per run (see
    _extraction_type) because their allowed values are whatever is in the DB right now."""
    company: str = Field(description="the hiring company's name as written in the posting; "
                                     "'Unknown company' if it genuinely isn't stated")
    title: str = Field(description="the job title as written in the posting, e.g. "
                                   "'Senior Software Engineer, Payments'")
    summary: str = Field(description="a 120-200 word digest an interviewer would prep from: what "
                                     "the company and team do, the core responsibilities, the "
                                     "required and nice-to-have skills and tech stack, and any "
                                     "stated values or culture signals. Plain prose, no bullet "
                                     "points, no salary/benefits/legal boilerplate")


def _extraction_type(role_slugs: list[str], level_slugs: list[str]) -> type[BaseModel]:
    """Build the output type with role/level constrained to the live slugs. `Literal[tuple]`
    unpacks to `Literal["a", "b", ...]`, which becomes an `enum` in the JSON schema the model sees."""
    return create_model(
        "JobExtraction",
        __base__=_JobExtractionBase,
        role_slug=(
            Literal[tuple(role_slugs)],
            Field(description="the closest matching role from the allowed list"),
        ),
        level_slug=(
            Literal[tuple(level_slugs)],
            Field(description="the seniority the posting is hiring for, from the allowed list"),
        ),
    )


# No output_type here — it's supplied per run by extract_job. flash-lite: extraction, not judgement.
jd_agent = Agent(
    model,
    instructions=(
        "You read a job posting and extract structured facts about it for an interview-practice app. "
        "Be faithful to the posting; do not invent a company, stack, or requirement it doesn't state. "
        "For the role, pick the closest match from the allowed roles by what the job actually does "
        "(a 'Software Engineer' building APIs and services is backend; one owning UI in React is "
        "frontend; one spanning both is full-stack). For the level: explicit titles win ('Senior', "
        "'Staff', 'Lead' -> senior; 'Junior', 'New Grad', 'Associate', 'Intern' -> entry); otherwise "
        "use required experience (0-2 years -> entry, 2-5 -> mid, 5+ -> senior), defaulting to mid."
    ),
    model_settings=ModelSettings(max_tokens=1000),
)


async def extract_job(description: str) -> BaseModel:
    """Run the extractor over a pasted JD. Returns a JobExtraction (company, title, summary,
    role_slug, level_slug) whose role/level are guaranteed to be live slugs.

    The allowed roles are passed WITH their names, so the model maps "Frontend engineer" by meaning
    rather than guessing from a slug. The vocab is tiny (4 roles, 3 levels), so one page each."""
    roles = (await list_roles(Params(page=1, size=100))).items
    levels = (await list_levels(Params(page=1, size=100))).items
    output_type = _extraction_type([r.slug for r in roles], [lv.slug for lv in levels])

    allowed = (
        "Allowed roles (slug: name): " + "; ".join(f"{r.slug}: {r.name}" for r in roles) + "\n"
        "Allowed levels (slug: name): " + "; ".join(f"{lv.slug}: {lv.name}" for lv in levels)
    )
    started = time.perf_counter()
    result = await jd_agent.run(
        f"{allowed}\n\nJOB POSTING:\n{description}",
        output_type=output_type,
        usage_limits=UsageLimits(request_limit=3),
    )
    log_run("jd_extract", result, started)
    return result.output


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    sample = (
        "Stripe is hiring a Software Engineer, Payments Infrastructure. You'll design and operate the "
        "APIs and distributed services that move money for millions of businesses. 3+ years building "
        "backend systems in Java, Go, or Ruby; experience with distributed systems, databases, and "
        "high-availability services. We value users first, rigor, and moving with urgency."
    )
    print(asyncio.run(extract_job(sample)))
