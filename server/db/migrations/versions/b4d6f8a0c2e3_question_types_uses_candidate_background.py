"""question_types uses_candidate_background

Revision ID: b4d6f8a0c2e3
Revises: f3a5c7e9b1d2
Create Date: 2026-10-20

`question_types.uses_candidate_background`: whether a Practice interview's persona carries the
candidate's Profile background when its plan includes a question of this kind. The Practice
counterpart to `round_types.uses_candidate_background` (e2a4c6b8d0f1): a Practice interview has no
round, so the flag lives on the question's TYPE, and a plan of only coding or system-design questions
starts without the background at all.

Added false, then `behavioral` is flipped on here, so a deploy is correct even before `seed.py` runs again.

Apply (from server/):  .venv/Scripts/python.exe -m alembic upgrade head
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b4d6f8a0c2e3'
down_revision: Union[str, Sequence[str], None] = 'f3a5c7e9b1d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "question_types",
        sa.Column("uses_candidate_background", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute("UPDATE question_types SET uses_candidate_background = true WHERE slug = 'behavioral'")
    op.alter_column("question_types", "uses_candidate_background", server_default=None)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("question_types", "uses_candidate_background")
