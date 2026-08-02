# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

**Interview Helper** started as a **learning project** that reuses the mental model from
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

> **Status — as of 2026-07-31 this pivoted to a production deploy.** The phases below were built
> learning-first (paced for part-time work, favoring clarity over robustness, everything
> mocked/local/cheap), and that history explains why the architecture looks the way it does. It is
> **no longer the current posture**: auth, a real database, and hosted deployment are now in scope.
> Phased production plan: `C:\Users\janse\.claude\plans\synchronous-greeting-puffin.md`.

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
- **Storage:** **Supabase** (Postgres + Auth + pgvector) is the production target — session state moves
  to Postgres as the single source of truth, replacing the in-memory `SESSIONS` dict. The JSON question
  bank (`server/data/questions.json`) is the pre-pivot skeleton, still in place.
- **LLM:** same cheapest-Gemini-Flash-Lite setup as `mcp-helpdesk` (copy the `.env` + provider wiring).
- **Audio:** STT/TTS behind a tiny adapter interface (`voice/adapters.py`). Now **cloud, not local** —
  OpenAI Whisper for STT, OpenAI TTS for output. That the swap was cheap is the adapter seam paying off.

## Cost guardrails (apply from day one — same as `mcp-helpdesk`)

- Cap `max_output_tokens` and the agent's `request_limit` — a voice loop that never ends is a runaway.
- Log token counts + latency per turn.
- STT/TTS are now **paid cloud calls** (OpenAI) — keep the Gemini Spend Cap in place and watch audio spend.

## Phase roadmap (see build plan for detail)

- **Phase 0:** one-tool FastMCP server over stdio (`next_question`), discovered via `--list`. Skeleton.
- **Phase 1:** the real interview tools/resources against the JSON bank (`record_answer`, `rubric://`).
- **Phase 2:** the `behavioral_interview` prompt + `evaluate_answer` prompt — the reusable templates.
- **Phase 3:** Pydantic AI drives the **multi-turn** interview loop, text-only, at the terminal.
- **Phase 4 (the new idea):** wrap the terminal I/O with STT (input) and TTS (output) adapters.
- **Phase 5:** polish, session review/scoring. Grading is grounded in authored per-question
  **reference briefs**, not RAG/pgvector — semantic retrieval is deferred.

When starting work, identify the active phase and stay in its scope.

## Working conventions

- **Verify live API shapes** (FastMCP 3.x, Pydantic AI MCP client) before relying on signatures —
  same caution as `mcp-helpdesk`. Cross-check that repo's `server/mcp_server.py` and
  `server/pydantic_agent.py` for the exact working call shapes; they're the reference implementation.
- **Text before audio, always.** If a bug can be reproduced by typing, don't involve the microphone.
- **Learning-first:** small throwaway experiments encouraged; leave short design notes for the write-up
  (especially the "STT/TTS are just edge adapters" realization — that's the headline lesson).

## Commands

See the `run-interview-helper` skill for how to start the MCP server, the agent, and the
backend/frontend dev servers — including the required `.env` keys.
