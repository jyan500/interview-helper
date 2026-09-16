# Backend conventions

Coding conventions for the Python backend (`server/`). See `CLAUDE.md` for the project overview and
architecture; this file is the detail for backend work.

- **Drop indirection once its consumer is gone** — import the function; don't keep an MCP hop, transport,
  or wrapper alive for a caller that no longer exists. (This is why `api.py` imports the tool functions
  directly rather than calling its own MCP server.)
- **DB schema:** `id` + `slug` keys; normalize by default (a real table, not a JSON blob, unless the
  blob genuinely has no queryable structure — `message_history` is the deliberate JSONB exception);
  name entities for the domain ("interview", not "session").
- **Keep a redundant identifier as a defensive guard param** even when a derived lookup would do.
- **Filter server-side.** A filtered list variant extends the existing endpoint with a generic params
  bag and filters in the DB — not a new endpoint, not a client-side filter.
- **Wallet-gate paid endpoints.** Any route that spends on a cloud call (`/api/transcribe`, `/api/tts`,
  grading) sits behind `Depends(require_user)` — an open proxy is a stranger's OpenAI bill.
- **Vocabulary:** the thing conducted is an **interview**. "Session" means exactly one thing — a
  SQLAlchemy DB session, the variable `db`. `interview_id` on the wire.
- **Verify live API shapes** (FastMCP 3.x, Pydantic AI) before relying on signatures — cross-check
  `../mcp-helpdesk/server` as the reference implementation.
