"""round_types avoids_recent_questions

Revision ID: f3a5c7e9b1d2
Revises: d5f7a9b1c3e4
Create Date: 2026-10-16

Whether the round generator is shown the candidate's recent questions of this round type and told to
vary away from their techniques. Coding and system design need it: a stateless generator kept handing
out the same likeliest problems (an intervals problem, then a graph one) for every job. Behavioral must
NOT get it: its intro / project / why-this-company structure is meant to repeat, and "differ from all
of these" would bend it.

BACKFILLED HERE, not left to a re-seed: the column lands false everywhere (today's behavior before the
history feed), then coding and system-design are flipped on, so a deploy is correct before `seed.py`.

Apply (from server/):  .venv/Scripts/python.exe -m alembic upgrade head
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f3a5c7e9b1d2'
down_revision: Union[str, Sequence[str], None] = 'd5f7a9b1c3e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "round_types",
        sa.Column("avoids_recent_questions", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute(
        "UPDATE round_types SET avoids_recent_questions = true WHERE slug IN ('coding', 'system-design')"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("round_types", "avoids_recent_questions")
