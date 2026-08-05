"""The database package — Phase A of the production migration.

WHAT CHANGED CONCEPTUALLY: up to now the "database" was two piles of JSON
(`data/questions.json` for the bank, `data/sessions/*.json` for transcripts) plus an
in-memory `SESSIONS` dict in `api.py`. All three die or diverge the moment there's more
than one process — which is exactly what a deploy is. This package replaces them with
one Postgres (Supabase) as the single source of truth.

The split inside here mirrors the split the repo already uses everywhere else:
    engine.py   -> the CONNECTION (one async engine + a session factory, built once)
    models.py   -> the SCHEMA    (declarative tables; the shape of the data)
    seed.py     -> a ONE-OFF     (load questions.json into roles/rubrics/questions)
    migrations/ -> Alembic       (versioned DDL so the schema is reproducible)

This file is deliberately EMPTY of re-exports — import from the submodule that owns the
name, so every import says where the thing lives:

    from db.engine import get_session
    from db.models import Question, Session

(Entry points all run with `server/` as CWD, which is what puts `db` on the import path.)
"""
