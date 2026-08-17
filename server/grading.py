"""Phase 5 — the GRADER: typed, structured evaluation of answers. SCAFFOLD (one TODO).

This is where the interview finally gets *graded* instead of just *conducted*. Phases 3–3.5
proved the agent-loop plumbing with dummy answers; the `evaluate_answer` prompt and
`rubric://{role}` resource you built in Phase 2 were never called. Here they finally are.

THE ONE NEW IDEA in this file — **structured output** (`output_type`):
    The conversational interviewer (`agent` in pydantic_agent.py) returns PROSE — the next
    question, a follow-up. A GRADER should return DATA: a number per rubric dimension, so we
    can average it into a scorecard. Pydantic AI does that with `output_type=`: give it a
    Pydantic model and it makes the LLM fill that shape instead of free text. `result.output`
    then IS an `AnswerGrade`, typed, no string-parsing. That's the whole trick.

DESIGN — two agents, one job each:
    interviewer (pydantic_agent.agent):  talks, drives ask -> follow-up, has the MCP toolset.
    grader      (this file):             scores, no toolset, output_type=AnswerGrade.
    They share the SAME `model` object — grading is a different USE of the model, not a
    different model. The interviewer *conducts*; the grader *evaluates*.

WHERE THIS RUNS — end-of-interview, over what was recorded (build-plan Phase 5). The client
owns the question spine and logs every turn via record_answer, so grading is a SEPARATE pass:
read the recorded (question_id, answer) turns back out of the `turns` table and grade each one
here. See api.py's /api/scorecard for the orchestration.

Phase E gives grader_agent its OWN, stronger model (it runs once per interview, so a better
model is cheap) and feeds `grade_one` the authored reference brief + the interview's level.

Smoke test (from server/, 1 LLM call — needs .env GEMINI_API_KEY):
    .venv/Scripts/python.exe grading.py
"""
from __future__ import annotations

from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import UsageLimits

# Reuse the SAME model the interviewer uses — importing pydantic_agent runs its module-level
# setup (model, toolset, agent) once; grading is just a second Agent over that model. It also
# runs the load_dotenv there, which is how the API keys reach this process.
from pydantic_agent import model
# The grading TEMPLATE, imported directly (Phase A). It's a pure function in prompts.py, so
# there's no transport between us and it — see that module's docstring for why.
from prompts import evaluate_answer
# The shared score arithmetic (Phase C). Pure — no LLM, no DB — which is exactly why it moved
# OUT of here: the data layer (get_scorecard) needed the same averaging without importing this
# module's model stack. See tools/scoring.py.
from tools.scoring import aggregate_scores


# --- THE TYPED OUTPUT SHAPE ------------------------------------------------------------
# These Pydantic models ARE the grader's contract. output_type=AnswerGrade makes the LLM
# return exactly this — no prose to parse. Field descriptions become schema hints the model
# sees, so they double as instructions.
class DimensionScore(BaseModel):
    """One rubric dimension, scored."""
    dimension: str = Field(description="the rubric dimension being scored, copied verbatim")
    score: int = Field(ge=1, le=5, description="1 (poor) to 5 (excellent) for this dimension")
    note: str = Field(description="one sentence justifying the score with specifics from the answer")


class AnswerGrade(BaseModel):
    """The full grade for a single answer — the grader's output_type.

    Note there's no question_id here: the LLM shouldn't have to echo an id it was handed.
    We attach the id in Python (in api.py) when we assemble the scorecard. Keep the model's
    job to what only the model can do — judge the answer.
    """
    dimension_scores: list[DimensionScore] = Field(description="one entry per rubric dimension")
    strength: str = Field(description="one concrete thing the answer did well")
    gap: str = Field(description="one concrete thing the answer was missing")
    improvement: str = Field(description="one specific, actionable suggestion")


# --- THE GRADER AGENT ------------------------------------------------------------------
# No toolset (grading is pure data-in -> judgement-out; evaluate_answer is a *template*, not
# a tool). output_type=AnswerGrade is the whole point. Same max_tokens guardrail as the
# interviewer so a grade can't run away.
grader_agent = Agent(
    model,
    output_type=AnswerGrade,
    model_settings=ModelSettings(max_tokens=600),
)


