# Interview Helper

A voice interview coach, built as a follow-on learning project to
[`mcp-helpdesk`](../mcp-helpdesk). It asks you interview questions, you answer, and an LLM evaluates
your answer and asks follow-ups.

**The one lesson:** the "AI core" of a voice app is identical to a text app. Speech-to-text and
text-to-speech are just *edge adapters* on the two ends of a loop the LLM runs over **text**. So this
project builds and debugs the entire interview as a *text* app first, then bolts audio on last —
touching nothing but two I/O functions.

```
🎤 ─► STT ─► text ─► [ FastMCP tools/resources/prompts + Pydantic AI agent loop ] ─► text ─► TTS ─► 🔊
                     └──────────────── built and debugged text-only first ───────────────┘
```

## Status: scaffold

This is a starting sketch mirroring `mcp-helpdesk`'s structure. The bodies are stubbed with TODOs and
pointers — fill them in phase by phase.

- `CLAUDE.md` — orientation + the primitive mapping + conventions.
- `interview-helper-build-plan.md` — the phased roadmap (text skeleton → audio last).
- `server/mcp_server.py` — MCP registration layer (1 worked tool, 1 worked resource, 1 partial prompt).
- `server/tools/questions.py`, `server/tools/session.py` — the tool bodies (read / side-effecting).
- `server/data/questions.json` — a tiny seed question bank with rubrics.
- `server/pydantic_agent.py` — the framework client + the **multi-turn** interview loop.
- `voice/adapters.py` — `speak()`/`listen()`: print/input now, TTS/STT in Phase 4.

## Getting started

1. Create `server/.venv` and install `server/requirements.txt` (copy the venv + `.env` recipe from
   `../mcp-helpdesk/server`).
2. Fill in the TODOs in `tools/questions.py`, then verify discovery with no LLM:
   `server/.venv/Scripts/python.exe server/mcp_server.py --list`
3. Work through the build plan: Phase 0 (skeleton) → Phase 3 (text interview) → Phase 4 (audio).
