"""profile onboarding: profiles.onboarding_dismissed_at

Revision ID: b3d5f7a9c1e2
Revises: a1c3e5f7b9d0
Create Date: 2026-10-31

The dashboard's "Getting started" checklist shows for a NEW user until they hide it:

  1. `profiles.onboarding_dismissed_at` (nullable): when they hid it. NULL = showing. The signup
     trigger doesn't set it, so every profile created from here on starts NULL.
  2. BACKFILL every existing profile to now(), so only accounts created after this migration see
     the checklist. (Anyone can bring it back from the nav's "Getting started" button.)

Apply (from server/):  .venv/Scripts/python.exe -m alembic upgrade head
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3d5f7a9c1e2'
down_revision: Union[str, Sequence[str], None] = 'a1c3e5f7b9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('profiles', sa.Column('onboarding_dismissed_at', sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE profiles SET onboarding_dismissed_at = now()")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('profiles', 'onboarding_dismissed_at')
