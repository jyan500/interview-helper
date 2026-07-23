# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

**Interview Helper** is a **learning project** that reuses the mental model from
[`mcp-helpdesk`](../mcp-helpdesk) — a FastMCP **server** of tools/resources/prompts driven by a
**Pydantic AI** agent loop — and applies it to a *voice interview coach*: it asks you an interview
question, you answer, the LLM evaluates the answer and either gives feedback or asks a follow-up.

The follow-on lesson here is **not** MCP itself (you learned the provider side in `mcp-helpdesk`).
It's this: **the "AI core" of a voice app is identical to a text app.** Speech-to-text (STT) and
text-to-speech (TTS) are just *edge adapters* bolted onto the two ends of a loop the LLM still runs
over **text**. Prove the text loop first; add audio last.

```
🎤 audio in ──► STT ──► text ──► [ AGENT LOOP: ask → evaluate → follow-up ] ──► text ──► TTS ──► 🔊 out
                                  └── this is the whole project. same as mcp-helpdesk's core. ──┘
```

> **This is not a production system.** Same posture as `mcp-helpdesk`: paced for part-time learning,
> favoring clarity over robustness. No auth, no scaling, no exhaustive error handling unless a phase
> calls for it. Everything stays mocked/local/cheap.

## Guiding principle

Build a thin **text-only** walking skeleton first — type an answer at a terminal, get a follow-up —
then deepen one slice at a time. **Audio is the LAST slice, not the first.** Debugging interview logic
and an audio pipeline simultaneously is the trap this ordering avoids.

## What carries over from `mcp-helpdesk` (and what's new)

| From `mcp-helpdesk` (reuse the pattern) | New here |
| --- | --- |
| FastMCP server: `@mcp.tool` / `@mcp.resource` / `@mcp.prompt` | Interview-shaped primitives (see mapping below) |
| Pydantic AI agent drives the loop — no hand-rolled loop | A **multi-turn** conversation loop (message history), not one-shot |
| Cost guardrails (max_tokens, request_limit, local everything) | STT/TTS as **edge adapters** — the one genuinely new concept |
| stdio transport, `--list` discovery smoke test | A tiny JSON question bank + session store (no Postgres needed yet) |

### The primitive mapping (this is the core design judgment)

- **tools** = actions / side effects → `record_answer`, `save_session_summary`
- **resources** = read-only context (GET) → `rubric://{role}`, `question://{id}`, your resume / a JD
- **prompts** = reusable interaction templates → `behavioral_interview(role, seniority)`,
  `evaluate_answer(question, answer, rubric)`

Picking the right bucket is the same lesson as Phase 2 of `mcp-helpdesk`. A question bank is **context
you read** (resource); persisting an answer is an **action** (tool); the interview style is a
**template** (prompt).

## Stack

- **MCP server** (`server/`): standalone **`fastmcp`** (3.x, same as `mcp-helpdesk`), decorator-based.
- **Transport:** **stdio** first (simplest); Streamable HTTP later if you want multi-client.
- **Framework client:** **Pydantic AI** as the MCP client + agent loop.
- **Storage:** a JSON question bank (`server/data/questions.json`) and a JSON session store — no
  Postgres/Docker for the skeleton. (Graduating to Postgres + pgvector for semantic question retrieval
  is an optional later deepening that mirrors `mcp-helpdesk` exactly.)
- **LLM:** same cheapest-Gemini-Flash-Lite setup as `mcp-helpdesk` (copy the `.env` + provider wiring).
- **Audio (last phase):** STT/TTS behind a tiny adapter interface (`voice/adapters.py`). Local/free
  options first (e.g. `faster-whisper` for STT, `piper`/`pyttsx3` for TTS) to keep spend at zero.

## Cost guardrails (apply from day one — same as `mcp-helpdesk`)

- Cap `max_output_tokens` and the agent's `request_limit` — a voice loop that never ends is a runaway.
- Log token counts + latency per turn.
- Keep STT/TTS **local**; keep the Gemini Spend Cap in place.

## Phase roadmap (see build plan for detail)

- **Phase 0:** one-tool FastMCP server over stdio (`next_question`), discovered via `--list`. Skeleton.
- **Phase 1:** the real interview tools/resources against the JSON bank (`record_answer`, `rubric://`).
- **Phase 2:** the `behavioral_interview` prompt + `evaluate_answer` prompt — the reusable templates.
- **Phase 3:** Pydantic AI drives the **multi-turn** interview loop, text-only, at the terminal.
- **Phase 4 (the new idea):** wrap the terminal I/O with STT (input) and TTS (output) adapters.
- **Phase 5 (optional):** polish, session review/scoring, semantic question retrieval (pgvector).

When starting work, identify the active phase and stay in its scope.

## Working conventions

- **Verify live API shapes** (FastMCP 3.x, Pydantic AI MCP client) before relying on signatures —
  same caution as `mcp-helpdesk`. Cross-check that repo's `server/mcp_server.py` and
  `server/pydantic_agent.py` for the exact working call shapes; they're the reference implementation.
- **Text before audio, always.** If a bug can be reproduced by typing, don't involve the microphone.
- **Learning-first:** small throwaway experiments encouraged; leave short design notes for the write-up
  (especially the "STT/TTS are just edge adapters" realization — that's the headline lesson).

## Commands

Once the venv + `.env` exist (copy the recipe from `../mcp-helpdesk/server`):

- **Run the MCP server (stdio):** `server/.venv/Scripts/python.exe server/mcp_server.py`
- **List discovered primitives (no LLM):** `server/.venv/Scripts/python.exe server/mcp_server.py --list`
- **Run the text-only interview agent:** `server/.venv/Scripts/python.exe server/pydantic_agent.py`

Phase 3.5 (web UI — FastAPI backend + React/Vite/TS frontend, run both together):

- **Backend API (from `server/`):** `.venv/Scripts/fastapi.exe dev api.py` (serves on `:8000`; the
  FastAPI process is the single MCP client, spawning `mcp_server.py` over stdio via the lifespan).
- **Frontend (from `client/`):** `npm run dev` (Vite dev server on `:5173`; calls the API's full
  origin `http://localhost:8000/api` directly — CORS, not a proxy). Both must run for the UI to work.
- **Frontend deps / typecheck (from `client/`):** `npm install` · `npx tsc --noEmit`.

Update this section as later phases (audio adapters, HTTP transport) get scaffolded.
