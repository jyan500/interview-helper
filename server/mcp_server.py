"""Interview Helper MCP server — SCAFFOLD. Fill in the TODOs.

The registration layer, structurally identical to `mcp-helpdesk/server/mcp_server.py`.
The tool/resource/prompt BODIES live in tools/*.py; this file only decorates thin
wrappers that delegate to them. If you internalized the helpdesk version, this is the
same moves with interview-shaped names — that repetition IS the point (you're proving
the pattern transfers).

Primitive picks (the core judgment, same as helpdesk Phase 2):
  tools     = ACTIONS      -> next_question (read helper exposed as a call),
                              record_answer, save_interview_summary
  resources = read CONTEXT -> rubric://{role}, question://{id}, interview://{id}
  prompts   = TEMPLATES    -> behavioral_interview, evaluate_answer

Phase A note — NOT EVERYTHING IN tools/ IS REGISTERED HERE. `tools/interview.py` also has
`create_interview`, `load_interview_state`, and `save_interview_state`; api.py calls those
directly. They're the backend's own bookkeeping, and the model has no business creating an
interview or setting which question is current — same reasoning that took question SELECTION
away from it. This file is where that line gets drawn.

Phase A also made every tool body `async` (they hit Postgres now), so every wrapper below
awaits. FastMCP registers async tools and resources exactly like sync ones — the generated
schemas are unchanged, which is the point: swapping JSON files for a database is invisible
from here up.

Run locally:
    .venv/Scripts/python.exe mcp_server.py            # serves over stdio
    .venv/Scripts/python.exe mcp_server.py --list     # discovery, no LLM (smoke test)
"""

from fastmcp import FastMCP

# The bodies, reused verbatim — we delegate, never reimplement. `interview` replaces the
# old `session` module: the tools write Postgres now, and "session" is reserved for a
# SQLAlchemy DB session in this codebase.
from tools import interview, questions
import textwrap

mcp = FastMCP("interview-helper")


# ===========================================================================
# TOOLS
# ===========================================================================
# WORKED EXAMPLE — next_question. Signature = model-facing args only (type-hinted,
# no session/state object), docstring = the model-facing description. FastMCP builds
# the input schema from the hints, exactly like the helpdesk's get_customer.
@mcp.tool
async def next_question(role: str, asked_ids: list[str] | None = None) -> dict:
    """Get the next interview question for a role the candidate hasn't been asked yet.
    Pass the ids you've already asked in `asked_ids` so questions don't repeat. Returns
    {status:"ok", question} with the next question, {status:"exhausted", role} once the
    bank is used up, or {status:"not_found", role} for an unknown role."""
    return await questions.next_question(role, asked_ids)


# record_answer — a side-effecting tool (persists a turn).
#   signature: def record_answer(session_id: str, question_id: str, answer: str) -> dict
#   docstring: tell the model to call this AFTER the candidate answers, to log the turn.
#   body:      return session.record_answer(session_id, question_id, answer)
@mcp.tool
async def record_answer(interview_id: str, question_id: str, answer: str) -> dict:
    """
        This tool records the answer that the candidate gives to a given question, as a turn
        of the interview. `interview_id` and `question_id` are both slugs (e.g. "be-1").
    """
    return await interview.record_answer(interview_id, question_id, answer)


# save_interview_summary — persists the final wrap-up feedback.
@mcp.tool
async def save_interview_summary(interview_id: str, feedback: str) -> dict:
    """
        This tool saves the final wrap-up feedback for this interview.
    """
    return await interview.save_interview_summary(interview_id, feedback)

# ===========================================================================
# RESOURCES (read-only context — GET, no side effect)
# ===========================================================================
# WORKED EXAMPLE — a templated resource. {role} in the URI binds to the parameter;
# FastMCP serializes the returned dict as the resource contents. Same as the
# helpdesk's ticket://{ticket_id}.
@mcp.resource("rubric://{role}")
async def rubric_resource(role: str) -> dict:
    """The scoring rubric for a role — read-only context the client can attach so the
    interviewer/grader stays consistent. No side effect, just loads the rubric in."""
    return await questions.get_rubric(role)


# question://{question_id} resource — a single question by id.
#   @mcp.resource("question://{question_id}")
#   def question_resource(question_id: str) -> dict:
#       """One interview question, addressable by id. Read-only context."""
#       return questions.get_question(question_id)
@mcp.resource("question://{question_id}")
async def question_resource(question_id: str) -> dict:
    """ One interview question, addressable by id. Read-only context. """
    return await questions.get_question(question_id)


# questions://{role} — ALL questions for a role (the whole list, not one by id). Added in
# Phase 5 so the scorecard can build the set of VALID question ids for a role and normalize
# invented follow-up ids against it. Read-only context = resource, like rubric_resource.
@mcp.resource("questions://{role}")
async def questions_resource(role: str) -> dict:
    """Every question for a role — read-only context.

    Phase A footnote: this was added so the scorecard could normalize INVENTED follow-up
    ids against a known-good set. That need is gone — `turns.question_id` is a real foreign
    key now, so an id that isn't a question can't be recorded in the first place. Kept
    because listing a role's questions is independently useful (the Phase D level picker
    will want it), but the normalization it was built for retires with the JSON store."""
    return await questions.list_questions(role)


