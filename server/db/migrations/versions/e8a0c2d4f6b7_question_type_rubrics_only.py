"""question-type rubrics only: drop role rubrics and the legacy round/interview columns

Revision ID: e8a0c2d4f6b7
Revises: d7f9b1c3e5a6
Create Date: 2026-10-20

PHASE 3 (final) of moving per-kind behavior to `question_types`. Grading now reads each answer's
QUESTION TYPE rubric and the turn loop reads the type's follow-up budget and voice mode, so the old
owners go:

  1. "Company and role fit" leaves the behavioral rubric (it can't be graded in a Practice interview,
     which has no company): its scores on past Job scorecards are deleted, then the dimension.
  2. Practice scorecards from before the change are deleted: those graded on a ROLE rubric, and those
     with no entries at all (the fake `seed-*` dashboard rows). The interviews and transcripts stay,
     just ungraded. Job scorecards are untouched (they were graded on round rubrics, now the types').
  3. The role rubrics go (their dimensions cascade), then `rubrics.role_id`, `rubrics.round_type_id`
     and `ck_rubric_one_owner`; `rubrics.question_type_id` becomes NOT NULL, the sole owner.
  4. `round_types.max_followups` / `allows_smart_voice` and `interviews.max_followups` are dropped:
     the cap and the voice mode are read off the current question's type.

Downgrade restores the SCHEMA only (columns nullable or defaulted, round_type_id re-pointed by slug),
not the deleted rows.

Apply (from server/):  .venv/Scripts/python.exe -m alembic upgrade head
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e8a0c2d4f6b7'
down_revision: Union[str, Sequence[str], None] = 'd7f9b1c3e5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # 1. "Company and role fit": its scores first (scorecard_entry_scores.dimension_id has no cascade).
    op.execute("""
        DELETE FROM scorecard_entry_scores
        WHERE dimension_id IN (SELECT id FROM rubric_dimensions WHERE name = 'Company and role fit')
    """)
    op.execute("DELETE FROM rubric_dimensions WHERE name = 'Company and role fit'")

    # 2. old Practice scorecards: any with a score on a role-rubric dimension, and Practice ones with no
    #    entries. Entries and scores cascade from the scorecard.
    op.execute("""
        DELETE FROM scorecards
        WHERE id IN (
            SELECT e.scorecard_id FROM scorecard_entries e
            JOIN scorecard_entry_scores x ON x.entry_id = e.id
            JOIN rubric_dimensions d ON d.id = x.dimension_id
            JOIN rubrics r ON r.id = d.rubric_id
            WHERE r.role_id IS NOT NULL)
        OR (NOT EXISTS (SELECT 1 FROM scorecard_entries e WHERE e.scorecard_id = scorecards.id)
            AND interview_id IN (SELECT id FROM interviews WHERE job_id IS NULL))
    """)

    # 3. the role rubrics (dimensions cascade; no score points at them any more), then the old owners.
    op.execute("DELETE FROM rubrics WHERE role_id IS NOT NULL")
    op.drop_constraint("ck_rubric_one_owner", "rubrics", type_="check")
    op.drop_column("rubrics", "role_id")
    op.drop_column("rubrics", "round_type_id")
    op.alter_column("rubrics", "question_type_id", existing_type=sa.Integer(), nullable=False)

    # 4. the copies the question type now owns.
    op.drop_column("round_types", "max_followups")
    op.drop_column("round_types", "allows_smart_voice")
    op.drop_column("interviews", "max_followups")


def downgrade() -> None:
    """Downgrade schema (not the deleted rows)."""
    op.add_column("interviews",
                  sa.Column("max_followups", sa.Integer(), nullable=False, server_default="3"))
    op.add_column("round_types", sa.Column("allows_smart_voice", sa.Boolean(), nullable=True))
    op.add_column("round_types", sa.Column("max_followups", sa.Integer(), nullable=True))

    op.alter_column("rubrics", "question_type_id", existing_type=sa.Integer(), nullable=True)
    op.add_column("rubrics", sa.Column("round_type_id", sa.Integer(), nullable=True))
    op.create_foreign_key("rubrics_round_type_id_fkey", "rubrics", "round_types",
                          ["round_type_id"], ["id"], ondelete="CASCADE")
    op.create_unique_constraint("rubrics_round_type_id_key", "rubrics", ["round_type_id"])
    op.execute("""
        UPDATE rubrics r
        SET round_type_id = rt.id
        FROM question_types qt, round_types rt
        WHERE r.question_type_id = qt.id AND rt.slug = qt.slug
    """)
    op.add_column("rubrics", sa.Column("role_id", sa.Integer(), nullable=True))
    op.create_foreign_key("rubrics_role_id_fkey", "rubrics", "roles",
                          ["role_id"], ["id"], ondelete="CASCADE")
    op.create_unique_constraint("rubrics_role_id_key", "rubrics", ["role_id"])
    op.create_check_constraint("ck_rubric_one_owner", "rubrics",
                               "(role_id IS NULL) <> (question_type_id IS NULL)")
