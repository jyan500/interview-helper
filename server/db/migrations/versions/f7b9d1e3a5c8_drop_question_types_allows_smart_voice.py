"""drop question_types.allows_smart_voice

Revision ID: f7b9d1e3a5c8
Revises: e5a7c9b1d3f6
Create Date: 2026-11-27

Smart voice mode (Silero VAD silence detection + an auto-submit countdown) was removed from the SPA:
manual tap-to-start / tap-to-stop beat silence detection on reliability, and it only ever applied to
behavioral questions. Every voice answer is manual now, so the per-type flag that decided whether a
question offered smart mode has no reader left. Drop it.

Downgrade re-adds it NOT NULL (default false) and turns it back on for behavioral, the one type that
had it.

Apply (from server/):  .venv/Scripts/python.exe -m alembic upgrade head
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f7b9d1e3a5c8'
down_revision: Union[str, Sequence[str], None] = 'e5a7c9b1d3f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_column('question_types', 'allows_smart_voice')


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column(
        'question_types',
        sa.Column('allows_smart_voice', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute("UPDATE question_types SET allows_smart_voice = true WHERE slug = 'behavioral'")
    op.alter_column('question_types', 'allows_smart_voice', server_default=None)
