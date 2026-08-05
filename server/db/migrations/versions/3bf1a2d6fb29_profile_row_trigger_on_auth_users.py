"""profile row trigger on auth users

Revision ID: 3bf1a2d6fb29
Revises: edc507e08778
Create Date: 2026-08-05 00:42:56.990532

THE ONE MIGRATION AUTOGENERATE CANNOT WRITE. Everything else in db/migrations/ was diffed
out of `models.py`; this is raw SQL because it reaches into `auth`, Supabase's own schema,
which our models don't (and shouldn't) describe. Two things live here:

  1. profiles.id -> auth.users(id) ON DELETE CASCADE. The model deliberately omits this FK:
     autogenerate only knows `Base.metadata`, so it would see an unexplained constraint and
     try to drop it on every future revision. Declared once here, by hand, where it's safe.
  2. The trigger that CREATES a profile row when someone signs up.

WHY A TRIGGER instead of a get-or-create in the FastAPI auth dependency: signup happens on
paths our API never sees — the Supabase dashboard, an emailed invite, a social provider —
and every one of them still needs a profile row. The database is the only place that sees
all of them.

WHAT TO RESPECT ABOUT IT: this runs INSIDE the signup transaction. If it raises, the SIGNUP
fails — so the function does exactly one INSERT and nothing else. `ON CONFLICT DO NOTHING`
makes it idempotent (a re-run, or a profile somehow already present, is not an error).

SECURITY DEFINER + `SET search_path = ''` is the standard Supabase shape: the function runs
as its OWNER (needed — the signing-up user has no rights on `public.profiles`), and the
emptied search_path stops a caller from shadowing an unqualified name with their own
object. That's why every identifier below is schema-qualified.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '3bf1a2d6fb29'
down_revision: Union[str, Sequence[str], None] = 'edc507e08778'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. the cross-schema FK the model can't carry
    op.execute(
        """
        ALTER TABLE public.profiles
            ADD CONSTRAINT profiles_id_auth_users_fkey
            FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE
        """
    )

    # 2. the function. display_name comes from whatever the signup call passed as user
    #    metadata; it's nullable, so a signup that sends nothing still works.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
        RETURNS trigger
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = ''
        AS $$
        BEGIN
            INSERT INTO public.profiles (id, display_name)
            VALUES (NEW.id, NEW.raw_user_meta_data ->> 'display_name')
            ON CONFLICT (id) DO NOTHING;
            RETURN NEW;
        END;
        $$
        """
    )

    # 3. hang it off auth.users. AFTER INSERT: the auth row must exist before a profile can
    #    reference it (the FK added above), so BEFORE would fail.
    op.execute(
        """
        CREATE TRIGGER on_auth_user_created
            AFTER INSERT ON auth.users
            FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user()
        """
    )


def downgrade() -> None:
    # reverse order: the trigger depends on the function, the FK on nothing else.
    op.execute("DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users")
    op.execute("DROP FUNCTION IF EXISTS public.handle_new_auth_user()")
    op.execute("ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_auth_users_fkey")
