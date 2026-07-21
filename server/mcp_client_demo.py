"""Phase 1 deliverable — exercise the interview tools/resources THROUGH MCP, no LLM.
SCAFFOLD. Fill in the TODOs.

This closes a gap in the mental model: the Pydantic AI *agent* (Phase 3) is just ONE
kind of MCP client. To prove the round-trip works you only need a plain
`fastmcp.Client` — the very same object your `--list` smoke test already opens in
mcp_server.py. The only difference is we go past *listing* primitives to *invoking*
them:

    list_tools()          -> already done by mcp_server.py --list
    read_resource(uri)    -> GET a resource (rubric://{role}, question://{id})
    call_tool(name, args) -> run a tool  (record_answer, save_session_summary)

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
        # TODO: call record_answer. Unlike a resource, a tool takes an ARGUMENTS dict
        # whose keys match the tool's parameters, and returns a CallToolResult (.data).
        #   - rec = await c.call_tool("record_answer", {
        #         "session_id": "demo",
        #         "question_id": "be-2",
        #         "answer": "I'd start with a token bucket per client key in Redis...",
        #     })
        #   - print("record_answer ->", rec.data)   # expect {"ok": True, ... "turn_count": N}
        rec = await c.call_tool("record_answer", {
            "session_id": "demo",
            "question_id": "be-2",
            "answer": "I'd start with a token bucket per client key in Redis...",
        })
        print("record_answer ->", rec.data)

        # TODO: call save_session_summary to write the wrap-up, then print .data.
        #   - args: {"session_id": "demo", "feedback": "<some overall feedback>"}
        #   - expect {"ok": True, "session_id": "demo", "status": "summarized"}
        session_rec = await c.call_tool("save_session_summary", {
            "session_id": "demo",     
            "feedback": "Strong technically, needs to work on conciseness of the answer."
        })
        print("save_session_summary ->", session_rec.data)

        # Checkpoint once both TODOs are in: open data/sessions/demo.json — the turn and
        # summary you wrote through MCP should be on disk, proving the side effect landed.


if __name__ == "__main__":
    asyncio.run(main())
