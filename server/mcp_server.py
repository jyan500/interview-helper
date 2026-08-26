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

Phase A note — WHO THIS SERVER IS FOR, now that the backend isn't a client of it. In the
client-driven design the MODEL calls nothing: api.py picks every question and records every
answer itself, so it imports `tools/*` and `prompts.py` directly rather than speaking MCP to
a subprocess of its own repo. This file is therefore the EXTERNAL surface — what a
third-party MCP client (Claude Desktop, `mcp_client_demo.py`, `--list`) connects to. Same
bodies, same text, different door. Keeping it thin is what makes that free.

NOT EVERYTHING IN tools/ IS REGISTERED HERE. `tools/interview.py` also has
`create_interview`, `load_interview_state`, and `save_interview_state`. They're the backend's
own bookkeeping, and no model — ours or someone else's — has business creating an interview
or setting which question is current, the same reasoning that took question SELECTION away
from it. This file is where that line gets drawn.

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
# Same delegation for the PROMPTS, new in Phase A: the template text lives in prompts.py so
# the backend can import it without launching this server. See that module's docstring.
import prompts

mcp = FastMCP("interview-helper")


# ===========================================================================
# TOOLS
# ===========================================================================
# WORKED EXAMPLE — next_question. Signature = model-facing args only (type-hinted,
# no session/state object), docstring = the model-facing description. FastMCP builds
# the input schema from the hints, exactly like the helpdesk's get_customer.
@mcp.tool
async def next_question(
    role: str, level: str | None = None, asked_ids: list[str] | None = None
) -> dict:
    """Get the next interview question for a role the candidate hasn't been asked yet.
    Pass the ids you've already asked in `asked_ids` so questions don't repeat. `level`
    ("entry"|"mid"|"senior") is optional — omit it for the whole bank, or pass it to get
    questions at or below that seniority. Returns {status:"ok", question} with the next
    question, {status:"exhausted", role} once the bank is used up, or {status:"not_found",
    role} for an unknown role/level."""
    return await questions.next_question(role, level, asked_ids)


# record_answer — a side-effecting tool. Phase C: it COMPLETES the open turn (the prompt that
# was presented, awaiting an answer) rather than inserting a new one — so a turn must already be
# OPEN for this interview, which the backend does when it presents a question. `question_id` is
# kept as a guard (the open turn must be for that question), not as the thing that locates it.
@mcp.tool
async def record_answer(interview_id: str, question_id: str, answer: str) -> dict:
    """
        This tool records the candidate's answer to the question currently on the table, by
        completing the interview's open turn. `interview_id` and `question_id` are both slugs
        (e.g. "be-1"); the answer is refused if the interview has no open turn, or its open turn
        is for a different question.
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


# reference://{question_id} — the authored grading brief for a question. Phase E — SCAFFOLD.
# Same shape as question_resource: a thin async wrapper delegating to questions.get_reference.
# It's a RESOURCE, not a tool — the brief is read-only context the grader pulls in to score,
# the same tools-vs-resources instinct as rubric:// and question://.
#
# NOTE which door this is: the BACKEND's grader does NOT reach the brief over MCP — grading.py
# imports get_reference directly (the Phase A "no transport to ourselves" rule). This
# registration is for EXTERNAL clients (Claude Desktop, mcp_client_demo.py, --list), keeping the
# MCP surface complete. (RLS makes reference_briefs deny-all over PostgREST — it's the answer
# key — but that guards the anon-key door, not this one.)
# TODO — mirror question_resource:
@mcp.resource("reference://{question_id}")
async def reference_resource(question_id: str) -> dict:
    """The authored grading brief for a question — read-only context."""
    return await questions.get_reference(question_id)


# ===========================================================================
# PROMPTS (reusable interaction templates)
# ===========================================================================
# Phase A: these are wrappers now, exactly like the tools above — the template TEXT moved to
# `prompts.py` so it's importable without a transport. `api.py` and `grading.py` call those
# functions directly (they're in-process; speaking MCP to ourselves bought nothing), while
# these registrations keep the identical text available to an EXTERNAL MCP client. One
# definition, two doors.
#
# behavioral_interview is the interviewer PERSONA. Its parameters become the prompt's
# arguments; returning a str becomes a single 'user' message (same as helpdesk's
# triage_ticket).
@mcp.prompt
def behavioral_interview(role: str, seniority: str = "mid") -> str:
    """Seed a consistent behavioral interviewer for a given role and seniority."""
    return prompts.behavioral_interview(role, seniority)


# evaluate_answer — the GRADING template. A pure data-in / instructions-out template: it
# scores each rubric dimension (1-5), then names ONE concrete strength, ONE gap, and ONE
# specific improvement. It never reads the DB — pair it with the rubric:// resource for data.
# Phase E extends this: the same template now also grounds scoring in an authored reference
# brief and calibrates to the candidate's seniority level. Both new args are OPTIONAL (default
# to "no brief" / "no level"), so this MCP surface stays backward-compatible for external
# clients that only pass question/answer/rubric.
@mcp.prompt
def evaluate_answer(question: str, answer: str, rubric: str,
                    reference_brief: str = "", level: str | None = None) -> str:
    """Grade one answer against a rubric — grounded in an authored reference brief and
    calibrated to the candidate's seniority level when given: score, one strength, one gap,
    one fix."""
    return prompts.evaluate_answer(question, answer, rubric, reference_brief, level)


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
