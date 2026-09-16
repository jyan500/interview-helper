# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this project is

**Interview Helper** is a **voice interview coach**: it asks an interview question, the candidate
answers (typed or spoken), the LLM either probes with a follow-up or, at the end, grades the answers
against authored rubrics and produces a scorecard. It began as a learning project modeled on
[`mcp-helpdesk`](../mcp-helpdesk) (a FastMCP server of tools/resources/prompts driven by a Pydantic AI
agent), and **as of 2026-07-31 it pivoted to a production deploy** — auth, a real database, and hosted
deployment are all in scope now. The learning-first history explains why the code is shaped the way it
is, but it is no longer the posture.

**The resume point across sessions is the plan.** Read the `## CURRENT STATUS (resume point)` section
at the end of `interview-helper-build-plan.md` (repo root) FIRST when continuing work — it records
what's done, why, and the explicit next action. Keep it current when you finish a meaningful chunk.

### The headline design lesson (still true)

STT and TTS are **edge adapters, not part of the agent** — and so is the web UI. The LLM reasons over
text regardless of how the answer arrived:

```
🎤 / ⌨️ in ──► STT / HTTP ──► text ──► [ AGENT LOOP: ask → probe → grade ] ──► text ──► TTS / HTTP ──► 🔊 / 🖥️ out
```

The agent, tools, and templates are byte-for-byte the same whether driven by a terminal, a mic, or the
SPA. Only the two ends change.

## Current architecture

- **Backend — `server/` (FastAPI, `api.py`).** The single app. Every turn does
  `load_interview_state → turn_agent.run → save_interview_state`; there is **no process-local state**.
  Routes are gated by `Depends(require_user)` (authentication) plus an ownership check (authorization).
- **The backend is NOT an MCP client.** `api.py` **imports the tool functions directly** (`from
  tools.interview import …`, `from grading import …`). The MCP round-trip was earned only when the
  *model* called the tools; the client-driven rewrite removed that caller, so the indirection went with
  it (see the `no-indirection-without-a-consumer` convention).
- **`server/mcp_server.py` still runs, as an external surface only** — for other people's MCP clients
  (Claude Desktop, `mcp_client_demo.py`, `--list`). Same tool/prompt bodies, different door. Don't
  route the app's own calls back through it.
- **Frontend — `client/` (Vite + React + TypeScript SPA).** RTK Query (`src/api.ts`) is the HTTP layer;
  `react-router` for nav, `react-hook-form` for forms, Supabase JS for auth. Pages in `src/pages/`,
  shared UI in `src/components/`, auth flow in `src/auth/`, voice adapters in `src/voice/`.
- **Auth — Supabase.** The SPA signs in against Supabase Auth and sends the access token as
  `Authorization: Bearer <jwt>`. `server/auth.py` verifies it against Supabase's published **JWKS
  (ES256)** — checks signature, `exp`, `aud`, `iss` — and trusts the `sub` claim as the user id. No
  auth secret lives in `server/.env`; the backend needs none to verify.

### The primitive mapping (original design judgment, still how the tools are organized)

- **tools** = actions / side effects → recording an answer, creating an interview, saving a summary.
- **resources** = read-only context → `rubric://{role}`, `question://{id}`, `reference://` briefs.
- **prompts** = reusable templates → `behavioral_interview(role, seniority)`, the grading template.

Picking the right bucket is the core lesson: context you read is a resource, an action is a tool, an
interaction style is a prompt.

## Stack

- **Backend:** Python — FastAPI + Pydantic AI (agent loop) + FastMCP 3.x (external server surface).
- **Storage:** **Supabase** (Postgres + Auth; pgvector available but **not used** — grading is grounded
  in authored reference briefs, not RAG). Interview state is a Postgres row (SQLAlchemy models in
  `server/db/models.py`); `message_history` is stored as JSONB via pydantic-ai serialization. Alembic
  migrations live in `server/db/migrations/`, including RLS policies and the profile-row trigger. The
  JSON question bank (`server/data/questions.json`) and old session files are pre-pivot leftovers.
- **LLM:** cheapest-Gemini setup. **Interviewer** = `gemini-3.1-flash-lite` (`USE_MODEL` in
  `pydantic_agent.py`). **Grader** = `gemini-3.5-flash-lite` (`GRADER_MODEL` in `grading.py`,
  overridable via `.env` to a stronger id — grading gets its own, stronger-than-interviewer model).
- **Grading grounding:** per-question authored **reference briefs** (`server/data/reference_briefs/`,
  a `reference://` resource) — leveling bands + concept anchors, written in-house. Deterministic
  `question_id → brief`; no semantic retrieval.
- **Seniority-aware:** entry/mid/senior get different questions and level-calibrated grading.
- **Audio (cloud, behind `voice/adapters.py` + `client/src/voice/`):** STT = OpenAI **`whisper-1`**;
  TTS = OpenAI **`tts-1`** via the `/api/tts` proxy, engine-switchable with a free browser
  `SpeechSynthesis` fallback. That swapping local→cloud was cheap is the adapter seam paying off.
- **Deploy target:** SPA on Vercel (`vercel.json` SPA rewrite + `VITE_*` vars) · FastAPI on
  Render/Railway/Fly · Supabase managed.

## Cost guardrails (apply from day one)

- Cap `max_output_tokens` and the agent's `request_limit` — a voice loop that never ends is a runaway.
- Log token counts + latency per turn.
- STT/TTS and every grade are paid cloud calls — keep the Gemini spend cap in place and watch spend.
  Paid endpoints (`/api/transcribe`, `/api/tts`) are wallet-gated behind `require_user`; never leave a
  proxy open — an open proxy is a stranger's OpenAI bill.

## Working conventions

**Verify before asserting.** Confirm live API shapes (FastMCP 3.x, Pydantic AI) before relying on
signatures — cross-check `../mcp-helpdesk/server` as the reference. Re-Read a file before quoting a
constant or model id in prose; in-context values go stale after edits.

**Implement, don't scaffold.** Deliver complete, working changes and edit the files directly. The old
TODO-scaffold workflow is retired (some file headers still say "SCAFFOLD" — ignore that framing).

**Text before audio.** If a bug can be reproduced by typing, don't involve the microphone.

**Vocabulary:** the thing conducted is an **interview**. "Session" means exactly one thing — a
SQLAlchemy DB session, the variable `db`. `interview_id` on the wire.

### Backend

Backend coding conventions live in **[`.claude/docs/backend-conventions.md`](.claude/docs/backend-conventions.md)** —
drop-indirection, DB schema rules, server-side filtering, guard params, wallet-gating, and vocabulary.
Read it before working in `server/`.

### Frontend / TypeScript

Frontend coding conventions live in **[`.claude/docs/frontend-conventions.md`](.claude/docs/frontend-conventions.md)** —
4-space indent, the constants module, the RTK Query hook rule, layout-route guards, extraction rules,
modal/toast/skeleton/icon/date conventions, dynamic interview length, and the npm-install gotcha. Read
it before working in `client/`.

The user's auto-memory (`MEMORY.md` + files) is the fuller, authoritative record of these preferences,
with the reasoning behind each. Prefer it when a convention here is ambiguous.

## Commands

See the `run-interview-helper` skill for how to start the MCP server, the agent, and the
backend (`:8000`) / frontend (`:6173`) dev servers, plus the grading smoke test and required `.env`
keys (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `DATABASE_URL`, `SUPABASE_URL` on the server; `VITE_*` on the
client).
