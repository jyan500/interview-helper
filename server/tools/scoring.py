"""Score arithmetic — the ONE place per-dimension averaging lives, so two callers can share it.

WHY THIS MODULE EXISTS. `aggregate` used to live in grading.py, and reusing it from the data
layer (tools/interview.py's get_scorecard) meant `from grading import aggregate` — which drags
the WHOLE LLM stack (grading -> pydantic_agent -> model construction + load_dotenv) into a
module whose entire job is Postgres. That's backwards: averaging 1-5 scores is pure arithmetic
with no business knowing the model exists. Pulling the shared math DOWN into a leaf module both
sides can import (no LLM, no DB, no pydantic-ai) removes that dependency instead of inverting it.

THE SHAPE THAT MAKES IT SHAREABLE. The two callers hold the same numbers in different objects:
    grading.aggregate  -> AnswerGrade.dimension_scores  (DimensionScore objects, live grader)
    get_scorecard      -> ScorecardEntryScore rows       (persisted, id -> name resolved)
So the shared core takes neither — it takes the lowest common denominator, a flat stream of
(dimension_name, score) PAIRS. Each caller does its own trivial flatten; the averaging is
written once here.
"""
from __future__ import annotations

from collections.abc import Iterable


def aggregate_scores(
    scores: Iterable[tuple[str, int]],
    dimensions: list[str] | None = None,
) -> dict:
    """Average 1-5 scores per dimension, plus one overall number. Pure — no LLM, no DB.

    scores:     a flat iterable of (dimension_name, score) pairs, however the caller flattens
                its own objects into that.
    dimensions: OPTIONAL whitelist. When given (the live-grader path), only these names are
                counted and the output follows their order — a pair whose name isn't in the
                list is DROPPED, which is the guard against the model drifting on wording. When
                None (the persisted-rows path), bucket by whatever names appear, in first-seen
                order — the rows were already cleaned at write time, so there's nothing to filter.

    Returns {"dimension_averages": {name: round(mean, 2)}, "overall": round(mean_of_means, 2)}.
    A dimension with no scores is omitted (never a 0 dragging the overall down), and an empty
    input yields overall 0.
    """
    sums: dict[str, int] = {}
    counts: dict[str, int] = {}
    allowed = set(dimensions) if dimensions is not None else None
    for name, score in scores:
        if allowed is not None and name not in allowed:
            continue                       # grader drift -> drop, don't invent a bucket
        sums[name] = sums.get(name, 0) + score
        counts[name] = counts.get(name, 0) + 1

    # output order: the caller's dimension order if given, else the order names first appeared.
    order = dimensions if dimensions is not None else list(sums.keys())
    averages = {
        name: round(sums[name] / counts[name], 2)
        for name in order
        if counts.get(name, 0) > 0        # skip a dimension nothing scored (no stray 0)
    }
    overall = round(sum(averages.values()) / len(averages), 2) if averages else 0
    return {"dimension_averages": averages, "overall": overall}
