"""profile trigger: fall back to the OAuth provider's name for display_name

Revision ID: e5a7c9b1d3f6
Revises: b3d5f7a9c1e2
Create Date: 2026-11-18

Google sign-in. The profile-row trigger (3bf1a2d6fb29) copies `display_name` out of the signup's user
metadata, which our own signup form sets. A Google sign-in never does: Supabase fills the metadata
from the provider instead (`full_name`, `name`, `avatar_url`, ...), so a Google user's profile would
start with display_name NULL.

Fix: re-define the SAME function to COALESCE through display_name -> full_name -> name. The trigger
itself is untouched (CREATE OR REPLACE swaps the body it calls). Everything the original migration
says still applies: it runs inside the signup transaction, so it stays one INSERT; SECURITY DEFINER +
an emptied search_path, so every identifier is schema-qualified.

Apply (from server/):  .venv/Scripts/python.exe -m alembic upgrade head
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e5a7c9b1d3f6'
down_revision: Union[str, Sequence[str], None] = 'b3d5f7a9c1e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
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
            VALUES (
                NEW.id,
                COALESCE(
                    NEW.raw_user_meta_data ->> 'display_name',
                    NEW.raw_user_meta_data ->> 'full_name',
                    NEW.raw_user_meta_data ->> 'name'
                )
            )
            ON CONFLICT (id) DO NOTHING;
            RETURN NEW;
        END;
        $$
        """
    )


def downgrade() -> None:
    # back to the original body from 3bf1a2d6fb29
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
