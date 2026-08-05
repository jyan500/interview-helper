"""Load `data/questions.json` into Postgres. A ONE-OFF, run by hand.

    .venv/Scripts/python.exe -m db.seed          (from server/)

WHAT IT'S DOING CONCEPTUALLY: the JSON bank is one nested document; the schema is eleven
flat tables. Seeding is where that reshaping actually happens, so this file is the clearest
statement of how the old shape maps to the new one:

    bank["roles"][slug]                 -> a roles row
      .rubric.dimensions[]              -> a rubrics row + one rubric_dimensions row each
      .questions[]                      -> a questions row (its array index becomes sort_order)
        .type                           -> a question_types row, deduped across the bank
        .tags[]                         -> tags rows + question_tags pairings

Two things the JSON never had, invented here because the schema needs them:
  - LEVELS (entry/mid/senior). Phase D assigns questions to them; the rows have to exist
    first. `rank` is what gives them an order a string column couldn't hold.
  - SLUGS for question types, tags, and rubric dimensions — derived from their text, so
    "Technical depth / correctness" becomes "technical-depth-correctness". The slug is the
    stable identity; the name stays free to be reworded.

IDEMPOTENT ON PURPOSE. Every insert goes through `_get_or_create`, keyed on the slug, so
running it twice is a no-op rather than a pile of duplicates — which matters because you
will run it again after editing questions.json. What it does NOT do is update or delete:
existing rows are left alone, so a reworded question in the JSON won't overwrite the DB.
Full re-sync is a bigger job (and a destructive one); this is a seeder, not a migration.
"""
from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.engine import get_session
from db.models import (
    Level,
    Question,
    QuestionType,
    Role,
    Rubric,
    RubricDimension,
    Tag,
)

_BANK = Path(__file__).resolve().parent.parent / "data" / "questions.json"

# The seniority ladder. Not in the JSON — authored here. rank is the ordering Phase D's
# picker and "at or below this level" filtering both need.
_LEVELS = [
    ("entry", "Entry level", 1),
    ("mid", "Mid level", 2),
    ("senior", "Senior", 3),
]


def slugify(text: str) -> str:
    """"Technical depth / correctness" -> "technical-depth-correctness"."""
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def titleize(slug: str) -> str:
    """"backend-engineer" -> "Backend engineer". A readable default display name; edit the
    row afterwards if you want something better."""
    return slug.replace("-", " ").capitalize()


async def _get_or_create(db: AsyncSession, model, *, slug: str, **fields):
    """Fetch the row with this slug, or create it. Returns (row, created).

    The whole reason this script is safe to re-run. `flush` (not `commit`) sends the INSERT
    so the new row gets its id — which callers need immediately for foreign keys — while
    leaving the transaction open, so a failure halfway through rolls the whole seed back
    rather than leaving it half-applied.
    """
    row = (await db.execute(select(model).where(model.slug == slug))).scalar_one_or_none()
    if row is not None:
        return row, False
    row = model(slug=slug, **fields)
    db.add(row)
    await db.flush()
    return row, True


async def seed() -> None:
    bank = json.loads(_BANK.read_text(encoding="utf-8"))
    created = {"levels": 0, "roles": 0, "types": 0, "tags": 0, "dimensions": 0, "questions": 0}

    async with get_session() as db:
        # --- levels: authored, not from the bank ---------------------------------------
        for slug, name, rank in _LEVELS:
            _, was_new = await _get_or_create(db, Level, slug=slug, name=name, rank=rank)
            created["levels"] += was_new

        for role_slug, role_data in bank["roles"].items():
            # --- role ------------------------------------------------------------------
            role, was_new = await _get_or_create(
                db, Role, slug=role_slug, name=titleize(role_slug)
            )
            created["roles"] += was_new

            # --- rubric + its dimensions ------------------------------------------------
            # The rubric has no slug of its own (it's one-per-role), so it's looked up by
            # role_id rather than through _get_or_create.
            rubric_data = role_data["rubric"]
            rubric = (
                await db.execute(select(Rubric).where(Rubric.role_id == role.id))
            ).scalar_one_or_none()
            if rubric is None:
                rubric = Rubric(role_id=role.id, scale=rubric_data["scale"])
                db.add(rubric)
                await db.flush()

            for i, dimension_name in enumerate(rubric_data["dimensions"]):
                dimension_slug = slugify(dimension_name)
                # unique per RUBRIC, not globally — so the lookup is scoped to this rubric
                # rather than going through _get_or_create.
                existing = (
                    await db.execute(
                        select(RubricDimension).where(
                            RubricDimension.rubric_id == rubric.id,
                            RubricDimension.slug == dimension_slug,
                        )
                    )
                ).scalar_one_or_none()
                if existing is None:
                    db.add(
                        RubricDimension(
                            rubric_id=rubric.id,
                            slug=dimension_slug,
                            name=dimension_name,
                            sort_order=i,
                        )
                    )
                    created["dimensions"] += 1
            await db.flush()

            # --- questions --------------------------------------------------------------
            for i, q in enumerate(role_data["questions"]):
                # the type is shared across the whole bank, so it dedupes naturally
                qtype, was_new = await _get_or_create(
                    db, QuestionType, slug=q["type"], name=titleize(q["type"])
                )
                created["types"] += was_new

                # --- tags, resolved BEFORE the question ---------------------------------
                # Order matters here, and it's the one real async-ORM trap in this file.
                # lazy="selectin" eagerly loads a relationship when the row is QUERIED — it
                # does nothing for a row we just constructed and flushed. Touching
                # `question.tags` on such a row would fall back to a lazy load, i.e. I/O
                # inside an attribute access, i.e. MissingGreenlet. So the tags are gathered
                # first and handed to the constructor, where no load is needed.
                tags = []
                for tag_name in q.get("tags", []):
                    tag, was_new = await _get_or_create(
                        db, Tag, slug=slugify(tag_name), name=titleize(tag_name)
                    )
                    created["tags"] += was_new
                    tags.append(tag)

                question = (
                    await db.execute(select(Question).where(Question.slug == q["id"]))
                ).scalar_one_or_none()
                if question is None:
                    question = Question(
                        slug=q["id"],          # "be-1" — the bank's id becomes the slug
                        role_id=role.id,
                        type_id=qtype.id,
                        text=q["text"],
                        level_id=None,         # Phase D fills this in
                        sort_order=i,          # array position becomes explicit bank order
                        tags=tags,             # writes the question_tags rows
                    )
                    db.add(question)
                    await db.flush()
                    created["questions"] += 1
                else:
                    # this one CAME from a query, so its tags are selectin-loaded and the
                    # membership test is free — new tags on an existing question get added.
                    for tag in tags:
                        if tag not in question.tags:
                            question.tags.append(tag)

        await db.commit()

    print("seeded (new rows):", ", ".join(f"{k}={v}" for k, v in created.items()))


if __name__ == "__main__":
    asyncio.run(seed())
