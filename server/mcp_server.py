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
import textwrap

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
    {status:"ok", question} with the next question, {status:"exhausted", role} once the
    bank is used up, or {status:"not_found", role} for an unknown role."""
    return questions.next_question(role, asked_ids)


# record_answer — a side-effecting tool (persists a turn).
#   signature: def record_answer(session_id: str, question_id: str, answer: str) -> dict
#   docstring: tell the model to call this AFTER the candidate answers, to log the turn.
#   body:      return session.record_answer(session_id, question_id, answer)
@mcp.tool
def record_answer(session_id: str, question_id: str, answer: str) -> dict:
    """ 
        This tool records the answer that the candidate gives after the answer a given question
        as a turn within session.json
    """
    return session.record_answer(session_id, question_id, answer)


# save_session_summary — persists the final wrap-up feedback.
#   signature: def save_session_summary(session_id: str, feedback: str) -> dict
#   body:      return session.save_session_summary(session_id, feedback)

@mcp.tool
def save_session_summary(session_id: str, feedback: str) -> dict:
    """ 
        This tool saves the final wrap-up feedback for this session
    """
    return session.save_session_summary(session_id, feedback)

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


# question://{question_id} resource — a single question by id.
#   @mcp.resource("question://{question_id}")
#   def question_resource(question_id: str) -> dict:
#       """One interview question, addressable by id. Read-only context."""
#       return questions.get_question(question_id)
@mcp.resource("question://{question_id}")
def question_resource(question_id: str) -> dict:
    """ One interview question, addressable by id. Read-only context. """
    return questions.get_question(question_id)


# questions://{role} — ALL questions for a role (the whole list, not one by id). Added in
# Phase 5 so the scorecard can build the set of VALID question ids for a role and normalize
# invented follow-up ids against it. Read-only context = resource, like rubric_resource.
@mcp.resource("questions://{role}")
def questions_resource(role: str) -> dict:
    """Every question for a role — read-only context. The scorecard reads this to get the
    known-good id set it normalizes follow-up ids against."""
    return questions.list_questions(role)


# session://{session_id} — the recorded transcript of a session, read-only. Added in
# Phase 5 so the end-of-session grader can pull the turns record_answer wrote back out
# and score them. It's the READ side of the record_answer/save_session_summary TOOLS:
# writing a turn is a side effect (tool); reading the turns back is context (resource) —
# the same tools-vs-resources split as everywhere else. Mirrors rubric_resource exactly.
@mcp.resource("session://{session_id}")
def session_resource(session_id: str) -> dict:
    """The recorded turns + summary for a session — read-only context the grader pulls
    in to score each answer. No side effect, just loads the transcript."""
    return session.get_session(session_id)


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
    return textwrap.dedent(f"""
        You are an experienced interviewer conducting a {seniority}-level {role} interview.

        Rules:
        - Ask ONE question at a time, then STOP and wait for the candidate's answer. This
        applies to follow-ups too — a follow-up IS a full turn: end your message with it
        and wait for the answer.
        - After an answer, do EXACTLY ONE of these, never both in the same message:
            (a) ask a SINGLE probing follow-up, then STOP — do NOT preview, append, or say
                "moving on" to the next question in that same turn; or
            (b) briefly acknowledge and ask the next question.
        Only advance to the next question AFTER the candidate has answered your follow-up.
        - Use the next_question tool to pull questions; log each answer with record_answer.
        - Keep your own turns short.
        - Stay in character as an experienced interviewer, can give hints but don't give the candidate the answer.
        - At the end, call save_session_summary with overall feedback against the rubric.

        Stay on the question bank (do NOT improvise the interview):
        - Every MAIN question MUST come from the next_question tool. NEVER invent your own
        main question or switch to a topic the bank didn't give you. The ONLY thing you may
        write yourself is a short follow-up probe about the candidate's LAST answer.
        - If the candidate says "I'm not sure" or can't answer, briefly acknowledge and call
        next_question for the NEXT question — do NOT substitute a topic of your own.
        - When you call record_answer, use the EXACT question_id that next_question returned
        for the question being answered (for a follow-up, reuse that id or add a "-followup"
        suffix). NEVER record an answer under a different question's id.
        - Keep going through next_question until it returns status "exhausted"; only THEN
        give your summary and call save_session_summary. Do not end the interview early.

        Be rigorous, not agreeable (this is an interview, not a chat):
        - If an answer is off-topic, evasive, one-word, or doesn't actually address the
        question, SAY SO plainly and press for specifics — do not move on as if it were fine.
        - Base any acknowledgement on the SUBSTANCE of the answer. No generic praise
        ("great", "sounds reasonable", "good point") unless the answer earned it with
        concrete detail. Silence is better than empty encouragement.
        - Push for specifics: concrete examples, real tradeoffs, actual numbers/decisions —
        not generalities. A vague answer gets a follow-up, not a pass.
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
