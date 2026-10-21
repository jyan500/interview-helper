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


def aggregate_by_kind(
    answers: Iterable[tuple[str, list[tuple[str, int]]]],
    kind_dimensions: dict[str, list[str]] | None = None,
) -> dict:
    """A whole interview's numbers when its answers can be of different KINDS, each graded on its own
    question type's rubric (a mixed Practice interview: behavioral + coding).

    answers:          one (kind name, dimension_scores) per graded question, in interview order.
                      `dimension_scores` is that answer's (dimension_name, score) pairs, the same
                      shape aggregate_scores takes; a skipped answer has none.
    kind_dimensions:  OPTIONAL whitelist per kind, as in aggregate_scores (the live-grader path).

    Example:
        answers = [
            ("Behavioral", [("Structure (situation, action, result)", 4), ("Communication", 5)]),
            ("Coding",     [("Code correctness", 2), ("Communication", 4)]),
            ("Coding",     [("Code correctness", 4), ("Communication", 4)]),
            ("Behavioral", []),                     # skipped: no scores
        ]
        -> by_kind: Behavioral {Structure...: 4.0, Communication: 5.0}
                    Coding     {Code correctness: 3.0, Communication: 4.0}
           overall: mean of the three graded answers' own means (4.5, 3.0, 4.0) = 3.83

    Per kind, the dimension averages come from aggregate_scores over that kind's answers only, so a
    behavioral "Communication" never blends with a coding "Communication" (different rubric rows).
    Kinds keep first-seen order. `overall` weighs every graded question the same whatever its kind,
    and a skipped answer drops out instead of counting as 0. For a one-kind interview it equals the old
    mean-of-dimension-means, since every graded answer scores every dimension.

    Returns {"by_kind": [{"kind": name, "dimension_averages": {...}}, ...], "overall": float}.
    """
    scores_by_kind: dict[str, list[tuple[str, int]]] = {}
    answer_means: list[float] = []
    for kind, dimension_scores in answers:
        scores_by_kind.setdefault(kind, []).extend(dimension_scores)
        if dimension_scores:
            answer_means.append(sum(score for _, score in dimension_scores) / len(dimension_scores))

    by_kind = []
    for kind, dimension_scores in scores_by_kind.items():
        dimensions = kind_dimensions.get(kind) if kind_dimensions is not None else None
        averages = aggregate_scores(dimension_scores, dimensions)["dimension_averages"]
        if averages:
            by_kind.append({"kind": kind, "dimension_averages": averages})
    overall = round(sum(answer_means) / len(answer_means), 2) if answer_means else 0
    return {"by_kind": by_kind, "overall": overall}