# --- THE INTERVIEWER'S PER-TURN DECISION (client-driven loop) --------------------------
# SECOND use of output_type, for a different reason. In the client-driven loop the model NO
# LONGER drives the interview — the client (api.py) owns which bank question is asked and
# records answers. The model's job shrinks to two things it, and only it, can do: react to
# the candidate's last answer, and JUDGE whether that answer is worth probing. We capture
# both in one typed result so the CLIENT can act on the decision (a bool it can branch on)
# instead of trying to parse intent out of prose:
#   reply        -> what the candidate sees (a reaction, plus a follow-up probe IF probing)
#   ask_followup -> the model's judgement: True = `reply` is a probe on the SAME question;
#                   False = the answer's been explored enough, ready to move on.
# The client CAPS follow-ups and picks the next question — so a True here is a *request* to
# probe, not permission to seize the wheel. That's the whole reliability fix: the model can't
# invent a main question or mislabel an id, because it never selects one or records one.
class TurnReply(BaseModel):
    """The interviewer's response to one answer, SPLIT so the client controls what's shown.

    Why split (vs a single `reply` blob): the client always shows `reaction`, but shows the
    probe ONLY when it actually follows up. If reaction and probe were one string, a probe the
    model wanted but the client CAN'T grant (follow-up cap reached -> advancing) would get shown
    right next to the next bank question — two questions in one turn. Separate fields let the
    client drop the probe when it advances.
    """
    is_clarification: bool = Field(description="true if the candidate's message is a CLARIFYING "
                                               "QUESTION about the current question (e.g. 'what do "
                                               "you mean by X?'), NOT an attempt to answer it")
    reaction: str = Field(description="what to say back: if is_clarification, a brief helpful "
                                      "clarification that does NOT reveal the answer; otherwise a "
                                      "substantive comment on the answer, NEVER phrased as a question")
    followup: str = Field(default="", description="a SINGLE probing question on the SAME "
                                                  "question when one is warranted; empty otherwise "
                                                  "(and always empty when is_clarification is true)")
    ask_followup: bool = Field(description="true only if this is an ANSWER (not a clarification) "
                                           "that was weak/vague/shallow and warrants one more probe")


# No toolset — the model doesn't call tools anymore; the client does. Same max_tokens cap.
turn_agent = Agent(
    model,
    output_type=TurnReply,
    model_settings=ModelSettings(max_tokens=600),
)


# --- WORKED EXAMPLE — grade ONE answer -------------------------------------------------
# The server owns the GRADING TEMPLATE (`evaluate_answer`, Phase 2), so we CALL it rather than
# hardcode grading instructions here — the same "server owns the persona" lesson as the
# interviewer, applied to the grader. It interpolates question/answer/rubric and hands back
# the filled text; we feed THAT to the grader as the run input, and output_type coerces the
# model's judgement into an AnswerGrade.
#
# PHASE A — this used to take a running `toolset` and fetch the template over MCP
# (`get_prompt` -> unwrap `pr.messages[0].content.content`). The template is a pure function
# in this same repo, so that was a stdio round-trip and a JSON decode to reach an f-string.
# The parameter is gone, which also means grade_one no longer needs a started MCP client to
# run — its smoke test below is now a plain function call.
async def grade_one(question_text: str, answer: str, rubric_text: str) -> AnswerGrade:
    """Grade a single (question, answer) against the rubric -> a typed AnswerGrade."""
    filled = evaluate_answer(question=question_text, answer=answer, rubric=rubric_text)
    result = await grader_agent.run(
        filled,
        usage_limits=UsageLimits(request_limit=3),
    )
    return result.output                       # typed AnswerGrade, not a string


# aggregate many grades into scorecard numbers -------------------------------
# The scorecard's headline: an average score PER DIMENSION across every answered question,
# plus one overall number. Deterministic arithmetic — the LLM already judged in grade_one;
# Python just averages.
#
# THE MATH ITSELF now lives in tools/scoring.py, shared with the data layer's get_scorecard so
# a persisted scorecard averages EXACTLY the way a live one does — one implementation, not two
# that can drift. This function is the thin ADAPTER for the grader's side: flatten AnswerGrade
# objects into the (name, score) pairs the shared core takes, passing `dimensions` as the
# whitelist so a model that drifts on wording is filtered (the old `if ds.dimension in sums`
# guard, now expressed once in aggregate_scores).
def aggregate(grades: list[AnswerGrade], dimensions: list[str]) -> dict:
    pairs = (
        (ds.dimension, ds.score)
        for grade in grades
        for ds in grade.dimension_scores
    )
    return aggregate_scores(pairs, dimensions)


if __name__ == "__main__":
    # 2-LLM-call smoke test. No MCP subprocess to start anymore — grade_one calls the template
    # directly, so this is just asyncio + the model.
    import asyncio

    qa = [
    {
        "question": "How would you design a rate limiter for a public API? Walk me through your approach.",
        "answer": """I'd use a token-bucket per client key in Redis: refill at the allowed rate, reject when empty. 
        It's atomic via a Lua script and survives multiple app servers."""
    },
    {
        "question": "Tell me about a time when you handled a production issue.",
        "answer": """ I accidentally pushed a regression to our React Native Mobile Application when fixing a bug. To handle this, 
        I notified customer service, used git bisect to find the problematic commit, applied the bug fix and worked with my engineering manager to push a hotfix deploy."""
    }
    ]
    _RUBRIC = ("Dimensions: Clarity of communication; Technical depth / correctness; "
               "Tradeoff reasoning; Concrete examples over generalities. Scale 1-5.")

    DIMENSIONS = [
        "Clarity of communication",
        "Technical depth / correctness",
        "Tradeoff reasoning",
        "Concrete examples over generalities"
    ]

    async def _smoke():
        grades = []
        for q in qa:
            grade = await grade_one(q["question"], q["answer"], _RUBRIC)
            print("AnswerGrade:")
            for ds in grade.dimension_scores:
                print(f"  {ds.dimension}: {ds.score} — {ds.note}")
            print("strength:   ", grade.strength)
            print("gap:        ", grade.gap)
            print("improvement:", grade.improvement)
            grades.append(grade)
        res = aggregate(grades, DIMENSIONS)
        print("aggregated results: ", res)

    asyncio.run(_smoke())
