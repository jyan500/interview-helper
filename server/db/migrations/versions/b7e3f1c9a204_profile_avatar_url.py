"""profile avatar url

Revision ID: b7e3f1c9a204
Revises: d4a2c6e8b135
Create Date: 2026-09-16

The profile picture. A profile can now carry the URL of an uploaded avatar so the SPA shows the
picture wherever it otherwise shows the user's initials (the nav, the session participant cell, the
"You" transcript rows). NULL = no picture yet, which is exactly the initials fallback.

ONE NULLABLE STRING COLUMN. The image itself does NOT live here — it's uploaded client-direct to a
Supabase Storage bucket (`avatars`), and this column is just the public URL the browser renders in an
<img>. Nothing to backfill: existing rows keep NULL ("no picture yet").

THE STORAGE SIDE IS NOT IN THIS MIGRATION. Creating the `avatars` bucket and its Row-Level-Security
policies is DDL against the `storage` schema, which is owned by `supabase_storage_admin` — the
`postgres` role this migration runs as (over the session pooler) may not have privileges to add
policies there, and a permission error mid-migration would roll back this column too. So the bucket +
policies live in a separate, idempotent SQL script meant for the Supabase SQL editor (which runs with
the right ownership): `server/db/policies/storage_avatars_bucket.sql`. Run that ONCE, in the
dashboard, alongside applying this migration.

Apply (from server/):  .venv/Scripts/python.exe -m alembic upgrade head
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7e3f1c9a204'
down_revision: Union[str, Sequence[str], None] = 'd4a2c6e8b135'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("profiles", sa.Column("avatar_url", sa.String(length=512), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("profiles", "avatar_url")
