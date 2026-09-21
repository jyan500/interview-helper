"""saved and planned questions

Revision ID: c7d9e1f3a5b2
Revises: b7e3f1c9a204
Create Date: 2026-09-18 00:00:00.000000

WHY: the bank grew large enough that "ask every question at or below the level" is no longer a
sensible interview. Two tables give the candidate control over what's asked:

  profile_questions   the candidate's durable "My questions" set — a plain N:N of profile to
                      question (NO role/level columns; both are derived by joining to the question).
  interview_questions the FROZEN plan for one interview: the ordered subset it will actually ask,
                      materialized once at kickoff from the saved set (or a random default). The
                      join table the Interview.asked_question_ids docstring predicted.

RLS (same defence-in-depth as the row-level-security migration): both tables are user-scoped, so
enable RLS and add owner policies. `profile_questions` is the direct case (`auth.uid() = profile_id`,
exactly like `interviews`); `interview_questions` is the indirect case (owned through its interview,
exactly like `turns`). Seeding/kickoff run as postgres, which bypasses RLS — these are for the anon
key that ships in the browser bundle.

Apply (from server/):   .venv/Scripts/python.exe -m alembic upgrade head
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7d9e1f3a5b2'
down_revision: Union[str, Sequence[str], None] = 'b7e3f1c9a204'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # -----------------------------------------------------------------------
    # 1. profile_questions — the saved "My questions" set. Surrogate id + unique(profile_id,
    #    question_id) as the natural key; both FKs ondelete CASCADE.
    # -----------------------------------------------------------------------
    op.create_table(
        'profile_questions',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('profile_id', sa.Uuid(), nullable=False),
        sa.Column('question_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['profile_id'], ['profiles.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['question_id'], ['questions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('profile_id', 'question_id', name='uq_profile_question'),
    )
    op.create_index(op.f('ix_profile_questions_profile_id'), 'profile_questions', ['profile_id'], unique=False)
    op.create_index(op.f('ix_profile_questions_question_id'), 'profile_questions', ['question_id'], unique=False)

    # -----------------------------------------------------------------------
    # 2. interview_questions — the frozen per-interview plan. Two unique constraints: a question
    #    can't appear twice in a plan, and two questions can't share a position.
    # -----------------------------------------------------------------------
    op.create_table(
        'interview_questions',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('interview_id', sa.Integer(), nullable=False),
        sa.Column('question_id', sa.Integer(), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['interview_id'], ['interviews.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['question_id'], ['questions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('interview_id', 'question_id', name='uq_interview_question'),
        sa.UniqueConstraint('interview_id', 'position', name='uq_interview_question_position'),
    )
    op.create_index(op.f('ix_interview_questions_interview_id'), 'interview_questions', ['interview_id'], unique=False)
    op.create_index(op.f('ix_interview_questions_question_id'), 'interview_questions', ['question_id'], unique=False)

    # -----------------------------------------------------------------------
    # 3. RLS. profile_questions is the DIRECT-ownership case (profile_id holds the auth uid),
    #    the same one-line comparison as interviews_own.
    # -----------------------------------------------------------------------
    op.execute("ALTER TABLE public.profile_questions ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY profile_questions_own ON public.profile_questions
            FOR ALL TO authenticated
            USING (auth.uid() = profile_id)
            WITH CHECK (auth.uid() = profile_id)
        """
    )

    # interview_questions is the INDIRECT case: owned through its interview, exactly like turns.
    op.execute("ALTER TABLE public.interview_questions ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY interview_questions_own ON public.interview_questions
            FOR ALL TO authenticated
            USING (
                EXISTS (
                    SELECT 1 FROM public.interviews i
                    WHERE i.id = interview_questions.interview_id AND i.profile_id = (SELECT auth.uid())
                )
            )
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM public.interviews i
                    WHERE i.id = interview_questions.interview_id AND i.profile_id = (SELECT auth.uid())
                )
            )
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP POLICY IF EXISTS interview_questions_own ON public.interview_questions")
    op.execute("DROP POLICY IF EXISTS profile_questions_own ON public.profile_questions")

    op.drop_index(op.f('ix_interview_questions_question_id'), table_name='interview_questions')
    op.drop_index(op.f('ix_interview_questions_interview_id'), table_name='interview_questions')
    op.drop_table('interview_questions')

    op.drop_index(op.f('ix_profile_questions_question_id'), table_name='profile_questions')
    op.drop_index(op.f('ix_profile_questions_profile_id'), table_name='profile_questions')
    op.drop_table('profile_questions')
