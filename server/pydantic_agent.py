"""Drive the interview server with Pydantic AI — SCAFFOLD. Fill in the TODOs.

This is the payoff, and it's where this project DIVERGES from `mcp-helpdesk`. The
helpdesk agent answered ONE request and stopped. An interview is a **multi-turn
conversation**: ask → answer → evaluate → follow-up → ... So the difference isn't
the Agent setup (that's copy-paste from the helpdesk); it's the LOOP at the bottom
that carries `message_history` across turns and reads the candidate's answer each
time.

READ THIS — the seam for audio (Phase 4):
    The loop below asks the user with `speak(...)` and reads their answer with
    `listen(...)`. Right now those are thin wrappers over print()/input() in
    voice/adapters.py. In Phase 4 you swap ONLY their bodies for TTS/STT — the
    agent, tools, resources, and this loop's logic don't change at all. That's the
    entire thesis of the project, made concrete in ~2 function calls.

Run (from server/):  .venv/Scripts/python.exe pydantic_agent.py
Requires .env (GEMINI_API_KEY) — copy it from ../mcp-helpdesk/server/.env.
"""
import asyncio
import os
import sys
import uuid
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

from pydantic_ai import Agent
from pydantic_ai.mcp import MCPToolset, StdioTransport
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.providers.google import GoogleProvider
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import UsageLimits

# Phase 4 seam: today these are print()/input(); later they become TTS/STT. Import
# them here so the ONLY thing that changes when you add audio is that file.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from voice.adapters import listen, speak  # noqa: E402

# --- MODEL: same Gemini-via-google-genai wiring as the helpdesk. Copy USE_MODEL from
#     there, or hardcode the model id string for now. --------------------------------
USE_MODEL = "gemini-3.1-flash-lite-preview"  # TODO: match whatever ../mcp-helpdesk uses
model = GoogleModel(
    USE_MODEL,
    provider=GoogleProvider(api_key=os.environ["GEMINI_API_KEY"]),
)

# --- YOUR MCP SERVER as a toolset. StdioTransport launches mcp_server.py as a
#     subprocess and discovers its tools — identical recipe to the helpdesk. --------
interview_toolset = MCPToolset(
    StdioTransport(
        command=sys.executable,
        args=["mcp_server.py"],
        cwd=str(Path(__file__).resolve().parent),
    ),
    init_timeout=30,
)


# TODO 1 — build the AGENT. One object replaces any hand-rolled loop.
#   agent = Agent(
#       model,
#       toolsets=[interview_toolset],
#       instructions=INTERVIEWER_PROMPT,   # <- still yours; see below
#       model_settings=ModelSettings(max_tokens=600),  # cost guardrail
#   )
# The instructions can lift the same rules as the behavioral_interview PROMPT on the
# server — or, cleaner, keep them thin here and let the server prompt carry the persona.
INTERVIEWER_PROMPT = """
You are conducting a mock interview. Ask ONE question at a time and wait for the
answer. Use next_question to pull questions (track which ids you've asked), and
record_answer after each response. Give a brief, specific follow-up or critique,
then move on. Keep YOUR turns short — this is being read aloud. When the candidate
says they're done, call save_session_summary with overall feedback and say goodbye.
"""

# TODO: uncomment once you've confirmed the imports resolve.
# agent = Agent(
#     model,
#     toolsets=[interview_toolset],
#     instructions=INTERVIEWER_PROMPT,
#     model_settings=ModelSettings(max_tokens=600),
# )


# TODO 2 — the MULTI-TURN loop. This is the new part vs. the helpdesk's single run().
# Pointers:
#   async def main():
#       session_id = uuid.uuid4().hex[:8]
#       async with agent:
#           history = []
#           # Kick off: the agent asks the first question.
#           result = await agent.run(
#               f"Start a backend-engineer interview. Session id: {session_id}.",
#               message_history=history,
#               usage_limits=UsageLimits(request_limit=8),
#           )
#           speak(result.output)              # <- TTS seam (print for now)
#           history = result.all_messages()   # carry context across turns
#
#           for _ in range(6):                # turn cap = interview-loop guardrail
#               answer = listen()             # <- STT seam (input for now)
#               if answer.strip().lower() in {"quit", "exit", "done"}:
#                   break
#               result = await agent.run(
#                   answer,
#                   message_history=history,
#                   usage_limits=UsageLimits(request_limit=8),
#               )
#               speak(result.output)
#               history = result.all_messages()
#               print("USAGE:", result.usage)   # cost visibility per turn
#
#   asyncio.run(main())


async def main():
    # TODO: implement the loop above.
    raise NotImplementedError("Fill in the multi-turn loop (TODO 2).")


if __name__ == "__main__":
    asyncio.run(main())
