"""Alembic's entry point — how a migration run finds the schema and the database.

WHAT ALEMBIC IS FOR: `models.py` says what the schema SHOULD be; the live database has
whatever it has. Alembic writes the versioned steps between them, so the database can be
rebuilt from scratch in order — including on a deploy where you can't just drop and
recreate. `alembic revision --autogenerate` diffs the two and drafts the step;
`alembic upgrade head` applies it.

TWO THINGS THIS FILE WIRES UP, and they're the only edits to the generated template:

1. `target_metadata = Base.metadata` — autogenerate diffs against THIS. Anything not
   imported into `db/models.py` is invisible to it, and would look like a table to DROP.
2. The connection. We do NOT put the URL in alembic.ini: it's a secret, and the file is
   committed. Instead we import the same `DATABASE_URL` the app uses, so there is exactly
   one place a connection string lives (`server/.env`). It's passed straight to
   create_async_engine rather than through `config.set_main_option`, because that path runs
   the value through configparser interpolation and a `%` in a password would break it.

ASYNC: this is the `-t async` template — the DBAPI is asyncpg, so the engine is async and
the actual migration runs inside `connection.run_sync(...)`. Alembic's own migration API is
synchronous; run_sync is the bridge.

NullPool: a migration is one short-lived connection, so pooling would just leave a
connection open after the process is done.

Run from `server/`:
    .venv/Scripts/alembic.exe revision --autogenerate -m "message"
    .venv/Scripts/alembic.exe upgrade head
    .venv/Scripts/alembic.exe downgrade -1
"""
import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from alembic import context

# `prepend_sys_path = .` in alembic.ini puts server/ on sys.path, so these resolve when
# alembic is run from server/ — the same import shape the app uses.
from db.engine import DATABASE_URL
from db.models import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# WHAT AUTOGENERATE DIFFS AGAINST. Every model must be reachable from this metadata —
# importing db.models is what registers all of them on Base.
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Emit SQL to stdout instead of running it (`alembic upgrade head --sql`).

    Useful when a DBA — or a deploy pipeline with no direct DB access — has to apply the
    change by hand. No connection is made, so `literal_binds` inlines parameters.
    """
    context.configure(
        url=DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    # compare_type: without it, autogenerate ignores CHANGED column types (only added and
    # dropped columns are noticed) — e.g. String(64) -> String(128) would pass silently.
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Connect for real and run the migrations."""
    connectable = create_async_engine(DATABASE_URL, poolclass=pool.NullPool)

    async with connectable.connect() as connection:
        # Alembic's migration API is synchronous; run_sync hands it a sync-style connection
        # backed by this async one.
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
