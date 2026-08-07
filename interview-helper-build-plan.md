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
- **The one dev wrinkle:** Vite dev server (`:6173`, hot reload) and FastAPI (`:8000`) are cross-origin,
  so the browser's preflight will block `fetch` unless the server opts in. Add FastAPI's
  `CORSMiddleware` with `allow_origins=["http://localhost:6173"]` (plus the methods/headers the calls
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
- **Robust STT (graduate from the browser Web Speech API).** Phase 4 uses the browser's free
  `SpeechRecognition` for input — but it's Chrome/Edge-only, gives NO endpointing control (Chrome cuts
  off after its own unconfigurable silence timeout; our workaround is auto-restart + manual Stop), and
  ships audio to Google. The robust pipeline replaces its *guts* with three pieces you control:
  1. **Capture raw audio** in the browser via `getUserMedia` + Web Audio/`AudioWorklet` (or MediaRecorder).
  2. **VAD for endpointing** — run a voice-activity model (e.g. Silero VAD in-browser via `@ricky0123/vad-web`)
     that exposes the tunable silence threshold the Web Speech API hides (`minSilenceDuration` etc.). This
     is where "don't cut off a thinking pause" is solved properly.
  3. **Server-side STT** — send the utterance to a FastAPI `/api/transcribe` route (or a WebSocket for
     streaming) running **`faster-whisper`** — the exact STT option this build plan named for Phase 4
     before the browser convergence. Cross-browser, consistent accuracy, offline-capable, audio stays on
     our server.
  Key point: this is STILL just a swap of the INPUT edge adapter. `useSpeechRecognition` keeps its
  `{ supported, listening, start, stop }` contract and `onResult(text) -> setDraft`; only the internals
  change. `handleSend`, the transcript, the agent, and the MCP server never move — the thesis one more time.
