"""question_types has_code_editor

Revision ID: a1c3e5f7b9d2
Revises: f6b1d3e5a7c9
Create Date: 2026-10-15

`question_types.has_code_editor`: whether the SPA shows the code editor while a question of this kind
is on the table. On the question's TYPE, like has_diagram_canvas, because a Practice interview has no
round to carry the flag and can mix a coding question (a candidate's own) in among other kinds.

Added false, then `coding` is flipped on here, so a deploy is correct even before `seed.py` runs again.

Apply (from server/):  .venv/Scripts/python.exe -m alembic upgrade head
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1c3e5f7b9d2'
down_revision: Union[str, Sequence[str], None] = 'f6b1d3e5a7c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "question_types",
        sa.Column("has_code_editor", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute("UPDATE question_types SET has_code_editor = true WHERE slug = 'coding'")
    op.alter_column("question_types", "has_code_editor", server_default=None)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("question_types", "has_code_editor")
