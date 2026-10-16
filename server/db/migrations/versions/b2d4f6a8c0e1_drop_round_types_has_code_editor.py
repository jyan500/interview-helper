"""drop round_types has_code_editor

Revision ID: b2d4f6a8c0e1
Revises: a1c3e5f7b9d2
Create Date: 2026-10-15

`round_types.has_code_editor` is superseded by `question_types.has_code_editor` (a1c3e5f7b9d2): the editor
follows the QUESTION on the table, so a Practice interview (no round) shows it for a coding question too.
Nothing reads the round flag any more.

Apply (from server/):  .venv/Scripts/python.exe -m alembic upgrade head
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2d4f6a8c0e1'
down_revision: Union[str, Sequence[str], None] = 'a1c3e5f7b9d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_column("round_types", "has_code_editor")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column(
        "round_types",
        sa.Column("has_code_editor", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute("UPDATE round_types SET has_code_editor = true WHERE slug = 'coding'")
    op.alter_column("round_types", "has_code_editor", server_default=None)