- **Audio quality polish (observed in Phase 4 testing, non-vital).** Two rough edges, both edge-adapter swaps:
  - **TTS sounds robotic.** `SpeechSynthesisUtterance` uses the default system voice. Cheap fix: pick a
    better voice from `speechSynthesis.getVoices()` (many OSes ship neural voices, e.g. Windows "… (Natural)")
    and tune `rate`/`pitch` on `speak()`. Robust fix: swap the OUTPUT adapter for neural TTS — Piper (local,
    the build plan's original Phase 4 TTS pick) or a cloud API — same `speak(text)` contract, better audio.
  - **STT mis-transcribes.** Browser Web Speech accuracy is mediocre and mic quality/volume/ambient noise
    matter. The real fix is the robust STT above (VAD + server-side `faster-whisper`, far more accurate);
    user-side, a better mic and clearer/louder speech help. Neither touches the interview loop.
- Semantic question retrieval: graduate `questions.json` to Postgres + pgvector and add a
  `search_questions` RAG tool — a near-verbatim reuse of `mcp-helpdesk`'s `search_docs`.

---

## Phase 6 — (future) Retrieval-grounded interviewing & grading

**Goal:** let the interviewer probe *and* the grader evaluate against **real reference material**
(e.g. a system-design article on rate limiting) instead of only the model's own priors —
especially for open-ended **system-design** questions, where there's no single rubric answer and
grounded, source-backed feedback is much higher quality.

**The design idea (and why it's a clean fit):** after Phase 5 the model no longer calls tools —
question-selection and recording are *deterministic*, so the client owns them. Retrieval is the
opposite: *which* source to look up and *how* to use it is open-ended judgment only the model can
make in-context. So this phase **re-grants the model a tool for exactly that**, while the
deterministic spine stays in the client — the mature hybrid. It's also where the MCP boundary
stops being overhead and starts paying off: the model becomes an MCP client again and MCP's core
"the agent decides what to invoke" benefit is finally cashed in.

**Sketch:**
- Add a RAG **tool** (not a resource — the model chooses the query) to the MCP server, e.g.
  `search_reference(query)`: embed the query, pull the most relevant chunks from a corpus of
  system-design articles, return excerpts. This is the same shape as `mcp-helpdesk`'s `search_docs`
  and reuses the Phase 5 pgvector work — just pointed at an article corpus, not the question bank.
- Give `turn_agent` (and/or the grader) that toolset: `Agent(model, toolsets=[reference_toolset],
  output_type=TurnReply, ...)` — pydantic-ai lets an agent call tools *and* still return a typed
  output (verify the call shape at build time). The model decides mid-turn whether to search, then
  grounds its follow-up/hint (or the grade) in what it finds.

**Caveats to plan for:** the "don't give away the answer" persona rule gets sharper now that the
model holds authoritative material (use it to *probe*, not hand over the solution); retrieved text
is interviewer/grader context, **not** the candidate's answer (keep it out of `record_answer`);
cost/latency rise per turn, so `request_limit` matters more.

---

## Cost guardrails (unchanged from `mcp-helpdesk`)

- Local STT/TTS; mocked/test-mode everything else.
- Cap `max_output_tokens` and the agent's `request_limit`; add a turn cap on the interview loop.
- Keep the per-project Gemini Spend Cap.
- Log token counts / latency per turn.

---

# PRODUCTION MIGRATION (post-learning pivot — started 2026-07-31)

> The phases above (0–6) were the **learning-first scaffold**. From 2026-07-31 the project pivots to a
> **production deploy**. This section supersedes the "learning project, not production" posture for all
> NEW work. It is self-contained so a fresh session can pick up mid-migration — read the **Current
> status** block first to see what's already done.

## Why (goals, in the user's words)

A proper database; user authentication + saved interview sessions; non-robotic voice; grading that
pulls from real reference material; and **role-level-aware** interviewing/grading (entry / mid / senior
get different questions and level-calibrated feedback).

## Locked decisions

- **Frontend shape (C):** keep the existing **Vite + React SPA** (do NOT rewrite to Next.js). Add
  Supabase auth *into it* now. A Next.js marketing/landing site is a **later** add (`www` → SPA `app`),
  explicitly out of scope for this migration.
- **Backend stays Python.** FastAPI + Pydantic AI + FastMCP are the untouched agent/MCP core. Supabase
  provides **Postgres + Auth + pgvector**. The SPA calls FastAPI with the Supabase JWT.
- **Session state → Postgres as the single source of truth** (drop the in-memory `SESSIONS` dict in
  `server/api.py`). Each `/api/answer` loads state → runs the turn → writes back. Survives restarts +
  horizontal scale; gives "resume later" for free. NO in-memory write-through cache (premature; the LLM
  call dwarfs a DB round-trip). Redis can front this same design later if ever needed.
- **TTS = OpenAI TTS** — new `/api/tts` proxy route, mirroring the existing `/api/transcribe` swap.
- **Grading grounding = per-question authored "reference briefs"** we write ourselves (structured like
  HelloInterview: leveling bands entry/mid/senior + tiered bad/good/great concept anchors + tradeoffs,
  but our own prose to avoid copyright/ToS). Deterministic `question_id → brief` (a `reference://{id}`
  MCP **resource**), **NOT** RAG/pgvector — one known brief per question is a join, not retrieval.
  pgvector/RAG is deferred to when briefs get long or the bank outgrows hand-authoring. Anchors phrased
  as *demonstrated capability*, not keywords (avoid keyword-bingo grading). Detail is a per-question
  dial, thickened only where testing shows the grader drifting.
- **Grader gets its own (stronger) model,** separate from the interviewer's Gemini flash-lite
  (`gemini-3.1-flash-lite-preview`). Grading runs once per session (low volume) so a better model is
  cheap and lets us keep briefs minimal.
- **Auth verification = JWKS, not a shared secret.** Supabase's new projects use asymmetric **JWT
  signing keys**; the backend verifies tokens against the JWKS endpoint
  (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`) with PyJWT's `PyJWKClient`. So there is deliberately
  **no `SUPABASE_JWT_SECRET`** in the env. (Legacy HS256 fallback only if a project still uses it.)
- **Frontend libs to add:** `react-router` (page nav: login / app / history — also triggers the SPA
  rewrite on Vercel), `react-hook-form` (login/signup validation; optionally the interview textarea),
  `@supabase/supabase-js`.
- **Deploy:** SPA (static) on **Vercel** (needs `client/vercel.json` SPA rewrite + `VITE_` env vars) ·
  FastAPI on **Render/Railway/Fly** · Supabase managed.
- **Future dual-mode (deferred):** a **voice mode** (TTS+STT) vs a **text-only mode**, chosen per
  session so the two aren't conflated. Design implication NOW: keep audio adapters (`speak()` / the
  whisper mic hook) invoked behind a single **mode flag** so the later split is trivial — don't
  hard-wire TTS/STT into the interview flow.

## Environment facts verified this session

- Python **3.14.3**; installed: `sqlalchemy[asyncio]` 2.0.51, `asyncpg` 0.31.0, `alembic` 1.18.5,
  `pydantic-ai` 2.13.0, `fastmcp` 3.4.4, `openai` 2.46.0, `PyJWT` 2.13.0 (+ `joserfc` available).
- **DB connection validated** through the Supabase **session pooler** (port **5432**, NOT the 6543
  transaction pooler which breaks asyncpg prepared statements). `DATABASE_URL` uses the
  `postgresql+asyncpg://` scheme and the `postgres.<project-ref>` pooler username. Server reports
  **PostgreSQL 17.6**, **pgvector 0.8.2 enabled**.
- **pydantic-ai message serialization** (for storing `message_history` as JSONB): dump with
  `ModelMessagesTypeAdapter.dump_python(messages, mode="json")`, load with
  `ModelMessagesTypeAdapter.validate_python(...)` (both from `pydantic_ai.messages`);
  `result.all_messages_json()` also exists. Verified against 2.13.0.
- **Env files (already configured, gitignored, NOT tracked):**
  - `client/.env`: `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable key
    `sb_publishable_…`).
  - `server/.env`: `GEMINI_API_KEY`, `OPENAI_API_KEY`, `DATABASE_URL` (asyncpg session pooler),
    `SUPABASE_URL`. (No JWT secret — JWKS.)
- **Schema naming gotcha:** do NOT name a table `references` (SQL reserved word) — use
  `reference_briefs`.

## Phases (dependency/risk order — storage+auth first, audio+deploy last)

### Phase A — Durable storage on Supabase Postgres  *(IN PROGRESS)*
- **New `server/db/` package:** SQLAlchemy 2.0 **async** engine + `async_sessionmaker` (`engine.py`),
  declarative models (`models.py`), reading `DATABASE_URL` from env.
- **Schema:** `roles`, `rubrics` (per role: dimensions JSONB + scale), `questions` (`id`, `role_id`,
  `type`, `text`, `tags` JSONB, `level` nullable-until-Phase-D), `sessions` (`id`, `user_id`
  nullable-until-Phase-B, `role`, `level`, `persona`, `asked_ids` JSONB, `current_qid`, `current_qtext`,
  `followups_used`, `max_followups`, `message_history` JSONB, `summary`, `done`, `created_at`,
  `updated_at`), `turns` (`id`, `session_id`, `question_id`, `answer`, `at`), `scorecards` (`session_id`,
  `overall`, `dimension_averages` JSONB, `answers` JSONB, `role`, `level`, `created_at`),
  `reference_briefs` (`question_id`, `brief`) — table created now, populated in Phase E.
- **Alembic** migration setup (env.py points at `db.Base.metadata`, async engine) + initial migration.
- **Seed script** loading the current `server/data/questions.json` into `roles`/`rubrics`/`questions`.
- **Rewrite tool BODIES to hit the DB, signatures unchanged** (so `mcp_server.py`, agent, client don't
  move): `server/tools/questions.py` (`next_question`, `get_question`, `list_questions`, `get_rubric`)
  and `server/tools/session.py` (`record_answer`, `get_session`, `save_session_summary`). Async DB
  access inside these — note MCP tool bodies can be `async def`. **← scaffold these as worked-example +
  TODO (real learning exercise), unlike the engine/models which are written complete.**
- **Relocate session state** in `server/api.py` from the `SESSIONS` dict to the `sessions`/`turns`
  tables (load → run turn → write back). Serialize `message_history` per the helpers above.
- **Verify:** `python -m tools.questions` reads the DB; `curl -X POST localhost:8000/api/session`
  writes a `sessions` row; a full interview writes `turns`.

### Phase B — Supabase auth end to end
- **Frontend:** `@supabase/supabase-js` client module; login/signup views (`react-hook-form`
  validation); `react-router` + a `<ProtectedRoute>`; store the Supabase session; inject the JWT into
  every API call via RTK Query `prepareHeaders` in `client/src/api.ts`. Supabase config via `VITE_` env
  (already set) surfaced through `client/src/constants.ts` (extend the existing pattern).
- **Backend:** a FastAPI dependency that verifies the Supabase JWT **via JWKS** (`PyJWKClient` against
  `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`, `algorithms=["ES256","RS256"]`,
  `audience="authenticated"`), extracts `user_id` (`sub`), applied to interview routes; thread `user_id`
  into session creation.
- **RLS** policies on the tables as defense-in-depth.
- **Verify:** sign up in the SPA, confirm the JWT reaches FastAPI; unauthenticated calls → 401.

### Phase C — Save & list interview sessions per user
- **Backend:** `GET /api/sessions` (my sessions), `GET /api/sessions/{id}` (transcript + persisted
  scorecard); persist the scorecard on `/api/scorecard` (write a `scorecards` row) instead of only
  returning it.
- **Frontend:** a **History** view (role/level/date/overall) drilling into the saved transcript +
  scorecard, reusing `ScorecardView` in `client/src/App.tsx`.
- **Verify:** finish an interview, reload, see it in History.

### Phase D — Seniority-aware questions & interviewing
- **Data:** populate `questions.level` (entry/mid/senior); add enough questions per role×level to run an
  interview. Rubrics may carry level-specific expectations.
- **Selection:** extend `next_question(role, level, asked_ids)` to filter by level (body in
  `server/tools/questions.py`, tool signature in `mcp_server.py`, client calls in `server/api.py`).
- **Kickoff:** role + **level picker** in the SPA before starting; store `level` on the session; thread
  `seniority` into the `behavioral_interview` prompt (already accepts it).
- **Verify:** pick entry vs senior → different questions.

### Phase E — Grounded, level-aware grading
- **Data:** author `reference_briefs` per question (tiered concept anchors + level bands). Seed the
  system-design ones first (e.g. `be-2` rate limiter).
- **MCP:** add `reference://{question_id}` **resource** in `server/mcp_server.py` + `get_reference`
  body in `server/tools/questions.py`.
- **Grader (`server/grading.py`):** give `grader_agent` its **own stronger model**; `grade_one` fetches
  the brief + passes it and the session `level` into `evaluate_answer` (`server/mcp_server.py`), which
  grounds scoring in the brief, calibrates to level, and rewards demonstrated understanding over
  keywords. `/api/scorecard` reads `level` from the session and passes it through.
- **Verify:** grade the same answer at two levels → brief + level change the feedback.

### Phase F — Neural TTS (OpenAI)
- **Backend:** `POST /api/tts` proxying OpenAI TTS (reuse the lazy `AsyncOpenAI` client already in
  `server/api.py`), returns audio bytes.
- **Frontend:** swap the body of `speak()` in `client/src/voice/speech.ts` to POST text → play the
  returned audio, **keeping the `speak(text)` contract** so `App.tsx` is untouched. Gate `speak()` +
  the mic behind the **mode flag** (future voice/text-only split). Drop the `SpeechSynthesis`/voice
  picker once the new path works.
- **Verify:** hear the OpenAI voice replace the robotic one, no `App.tsx` change.

### Phase G — Production hardening & deploy
- **Config:** all secrets/URLs via env (`DATABASE_URL`, `SUPABASE_URL`, `OPENAI_API_KEY`,
  `GEMINI_API_KEY`, grader model id, CORS origins). Make CORS `allow_origins` in `server/api.py`
  env-driven (the deployed Vercel origin, not just `localhost:6173`).
- **SPA:** `client/vercel.json` with the SPA rewrite `{"rewrites":[{"source":"/(.*)","destination":
  "/index.html"}]}`; set `VITE_*` vars in Vercel (build-time, public — never a secret).
- **Backend:** `Dockerfile` / Render-Railway build config for FastAPI; MCP server runs as its stdio
  subprocess via the existing lifespan. Keep `max_tokens` / `request_limit` / turn-cap guardrails.
- **Deferred future:** pgvector RAG; streaming TTS / VAD endpointing; Next.js landing; dual practice
  modes.

## Files at the center of the work

- `server/db/` (new: `engine.py`, `models.py`, Alembic env + versions, seed script)
- `server/tools/questions.py`, `server/tools/session.py` — bodies → Postgres; signatures grow `level` /
  `get_reference` (scaffold-style TODOs)
- `server/mcp_server.py` — add `reference://{question_id}` resource; thread `level`
- `server/grading.py` — grader gets its own model; `grade_one` consumes brief + level
- `server/api.py` — JWKS-auth dependency, `user_id` on sessions, session state → Postgres,
  `GET /api/sessions[...]`, `/api/tts`, env-driven CORS, persist scorecard
- `client/src/api.ts` — JWT header injection; session-history + tts endpoints
- `client/src/App.tsx` — router, auth gate, role+level picker, History view, mode flag
- `client/src/voice/speech.ts` — `speak()` → `/api/tts`
- `client/src/constants.ts`, `client/vercel.json`, `client/.env` — Supabase + API config
- new: Supabase client module, login/signup views, `<ProtectedRoute>`

## CURRENT STATUS (resume point)

*Last updated 2026-08-07. Branch: `migrating-away-from-json-to-db`.*

### Phase A — DONE so far (all verified against the live Supabase DB)

- **`server/db/` package.** `engine.py` (async engine, `AsyncSessionLocal`, `get_session`),
  `models.py` (**15 tables**), `seed.py`, `migrations/` (Alembic, async template).
- **Schema decisions** (the long design pass — reasoning is in `models.py`'s module docstring, and
  summarized in the `db-schema-conventions` memory):
  - Every table: autoincrement int `id` + a `slug` natural key. Sole exception: `profiles.id` IS the
    Supabase auth UUID, so RLS policies are `auth.uid() = id` / `= profile_id` with no subquery.
  - **"Interview", never "session"** — table `interviews`, HTTP field `interview_id`,
    `interview://{id}` resource. "Session" = a SQLAlchemy DB session only, always the variable `db`.
  - Normalized hard: `levels`, `question_types`, `tags` (+`question_tags`), `rubric_dimensions`,
    `scorecard_entries`, `scorecard_entry_scores` are all tables. Scorecards don't copy role/level.
  - `interviews.message_history` is the ONLY JSONB column left (pydantic-ai owns that shape).
  - `Interview.asked_question_ids` is derived from turns + current question, not stored.
  - `TimestampMixin` (`created_at`/`updated_at`) on every table; `turns.at` became `created_at`.
  - `turns.question_id` is a REAL FK now — the client-driven flow means the model can't invent ids,
    so `parent_question_id` in `api.py` is dead code that retires with the JSON store.
- **Migrations applied:** `edc507e08778` (initial schema) and `3bf1a2d6fb29` (hand-written: the
  `auth.users` → `profiles` trigger + the cross-schema FK Alembic can't autogenerate).
- **Seeded** from `questions.json`: 2 roles, 5 questions, 3 levels, 4 question types, 9 tags,
  8 rubric dimensions. `python -m db.seed` is idempotent (get-or-create by slug).
- **`server/tools/questions.py`** — rewritten to Postgres, all bodies filled in and verified
  (`next_question` / `get_question` / `list_questions` / `get_rubric` / `list_roles`).
- **`server/tools/interview.py`** — NEW, replaces `tools/session.py` (deleted). Filled in + verified:
  `create_interview`, `get_interview`, `load_interview_state`, `save_interview_state`,
  `record_answer`, `save_interview_summary`. All bodies are `async def` now.
- **`server/mcp_server.py`** — async wrappers, `interview://{interview_id}` resource,
  `save_interview_summary`. Full MCP round-trip verified (all 3 tools + all 4 resources).
  Deliberately NOT registered: `create_interview`, `load_interview_state`, `save_interview_state` —
  backend bookkeeping the model has no business calling; `api.py` imports them directly.

### Next action (Phase A, where we stopped): the `api.py` rewrite

Scaffold-style (worked example + TODOs). Two jobs, one file:

1. **Drop the `SESSIONS` dict** for load → run turn → write back:
   `load_interview_state(iid)` → `turn_agent.run(...)` → `save_interview_state(iid, ...)`.
   `message_history` round-trips with `ModelMessagesTypeAdapter.dump_python(msgs, mode="json")` out
   and `.validate_python(...)` back in (both from `pydantic_ai.messages`; verified on 2.13.0).
   `POST /api/session` becomes `create_interview(...)` + `save_interview_state(current_qid=...)`.
2. **Rename `session_id` → `interview_id`** across the HTTP contract, and delete
   `parent_question_id` + its grouping workaround (the FK makes it unnecessary).

Then the remaining rename surface:
- `client/src/api.ts` + `client/src/App.tsx` — ~10 sites (`session_id`, `sessionId`).
- `grading.py:23` — a stale `session://` mention in a comment (cosmetic).
- `mcp_client_demo.py` — **currently broken**: calls the renamed `save_session_summary` (line 84).
  Update or delete; it's the Phase-1 learning demo, not part of the running app.

**Verify Phase A when done:** `curl -X POST localhost:8000/api/interview` writes an `interviews` row;
a full interview writes `turns` rows; restarting the backend mid-interview and continuing still works
(the point of the whole phase).
