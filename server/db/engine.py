"""The connection: one async engine + one session factory for the whole app.

Usage:  from db.engine import get_session

WHY ASYNC. Every caller here is already async — FastAPI routes, MCP tool bodies, the
agent's OpenAI/Gemini calls. A blocking (psycopg2-style) driver would park the single
event-loop thread for the whole round-trip to Supabase, so one slow query would stall
every other in-flight interview. `postgresql+asyncpg://` + `AsyncSession` keeps the loop
free, exactly like the `AsyncOpenAI` client already in `api.py`.

WHAT A CONNECTION POOL ACTUALLY IS (the mental model for the two objects below):

    engine  = the POOL   — a small set of already-open Postgres connections. ONE per
                           process, built at import. Never created per request.
    session = a BORROWER — one unit of work that checks a connection OUT, uses it, and
                           returns it. Many, short-lived.

  - Concurrent users do NOT share a connection. Two requests in flight check out two
    different connections; a Postgres connection is a single session with a single
    transaction state, and asyncpg raises if you use one concurrently. (Same reason an
    AsyncSession must never be shared across requests.)
  - Checkout is lazy and scoped: `async with get_session()` grabs a connection on the
    FIRST statement and holds it until commit/rollback/close, then returns it to the pool
    still open. Reusing the TCP+TLS+auth handshake is the entire point of pooling.
  - A drained pool queues. SQLAlchemy's default is pool_size=5 + max_overflow=10 (≤15
    connections); past that, a checkout waits. So the pool doubles as a concurrency cap —
    that's how you stop 200 requests from opening 200 connections to Supabase.
  - There are TWO pools stacked here: ours, talking to Supabase's pgbouncer, which has its
    own pool of real Postgres backends.

CONNECTION STRING GOTCHA (already burned once, keep it written down): `DATABASE_URL` must
point at Supabase's **session pooler on port 5432**, not the transaction pooler on 6543.
Session mode pins one real backend to our connection for its whole life; transaction mode
can hand us a different backend per statement, which breaks asyncpg's prepared statements
(`InvalidSQLStatementNameError`). The scheme must be `postgresql+asyncpg`.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Same explicit-path .env load as pydantic_agent.py: resolved from THIS file, so it works
# no matter which directory an MCP client / uvicorn / alembic was launched from.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DATABASE_URL = os.environ.get("DATABASE_URL", "")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set in server/.env — expected a Supabase SESSION-pooler URL:\n"
        "  postgresql+asyncpg://postgres.<project-ref>:<password>@<host>:5432/postgres"
    )

# pool_pre_ping: Supabase (and any pooler) drops idle connections; pre_ping cheaply checks
# a pooled connection is still alive before handing it out, instead of failing your query.
# echo: set SQL_ECHO=1 in .env to see every statement — useful while learning the ORM.
engine = create_async_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    echo=os.environ.get("SQL_ECHO") == "1",
)

# The session FACTORY. expire_on_commit=False so ORM objects stay readable after commit()
# (the default marks attributes stale, so the next attribute access re-fetches — an extra
# round-trip, and in async code an accidental lazy-load raises). The tool bodies read
# attributes off objects after committing, so this matters.
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


def get_session() -> AsyncSession:
    """Open one unit of work. Callers own the lifetime:

        async with get_session() as db:
            ...
            await db.commit()

    Kept a plain function (not a FastAPI dependency) on purpose: the MCP tool bodies in
    tools/*.py are called from BOTH FastAPI routes and the bare `python -m tools.questions`
    smoke test, so they can't depend on FastAPI's injection.
    """
    return AsyncSessionLocal()
