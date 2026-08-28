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

*Last updated 2026-08-27. Branch: `neural-tts` (Phase F complete). Phases A–F all ✅; **Phase G
(production hardening & deploy) is the next phase.***

### Phase A — ✅ COMPLETE (all verified against the live Supabase DB)

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

- **THE BACKEND STOPPED BEING AN MCP CLIENT OF ITS OWN SERVER** (design change made mid-rewrite,
  not in the original plan). `api.py`/`grading.py` were calling `direct_call_tool` / `read_resource`
  / `get_prompt` — a stdio round-trip to a subprocess of this same repo, plus a `json.loads`, to
  reach local Python functions. That indirection was earned in Phase 3, when the MODEL called those
  tools (MCP is how a model reaches a capability); the client-driven rewrite removed the model from
  that path, leaving transport with nobody on the other end. Now direct imports.
  - **New `server/prompts.py`** — `behavioral_interview` / `evaluate_answer` as plain functions, so
    the templates are importable without a transport. This is the same "bodies in a module,
    registration is thin" split `tools/*` always had; prompts were the one thing that never got it.
  - `mcp_server.py` prompts are now thin wrappers delegating to it. **The MCP surface is unchanged**
    (`--list` verified: 3 tools, 4 resource templates, 2 prompts) — it's now for EXTERNAL clients
    (Claude Desktop, `mcp_client_demo.py`), which is what an MCP server is actually for.
  - `grade_one` lost its `toolset` parameter; it no longer needs a running MCP client, so
    `python grading.py` is a plain smoke test.
  - `api.py`'s lifespan no longer starts the MCP subprocess. It now disposes the DB pool on shutdown.
- **`server/api.py`** — rewritten. `SESSIONS` dict gone; `POST /api/interview` (renamed) does
  `create_interview` + `save_interview_state(current_qid=...)`; `/api/answer` does load → run →
  write back with `ModelMessagesTypeAdapter` round-tripping `message_history`; `session_id` →
  `interview_id` across the contract; `parent_question_id` + the `questions://` fetch that fed it
  **deleted** (the FK makes invented ids impossible, so the workaround has nothing to work around).
  Added a 409 guard on an already-`done` interview — newly possible now that `done` outlives the process.
- **`client/src/api.ts` + `App.tsx`** — renamed (`startInterview`, `interview_id`, `interviewId`,
  `InterviewResponse`, `POST /api/interview`). `npx tsc --noEmit` clean.
- **`mcp_client_demo.py`** — un-broken (`save_interview_summary`, `interview_id`), with a note that
  a made-up id now returns an error envelope instead of silently creating a JSON file.

- **All three `/api/answer` write-backs filled in** (follow-up / advance / end), completing the
  load → run → write-back cycle. The rule they follow: **every exit path writes `message_history`
  back**, because a `return` that skips `save_interview_state` silently discards the turn the model
  was just paid for — the one new failure mode this design introduces.

**Verified live, end to end:**
- `POST /api/interview` writes a correct `interviews` row; bad role → 400; unknown interview → 404.
- **A full interview to exhaustion**: 8 turns grouped `{be-1: 3, be-2: 2, be-3: 3}` — follow-ups kept
  `current_qid` pinned, advancing reset the probe budget, the end branch set `done=True` and left
  `current_qid` on the last question. A further answer → 409. The scorecard folded 8 turns into
  exactly 3 grades. `asked_ids` derived correctly with no list to keep in sync.
- **Killing the backend mid-interview, restarting it, and posting again continues the same
  conversation** (history grew 3 → 6 entries, the reply was context-aware) — the point of the phase.
- A full run through the **SPA** works against the renamed API.

**Known-and-deferred, not gaps:** `/api/scorecard` grades and returns but does not persist a
`scorecards` row, and `save_interview_summary` is implemented + registered but never called by the
app. Both are **Phase C** — they only become observable once there's a History view to read them
back, which needs Phase B's `user_id` to scope. Marked `(Phase C)` in `api.py`.

**Optional hardening (Phase G, inherited from the scaffold):** none of the `save_interview_state`
calls check the returned `{"ok": ...}` envelope. If the `current_qid` lookup in the advance branch
ever missed, the candidate would see the next question while the row still pointed at the old one,
and the following answer would file under the wrong question. Can't realistically happen today
(`q["id"]` comes from `next_question`, reading the same DB).

