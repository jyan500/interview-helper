"""diagram canvas

Revision ID: c3e7a1d9f5b2
Revises: b9d4f2a6c8e1
Create Date: 2026-10-06

The system-design diagram canvas. Two columns:

- `question_types.has_diagram_canvas`: whether the SPA shows the canvas while a question of this kind
  is on the table. On the question's TYPE, not the round, so Practice interviews (which mix kinds)
  get it per question. Backfilled true for `system-design` here, not left to a re-seed.
- `turns.diagram`: the latest diagram (a diagram.DiagramDoc dump) sent while the turn was open.

Apply (from server/):  .venv/Scripts/python.exe -m alembic upgrade head
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c3e7a1d9f5b2'
down_revision: Union[str, Sequence[str], None] = 'b9d4f2a6c8e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "question_types",
        sa.Column("has_diagram_canvas", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute("UPDATE question_types SET has_diagram_canvas = true WHERE slug = 'system-design'")
    op.alter_column("question_types", "has_diagram_canvas", server_default=None)
    op.add_column("turns", sa.Column("diagram", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("turns", "diagram")
    op.drop_column("question_types", "has_diagram_canvas")
