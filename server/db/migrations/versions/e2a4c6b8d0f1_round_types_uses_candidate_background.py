"""round_types uses_candidate_background

Revision ID: e2a4c6b8d0f1
Revises: d8f2b4a6c0e3
Create Date: 2026-10-13

`round_types.uses_candidate_background`: whether a round reads the candidate's Profile background
(roles, projects, skills). When set, the round generator grounds its questions in it and the persona may
tie follow-ups to it. A flag on the row (like allows_smart_voice), so a new round opts in with a seed
entry, never a slug check in code.

Added false, then behavioral is flipped on here, so a deploy is correct even before `seed.py` runs again.

Apply (from server/):  .venv/Scripts/python.exe -m alembic upgrade head
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e2a4c6b8d0f1'
down_revision: Union[str, Sequence[str], None] = 'd8f2b4a6c0e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "round_types",
        sa.Column("uses_candidate_background", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute("UPDATE round_types SET uses_candidate_background = true WHERE slug = 'behavioral'")
    op.alter_column("round_types", "uses_candidate_background", server_default=None)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("round_types", "uses_candidate_background")
