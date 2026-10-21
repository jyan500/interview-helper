"""question_types own interview + grading behavior

Revision ID: d7f9b1c3e5a6
Revises: c5e7a9b1d3f4
Create Date: 2026-10-20

PHASE 1 of moving per-kind behavior from `round_types` to `question_types`, so a coding (or
behavioral, or system-design) question is interviewed and graded the same way in a Practice interview
as in a Job interview. ADDITIVE: the new homes are filled, nothing the app reads today is removed.

  1. `question_types` gets `interviewer_guidance`, `max_followups`, `allows_smart_voice`, copied from
     the round of the same kind (slug match; the three kinds line up one-to-one). `seed.py` then
     rewrites the guidance to kind-specific wording.
  2. `rubrics.question_type_id`: the three round rubrics are RE-POINTED to the question type of the
     same kind. Same rubric and dimension rows, so existing Job-interview scorecards keep their
     history. `round_type_id` stays set (still read via RoundType.rubric until grading moves).
  3. `ck_rubric_one_owner` now means role XOR question type.
  4. `round_types.max_followups` / `allows_smart_voice` become nullable: legacy, the seed stops
     supplying them, and a later migration drops them.

Apply (from server/):  .venv/Scripts/python.exe -m alembic upgrade head
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd7f9b1c3e5a6'
down_revision: Union[str, Sequence[str], None] = 'c5e7a9b1d3f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # 1. per-kind behavior on the question type. Added with defaults so existing rows are valid, then
    #    filled from the matching round, then the defaults come off (the seed supplies new rows).
    op.add_column("question_types",
                  sa.Column("interviewer_guidance", sa.Text(), nullable=False, server_default=""))
    op.add_column("question_types",
                  sa.Column("max_followups", sa.Integer(), nullable=False, server_default="3"))
    op.add_column("question_types",
                  sa.Column("allows_smart_voice", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.execute("""
        UPDATE question_types qt
        SET interviewer_guidance = rt.interviewer_guidance,
            max_followups = rt.max_followups,
            allows_smart_voice = rt.allows_smart_voice
        FROM round_types rt
        WHERE rt.slug = qt.slug
    """)
    op.alter_column("question_types", "interviewer_guidance", server_default=None)
    op.alter_column("question_types", "max_followups", server_default=None)
    op.alter_column("question_types", "allows_smart_voice", server_default=None)

    # 2. the rubric's new owner, re-pointing each round rubric to the same-kind question type.
    op.add_column("rubrics", sa.Column("question_type_id", sa.Integer(), nullable=True))
    op.create_foreign_key("rubrics_question_type_id_fkey", "rubrics", "question_types",
                          ["question_type_id"], ["id"], ondelete="CASCADE")
    op.create_unique_constraint("rubrics_question_type_id_key", "rubrics", ["question_type_id"])
    op.execute("""
        UPDATE rubrics r
        SET question_type_id = qt.id
        FROM round_types rt, question_types qt
        WHERE r.round_type_id = rt.id AND qt.slug = rt.slug
    """)

    # 3. one owner: a role (legacy) or a question type.
    op.drop_constraint("ck_rubric_one_owner", "rubrics", type_="check")
    op.create_check_constraint("ck_rubric_one_owner", "rubrics",
                               "(role_id IS NULL) <> (question_type_id IS NULL)")

    # 4. the round's copies become legacy.
    op.alter_column("round_types", "max_followups", existing_type=sa.Integer(), nullable=True)
    op.alter_column("round_types", "allows_smart_voice", existing_type=sa.Boolean(), nullable=True)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("UPDATE round_types SET max_followups = 3 WHERE max_followups IS NULL")
    op.execute("UPDATE round_types SET allows_smart_voice = false WHERE allows_smart_voice IS NULL")
    op.alter_column("round_types", "allows_smart_voice", existing_type=sa.Boolean(), nullable=False)
    op.alter_column("round_types", "max_followups", existing_type=sa.Integer(), nullable=False)

    op.drop_constraint("ck_rubric_one_owner", "rubrics", type_="check")
    op.create_check_constraint("ck_rubric_one_owner", "rubrics",
                               "(role_id IS NULL) <> (round_type_id IS NULL)")
    op.drop_constraint("rubrics_question_type_id_key", "rubrics", type_="unique")
    op.drop_constraint("rubrics_question_type_id_fkey", "rubrics", type_="foreignkey")
    op.drop_column("rubrics", "question_type_id")

    op.drop_column("question_types", "allows_smart_voice")
    op.drop_column("question_types", "max_followups")
    op.drop_column("question_types", "interviewer_guidance")
