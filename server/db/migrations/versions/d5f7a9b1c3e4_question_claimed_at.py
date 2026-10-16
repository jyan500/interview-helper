"""question claimed_at

Revision ID: d5f7a9b1c3e4
Revises: c4e6a8b0d2f3
Create Date: 2026-10-15

`questions.claimed_at`: set when a user CLAIMS a generated (job) question ("Save to My questions" on
the interview detail page). The claim moves the row from the job to the user (`job_id` -> NULL,
`profile_id` -> the user), so without this stamp it would look exactly like a question the user wrote.
A claimed question is READ-ONLY: the job interview it came from still reads its title, text, and brief,
so an edit would rewrite that interview's history.

Apply (from server/):  .venv/Scripts/python.exe -m alembic upgrade head
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd5f7a9b1c3e4'
down_revision: Union[str, Sequence[str], None] = 'c4e6a8b0d2f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("questions", sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("questions", "claimed_at")
