"""interview time limit: interviews.time_limit_seconds + time_used_ms

Revision ID: a1c3e5f7b9d0
Revises: e8a0c2d4f6b7
Create Date: 2026-10-21

A TIMED interview. The candidate picks a limit at kickoff, frozen on the row, and the clock runs only
during THEIR turn (the client measures it and reports it with each answer), never while the answer is
transcribed, the interviewer thinks, or it speaks:

  1. `interviews.time_limit_seconds` (nullable): the limit. NULL = untimed, every existing row.
  2. `interviews.time_used_ms` (NOT NULL, default 0): the candidate-turn time spent so far, summed by
     /api/answer and /api/interviews/{id}/final-answer, so a refresh or resume continues the clock.

Apply (from server/):  .venv/Scripts/python.exe -m alembic upgrade head
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1c3e5f7b9d0'
down_revision: Union[str, Sequence[str], None] = 'e8a0c2d4f6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('interviews', sa.Column('time_limit_seconds', sa.Integer(), nullable=True))
    op.add_column('interviews', sa.Column('time_used_ms', sa.Integer(), nullable=False, server_default='0'))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('interviews', 'time_used_ms')
    op.drop_column('interviews', 'time_limit_seconds')
