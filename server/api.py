"""The FastAPI backend 

Concept (unchanged since Phase 3.5): a web UI is the SAME kind of edge adapter as audio.
The agent, the tools, the templates are byte-for-byte the ones you already built — we just
put an HTTP boundary on the two ends of the loop instead of a terminal (or a mic).

PHASE A CHANGED TWO THINGS HERE.

1. THE STATE MOVED OUT OF THE PROCESS.

    Phase 3.5:   SESSIONS[session_id] = {history, persona, current_qid, ...}   # a dict
    Phase A:     the `interviews` row in Postgres                              # a table

   Phase 3.5 relocated the terminal loop's `history` local var into a module-level dict —
   that was the lesson then (control inverts; state lives behind the HTTP boundary). But a
   dict dies on restart and is invisible to a second process, so it survives neither a deploy
   nor horizontal scale. Phase A finishes the move: every turn now does

        load_interview_state(iid)  ->  turn_agent.run(...)  ->  save_interview_state(iid, ...)

   with NO process-local state at all. Any instance can serve any request, a restart
   mid-interview loses nothing, and "resume an interview later" (Phase C) falls out free.

   Deliberately NOT added: an in-memory write-through cache. The DB round-trip is noise next
   to the LLM call, so a cache would buy invalidation bugs and nothing else. If turn latency
   ever matters, Redis goes IN FRONT of this same Postgres-as-truth design — nothing here is
   thrown away.

2. THIS BACKEND STOPPED BEING AN MCP CLIENT OF ITS OWN SERVER.

   Every question and answer used to travel `direct_call_tool(...)` / `read_resource(...)` —
   a stdio round-trip to a subprocess, plus a `json.loads` to undo the serialization, to
   reach Python functions in this same repo. That indirection was EARNED in Phase 3, when the
   MODEL called those tools: MCP is how a model reaches a capability. The client-driven
   rewrite took that away — the model calls nothing now, so there was no model on the other
   side of the transport. Direct imports below.

   `mcp_server.py` is untouched and still runs: it's the surface for OTHER people's clients
   (Claude Desktop, `mcp_client_demo.py`, `--list`), which is what an MCP server is actually
   for. Same bodies, same templates, different door.

VOCABULARY (Phase A rename): what the app conducts is an INTERVIEW. "Session" now means
exactly one thing — a SQLAlchemy DB session, always the variable `db`, and it never appears
in the routers. So: `interview_id` on the wire, `POST /api/interview`.

PHASE B ADDS ONE WORD TO EVERY ROUTE: `Depends(require_user)`.

   Phase A:  POST /api/answer  ->  load the row, run the turn, write it back
   Phase B:  POST /api/answer  ->  verify the JWT -> load the row -> IS IT THIS USER'S? ->
                                   run the turn, write it back

   Two separate questions, and it's worth keeping them separate in your head because they
   fail with different status codes:

       AUTHENTICATION (401) — who is calling? Answered by the signature on the token,
           in auth.py, before the route body runs at all.
       AUTHORIZATION (403) — may they touch THIS row? Answered by comparing the
           interview's `profile_id` to that user id, INSIDE the route, after the load.

   A route that does the first and forgets the second is the classic broken-access-control
   bug: everyone is a real user, and every real user can read everyone else's interviews by
   changing an id. `interview_id` being an unguessable uuid slug is not a defence — it's an
   obscurity that Phase C's History list will hand out on a plate.

   RLS on the Supabase tables is a SECOND line of defence, not this one: our backend
   connects as the `postgres` role, which bypasses RLS, so the check that actually protects
   your users today is the one in the routes (routers/).

Run (from server/) — the FastAPI CLI auto-detects `app` and enables reload:
    .venv/Scripts/fastapi.exe dev api.py
Smoke-test with curl (no browser needed — prove the backend before the React side):
    curl -X POST localhost:8000/api/interview
    curl -X POST localhost:8000/api/answer -H "Content-Type: application/json" \\
         -d '{"interview_id":"<id-from-above>","text":"my answer"}'
Then prove the point of the whole phase: Ctrl-C the server mid-interview, start it again,
and POST another answer to the SAME interview_id. It keeps going.

ROUTES live in routers/, one module per area, each an APIRouter mounted under /api below:
    interviews  the turn loop, grading, history, resume   audio       /transcribe, /tts
    questions   the bank, custom questions, saved set     jobs        saved job descriptions
    profile     profile row, avatar, dashboard            background  roles, projects, skills, resume
    vocab       roles, levels, question/round types       common      helpers shared by routers
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db.engine import engine
from routers import audio, background, interviews, jobs, profile, questions, vocab


# --- LIFESPAN: the terminal loop opened `async with agent:` ONCE and ran the whole
#     conversation inside it, and until Phase A this block did the same to keep the MCP
#     subprocess alive across requests. There's no subprocess to hold open now — what has a
#     lifetime worth managing is the DB CONNECTION POOL, so shutdown closes it cleanly
#     instead of dropping sockets on Supabase's floor. (The pool itself is created lazily at
#     import; see db/engine.py for what a pool actually is.) ------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    yield                       # ...app serves requests here...
    await engine.dispose()      # close every pooled connection on shutdown


app = FastAPI(lifespan=lifespan)

# --- CORS: the Vite dev server (:6173) and this API (:8000) are different origins, so the
#     browser's preflight blocks fetch unless we opt in. Explicit origin, not "*", to stay
#     honest about who's calling. (Phase G makes this env-driven for the Vercel origin.) ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:6173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


for module in (interviews, audio, vocab, jobs, questions, profile, background):
    app.include_router(module.router, prefix="/api")


# NOTE — deliberately NOT calling `add_pagination(app)`. In fastapi-pagination 0.15.16 that helper
# rebuilds every route to inject the page/size params via a contextvar, and its rebuild calls a
# FastAPI internal (`get_body_field(body_params=...)`) whose signature changed in FastAPI 0.139 —
# so `add_pagination` raises at import on our version. We don't need it: both routes declare
# `params: Params = Depends()` explicitly (so page/size are read from the query the normal way)
# and pass that `params` straight into `apaginate(...)`. `add_pagination` only matters for the
# IMPLICIT form (`apaginate(db, stmt)` with no params, pulled from the contextvar it installs),
# which we never use. `Page[T]` is a plain pydantic model, so it serializes as a response_model
# on its own. (If a future upgrade aligns the versions, add it back to also surface page/size in
# the OpenAPI docs — cosmetic here.)
