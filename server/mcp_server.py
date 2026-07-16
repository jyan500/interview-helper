"""Interview Helper MCP server — SCAFFOLD. Fill in the TODOs.

The registration layer, structurally identical to `mcp-helpdesk/server/mcp_server.py`.
The tool/resource/prompt BODIES live in tools/*.py; this file only decorates thin
wrappers that delegate to them. If you internalized the helpdesk version, this is the
same moves with interview-shaped names — that repetition IS the point (you're proving
the pattern transfers).

Primitive picks (the core judgment, same as helpdesk Phase 2):
  tools     = ACTIONS      -> next_question (read helper exposed as a call),
                              record_answer, save_session_summary
  resources = read CONTEXT -> rubric://{role}, question://{id}
  prompts   = TEMPLATES    -> behavioral_interview, evaluate_answer

Run locally:
    .venv/Scripts/python.exe mcp_server.py            # serves over stdio
    .venv/Scripts/python.exe mcp_server.py --list     # discovery, no LLM (smoke test)
"""

from fastmcp import FastMCP

# The bodies, reused verbatim — we delegate, never reimplement.
from tools import questions, session

mcp = FastMCP("interview-helper")


# ===========================================================================
# TOOLS
# ===========================================================================
# WORKED EXAMPLE — next_question. Signature = model-facing args only (type-hinted,
# no session/state object), docstring = the model-facing description. FastMCP builds
# the input schema from the hints, exactly like the helpdesk's get_customer.
@mcp.tool
def next_question(role: str, asked_ids: list[str] | None = None) -> dict:
    """Get the next interview question for a role the candidate hasn't been asked yet.
    Pass the ids you've already asked in `asked_ids` so questions don't repeat. Returns
    the question (id, type, text, tags), or done=true when the bank is exhausted."""
    return questions.next_question(role, asked_ids)


# TODO: record_answer — a side-effecting tool (persists a turn).
#   signature: def record_answer(session_id: str, question_id: str, answer: str) -> dict
#   docstring: tell the model to call this AFTER the candidate answers, to log the turn.
#   body:      return session.record_answer(session_id, question_id, answer)
# @mcp.tool
# def record_answer(...): ...


# TODO: save_session_summary — persists the final wrap-up feedback.
#   signature: def save_session_summary(session_id: str, feedback: str) -> dict
#   body:      return session.save_session_summary(session_id, feedback)


# ===========================================================================
# RESOURCES (read-only context — GET, no side effect)
# ===========================================================================
# WORKED EXAMPLE — a templated resource. {role} in the URI binds to the parameter;
# FastMCP serializes the returned dict as the resource contents. Same as the
# helpdesk's ticket://{ticket_id}.
@mcp.resource("rubric://{role}")
def rubric_resource(role: str) -> dict:
    """The scoring rubric for a role — read-only context the client can attach so the
    interviewer/grader stays consistent. No side effect, just loads the rubric in."""
    return questions.get_rubric(role)


# TODO: question://{question_id} resource — a single question by id.
#   @mcp.resource("question://{question_id}")
#   def question_resource(question_id: str) -> dict:
#       """One interview question, addressable by id. Read-only context."""
#       return questions.get_question(question_id)


# ===========================================================================
# PROMPTS (reusable interaction templates)
# ===========================================================================
# behavioral_interview is the interviewer PERSONA + rules — the reusable template a
# client invokes to seed a consistent interview. Its parameters become the prompt's
# arguments; returning a str becomes a single 'user' message (same as helpdesk's
# triage_ticket). This one is partly written — flesh out the rules in the TODO.
@mcp.prompt
def behavioral_interview(role: str, seniority: str = "mid") -> str:
    """Seed a consistent behavioral interviewer for a given role and seniority."""
    return f"""
You are an experienced interviewer conducting a {seniority}-level {role} interview.

Rules:
  - Ask ONE question at a time, then STOP and wait for the candidate's answer.
  - After an answer, decide: ask a probing follow-up if it was vague or shallow,
    otherwise briefly acknowledge and move to the next question.
  - Use the next_question tool to pull questions; log each answer with record_answer.
  # TODO: add 2-3 more rules that make the persona good — e.g. stay in character,
  #       don't hand the candidate the answer, keep your own turns short, and at the
  #       end call save_session_summary with overall feedback against the rubric.
""".strip()


# TODO: evaluate_answer PROMPT — the GRADING template (a pure data-in / instructions-out
# template; don't read the DB here). Pointers:
#   @mcp.prompt
#   def evaluate_answer(question: str, answer: str, rubric: str) -> str:
#       """Grade one answer against a rubric: score, one strength, one gap, one fix."""
#       return f"...template interpolating {question}, {answer}, {rubric}..."
#   Have it score each rubric dimension (1-5), then name ONE concrete strength, ONE
#   gap, and ONE specific improvement. Keeping it a pure template (data in, text out)
#   is the clean mental model — pair it with the rubric:// resource for the data.


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
