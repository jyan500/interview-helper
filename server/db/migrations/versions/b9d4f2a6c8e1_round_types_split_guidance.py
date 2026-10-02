"""round_types split guidance

Revision ID: b9d4f2a6c8e1
Revises: a6c8e0f2b4d7
Create Date: 2026-09-30

`guidance` fed TWO readers: the question generator (round_agent) and the per-turn interviewer persona.
The behavioral text said "Ask these four questions, in this order", which is right for the generator
but read as an order by the interviewer, so it asked the next planned question itself inside its
reaction, right before the client presented the real one. Now each reader gets its own column:
`question_guidance` (round_agent) and `interviewer_guidance` (persona).

BACKFILLED HERE, not left to a re-seed: every seeded guidance splits at "Interviewer style:", so the
text before it becomes question_guidance and the text after it interviewer_guidance. A row without
the marker keeps all its text as question_guidance and gets an empty interviewer_guidance. Re-run
`seed.py` afterwards to pick up the reworded text in data/questions.json.

Apply (from server/):  .venv/Scripts/python.exe -m alembic upgrade head
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b9d4f2a6c8e1'
down_revision: Union[str, Sequence[str], None] = 'a6c8e0f2b4d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MARKER = "Interviewer style:"


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "round_types",
        sa.Column("interviewer_guidance", sa.Text(), nullable=False, server_default=""),
    )
    op.execute(f"""
        UPDATE round_types
        SET interviewer_guidance = trim(substring(guidance from position('{MARKER}' in guidance)
                                                  + length('{MARKER}'))),
            guidance = trim(substring(guidance for position('{MARKER}' in guidance) - 1))
        WHERE position('{MARKER}' in guidance) > 0
    """)
    op.alter_column("round_types", "interviewer_guidance", server_default=None)
    op.alter_column("round_types", "guidance", new_column_name="question_guidance")


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column("round_types", "question_guidance", new_column_name="guidance")
    op.execute(f"""
        UPDATE round_types
        SET guidance = guidance || ' {MARKER} ' || interviewer_guidance
        WHERE interviewer_guidance <> ''
    """)
    op.drop_column("round_types", "interviewer_guidance")
