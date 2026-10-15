"""user-authored questions

Revision ID: f6b1d3e5a7c9
Revises: e2a4c6b8d0f1
Create Date: 2026-10-14

Users can write their own practice questions. Three nullable columns on `questions`:
- `profile_id`: the author (NULL for bank and generated questions). CHECK: a row is never both a
  job's generated question and a user's own.
- `grading_notes`: the author's optional "how should this be graded" note, which guides the
  LLM-written brief.
- `archived_at`: soft delete, since turns and scorecard entries keep FKs to the row.

`questions_read` gains an owner clause: bank rows (no job, no author) for everyone signed in, a
generated row for its job's owner, a user-written row for its author.

Apply (from server/):  .venv/Scripts/python.exe -m alembic upgrade head
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f6b1d3e5a7c9'
down_revision: Union[str, Sequence[str], None] = 'e2a4c6b8d0f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("questions", sa.Column("profile_id", sa.Uuid(), nullable=True))
    op.add_column("questions", sa.Column("grading_notes", sa.Text(), nullable=True))
    op.add_column("questions", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(op.f("ix_questions_profile_id"), "questions", ["profile_id"], unique=False)
    op.create_foreign_key(
        "fk_questions_profile_id", "questions", "profiles", ["profile_id"], ["id"], ondelete="CASCADE"
    )
    op.create_check_constraint(
        "ck_question_job_or_author", "questions", "job_id IS NULL OR profile_id IS NULL"
    )

    op.execute("DROP POLICY IF EXISTS questions_read ON public.questions")
    op.execute(
        """
        CREATE POLICY questions_read ON public.questions
            FOR SELECT TO authenticated
            USING (
                (job_id IS NULL AND profile_id IS NULL)
                OR profile_id = (SELECT auth.uid())
                OR EXISTS (
                    SELECT 1 FROM public.jobs j
                    WHERE j.id = questions.job_id AND j.profile_id = (SELECT auth.uid())
                )
            )
        """
    )


def downgrade() -> None:
    """Downgrade schema."""
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
    # user-written questions can't survive losing their owner column (briefs/roles cascade)
    op.execute("DELETE FROM public.questions WHERE profile_id IS NOT NULL")
    op.drop_constraint("ck_question_job_or_author", "questions", type_="check")
    op.drop_constraint("fk_questions_profile_id", "questions", type_="foreignkey")
    op.drop_index(op.f("ix_questions_profile_id"), table_name="questions")
    op.drop_column("questions", "archived_at")
    op.drop_column("questions", "grading_notes")
    op.drop_column("questions", "profile_id")
