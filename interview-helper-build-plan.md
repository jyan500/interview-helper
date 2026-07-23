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

## Phase 3.5 — Same seam, new adapter: a React/Vite frontend

**Goal:** swap the terminal I/O for a browser, proving a **web UI is the same edge adapter as audio** —
the agent, tools, resources, and prompts stay byte-for-byte unchanged. This is *not* a detour from the
voice goal; it's another instance of the one idea, and it becomes the natural host for Phase 4's audio.

- **The one genuinely new structural thing:** a browser can't call `input()`. Phase 3's loop is a
  single synchronous process that owns the whole conversation; a browser talks in discrete
  request/response. So control inverts — the loop's state has to move **behind an HTTP boundary**,
  stateless-per-request, keyed by `session_id`. That's the same problem any web backend has, and it's
  the real learning nugget of this phase.
- **Backend:** wrap Phase 3's loop in **FastAPI**. `POST /api/session` → new `session_id` + first
  question; `POST /api/answer {session_id, text}` → feedback + next question. The FastAPI process is the
  single MCP client (browser → HTTP → FastAPI → stdio → FastMCP), so **the MCP transport stays stdio** —
  no need to graduate to Streamable HTTP yet. FastAPI now holds `message_history` keyed by `session_id`
  instead of a local variable — that's the terminal loop's job, relocated.
- **Frontend:** **React + Vite** (locked-in stack, not vanilla). React holds only what it renders — the
  current `session_id` and the transcript. The backend stays the source of truth for agent state; don't
  mirror `message_history` into React.
- **The one dev wrinkle:** Vite dev server (`:5173`, hot reload) and FastAPI (`:8000`) are cross-origin,
  so the browser's preflight will block `fetch` unless the server opts in. Add FastAPI's
  `CORSMiddleware` with `allow_origins=["http://localhost:5173"]` (plus the methods/headers the calls
  use). React `fetch` then hits the FastAPI origin directly — no Vite proxy. Keep the allowed origin
  list explicit rather than `["*"]` so it stays honest about who's calling.
- Guardrails carry over unchanged: `max_tokens`, `request_limit`, turn cap — now enforced server-side.

**Deliverable:** run a full text interview in the browser — question, typed answer, feedback,
follow-up — with the terminal loop's logic untouched underneath.

**Checkpoint:** what did moving to a browser change *below* the HTTP boundary? (Nothing — same answer as
audio. The only new work was making the loop stateless-per-request.)

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
- **If Phase 3.5 exists, the browser is the natural adapter home:** the Web Speech API gives you
  `SpeechRecognition` (STT) and `SpeechSynthesis` (TTS) natively — free, cross-platform, no local model
  downloads. `voice/adapters.py`'s `listen()`/`speak()` interface just gets a browser implementation in
  the React app instead of a Python one. The UI and the audio goal converge here.

**Deliverable:** speak an answer into the mic; hear the follow-up question back.

**Checkpoint:** what did adding voice change *above* the adapter line? (Nothing. Say why that's the
point.)

---

## Phase 5 — Optional polish

- End-of-session scorecard: aggregate per-question feedback into a summary rubric score.
- Make evaluation *real* (deferred here on purpose — Phases 3–3.5 cared about the agent-loop
  plumbing, not answer quality, so dummy answers were fine). Two linked pieces:
  - **Wire in the dormant grader.** `evaluate_answer` + `rubric://{role}` exist but nothing calls them;
    the live loop only runs the lightweight `behavioral_interview` persona, and the rubric never reaches
    the agent (it's a *resource* — someone must pull it in). Deliver the rubric to the grader (client
    reads `rubric://` and passes it, or add a rubric tool), and use `evaluate_answer` — ideally with a
    Pydantic AI `output_type` for a typed score per dimension instead of prose. This is what feeds the
    scorecard above.
  - **Tighten the persona against sycophancy.** Observed in Phase 3.5: a dummy answer like "my answer"
    gets canned praise ("that sounds reasonable") — the persona leans polite, never told to flag answers
    that don't address the question, and flash-lite defaults to agreeable. Add explicit rules: call out
    off-topic/evasive/vague answers and press for specifics; base acknowledgment on substance; no generic
    praise. Cheap prompt-engineering edit to `behavioral_interview`; do it once scoring is grounded so
    the interviewer's rigor and the rubric score reinforce each other.
- **Per-answer time limit (optional, toggleable).** Simulate interview pressure: give each answer a
  configurable countdown; when it expires, auto-submit whatever's in the textarea (or lock input and
  submit what's there). Mostly a frontend feature — a countdown in the UI (a `useEffect` timer that
  calls the existing `handleSend` on expiry), with the limit chosen per session (or per question) and an
  on/off toggle since it's an *option*. Optional server side: record time-taken per answer in the session
  store, which could later feed the scorecard ("answered under pressure"). Keep the timer client-side
  first; server-enforced timing is only needed if you don't trust the client.
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
