"""Load `data/questions.json` into Postgres. A ONE-OFF, run by hand.

    .venv/Scripts/python.exe -m db.seed          (from server/)

WHAT IT'S DOING CONCEPTUALLY: the JSON bank is one nested document; the schema is eleven
flat tables. Seeding is where that reshaping actually happens, so this file is the clearest
statement of how the old shape maps to the new one:

    bank["roles"][slug]                 -> a roles row
      .rubric.dimensions[]              -> a rubrics row + one rubric_dimensions row each
      .questions[]                      -> a questions row (its array index becomes sort_order)
        .type                           -> a question_types row, deduped across the bank
        .level                          -> the question's level_id, via the levels map (Phase D)
        .tags[]                         -> tags rows + question_tags pairings

Two things about LEVELS and SLUGS the raw bank doesn't spell out:
  - The LEVEL ROWS (entry/mid/senior) are authored HERE, not in the bank — they're a fixed
    ladder, and `rank` gives them an order a string column couldn't hold. Each QUESTION,
    though, names its level in the JSON (`"level": "mid"`), and this script resolves that slug
    to the level_id. A question with no `level` seeds unassigned (NULL). RE-RUNNING the seed
    after adding a level to a question BACKFILLS it onto the existing row (fill-if-missing, see
    the questions loop) — the one place this otherwise-append-only seeder updates in place.
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
    ReferenceBrief,
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
    created = {"levels": 0, "roles": 0, "types": 0, "tags": 0, "dimensions": 0,
               "questions": 0, "briefs": 0}

    async with get_session() as db:
        # --- levels: authored, not from the bank ---------------------------------------
        # Keep each level ROW as we create/fetch it: the questions below need to turn their
        # `level` slug ("mid") into a level_id, and this is the map that does it. (The role
        # loop resolves its own role row inline; levels are shared across all roles, so they're
        # resolved once, up here.)
        levels_by_slug: dict[str, Level] = {}
        for slug, name, rank in _LEVELS:
            level_row, was_new = await _get_or_create(db, Level, slug=slug, name=name, rank=rank)
            levels_by_slug[slug] = level_row
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

                # --- level, resolved from the map built at the top (Phase D) -------------
                # `level` is optional in the JSON: a question with no `level` seeds as
                # unassigned (level_id NULL) and next_question's at-or-below filter skips it
                # until it's given one. A `level` that names no seeded level is a bank TYPO,
                # not a legitimate NULL — fail loudly rather than silently drop the level.
                level_slug = q.get("level")
                if level_slug is not None and level_slug not in levels_by_slug:
                    raise ValueError(
                        f"question {q['id']} has unknown level {level_slug!r} "
                        f"(known: {sorted(levels_by_slug)})"
                    )
                level_row = levels_by_slug.get(level_slug) if level_slug else None

                question = (
                    await db.execute(select(Question).where(Question.slug == q["id"]))
                ).scalar_one_or_none()
                if question is None:
                    question = Question(
                        slug=q["id"],          # "be-1" — the bank's id becomes the slug
                        role_id=role.id,
                        type_id=qtype.id,
                        text=q["text"],
                        level_id=level_row.id if level_row else None,   # Phase D
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
                    # PHASE D BACKFILL — the deliberate exception to this seeder's "never touch
                    # existing rows" rule. Levels are a new attribute the first seed didn't set,
                    # so the 5 already-seeded questions have level_id NULL. FILL a missing level,
                    # but never OVERWRITE one already assigned (that would clobber an edit the
                    # same way re-seeding a reworded question would — which is exactly what the
                    # get-or-create philosophy avoids). So re-running the seed after adding levels
                    # to the JSON assigns them to the live rows, and re-running it again is a
                    # no-op.
                    if question.level_id is None and level_row is not None:
                        question.level_id = level_row.id

        # --- reference briefs (Phase E): authored markdown, one file per question ---------
        # Briefs live as data/reference_briefs/<question-slug>.md, NOT inline in questions.json:
        # they're long-form prose (leveling bands + tiered anchors) that reads and edits far
        # better as markdown than as an escaped JSON string. The FILENAME is the question slug,
        # so "which question owns which brief" is just the directory listing — no mapping to keep.
        #
        # THE ONE PLACE THIS SEEDER UPDATES IN PLACE (besides the Phase D level backfill). The
        # bank is authored once and protected from accidental overwrite; briefs are the opposite —
        # they get TUNED iteratively (thickened wherever the grader drifts, per the plan), so
        # re-seeding after an edit MUST pick up the new text. Create if missing, overwrite if the
        # file changed. Everything else here stays get-or-create.
        #
        # A brief file whose slug names no seeded question is a TYPO (mirrors the level check) —
        # fail loudly rather than silently drop authored work. Path.glob on a missing dir returns
        # nothing, so an empty/absent reference_briefs/ dir is simply "no briefs yet".
        briefs_dir = _BANK.parent / "reference_briefs"
        for brief_path in sorted(briefs_dir.glob("*.md")):
            q_slug = brief_path.stem                 # "be-2.md" -> "be-2"
            brief_text = brief_path.read_text(encoding="utf-8").strip()
            question = (
                await db.execute(select(Question).where(Question.slug == q_slug))
            ).scalar_one_or_none()
            if question is None:
                raise ValueError(
                    f"reference brief {brief_path.name} names unknown question {q_slug!r}"
                )
            existing = (
                await db.execute(
                    select(ReferenceBrief).where(ReferenceBrief.question_id == question.id)
                )
            ).scalar_one_or_none()
            if existing is None:
                db.add(ReferenceBrief(question_id=question.id, brief=brief_text))
                created["briefs"] += 1
            elif existing.brief != brief_text:
                existing.brief = brief_text          # tuned edit — the deliberate in-place update

        await db.commit()

    print("seeded (new rows):", ", ".join(f"{k}={v}" for k, v in created.items()))


if __name__ == "__main__":
    asyncio.run(seed())
