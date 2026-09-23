"""jobs and round types

Revision ID: e4b8d2f6a1c3
Revises: c7d9e1f3a5b2
Create Date: 2026-09-22 00:00:00.000000

WHY: interview SIMULATION. The candidate pastes a job description (saved as a `jobs` row) and runs a
round of that company's interview — behavioral, coding, or system design — whose questions the LLM
generates from the JD. This migration is the schema half; no LLM is involved here.

  round_types     the round FORMATS (vocab): plan size, probe budget, the guidance prose the
                  generator + interviewer read, and whether the SPA shows a code editor. Its own
                  table, NOT question_types — a round is a format that may mix question kinds.
  jobs            the saved JD + what the extractor pulled out of it (company, title, summary, and
                  the role/level mapped onto existing vocab). Owner-scoped.
  questions.job_id        generated questions are ordinary question rows tagged with their job, so
                          the plan/turn/grade pipeline runs unchanged. NULL for the whole bank.
  interviews.job_id       which job a simulated round belongs to (CASCADE with the job).
  interviews.round_type_id which round it was.
  rubrics.round_type_id   a round is graded on its own rubric; `role_id` becomes nullable and a
                          CHECK keeps exactly one owner set.

RLS:
  - jobs: direct ownership (`auth.uid() = profile_id`), exactly like interviews.
  - round_types: public read, like the other vocab tables.
  - questions: WAS public read (`USING (true)`). Generated questions carry JD-derived content, so the
    policy narrows to "bank questions, plus generated ones for a job you own".
  - reference_briefs needs nothing: it's already grader-only (RLS on, no policy = deny all).
The backend connects as postgres (BYPASSRLS); these are the anon-key defence in depth.

Apply (from server/):   .venv/Scripts/python.exe -m alembic upgrade head
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e4b8d2f6a1c3'
down_revision: Union[str, Sequence[str], None] = 'c7d9e1f3a5b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # -----------------------------------------------------------------------
    # 1. round_types — vocab. Rows come from the seed (data/questions.json "rounds").
    # -----------------------------------------------------------------------
    op.create_table(
        'round_types',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('slug', sa.String(length=32), nullable=False),
        sa.Column('name', sa.String(length=64), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('guidance', sa.Text(), nullable=False),
        sa.Column('plan_size', sa.Integer(), nullable=False),
        sa.Column('max_followups', sa.Integer(), nullable=False),
        sa.Column('has_code_editor', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_round_types_slug'), 'round_types', ['slug'], unique=True)

    # -----------------------------------------------------------------------
    # 2. jobs — the saved JD. Owned directly by a profile (CASCADE with it).
    # -----------------------------------------------------------------------
    op.create_table(
        'jobs',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('slug', sa.String(length=32), nullable=False),
        sa.Column('profile_id', sa.Uuid(), nullable=False),
        sa.Column('company', sa.String(length=256), nullable=False),
        sa.Column('title', sa.String(length=256), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('summary', sa.Text(), nullable=False),
        sa.Column('role_id', sa.Integer(), nullable=False),
        sa.Column('level_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['profile_id'], ['profiles.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['role_id'], ['roles.id']),
        sa.ForeignKeyConstraint(['level_id'], ['levels.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_jobs_slug'), 'jobs', ['slug'], unique=True)
    op.create_index(op.f('ix_jobs_profile_id'), 'jobs', ['profile_id'], unique=False)
    op.create_index(op.f('ix_jobs_role_id'), 'jobs', ['role_id'], unique=False)

    # -----------------------------------------------------------------------
    # 3. The new FK columns. All nullable — every existing row is a bank question / bank interview.
    # -----------------------------------------------------------------------
    op.add_column('questions', sa.Column('job_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_questions_job_id', 'questions', 'jobs', ['job_id'], ['id'], ondelete='CASCADE')
    op.create_index(op.f('ix_questions_job_id'), 'questions', ['job_id'], unique=False)

    op.add_column('interviews', sa.Column('job_id', sa.Integer(), nullable=True))
    op.add_column('interviews', sa.Column('round_type_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_interviews_job_id', 'interviews', 'jobs', ['job_id'], ['id'], ondelete='CASCADE')
    op.create_foreign_key('fk_interviews_round_type_id', 'interviews', 'round_types', ['round_type_id'], ['id'])
    op.create_index(op.f('ix_interviews_job_id'), 'interviews', ['job_id'], unique=False)

    # -----------------------------------------------------------------------
    # 4. rubrics: role-owned OR round-owned. Every existing rubric has a role, so the CHECK holds
    #    for all current rows the moment it's added.
    # -----------------------------------------------------------------------
    op.add_column('rubrics', sa.Column('round_type_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_rubrics_round_type_id', 'rubrics', 'round_types', ['round_type_id'], ['id'], ondelete='CASCADE')
    op.create_unique_constraint('uq_rubrics_round_type_id', 'rubrics', ['round_type_id'])
    op.alter_column('rubrics', 'role_id', existing_type=sa.Integer(), nullable=True)
    op.create_check_constraint(
        'ck_rubric_one_owner', 'rubrics', '(role_id IS NULL) <> (round_type_id IS NULL)'
    )

    # -----------------------------------------------------------------------
    # 5. RLS.
    # -----------------------------------------------------------------------
    op.execute("ALTER TABLE public.round_types ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY round_types_read ON public.round_types
            FOR SELECT TO authenticated USING (true)
        """
    )

    op.execute("ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY jobs_own ON public.jobs
            FOR ALL TO authenticated
            USING (auth.uid() = profile_id)
            WITH CHECK (auth.uid() = profile_id)
        """
    )

    # questions: bank rows stay readable by everyone signed in; a generated row only by its job's
    # owner. Replaces the blanket `USING (true)` from the row-level-security migration.
    op.execute("DROP POLICY IF EXISTS questions_read ON public.questions")
    op.execute(
        """
        CREATE POLICY questions_read ON public.questions
            FOR SELECT TO authenticated
            USING (
                job_id IS NULL
                OR EXISTS (
                    SELECT 1 FROM public.jobs j
                    WHERE j.id = questions.job_id AND j.profile_id = (SELECT auth.uid())
                )
            )
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    # questions policy back to the blanket read
    op.execute("DROP POLICY IF EXISTS questions_read ON public.questions")
    op.execute(
        """
        CREATE POLICY questions_read ON public.questions
            FOR SELECT TO authenticated USING (true)
        """
    )
    op.execute("DROP POLICY IF EXISTS jobs_own ON public.jobs")
    op.execute("DROP POLICY IF EXISTS round_types_read ON public.round_types")

    # round-owned rubrics can't survive `role_id` going back to NOT NULL (dimensions cascade)
    op.drop_constraint('ck_rubric_one_owner', 'rubrics', type_='check')
    op.execute("DELETE FROM public.rubrics WHERE round_type_id IS NOT NULL")
    op.alter_column('rubrics', 'role_id', existing_type=sa.Integer(), nullable=False)
    op.drop_constraint('uq_rubrics_round_type_id', 'rubrics', type_='unique')
    op.drop_constraint('fk_rubrics_round_type_id', 'rubrics', type_='foreignkey')
    op.drop_column('rubrics', 'round_type_id')

    # simulation interviews + generated questions go with their jobs (the FKs cascade)
    op.execute("DELETE FROM public.jobs")

    op.drop_index(op.f('ix_interviews_job_id'), table_name='interviews')
    op.drop_constraint('fk_interviews_round_type_id', 'interviews', type_='foreignkey')
    op.drop_constraint('fk_interviews_job_id', 'interviews', type_='foreignkey')
    op.drop_column('interviews', 'round_type_id')
    op.drop_column('interviews', 'job_id')

    op.drop_index(op.f('ix_questions_job_id'), table_name='questions')
    op.drop_constraint('fk_questions_job_id', 'questions', type_='foreignkey')
    op.drop_column('questions', 'job_id')

    op.drop_index(op.f('ix_jobs_role_id'), table_name='jobs')
    op.drop_index(op.f('ix_jobs_profile_id'), table_name='jobs')
    op.drop_index(op.f('ix_jobs_slug'), table_name='jobs')
    op.drop_table('jobs')

    op.drop_index(op.f('ix_round_types_slug'), table_name='round_types')
    op.drop_table('round_types')
