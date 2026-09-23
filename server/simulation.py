"""Interview SIMULATION — the LLM work behind "paste a job description, run that company's round".

Two agents live here (the same `output_type` idea as grading.py — the model fills a typed shape,
no prose to parse):

    jd_agent     reads a pasted JD once, at job creation, and extracts company / title / a short
                 summary, plus the role and level MAPPED ONTO OUR EXISTING VOCAB. Cheap model
                 (the interviewer's flash-lite): it's extraction, not judgement.
    round_agent  writes a round's questions + a grading brief for each, from the job's summary and
                 the round's `guidance`. The STRONGER grader model: these questions and briefs
                 are the whole interview and its answer key, so quality is worth paying for —
                 and it runs once per round, not once per turn.

WHY THE ROLE/LEVEL ARE CONSTRAINED, NOT FREE TEXT. A job's role/level are FKs — they pick the level
calibration for grading and let simulations sit beside bank interviews. A free-text "Senior Backend
Engineer II" can't be an FK. So the output type is built PER RUN with `Literal[...]` over the LIVE
slugs (pydantic-ai 2.13's `run(output_type=...)` override): the model's JSON schema only admits real
slugs, and pydantic rejects anything else — it can't invent vocab, the same "the model never picks an
id we didn't give it" rule as the turn loop.

COST GUARDRAILS (CLAUDE.md): max_tokens capped, request_limit capped, and every run logs its token
counts + latency. The JD itself is length-capped by the route before it gets here.

Smoke test (from server/, 2 LLM calls: extract, then generate a coding round — needs .env
GEMINI_API_KEY and a seeded DB):
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

# Importing pydantic_agent runs its load_dotenv (GEMINI_API_KEY) and gives us the cheap model;
# grading gives us the stronger one the round generator runs on.
from grading import grader_model
from pydantic_agent import model
from tools.questions import list_levels, list_question_types, list_roles

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


# --- ROUND GENERATION ----------------------------------------------------------------------
# The questions a simulation asks are WRITTEN here, once, at kickoff — and each one carries its own
# grading brief. The brief is what keeps grading grounded: a generated question is graded exactly
# like a bank question with an authored brief (grade_one -> get_reference), so the brief has to be
# the same house style as data/reference_briefs/*.md. The candidate never sees it.
class _GeneratedQuestionBase(BaseModel):
    """The free-text half of one generated question. `type_slug` is added per run (see
    _round_output_type), constrained to the live question types like the JD extractor's role."""
    text: str = Field(description="the question exactly as the interviewer will present it to the "
                                  "candidate, in plain text (no markdown headings)")
    brief: str = Field(description="the grading brief for this question, in the house style set out "
                                   "in the instructions. Hidden from the candidate — it's the answer key")


def _round_output_type(type_slugs: list[str], plan_size: int) -> type[BaseModel]:
    """Build the round's output type: exactly `plan_size` questions, each typed from the live
    question-type slugs. Both constraints are in the JSON schema the model sees AND enforced by
    pydantic — a wrong count or an invented type is a validation error pydantic-ai retries, so the
    plan the interview freezes is always the round's size."""
    question = create_model(
        "GeneratedQuestion",
        __base__=_GeneratedQuestionBase,
        type_slug=(
            Literal[tuple(type_slugs)],
            Field(description="the question's type, from the allowed list — the round guidance "
                              "says which to use"),
        ),
    )
    return create_model(
        "GeneratedRound",
        questions=(
            list[question],
            Field(min_length=plan_size, max_length=plan_size,
                  description=f"exactly {plan_size} question(s), in the order they will be asked"),
        ),
    )


