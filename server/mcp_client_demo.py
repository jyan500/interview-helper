"""Phase 1 deliverable — exercise the interview tools/resources THROUGH MCP, no LLM.
SCAFFOLD. Fill in the TODOs.

This closes a gap in the mental model: the Pydantic AI *agent* (Phase 3) is just ONE
kind of MCP client. To prove the round-trip works you only need a plain
`fastmcp.Client` — the very same object your `--list` smoke test already opens in
mcp_server.py. The only difference is we go past *listing* primitives to *invoking*
them:

    list_tools()          -> already done by mcp_server.py --list
    read_resource(uri)    -> GET a resource (rubric://{role}, question://{id})
    call_tool(name, args) -> run a tool  (record_answer, save_interview_summary)

Every call goes through the full MCP protocol — arg-schema validation in, JSON
serialization out — so it proves the registration in mcp_server.py is wired correctly,
without spending a single token. This is the client-side mirror of the smoke tests you
already ran on the bodies directly.

Return shapes to expect (FastMCP 3.x):
  - read_resource(uri) -> list of content blocks; block.text is the JSON string of the
    dict your resource body returned. Parse with json.loads(blocks[0].text).
  - call_tool(name, args) -> CallToolResult; result.data is the deserialized dict your
    tool body returned (result.is_error flags a failure).

Run (from server/):
    .venv/Scripts/python.exe mcp_client_demo.py
"""
from __future__ import annotations

import asyncio
import json

from fastmcp import Client

# Import the server object and drive it IN-PROCESS (no subprocess, no network) — the
# same thing the --list block does. Importing is safe: mcp_server.py only *defines*
# `mcp` at import time; it only serves when run as __main__.
#
# To instead prove the REAL stdio transport (client launches the server as a
# subprocess), swap the client target for the script path:  Client("mcp_server.py").
# Nothing else in this file changes — that's the "transport is the only thing that
# changed" lesson from mcp-helpdesk, made concrete.
from mcp_server import mcp


async def main() -> None:
    async with Client(mcp) as c:
        # === RESOURCES (read-only context — GET) ============================
        # WORKED EXAMPLE — read the rubric resource. Note the two-step unwrap:
        # read_resource gives a LIST of content blocks; block .text is a JSON
        # string, so json.loads it back into the dict your body returned.
        rubric_blocks = await c.read_resource("rubric://backend-engineer")
        rubric = json.loads(rubric_blocks[0].text)
        print("rubric://backend-engineer ->", rubric["status"])
        print("  dimensions:", rubric["rubric"]["dimensions"])

        # TODO: read the question:// resource the same way and print the question text.
        #   - blocks = await c.read_resource("question://be-2")
        #   - question = json.loads(blocks[0].text)
        #   - print the nested question["question"]["text"]
        blocks = await c.read_resource("question://be-2")
        question = json.loads(blocks[0].text)
        print(" question:", question["question"]["text"])

        # === TOOLS (side effects — write a turn, then the summary) ===========
        # Unlike a resource, a tool takes an ARGUMENTS dict whose keys match the tool's
        # parameters, and returns a CallToolResult (.data).
        #
        # PHASE A — both calls below changed, and the reasons are worth separating:
        #   - the ARG is `interview_id`, not `session_id` (the rename: "session" is a DB
        #     session now), and the tool is `save_interview_summary`.
        #   - the VALUE can no longer be a made-up string like "demo". `turns.interview_id`
        #     and `turns.question_id` are real FOREIGN KEYS, so a write against an interview
        #     that doesn't exist comes back {"ok": False, "error": ...} instead of quietly
        #     creating data/sessions/demo.json. That refusal IS the integrity win — the JSON
        #     store would happily file a turn under a fictional interview and a fictional
        #     question. Run it once as-is to see the envelope, then point INTERVIEW_ID at a
        #     real slug (start one: curl -X POST localhost:8000/api/interview) to see it land.
        INTERVIEW_ID = "demo"   # <- replace with a real interviews.slug

        # PHASE C — record_answer now COMPLETES an OPEN turn, so this only lands if INTERVIEW_ID
        # is a real interview whose current open turn is question be-2 (i.e. you started one and
        # it's sitting on be-2). Otherwise you get {"ok": False, "error": "no open turn ..."} /
        # "... does not match ...". Opening a turn is backend-only (not an MCP tool), so an
        # external client answers turns the backend presented — it doesn't invent them.
        rec = await c.call_tool("record_answer", {
            "interview_id": INTERVIEW_ID,
            "question_id": "be-2",
            "answer": "I'd start with a token bucket per client key in Redis...",
        })
        print("record_answer ->", rec.data)

        summary_rec = await c.call_tool("save_interview_summary", {
            "interview_id": INTERVIEW_ID,
            "feedback": "Strong technically, needs to work on conciseness of the answer."
        })
        print("save_interview_summary ->", summary_rec.data)

        # Checkpoint with a real slug: read it back through the resource —
        #   await c.read_resource(f"interview://{INTERVIEW_ID}")
        # — and the turn + summary you wrote through MCP are there, proving the side effect
        # landed in Postgres. (This file is also now the ONLY thing exercising the MCP
        # surface end-to-end, since the backend stopped being a client of it in Phase A.)


if __name__ == "__main__":
    asyncio.run(main())