# interview://{interview_id} — the recorded transcript, read-only. Added in Phase 5 so the
# end-of-interview grader can pull the turns record_answer wrote back out and score them.
# It's the READ side of the record_answer/save_interview_summary TOOLS: writing a turn is a
# side effect (tool); reading the turns back is context (resource) — the same
# tools-vs-resources split as everywhere else. Mirrors rubric_resource exactly.
#
# Renamed from session:// in Phase A. Note what it deliberately does NOT expose: the
# interview's `message_history`. That's the agent's own replay buffer, read through
# tools.interview.load_interview_state by api.py — handing the model a resource containing
# its own conversation would be both wasteful and confusing.
@mcp.resource("interview://{interview_id}")
async def interview_resource(interview_id: str) -> dict:
    """The recorded turns + summary for an interview — read-only context the grader pulls
    in to score each answer. No side effect, just loads the transcript."""
    return await interview.get_interview(interview_id)


# ===========================================================================
# PROMPTS (reusable interaction templates)
# ===========================================================================
# behavioral_interview is the interviewer PERSONA — the reusable template the client
# invokes to seed a consistent interviewer. Its parameters become the prompt's arguments;
# returning a str becomes a single 'user' message (same as helpdesk's triage_ticket).
#
# REDUCED ROLE (client-driven loop): the CLIENT (api.py) now owns the question spine —
# it picks each bank question (next_question), records every answer (record_answer), caps
# follow-ups, and ends the interview. So this persona no longer drives any of that; it
# describes only what the model still does each turn: REACT to the candidate's last answer
# and DECIDE whether to probe (the ask_followup field of the TurnReply output_type). All
# the old "use next_question / log with record_answer / run until exhausted" rules are gone
# BY DESIGN — the model can't invent a question or mislabel an id if it never touches either.
@mcp.prompt
def behavioral_interview(role: str, seniority: str = "mid") -> str:
    """Seed a consistent behavioral interviewer for a given role and seniority."""
    return textwrap.dedent(f"""
        You are an experienced interviewer conducting a {seniority}-level {role} interview.

        Each turn you get the candidate's latest MESSAGE. First decide what it is:

        - CLARIFYING QUESTION about the current question ("what do you mean by X?", "is this
          asking about Y?", "what are your thoughts?") — NOT an attempt to answer. Then set
          is_clarification = true and put a brief, helpful clarification in `reaction` that does
          NOT reveal the answer. Leave `followup` empty and ask_followup = false. (The candidate
          may go back and forth clarifying as much as they need — that's fine.)
        - Otherwise it's an ANSWER. Respond in two parts:
            - reaction: a short, substantive comment on what they actually said — an assessment,
              never phrased as a question, never with a question tacked on.
            - followup + ask_followup: if the answer is weak, vague, or shallow enough to warrant
              one more probe on the SAME topic, put that single question in `followup` and set
              ask_followup = true; otherwise leave `followup` empty and ask_followup = false.

        Never ask a NEW main question and never announce "moving on" — the system chooses and
        presents the next question. You never pick the topic. Keep it short; stay in character.

        Tone — supportive and professional, but not a pushover:
        - Engage with the SUBSTANCE of what they said. If it's vague, thin, or off-topic, probe
          for specifics with a follow-up (ask_followup = true) — curious, not accusatory.
        - Do NOT judge the candidate's overall ability, call out "gaps in their knowledge," or
          comment on whether their answer is (un)expected for the level. That assessment belongs
          in the end-of-interview scorecard, NOT the live conversation.
        - If they're unsure or can't answer, acknowledge it graciously and move on — no scolding.
        - No hollow praise for answers that didn't earn it, but a warm, encouraging tone is good.
          Never give away the answer; hints are fine.
    """).strip()


# evaluate_answer PROMPT — the GRADING template (a pure data-in / instructions-out
# template; don't read the DB here). Pointers:
#   @mcp.prompt
#   def evaluate_answer(question: str, answer: str, rubric: str) -> str:
#       """Grade one answer against a rubric: score, one strength, one gap, one fix."""
#       return f"...template interpolating {question}, {answer}, {rubric}..."
#   Have it score each rubric dimension (1-5), then name ONE concrete strength, ONE
#   gap, and ONE specific improvement. Keeping it a pure template (data in, text out)
#   is the clean mental model — pair it with the rubric:// resource for the data.
@mcp.prompt
def evaluate_answer(question: str, answer: str, rubric: str) -> str:
    """ Grade one answer against a rubric: score, one strength, one gap, one fix. """
    return textwrap.dedent(f"""
        You are grading a candidate's answer.

        Given the question, answer, and rubric, score the answer on each rubric dimension (1 to 5),
        name one concrete strength, one gap, and one specific improvement. 

        question: {question}
        answer: {answer}
        rubric: {rubric}
    """).strip()


if __name__ == "__main__":
    import sys

    if "--list" in sys.argv:
        # Print discovered primitives via an in-process client — no LLM, no network.
        # Proves your registration + generated schemas are right (same smoke test as
        # the helpdesk). Works even before the tool bodies are filled in.
        import asyncio

        from fastmcp import Client

        async def _list():
            async with Client(mcp) as c:
                print("TOOLS:")
                for t in await c.list_tools():
                    props = (t.inputSchema or {}).get("properties", {})
                    print(f"  - {t.name}{tuple(props)}")
                print("RESOURCE TEMPLATES:")
                for r in await c.list_resource_templates():
                    print(f"  - {r.uriTemplate}")
                print("PROMPTS:")
                for p in await c.list_prompts():
                    print(f"  - {p.name}({', '.join(a.name for a in (p.arguments or []))})")

        asyncio.run(_list())
    else:
        # stdio: the client launches THIS file as a subprocess and speaks MCP over
        # stdin/stdout. (Streamable HTTP is an optional later transport swap — see
        # mcp-helpdesk's --http block for the recipe; nothing above changes.)
        mcp.run(transport="stdio")
