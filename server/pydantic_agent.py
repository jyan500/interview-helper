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
USE_MODEL = "gemini-3.1-flash-lite-preview"  # confirmed: matches ../mcp-helpdesk USE_MODEL
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


# build the AGENT. One object replaces any hand-rolled loop.
#
# DESIGN — the SERVER owns the persona. There is deliberately NO interviewer prompt
# hardcoded in this client. The persona lives ONLY in the server's behavioral_interview
# PROMPT (Phase 2); this client FETCHES it at runtime (see TODO 2) and passes it as
# per-run `instructions`. So the agent is built with NO `instructions=` argument:
#
agent = Agent(
    model,
    toolsets=[interview_toolset],
    model_settings=ModelSettings(max_tokens=600)
)
#
# Why not set instructions here? The steering text comes FROM THE SERVER, and it's
# only reachable once the toolset is running (inside `async with agent`). We therefore
# inject it per-run in the loop, not at construction time. This is the whole "server
# owns the persona" lesson made concrete — the @mcp.prompt you wrote drives this client
# over MCP, instead of a local copy of the rules.

# TODO 2 — the MULTI-TURN loop. This is the new part vs. the helpdesk's single run().
# It also does the SERVER-OWNS-PERSONA fetch: pull behavioral_interview from the server
# and feed it as `instructions` on EVERY turn.

# Pointers:
#   async def main():
#       session_id = uuid.uuid4().hex[:8]
#       async with agent:                      # toolset is now running -> can fetch prompts
#           # Fetch the persona FROM THE SERVER (not a local constant). The MCPToolset is
#           # itself a full MCP client: get_prompt(name, args) -> PromptResult. Unwrap the
#           # text the same way mcp_client_demo.py did:  .messages[0].content.text
#           pr = await interview_toolset.get_prompt(
#               "behavioral_interview",
#               {"role": "backend-engineer", "seniority": "mid"},
#           )
#           persona = pr.messages[0].content.text
#
#           history = []
#           # Kick off: the agent asks the first question. Note instructions=persona.
#           result = await agent.run(
#               f"Start the interview. Session id: {session_id}.",
#               instructions=persona,          # <- server-owned steering, passed EACH run
#               message_history=history,
#               usage_limits=UsageLimits(request_limit=8),
#           )
#           speak(result.output)               # <- TTS seam (print for now)
#           history = result.all_messages()    # carry context across turns
#
#           for _ in range(6):                 # turn cap = interview-loop guardrail
#               answer = listen()              # <- STT seam (input for now)
#               if answer.strip().lower() in {"quit", "exit", "done"}:
#                   break
#               result = await agent.run(
#                   answer,
#                   instructions=persona,      # <- MUST re-pass every run: instructions are
#                                              #    NOT stored in message_history (that's what
#                                              #    separates them from a system_prompt), so
#                                              #    passing once wouldn't survive to turn 2.
#                   message_history=history,
#                   usage_limits=UsageLimits(request_limit=8),
#               )
#               speak(result.output)
#               history = result.all_messages()
#               print("USAGE:", result.usage)  # cost visibility per turn (property, no parens)
#
#   asyncio.run(main())


async def main():
    # taking only the first 8 characters of hexadecimal string, which strips out the dashes in the uuid
    session_id = uuid.uuid4().hex[:8]
    # run the toolset
    async with agent:
        # fetch the interview persona from the server
        prompt = await interview_toolset.get_prompt(
            "behavioral_interview",
            {"role": "backend-engineer", "seniority": "mid"}
        )
        persona = prompt.messages[0].content.content
        history = []
        # agent asks the first question, then the interview answer -> LLM feedback loop begins
        result = await agent.run(
            f"Start the interview. Session id: {session_id}.",
            instructions=persona, # pass the persona on each run of the agent
            message_history=history,
            usage_limits=UsageLimits(request_limit=8)
        )

        # placeholder until Text-To-Speech is implemented
        speak(result.output)

        # accumulate the result history
        history = result.all_messages()

        # arbitrary loop guardrail 
        for _ in range(6):
            answer = listen()
            if answer.strip().lower() in {"quit", "exit", "done"}:
                break

            # send the answer back to the LLM
            result = await agent.run(
                answer,
                instructions=persona,
                message_history=history,
                usage_limits=UsageLimits(request_limit=8)
            )

            # speak LLM output
            speak(result.output)
            # notice that it's not appending to a list because when we pass in the previous
            # messages' history, the agent run will take that into account into its own history,
            # so we just need to store "all_messages" each time
            history = result.all_messages()
            # cost visibility per turn (property, no parens)
            print("USAGE:", result.usage)  

if __name__ == "__main__":
    asyncio.run(main())
