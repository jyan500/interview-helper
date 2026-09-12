"""profile default role/level

Revision ID: c2e1a4b7d9f0
Revises: f3b9c1d5a7e2
Create Date: 2026-09-11

The dashboard default. A profile can now remember the role/level the user usually practises,
so the kickoff form opens pre-filled and the signal panel (readiness / skill breakdown / work
on next) opens scoped to that role instead of making them re-pick every visit.

Two NULLABLE FK columns on `profiles`, both `ON DELETE SET NULL`: a fresh profile has no default
(the dashboard falls back to the user's most-recently-graded role until they set one), and if a
role/level were ever removed the profile should just lose its default, never be deleted with it.

Nothing to backfill — existing rows keep NULL, which is exactly "no default yet".

Apply (from server/):  .venv/Scripts/python.exe -m alembic upgrade head
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c2e1a4b7d9f0'
down_revision: Union[str, Sequence[str], None] = 'f3b9c1d5a7e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("profiles", sa.Column("role_id", sa.Integer(), nullable=True))
    op.add_column("profiles", sa.Column("level_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_profiles_role_id_roles", "profiles", "roles",
        ["role_id"], ["id"], ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_profiles_level_id_levels", "profiles", "levels",
        ["level_id"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("fk_profiles_level_id_levels", "profiles", type_="foreignkey")
    op.drop_constraint("fk_profiles_role_id_roles", "profiles", type_="foreignkey")
    op.drop_column("profiles", "level_id")
    op.drop_column("profiles", "role_id")
