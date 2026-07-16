# Interview Helper — Build Plan

A learning-first roadmap that reuses the MCP + framework skeleton from `mcp-helpdesk` and applies it
to a **voice interview coach**. Same principle as before: **walking skeleton first, then deepen one
slice at a time.** The skeleton is *text-only*; audio is the final slice.

> **Learning project, not production.** Everything stays local/mocked/cheap. The point is to *feel*
> that a voice app is a text app with adapters on the ends — not to ship a polished product.

---

## The one new idea

In `mcp-helpdesk` the new idea was the MCP *provider* boundary. Here it's:

> **STT and TTS are edge adapters, not part of the agent.** The LLM reasons over text either way.
> A voice interview app = (text interview app) + (mic→text on the way in) + (text→speaker on the way
> out). Build and debug the text app fully; the audio is a thin wrapper you add last.

Everything below is in service of proving that ordering.

---

## Phase 0 — Hello, interview server (skeleton)

**Goal:** a one-tool FastMCP server over stdio that hands back an interview question.

- Copy the venv + `.env` + provider wiring from `../mcp-helpdesk/server` (same Gemini setup).
- Seed a tiny `server/data/questions.json` (a handful of behavioral + technical questions with tags).
- Write `next_question(role)` as a single `@mcp.tool` that returns one question from the bank.
- Prove discovery with `python mcp_server.py --list` (no LLM, no DB) — same smoke test as `mcp-helpdesk`.

**Deliverable:** `--list` shows `next_question`; calling it returns a real question dict.

**Checkpoint:** where do the tool's name, description, and arg schema come from? (Docstring + type
hints — identical to `mcp-helpdesk`.)

---

## Phase 1 — The real interview tools & resources

**Goal:** the read/write primitives an interview needs.

- **tools (side effects):** `record_answer(session_id, question_id, answer)` persists a turn to a JSON
  session file; `save_session_summary(session_id, feedback)` writes the final wrap-up.
- **resources (read-only context):** `rubric://{role}` returns the scoring rubric; `question://{id}`
  returns one question by id. These are GETs — context the client pulls in, not actions.
- Decide who owns the session store the same way `mcp-helpdesk` decided who owns the DB session: each
  tool opens/reads/writes the JSON store itself. Leave a design note.

**Deliverable:** record an answer and read a rubric through MCP.

**Checkpoint:** why is `rubric://` a resource but `record_answer` a tool? (Read vs. side effect; who
decides to pull it in — the client attaches a resource, the model calls a tool.)

---

## Phase 2 — Prompts: the interview templates

**Goal:** the two reusable templates that make the coaching consistent.

- `behavioral_interview(role, seniority)` — packages the *interviewer persona + rules*: ask one
  question at a time, wait for the answer, probe with a follow-up before moving on, stay in character.
- `evaluate_answer(question, answer, rubric)` — packages the *grading instructions*: score against the
  rubric dimensions, name one strength and one gap, suggest a concrete improvement.
- Note the primitive contrast again: these are **templates**, not actions or context.

**Deliverable:** invoke `behavioral_interview` and watch it seed a consistent interviewer.

---

## Phase 3 — Drive it with the framework (text-only loop)

**Goal:** the payoff — Pydantic AI runs the interview, you type answers at the terminal.

- Point a Pydantic AI `Agent` at the MCP server as a toolset (stdio), exactly like
  `../mcp-helpdesk/server/pydantic_agent.py`.
- **New vs. helpdesk:** this is a **multi-turn** conversation. Keep `message_history` across turns and
  loop: agent asks → you type an answer → agent evaluates + asks the next → repeat until you quit.
- Guardrails: `max_tokens`, `request_limit`, and a turn cap so a runaway interview can't spin.

**Deliverable:** a full text interview at the terminal — question, your typed answer, feedback,
follow-up — driven entirely by the framework.

**Checkpoint:** the loop that keeps `message_history` and reads input IS the seam where audio goes.
Everything above this line never learns whether the answer was typed or spoken.

---

## Phase 4 — The new idea: bolt on audio (STT + TTS)

**Goal:** make it a *voice* app by swapping the terminal I/O for audio adapters — and touching nothing
else.

- Define a tiny interface in `voice/adapters.py`: `listen() -> str` (STT) and `speak(text: str)` (TTS).
- Phase 3's loop calls `input()` and `print()`. Replace exactly those two calls with `listen()` and
  `speak()`. **The agent, tools, resources, prompts are byte-for-byte unchanged** — that's the whole
  lesson, and it's the same "the transport is the only thing that changed" move as `mcp-helpdesk`
  Phase 4.
- Start with local/free models to keep spend at zero: e.g. `faster-whisper` (STT), `piper` or
  `pyttsx3` (TTS). Mock them first (`listen()` = `input()`, `speak()` = `print()`) so the seam is
  provably correct before real audio is involved.

**Deliverable:** speak an answer into the mic; hear the follow-up question back.

**Checkpoint:** what did adding voice change *above* the adapter line? (Nothing. Say why that's the
point.)

---

## Phase 5 — Optional polish

- End-of-session scorecard: aggregate per-question feedback into a summary rubric score.
- Real-time concerns (streaming TTS, endpointing/knowing when you stopped talking, barge-in) — these
  live entirely in the audio layer; note them as the genuinely *new* engineering vs. `mcp-helpdesk`.
- Semantic question retrieval: graduate `questions.json` to Postgres + pgvector and add a
  `search_questions` RAG tool — a near-verbatim reuse of `mcp-helpdesk`'s `search_docs`.

---

## Cost guardrails (unchanged from `mcp-helpdesk`)

- Local STT/TTS; mocked/test-mode everything else.
- Cap `max_output_tokens` and the agent's `request_limit`; add a turn cap on the interview loop.
- Keep the per-project Gemini Spend Cap.
- Log token counts / latency per turn.
