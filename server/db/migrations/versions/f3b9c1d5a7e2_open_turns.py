"""open turns: prompt_text, nullable answer, one-open-turn index

Revision ID: f3b9c1d5a7e2
Revises: ebbeeba4648a
Create Date: 2026-08-17

Phase C, the follow-up-transcript fix. A `turns` row used to be written only when an answer
arrived, storing just `question_id` + `answer`. That made the transcript unable to show what a
FOLLOW-UP answer was actually responding to: the probe text lived only in `message_history`
(pydantic-ai JSON), so History fell back to the parent bank question and read confusingly.

This migration turns a turn into an EXCHANGE: born when the interviewer presents a prompt (with
`prompt_text` set, `answer` NULL — an "open" turn), completed when the candidate answers (that
same row's `answer` is filled). See the Turn docstring in models.py.

Three schema changes + two data steps + one guarantee:
  1. ADD `turns.prompt_text` — the exact text presented (bank question, or the probe).
  2. `turns.answer` becomes NULLABLE — NULL now means "presented, not yet answered". (An empty
     answer is the empty STRING, not NULL, so a blank submission still closes the turn.)
  3. BACKFILL `prompt_text` on existing rows from their question's text. Best-effort: old
     follow-up rows had no probe stored, so they read as the bank question — no worse than
     before, and correct for every first-answer row.
  4. SEED one open turn for each IN-PROGRESS interview, so the new "find the open turn" flow has
     something to complete on the next answer. (Completed/old interviews need nothing.)
  5. PARTIAL UNIQUE INDEX `uq_one_open_turn_per_interview` — at most one open turn per
     interview, enforced by the DB. Existing rows all have answers, so there are zero NULLs to
     conflict with; the seed adds exactly one per in-progress interview, so the index is
     satisfiable the moment it's created.

Apply (from server/):  .venv/Scripts/python.exe -m alembic upgrade head
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f3b9c1d5a7e2'
down_revision: Union[str, Sequence[str], None] = 'ebbeeba4648a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # 1. the new column, nullable (old rows won't have it until the backfill below).
    op.add_column("turns", sa.Column("prompt_text", sa.Text(), nullable=True))

    # 2. answer becomes nullable — NULL is now "open turn, awaiting an answer".
    op.alter_column("turns", "answer", existing_type=sa.Text(), nullable=True)

    # 3. backfill prompt_text for existing (answered) rows from their bank question's text.
    op.execute(
        """
        UPDATE turns
           SET prompt_text = q.text
          FROM questions q
         WHERE turns.question_id = q.id
           AND turns.prompt_text IS NULL
        """
    )

    # 4. seed one OPEN turn per in-progress interview so the next answer has a turn to complete.
    #    NOT EXISTS guard keeps it to one (and makes re-running harmless). created_at/updated_at
    #    fill from their server defaults, so they're omitted.
    op.execute(
        """
        INSERT INTO turns (interview_id, question_id, prompt_text, answer)
        SELECT i.id, i.current_question_id, q.text, NULL
          FROM interviews i
          JOIN questions q ON q.id = i.current_question_id
         WHERE i.done = false
           AND i.current_question_id IS NOT NULL
           AND NOT EXISTS (
               SELECT 1 FROM turns t
                WHERE t.interview_id = i.id AND t.answer IS NULL
           )
        """
    )

    # 5. the guarantee: at most one open turn per interview.
    op.create_index(
        "uq_one_open_turn_per_interview",
        "turns",
        ["interview_id"],
        unique=True,
        postgresql_where=sa.text("answer IS NULL"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    # drop the guarantee first, then remove the open (NULL-answer) turns that the NOT NULL
    # constraint below could not tolerate, then reverse the column changes.
    op.drop_index("uq_one_open_turn_per_interview", table_name="turns")
    op.execute("DELETE FROM turns WHERE answer IS NULL")
    op.alter_column("turns", "answer", existing_type=sa.Text(), nullable=False)
    op.drop_column("turns", "prompt_text")
