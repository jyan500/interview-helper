"""round_types allows_smart_voice

Revision ID: a6c8e0f2b4d7
Revises: e4b8d2f6a1c3
Create Date: 2026-09-28

Whether a round offers "smart" voice turn-taking (VAD notices silence -> "still there?" countdown ->
auto-submit) and, when it does, opens in it. Coding and system-design rounds are MANUAL-ONLY: the
candidate thinks for long stretches, and those pauses blow past the silence threshold and submit a
half-answer. Behavioral is conversational, so it defaults to smart (manual still selectable).

A flag on the row — like has_code_editor — so the SPA never branches on a round slug.

BACKFILLED HERE, not left to a re-seed: the column lands false everywhere (the safe, manual-only
value), then behavioral is flipped on, so a deploy is correct even before `seed.py` runs again.

Apply (from server/):  .venv/Scripts/python.exe -m alembic upgrade head
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a6c8e0f2b4d7'
down_revision: Union[str, Sequence[str], None] = 'e4b8d2f6a1c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "round_types",
        sa.Column("allows_smart_voice", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute("UPDATE round_types SET allows_smart_voice = true WHERE slug = 'behavioral'")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("round_types", "allows_smart_voice")
