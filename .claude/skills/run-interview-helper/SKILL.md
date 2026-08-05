---
name: run-interview-helper
description: How to run Interview Helper locally — the venv-qualified server/agent commands, the FastAPI backend (:8000) and Vite frontend (:6173) dev servers, and the grading smoke test. Use when starting, serving, or smoke-testing any part of this project.
---

# Running Interview Helper

Ports and interpreter paths here are **not** guessable — the frontend runs on `:6173` (not Vite's
default `:5173`), and every Python entry point must be invoked through the venv interpreter.

Once the venv + `.env` exist (copy the recipe from `../mcp-helpdesk/server`):

- **Run the MCP server (stdio):** `server/.venv/Scripts/python.exe server/mcp_server.py`
- **List discovered primitives (no LLM):** `server/.venv/Scripts/python.exe server/mcp_server.py --list`
- **Run the text-only interview agent:** `server/.venv/Scripts/python.exe server/pydantic_agent.py`

## Web UI — run both together

- **Backend API (from `server/`):** `.venv/Scripts/fastapi.exe dev api.py` (serves on `:8000`; the
  FastAPI process is the single MCP client, spawning `mcp_server.py` over stdio via the lifespan).
- **Frontend (from `client/`):** `npm run dev` (Vite dev server on `:6173`; calls the API's full
  origin `http://localhost:8000/api` directly — CORS, not a proxy). Both must run for the UI to work.
- **Frontend deps / typecheck (from `client/`):** `npm install` · `npx tsc --noEmit`.

## Grading

- **Grade one answer (structured-output smoke test, 1 LLM call, from `server/`):**
  `.venv/Scripts/python.exe grading.py` — runs the typed `grader_agent` on a canned Q/A/rubric.

## Required environment

- **`OPENAI_API_KEY`** in `server/.env` — needed by the `/api/transcribe` Whisper route (the openai
  SDK reads it automatically). There is no tracked `.env.example`, so a fresh clone won't reveal this.
- `GEMINI_API_KEY` in `server/.env` for the interviewer agent.

Update this skill as later phases (HTTP transport, self-hosted/streaming STT) get scaffolded.