### Phase B — ✅ COMPLETE (verified end to end against live Supabase)

**Backend — identity.**

- **`server/auth.py` (new).** This project signs tokens **asymmetrically (ES256)**, with public keys
  at `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` — so the backend holds **no auth secret at all**;
  `SUPABASE_URL` is the only env var it needs. (Legacy Supabase projects use a shared HS256 secret,
  which every verifier could also *sign* with. Ours can't.)
  - `decode_supabase_jwt` — `PyJWKClient` (cached, `lifespan=300`) + `jwt.decode` checking signature,
    `exp`, `aud="authenticated"`, `iss=<SUPABASE_URL>/auth/v1`. `algorithms=["ES256"]` is a security
    control, not a hint.
  - `require_user` — FastAPI dependency, `HTTPBearer(auto_error=False)` so BOTH "no header" and "bad
    token" give **401** (not FastAPI's default 403). `PyJWKClientConnectionError` → **503**, and it
    must be caught **before** the `PyJWTError` catch-all — it's a subclass, so the reverse order makes
    it dead code and reports a Supabase outage as "invalid token".
  - `require_ownership(row_profile_id, user_id)` → **403**. Compares as strings (the row gives a
    `uuid.UUID`, the JWT a `str`); a `None` owner (pre-Phase-B row) is also 403.
- **`requirements.txt`: `pyjwt[crypto]`.** Bare PyJWT is HMAC-only and dies on ES256 with
  `MissingCryptographyError`; `cryptography` was in the venv only as a transitive dep of
  Authlib/google-auth — i.e. by luck, which would have broken a clean Phase G deploy.
- **`server/api.py`** — `Depends(require_user)` on all four routes. `/api/interview` threads
  `profile_id=user_id` into `create_interview`. `/api/transcribe` is gated to protect the **wallet**,
  not data (an open Whisper proxy is a stranger billing your `OPENAI_API_KEY`).
  - **Guard order, and it matters: exists (404) → owns (403) → state (409).** Ownership before the
    existence check reads `state["profile_id"]` off a not-found envelope → `KeyError` → 500 instead of
    404. And ownership is checked **before `turn_agent.run`**, so a stranger's request costs one
    indexed SELECT rather than tokens.
- **`server/tools/interview.py`** — `create_interview(..., profile_id=None)` (optional, so the
  `python -m tools.interview` smoke test still runs). `load_interview_state` returns `profile_id`
  **raw**; `get_interview` returns it **stringified**, because that dict is also the `interview://`
  MCP resource payload and crosses a JSON boundary.

**Backend — RLS** (migrations `a98eeeef7b99` + `ebbeeba4648a`, both applied).

- **It is defence in depth, NOT what protects users today.** FastAPI connects as `postgres`
  (`BYPASSRLS`), and even without that a pooled connection carries no per-user identity — `auth.uid()`
  reads a claim **PostgREST** sets per request, so on our connections it would be NULL and every
  owner-scoped policy would deny *everything*. The real control is `require_ownership`. The policies
  guard the **other door**: PostgREST + the anon key, which ships in the JS bundle.
- Tables are grouped by **access rule, not content** — the rename from `BANK_TABLES` to
  `PUBLIC_READ_TABLES` was prompted by a real near-miss:
  - `OWNED_TABLES` — `EXISTS (...)` subquery walking the FK chain back to `interviews.profile_id`
    (1 hop for `turns`/`scorecards`, 2 for `scorecard_entries`, 3 for `scorecard_entry_scores`).
  - `PUBLIC_READ_TABLES` — `FOR SELECT TO authenticated USING (true)`, no write policies.
  - `GRADER_ONLY_TABLES = ["reference_briefs"]` — **RLS on, no policy = deny-all.** Briefs are the
    Phase E *answer key*; a read policy would let any signed-in user fetch the model answer before
    answering. It's structurally bank data, which is exactly why a content-shaped constant name
    quietly answered a security question.
- `(SELECT auth.uid())`, not bare `auth.uid()` — an InitPlan evaluated once per query instead of once
  per row (Supabase's `auth_rls_initplan` lint).
- `ebbeeba4648a` covers `alembic_version`, which no model describes but PostgREST still serves.
  Alembic keeps working because a table's **owner** is exempt from its own policies unless
  `FORCE ROW LEVEL SECURITY` is set.

**Frontend** — added `@supabase/supabase-js`, `react-hook-form`, and **`react-router` v7** (v8 requires
React ≥19.2; this app is React 18, and npm 6 doesn't enforce peer deps, so it installed silently).

- `src/supabase.ts` — one client for the process, **auth only**; throws at startup if the `VITE_` vars
  are missing. It owns the session (localStorage + background refresh).
- `src/auth/AuthProvider.tsx` — the session **mirror**: `getSession()` once (the page-refresh case) +
  `onAuthStateChange` (the everything-else case, including other tabs), with a `loading` flag. React
  mirrors what it renders; **the access token is never copied anywhere.**
- `src/auth/LoginPage.tsx` / `SignupPage.tsx` / `ProtectedRoute.tsx` — signup passes
  `options.data.display_name`, which is precisely what the `3bf1a2d6fb29` trigger reads out of
  `raw_user_meta_data`, so a name typed in the form reaches `profiles` with no API involvement.
  `ProtectedRoute` checks `loading` **before** `session`, or every refresh flashes the login page.
- `src/main.tsx` — `<Provider>` → `<BrowserRouter>` → `<AuthProvider>` → `<Routes>`; public
  `/login` + `/signup`, protected `/` behind the layout route.
- `src/api.ts` — `prepareHeaders` calls `supabase.auth.getSession()` **per request** (it refreshes an
  expired token on the way, which a cached copy could not), and `baseQueryWithReauth` reacts to a 401
  by forcing `refreshSession()`, retrying **once**, and otherwise `signOut()` — letting the mirror and
  `<ProtectedRoute>` do the redirect, so this module never learns that routes exist.

**Verified live:** signup creates the `profiles` row via the trigger; a full SPA interview runs and
`interviews.profile_id` is populated; no header → 401; garbage token → 401; unknown id → 404; and the
one that only runs under attack — **a second account against the first account's interview → 403 on
both `/api/answer` and `/api/scorecard`**, with no LLM call and no `turns` row written. Anon-key GETs
against PostgREST return `[]` for `reference_briefs`, `alembic_version` *and* `questions` (the bank is
`TO authenticated`; a public "sample question" page would mean adding `anon` to that one loop).
This also closes Phase A's last open check.

**Open (small, not blocking):** no sign-out control in the UI yet (`App.tsx` TODO — `useAuth()` gives
`session.user.email` + `signOut`; no navigate needed, the mirror handles it); optional localStorage
mirror of `draft`/`interviewId` so a dropped session doesn't eat a half-typed answer; cosmetics in
`SignupPage.tsx` (green box with red text, unused `React` import).

### Phase C — ✅ COMPLETE (migration applied + follow-up transcript verified live)

*Branch `list-interview-history-and-scorecard`. History list + detail done; the follow-up-transcript
open-turn model added on top. Migration `f3b9c1d5a7e2` **applied to the live Supabase DB**, and the
transcript was verified to show the actual follow-up probes (not the repeated bank question). Client
`tsc --noEmit` clean; all server modules import clean; alembic chain valid.*

**Naming decision (resolved, not defaulted):** the routes are **`GET /api/interviews`** and
**`GET /api/interviews/{id}`**, NOT the `/api/sessions` this section originally named. That wording
predates Phase A's *session → interview* rename; "one word for one thing" wins, so the whole wire
contract stays `interview`. Recorded here so it isn't re-litigated.

**Design fork (resolved): the list stays in FastAPI, not PostgREST.** Reasons as noted below —
one auth story, the scorecard needs shaping, and a History view speaking table names would
re-couple the SPA to the schema Phase A normalized. `list_interviews` scopes by the verified uid
in the WHERE clause (the ownership IS the query), so that route needs no separate `require_ownership`.

**Backend (done, committed):**
- **`server/tools/interview.py`** — `list_interviews(profile_id)` (owner-scoped, newest-first,
  reads each interview's `overall` via the new 1:1 relationship), `save_scorecard(interview_id,
  overall, answers)` (the three-level nested write — scorecard → entries → per-dimension scores —
  resolving each grader dimension NAME to `rubric_dimensions.id`, dropping unresolved names,
  idempotent via delete-then-insert), and `get_scorecard(interview_id)` (reads the persisted grade
  back into the live `Scorecard` shape; recomputes `dimension_averages`, keeps the cached `overall`).
- **`server/db/models.py`** — added `Interview.scorecard` (1:1, `uselist=False`, `viewonly=True`,
  selectin) so the list reads the grade in one load. **No column, no migration** — pure ORM.
- **`server/api.py`** — `GET /api/interviews` (list) and `GET /api/interviews/{id}` (transcript via
  `get_interview` + grade via `get_scorecard`, guard order exists→owns). `POST /api/scorecard` now
  **persists** via `save_scorecard` (500s if the store fails rather than pretending it saved).
- **THE AGGREGATE REFACTOR (`server/tools/scoring.py`, NEW).** `grading.aggregate` lived in the LLM
  module; reusing it from the data layer would drag `pydantic_agent` + the model into `tools/` just
  to average numbers. Moved the arithmetic DOWN into a pure leaf module both call: `aggregate_scores(
  pairs, dimensions=None)` takes a flat `(name, score)` stream, so `grading.aggregate` is now a thin
  adapter (flatten `AnswerGrade`s, pass the dimension whitelist) and `get_scorecard` calls it with no
  whitelist (persisted rows are already clean). One implementation, no LLM stack in the data layer —
  the same `no-indirection` instinct as dropping the MCP round-trip in Phase A.

**Frontend (scaffolded):**
- **`client/src/ScorecardView.tsx` (NEW)** — extracted verbatim from `App.tsx` so the History detail
  view reuses the SAME component; live and persisted grades share the `Scorecard` shape (the
  persisted one just leaves per-dimension `note` empty — the schema stores only the score).
- **`client/src/api.ts`** — `getMyInterviews` (query) + `getInterviewDetail` (query) + the
  `InterviewSummary` / `InterviewDetail` types. Queries, not mutations: cacheable GETs.
- **`client/src/HistoryPage.tsx` (NEW)** — LIST (role/level/date/overall, em-dash for ungraded,
  click → detail via local `selectedId`) AND the `InterviewDetailView` drill-in (transcript +
  `{data.scorecard && <ScorecardView card={data.scorecard} />}`) are both implemented.
- **`client/src/main.tsx`** — `/history` route inside the `<ProtectedRoute>` block; a "View past
  interviews" `<Link>` in `App.tsx`.
- Drive-by: fixed the committed sign-out code's `session.user.email` (nullable per `useAuth`) to
  `session?.user.email` so `tsc` passes.

**Follow-up transcript — the OPEN-TURN model (new schema work, needs a migration applied).**
The transcript first pulled each turn's question text from the scorecard, so an UNGRADED interview
showed no questions. Fixed in two steps:
1. **Question text on the turn** (no scorecard dependency): `get_interview` now returns
   `question_text = turn.prompt_text or turn.question.text`, and `InterviewTurn` gained the field.
2. **The real fix — a turn is now an EXCHANGE, born at ask-time.** A follow-up answer records under
   its parent `question_id` (grouping unchanged), but the transcript showed the *parent bank
   question* for a probe, which read confusingly. Rather than parse the probe out of
   `message_history` (pydantic-ai JSON), a turn now stores the exact prompt and is created when the
   question/probe is PRESENTED, completed when the answer arrives:
   - **`turns.prompt_text`** (the exact question/probe shown) + **`turns.answer` is now NULLABLE**
     (`NULL` = presented-but-unanswered = the "open" turn; `""` is a real blank answer and closes it).
   - **Partial unique index `uq_one_open_turn_per_interview`** (`WHERE answer IS NULL`) makes "at
     most one open turn per interview" a DB guarantee — so `record_answer` finds the turn to
     complete with `WHERE interview_id=? AND answer IS NULL`, **no turn id threaded through the
     client** (it still holds only `interview_id`).
   - **`open_turn(interview_id, question_id, prompt_text)`** (NEW, backend-only, NOT an MCP tool):
     called at `POST /api/interview` (first question) and in the follow-up/advance branches of
     `/api/answer`. The advance `open_turn` is **inside** the `next_question == ok` block, so an
     exhausted bank falls to the END branch and opens nothing — a finished interview has ZERO open
     turns. **Complete-then-open** ordering everywhere keeps the index happy.
   - **`record_answer(interview_id, question_id, answer)`** now COMPLETES the open turn (UPDATE, not
     INSERT). `question_id` was kept (not strictly needed to find the turn) as a GUARD: the open
     turn must be for that question, else refuse. MCP tool signature therefore unchanged.
   - `/api/answer` gained an **empty-answer 400 guard** (before the LLM call); `/api/scorecard`
     **skips `answer IS NULL`** turns; migration **`f3b9c1d5a7e2`** adds the column, makes `answer`
     nullable, backfills `prompt_text` from `question.text`, seeds one open turn per in-progress
     interview, and creates the index. `message_history` stays — `turns` is the human transcript,
     `message_history` is the model's replay buffer (reactions + clarifications + library shape).

**Closed:**
1. **Migration applied** (`f3b9c1d5a7e2`, DB at head).
2. **Verified live:** the transcript shows the ACTUAL follow-up probes (not the repeated bank
   question).
3. Still deferred (own follow-up): `save_interview_summary` is implemented + registered but nothing
   calls it — a one-line wrap-up on `/api/scorecard` if History wants a summary blurb.

### Phase D — ✅ COMPLETE (seniority-aware questions + a paginated role/level picker)

*Branch `questions-by-level`. Backend level-filtering verified via `python -m tools.questions`
smoke test; the paginated option endpoints verified returning the `Page` envelope; client
`npx tsc --noEmit` clean.*

**The idea:** interview questions and interviewing are now LEVEL-AWARE (entry/mid/senior), with
**at-or-below-by-rank** semantics — a senior interview draws entry + mid + senior questions, a mid
interview entry + mid, an entry interview only entry. `levels.rank` is the column that makes "at or
below" orderable; a plain string level couldn't express it. The 5 seed questions were assigned
starter levels (be-1 entry, be-2 senior, be-3 mid, pm-1 entry, pm-2 mid); the bank author adds more.

**Backend — level filtering.**
- **`server/tools/questions.py`** — `next_question(role, level=None, asked_ids=None)`. `level` is
  OPTIONAL (defaults None = no filter = pre-Phase-D behaviour, so the MCP tool, `mcp_client_demo.py`,
  and the smoke test keep working). When a level is passed, it resolves the `levels` row, guards an
  unknown slug (`not_found` envelope), and filters `Question.level_id.in_(select(Level.id).where(
  Level.rank <= level_row.rank))`. A question with `level_id` NULL has no rank and is EXCLUDED — an
  unleveled question isn't in any level's set until assigned one.
- **`server/mcp_server.py`** — the `next_question` MCP wrapper gained the `level` param, delegating on.
- **`server/tools/interview.py`** — `load_interview_state` returns `level` (the slug), so `/api/answer`'s
  advance branch can filter `next_question` by the interview's level, not just its role.
- **`server/api.py`** — `POST /api/interview` threads `req.seniority` into the first `next_question`;
  the advance branch threads `state["level"]`.
- **`server/db/seed.py`** — resolves each question's `level` slug → `level_id`, raises on an unknown
  level, backfills existing rows. **`server/data/questions.json`** — each question gained a `level`.

**Backend — the picker's option endpoints (server-side pagination).**
- **New dep `fastapi-pagination`** (`>=0.15,<0.16`). Provides `Params` (page/size query params),
  the `Page[T]` response envelope, and `apaginate(session, stmt, params)` (the ASYNC ext entry point
  — `paginate` is deprecated for AsyncSession in 0.15.16, removed in 0.16) that runs the COUNT +
  LIMIT/OFFSET. The FastAPI/async-SQLAlchemy analog of the Node paginate plugins.
- **`list_roles(params, search=None)` / `list_levels(params, search=None)`** build the statement
  (our ordering + optional `ilike` search on name) and hand it to `apaginate`. **Division of labour:**
  the SEARCH is ours (a domain decision), the PAGING/COUNT is the library's — no hand-written
  `.limit()/.offset()`. Only scalar columns are read downstream, so serialization after the session
  closes is detached-safe.
- **`server/api.py`** — `RoleOut {slug,name}` / `LevelOut {slug,name,rank}` Pydantic models
  (`model_config = from_attributes` coerces the ORM rows); `GET /api/roles` → `Page[RoleOut]` and
  `GET /api/levels` → `Page[LevelOut]`, each taking `params: Params = Depends()` + our `q` +
  `require_user`. **`add_pagination(app)` is deliberately NOT called** — it breaks on import against
  FastAPI 0.139 (`get_body_field() unexpected kwarg 'body_params'`), and it isn't needed: `Params` is
  passed explicitly to `apaginate` and declared explicitly as a route dependency. A NOTE in api.py
  records this so it isn't "helpfully" re-added.

**Frontend — a reusable async, paginated select + a separate RHF wrapper.**
- **New deps** `react-select` + `react-select-async-paginate` (both installed explicitly; npm 6
  doesn't pull peer deps, same gotcha as react-router).
- **`client/src/components/AsyncPaginateSelect.tsx` (NEW)** — a reusable, RHF-AGNOSTIC select that
  owns the WHOLE pagination dance internally (cursor threading, row→Option mapping, `hasMore`). A
  caller differentiates one instance from another by injecting the ENDPOINT — a lazy RTK Query
  trigger passed as `fetchPage` — and nothing else. Speaks react-select's native `{value,label}`
  Option shape so the chosen option carries its own label (async loading can't guarantee it's in the
  currently-loaded page to look up). *(Design note: the loadOptions closure was first written at the
  call site, then moved INSIDE the component at the user's direction — the caller injects the endpoint
  trigger, the component builds loadOptions from it. Centralizes fetch/paginate/map in one place.)*
- **`client/src/components/ControlledAsyncPaginateSelect.tsx` (NEW)** — the React Hook Form
  integration, kept SEPARATE (the separation-of-concerns the user asked for). Generic over the form
  (`<TForm extends FieldValues>`), wraps the select in a `<Controller>` that supplies
  value/onChange/onBlur; forwards `fetchPage` + the rest through. The one type assertion at the
  boundary: the field value is asserted `SelectOption | null` (the wrapper's contract is that `name`
  points at such a field).
- **`client/src/api.ts`** — `getRoles`/`getLevels` are now `builder.query<Page<T>, {q?,page?}>` hitting
  `/roles?q=&page=` / `/levels?q=&page=`; a generic `Page<T>` type + `RolePageItem`/`LevelPageItem`
  mirror the backend envelope. The **LAZY** hooks (`useLazyGetRolesQuery`/`useLazyGetLevelsQuery`) are
  exported — the select calls the trigger imperatively inside its loadOptions, not on mount.
- **`client/src/App.tsx`** — the useState picker (+ two defaulting effects + raw `<select>`s) is
  REPLACED by a React Hook Form `<form>` over `StartFormValues = {role, level: SelectOption | null}`,
  `mode: "onChange"`. Two `ControlledAsyncPaginateSelect`s (role + level), each handed its lazy
  trigger as `fetchPage`, `rules={{ required: true }}`. Submit unwraps each Option's `.value` (slug)
  and sends `startInterview({role, seniority})`. No auto-default to the first option — an explicit
  required pick is cleaner with async-loaded options; Start is disabled until `formState.isValid`.

**Deferred / not gaps:** only the 5 seed questions carry levels so far (the bank author adds more);
the picker's pagination is exercised more than 2 roles / 3 levels need — the point was the reusable
paginated pattern for larger future lists (a growing question bank, tags).

### Phase E — ✅ COMPLETE (grounded + level-aware grading, verified via the grader smoke test)

*Grader given its own separate model; the authored reference brief + the interview's level now
flow into grading. All server modules compile; `mcp_server.py --list` shows the new surface;
`python grading.py` produced a grounded, level-calibrated grade.*

**The idea:** grading is now GROUNDED in an authored per-question **reference brief** (leveling
bands + tiered bad/good/great concept anchors, phrased as *demonstrated capability* not keywords)
and CALIBRATED to the interview's **level** (the same answer clears entry but not senior). The
brief is a deterministic `question_id → brief` join — a `reference://{question_id}` MCP
**resource**, NOT RAG. An un-briefed question still grades, just ungrounded (fallback to priors).

**Grading source — authored markdown briefs.**
- **`server/data/reference_briefs/<slug>.md`** — one markdown file per question; the FILENAME is
  the question slug. Chosen over inline JSON because briefs are long-form prose that reads/edits
  far better as markdown. `be-2` (rate limiter) authored as the worked exemplar; the rest are the
  bank author's to write (be-1/be-3/pm-1/pm-2 currently un-briefed → graceful `not_found`).
- **`server/db/seed.py`** — scans `reference_briefs/*.md` and upserts `reference_briefs` rows. The
  ONE place the seeder UPDATES in place (besides the Phase D level backfill): briefs get tuned
  iteratively, so re-seeding after an edit picks up new text (create if missing, overwrite if
  changed). An unknown slug is a loud error (mirrors the level check). `created["briefs"]` tracks it.

**Backend — the read helper + MCP surface.**
- **`server/tools/questions.py`** — `get_reference(question_id)`: resolve slug → `Question`, then
  query `ReferenceBrief` DIRECTLY by `question.id` (design choice: keeps the hot question-fetch
  paths — `next_question`, the transcript — from dragging brief text they never use; no relationship
  added to the `Question` model). Returns `{status:"ok", question_id, brief}` or a graceful
  `not_found` for BOTH an unknown question and an un-briefed one.
- **`server/mcp_server.py`** — `reference://{question_id}` **resource** (thin wrapper → `get_reference`,
  mirrors `question://`). For EXTERNAL clients; the backend grader imports `get_reference` directly
  (the Phase A "no transport to ourselves" rule). RLS already makes `reference_briefs` deny-all over
  PostgREST (the answer key), so no anon-key read path exists.

**Grader — its own model + brief/level threading.**
- **`server/grading.py`** — `grader_agent` now runs on a SEPARATE `grader_model`
  (`GoogleModel`, currently hardcoded to `gemini-3.5-flash-lite`), distinct from the interviewer's
  `gemini-3.1-flash-lite-preview`; grading runs once per interview, so the grader's model is chosen
  independently. `grade_one(question_id, question_text, answer, rubric_text, level=None)` FETCHES the
  brief itself (`get_reference`, tolerating `not_found` → `""`) and threads `reference_brief` + `level`
  into `evaluate_answer`. The smoke test passes real slugs (`be-2`/`be-1`) so it exercises the fetch.
- **`server/prompts.py`** — `evaluate_answer` gained optional `reference_brief` + `level` (defaults
  keep the MCP wrapper + pre-Phase-E callers working). The instruction prose now (a) grounds scoring
  in the brief's bad/good/great anchors, (b) calibrates to the level, (c) rewards demonstrated
  understanding over keyword presence, and falls back to plain rubric grading when brief/level absent.
  The optional brief/level sections render nothing-dangling when empty.
- **`server/mcp_server.py`** — the `evaluate_answer` prompt wrapper mirrors the new optional signature.

**API — level flows to the grader.**
- **`server/tools/interview.py`** — `get_interview` now returns `"level"` (the `levels.slug`),
  which is what `/api/scorecard` reads to grade at the right bar.
- **`server/api.py`** — `/api/scorecard` reads `level` off the interview and passes `question_id` +
  `level` into `grade_one`.

**Verified live:** `mcp_server.py --list` shows `reference://{question_id}` and the extended
`evaluate_answer` args; `python -m db.seed` loads the be-2 brief idempotently; `python -m tools.questions`
returns the be-2 brief and `not_found` for un-briefed be-1; `python grading.py` produced a grade that
CITES the brief's own concepts (fail-open/closed, X-RateLimit-*, edge-vs-app) and calibrated to level
("for a senior" vs "for an entry level candidate") — the plan's Phase E acceptance check.

**Config note:** `GRADER_MODEL` is currently HARDCODED in `grading.py` rather than read from
`.env`; the scaffold's `os.environ.get("GRADER_MODEL", USE_MODEL)` form is the config-in-env option
if the model id should later change without a code edit.

**Deferred / not gaps:** only `be-2` has a brief so far (the rest fall back to ungrounded grading
until authored); pgvector/RAG-backed retrieval stays deferred to when briefs get long or the bank
outgrows hand-authoring; the full HTTP round-trip of `/api/scorecard` reading `level` off a real
interview wasn't curl-tested (the grader core is proven via the smoke test, and the wiring compiles).

### Phase F — ✅ COMPLETE (engine-switchable neural TTS, latency-masked, verified live in the SPA)

*Branch `neural-tts`. Client `npx tsc --noEmit` clean; `python -m py_compile api.py` clean. Tested end
to end in the browser: the OpenAI voice plays with no `App.tsx` change to the call sites, the free
browser voice is selectable, and text now reveals in sync with the audio.*

**Design fork (resolved, NOT the plan's default):** the OUTPUT adapter routes through **RTK Query via
a `useSpeak()` hook**, not a raw `fetch` in a module function. The plan said "swap speak()'s body",
but a raw fetch would DUPLICATE api.ts's `prepareHeaders` auth. So `speak()` became a hook wrapping
`useTtsMutation` (auth + origin come free); App call sites are unchanged. Recorded as the
`route-client-http-through-rtk-hook` memory. RTK Query hooks only run during render, hence the shape.

**Backend — `server/api.py`.** `POST /api/tts`: `TtsRequest {text}`, `Depends(require_user)` **wallet
gate** (an open TTS proxy is a stranger's OpenAI bill — same reasoning as `/api/transcribe`), reuses
the lazy `get_openai_client()`, returns `fastapi.Response(content=audio_bytes, media_type="audio/mpeg")`
(binary, not a dict). Guards: empty text → 400, `len(text) > 4096` → 413 (OpenAI's own input cap — a
**character** ceiling, NOT transcribe's byte/MB math, which was a category error when copied over).
Model is **`tts-1`** (OpenAI's latency-optimized voice; switched from `gpt-4o-mini-tts` after testing
showed a 1–2s gap), `voice="alloy"`, `response_format="mp3"`, read async via `await resp.aread()`.

**Client — `client/src/api.ts`.** `tts` mutation returns a **`Blob`** via `responseHandler: r =>
r.blob()` (the one binary-response endpoint — fetchBaseQuery's default `r.json()` would choke on mp3);
`TtsRequest` type; `useTtsMutation` exported.

**Client — `client/src/voice/speech.ts`.** `speak()` → **`useSpeak(engine)`** hook, returning
`{ speak(text, onReady?), speaking }`:
- **Two engines behind ONE `speak(text, onReady)` contract** (App stays engine-blind — the thesis):
  `speakOpenAI` (neural `/api/tts`, spends tokens) and `speakBrowser` (the RESTORED `SpeechSynthesis`
  path — free/robotic, for debugging without burning credit). The old `voicePrefs`/`useVoices`/
  `pickPreferredVoice` block I'd flagged "dead-once-verified" came **back to life** as the browser
  engine's voice machinery rather than being deleted. `useSpeak(engine)` dispatches.
- **Leak-free audio cleanup (Option A):** `currentRef` pairs the `HTMLAudioElement` WITH its object
  URL, so every path revokes exactly once — natural end (`onended`), barge-in (pause + revoke the
  replaced clip, since `pause()` never fires `ended`), `play()` rejection (autoplay blocked), and a
  synth failure that returns early WITHOUT disturbing a clip still playing.
- **`onReady` callback** fires the instant audio actually starts (and on every failure path), letting
  the caller sync text to sound.

**Client — `client/src/App.tsx`.**
- `const { speak } = useSpeak(ttsEngine)`; call sites (`speak(res.message, …)`) otherwise unchanged.
- **Latency masking (#5), done RIGHT:** instead of showing text 1–2s before sound, a new interviewer
  turn pushes a `pending` bubble rendering **"thinking…"**, and `speak(text, () => revealLine(id, text))`
  swaps in the real text the moment audio starts — **text + voice land together.** `Line` gained
  `id` (a `useRef` counter — stable key, race-safe reveal by id) + `pending`. The earlier standalone
  "🔊 speaking…" indicator was removed in favor of this.
- **Engine picker:** a **`react-select`** dropdown (same widget family as the kickoff role/level
  selects; a plain static options list, not the async-paginate variant — recorded as the
  `prefer-react-select-for-dropdowns` memory) toggles `ttsEngine` (`"openai"` default | `"browser"`).
  Works mid-interview — `useSpeak(engine)` just re-dispatches the next `speak()`.

**Deferred / not gaps:** the **mode-flag gate** (`speak()` + mic behind a per-session voice vs
text-only flag — the dual-mode split; when built, text-only mode should skip the thinking→reveal wait);
persisting the engine choice across reloads (a `localStorage` mirror); cross-engine mid-utterance stop
(switching engines while a clip plays can briefly overlap — harmless for a debug toggle). The
SpeechSynthesis block is NO LONGER slated for removal — it's the free engine now.

**Next up — Phase G (production hardening & deploy):** env-driven CORS, `client/vercel.json` SPA
rewrite + `VITE_*` vars in Vercel, a FastAPI `Dockerfile` for Render/Railway, keep the guardrails.