# No output_type here either — supplied per run by generate_round. The stronger model (see the module
# docstring). max_tokens is sized for the biggest round: four briefs of a few hundred words each, or
# two full coding problem statements plus their briefs.
round_agent = Agent(
    grader_model,
    instructions=(
        "You write the questions for one round of a realistic mock interview at a specific company, "
        "plus a private grading brief for each question. The round guidance says what the round "
        "contains and how many questions to write; follow it exactly, in its order. Tailor every "
        "question to this company and job using the job summary, and calibrate difficulty to the "
        "candidate's level. Do not invent facts about the company beyond what the summary states.\n\n"
        "Each BRIEF is the answer key a separate grader scores the candidate's answer against. Write it "
        "in plain markdown with these sections, in this order:\n"
        "1. 'What this question is really testing' - one or two sentences.\n"
        "2. 'Concept anchors' - 3 to 5 bullets, phrased as DEMONSTRATED CAPABILITY, never as keywords "
        "(explaining how a mechanism works earns credit; naming it does not).\n"
        "3. 'Tiered gradation' - this IS the 1-5 scale: Bad (1-2), Good (3-4) and Great (5), each a "
        "concrete description of what such an answer contains.\n"
        "4. 'Leveling bands' - what clears the bar at Entry, at Mid, and at Senior; the same answer "
        "clears a different bar at each level.\n"
        "For a CODING question, the brief must also give the brute-force approach, the optimal approach "
        "with its time and space complexity, and the edge cases a strong answer handles. For a "
        "behavioral question, anchor on structure, the candidate's own actions, measurable results, and "
        "(where the question is about this company) genuine knowledge of the company and role."
    ),
    model_settings=ModelSettings(max_tokens=8000),
)


async def generate_round(job: dict, round_type) -> list[dict]:
    """Write one round's questions for a job. Returns `plan_size` dicts of {text, type_slug, brief},
    in ask order — the shape create_interview(generated=...) takes (plain dicts, so the data layer
    never imports this module's model stack).

    `job` is the tools/jobs detail dict (company, title, summary, level); `round_type` is the
    RoundType ORM row, whose `guidance` says what to ask and `plan_size` how many. The allowed
    question types are passed with their names, like the JD extractor's roles."""
    types = (await list_question_types(Params(page=1, size=100))).items
    output_type = _round_output_type([t.slug for t in types], round_type.plan_size)

    prompt = (
        f"Allowed question types (slug: name): {'; '.join(f'{t.slug}: {t.name}' for t in types)}\n\n"
        f"COMPANY: {job['company']}\n"
        f"JOB TITLE: {job['title']}\n"
        f"CANDIDATE LEVEL: {job['level']} ({job['level_name']})\n"
        f"JOB SUMMARY: {job['summary']}\n\n"
        f"ROUND: {round_type.name}\n"
        f"ROUND GUIDANCE: {round_type.guidance}\n\n"
        f"Write exactly {round_type.plan_size} question(s), each with its brief."
    )
    started = time.perf_counter()
    result = await round_agent.run(
        prompt,
        output_type=output_type,
        usage_limits=UsageLimits(request_limit=3),
    )
    log_run(f"round_generate[{round_type.slug}]", result, started)
    return [q.model_dump() for q in result.output.questions]


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    sample = (
        "Stripe is hiring a Software Engineer, Payments Infrastructure. You'll design and operate the "
        "APIs and distributed services that move money for millions of businesses. 3+ years building "
        "backend systems in Java, Go, or Ruby; experience with distributed systems, databases, and "
        "high-availability services. We value users first, rigor, and moving with urgency."
    )
    async def _smoke() -> None:
        from tools.rounds import get_round_type_by_slug

        extracted = await extract_job(sample)
        print(extracted)
        # the job dict shape generate_round reads (tools/jobs._job_dict), without writing a row
        job = {
            "company": extracted.company,
            "title": extracted.title,
            "summary": extracted.summary,
            "level": extracted.level_slug,
            "level_name": extracted.level_slug,
        }
        for q in await generate_round(job, await get_round_type_by_slug("coding")):
            print(f"\n[{q['type_slug']}] {q['text']}\n--- brief ---\n{q['brief']}")

    asyncio.run(_smoke())
