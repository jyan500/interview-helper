"""rls on alembic_version

Revision ID: ebbeeba4648a
Revises: a98eeeef7b99
Create Date: 2026-08-12

THE TABLE THE LAST MIGRATION COULDN'T SEE. `a98eeeef7b99` enabled RLS on every table in
`models.py` — but `alembic_version` isn't in models.py. Alembic created it itself, in
`public`, to remember which revision is applied. Nobody wrote it, so nobody thought to
protect it, and Supabase's linter is right to flag it: everything in `public` is served by
PostgREST, so `GET <SUPABASE_URL>/rest/v1/alembic_version` with the anon key returns your
schema's revision hash to anyone who reads the JS bundle.

The content is one short string, so this is not an emergency. It's worth doing anyway for
the reason the linter exists: "which tables are reachable from a browser" should be a list
you decide, not a list that accumulates. Migration bookkeeping is not part of your API.

DENY-ALL, same as `reference_briefs`: RLS on, no policy, nothing to OR, nothing visible.

WHY THIS DOESN'T LOCK ALEMBIC OUT OF ITS OWN BOOKKEEPING — the question to ask before
enabling RLS on a table something else depends on. Two separate exemptions cover it:

    the OWNER of a table is exempt from its policies unless the table is also set to
        FORCE ROW LEVEL SECURITY (which we are not doing), and
    the `postgres` role Supabase gives us has BYPASSRLS anyway.

Alembic connects as that role and owns this table, so it keeps reading and writing the
version row exactly as before. Worth knowing the FORCE keyword exists, though: it's the
difference between "policies apply to everyone else" and "policies apply to everyone",
and if you ever enable RLS on a table and find your own backend still sees every row, this
is why.

Apply (from server/):  .venv/Scripts/python.exe -m alembic upgrade head
Confirm nothing is left unprotected:
    select tablename from pg_tables where schemaname='public' and not rowsecurity;
    -> 0 rows
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ebbeeba4648a'
down_revision: Union[str, Sequence[str], None] = 'a98eeeef7b99'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # No CREATE POLICY: the absence IS the rule. See reference_briefs in a98eeeef7b99.
    op.execute("ALTER TABLE public.alembic_version ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("ALTER TABLE public.alembic_version DISABLE ROW LEVEL SECURITY")
