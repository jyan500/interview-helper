"""candidate background

Revision ID: d8f2b4a6c0e3
Revises: c3e7a1d9f5b2
Create Date: 2026-10-12

WHY: behavioral interviews should be able to draw on the candidate's real career — ask about a role
they held or a project they shipped, and tie it to the job description. The Profile page collects it:

  profile_experiences  past/current roles: title, company, month-granular start/end, what they did.
  profile_projects     projects: name, description, optional URL. Independent of experiences.
  skills               a CURATED skill vocabulary, filled by db/seed.py from data/skills.json.
                       Candidates pick from it; they can't add to it.
  profile_skills       the N:N of profile to skill (shaped like profile_questions).

RLS (defence in depth, as everywhere): the three profile-owned tables are the DIRECT-ownership case
(`auth.uid() = profile_id`, like jobs); `skills` is public-read vocab, written only by the backend
(postgres bypasses RLS).

Apply (from server/):  .venv/Scripts/python.exe -m alembic upgrade head
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd8f2b4a6c0e3'
down_revision: Union[str, Sequence[str], None] = 'c3e7a1d9f5b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


OWNED_TABLES = ("profile_experiences", "profile_projects", "profile_skills")


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    ]


def upgrade() -> None:
    """Upgrade schema."""
    # -----------------------------------------------------------------------
    # 1. profile_experiences — one row per role.
    # -----------------------------------------------------------------------
    op.create_table(
        'profile_experiences',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('slug', sa.String(length=32), nullable=False),
        sa.Column('profile_id', sa.Uuid(), nullable=False),
        sa.Column('title', sa.String(length=128), nullable=False),
        sa.Column('company', sa.String(length=128), nullable=False),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('description', sa.Text(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(['profile_id'], ['profiles.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_profile_experiences_slug'), 'profile_experiences', ['slug'], unique=True)
    op.create_index(op.f('ix_profile_experiences_profile_id'), 'profile_experiences', ['profile_id'], unique=False)

    # -----------------------------------------------------------------------
    # 2. profile_projects — one row per project.
    # -----------------------------------------------------------------------
    op.create_table(
        'profile_projects',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('slug', sa.String(length=32), nullable=False),
        sa.Column('profile_id', sa.Uuid(), nullable=False),
        sa.Column('name', sa.String(length=128), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('url', sa.String(length=512), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(['profile_id'], ['profiles.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_profile_projects_slug'), 'profile_projects', ['slug'], unique=True)
    op.create_index(op.f('ix_profile_projects_profile_id'), 'profile_projects', ['profile_id'], unique=False)

    # -----------------------------------------------------------------------
    # 3. skills (vocab) + profile_skills (N:N).
    # -----------------------------------------------------------------------
    op.create_table(
        'skills',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('slug', sa.String(length=64), nullable=False),
        sa.Column('name', sa.String(length=64), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_skills_slug'), 'skills', ['slug'], unique=True)

    op.create_table(
        'profile_skills',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('profile_id', sa.Uuid(), nullable=False),
        sa.Column('skill_id', sa.Integer(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(['profile_id'], ['profiles.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['skill_id'], ['skills.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('profile_id', 'skill_id', name='uq_profile_skill'),
    )
    op.create_index(op.f('ix_profile_skills_profile_id'), 'profile_skills', ['profile_id'], unique=False)
    op.create_index(op.f('ix_profile_skills_skill_id'), 'profile_skills', ['skill_id'], unique=False)

    # -----------------------------------------------------------------------
    # 4. RLS. The owned tables are the direct case, like jobs_own; skills is public-read vocab.
    # -----------------------------------------------------------------------
    for table in OWNED_TABLES:
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"""
            CREATE POLICY {table}_own ON public.{table}
                FOR ALL TO authenticated
                USING (auth.uid() = profile_id)
                WITH CHECK (auth.uid() = profile_id)
            """
        )

    op.execute("ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY skills_read ON public.skills
            FOR SELECT TO authenticated USING (true)
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP POLICY IF EXISTS skills_read ON public.skills")
    for table in OWNED_TABLES:
        op.execute(f"DROP POLICY IF EXISTS {table}_own ON public.{table}")

    op.drop_index(op.f('ix_profile_skills_skill_id'), table_name='profile_skills')
    op.drop_index(op.f('ix_profile_skills_profile_id'), table_name='profile_skills')
    op.drop_table('profile_skills')

    op.drop_index(op.f('ix_skills_slug'), table_name='skills')
    op.drop_table('skills')

    op.drop_index(op.f('ix_profile_projects_profile_id'), table_name='profile_projects')
    op.drop_index(op.f('ix_profile_projects_slug'), table_name='profile_projects')
    op.drop_table('profile_projects')

    op.drop_index(op.f('ix_profile_experiences_profile_id'), table_name='profile_experiences')
    op.drop_index(op.f('ix_profile_experiences_slug'), table_name='profile_experiences')
    op.drop_table('profile_experiences')
