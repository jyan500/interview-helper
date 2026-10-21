"""drop technical + product-sense question types and the product-manager role

Revision ID: c5e7a9b1d3f4
Revises: b4d6f8a0c2e3
Create Date: 2026-10-20

DATA-ONLY cleanup ahead of moving per-kind interview + grading behavior onto `question_types`. The
product now covers behavioral, coding, and system-design questions, so:
  * the `technical` and `product-sense` question types go, with every question of those types
    (bank or custom) and its brief, tag and role pairings;
  * the `product-manager` role goes, with its rubric and any bank question paired ONLY with it
    (pm-1: a behavioral question that would otherwise be left with no role, so no bank read sees it);
  * every interview that touched one of those questions (plan, turn, current question, or scorecard
    entry) or ran on that role is deleted, with its turns, plan and scorecard (they cascade).

Order matters: the doomed question ids are collected FIRST, while `question_roles` still says which
questions belong only to the PM role. The interviews go before the questions and the role, because
`turns.question_id`, `scorecard_entries.question_id`, `interviews.current_question_id` and
`interviews.role_id` don't cascade.

NOT REVERSIBLE: downgrade is a no-op. The bank rows come back from `python -m db.seed` only if
questions.json still had them (it doesn't); the deleted interviews are gone.

Apply (from server/):  .venv/Scripts/python.exe -m alembic upgrade head
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c5e7a9b1d3f4'
down_revision: Union[str, Sequence[str], None] = 'b4d6f8a0c2e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # 1. the questions to drop: every question of a dropped type, plus bank questions paired only
    #    with the PM role (no other role, not a custom or generated question).
    op.execute("""
        CREATE TEMP TABLE dropped_questions ON COMMIT DROP AS
        SELECT q.id FROM questions q
        JOIN question_types t ON t.id = q.type_id
        WHERE t.slug IN ('technical', 'product-sense')
        UNION
        SELECT q.id FROM questions q
        WHERE q.profile_id IS NULL AND q.job_id IS NULL
          AND EXISTS (
              SELECT 1 FROM question_roles qr JOIN roles r ON r.id = qr.role_id
              WHERE qr.question_id = q.id AND r.slug = 'product-manager')
          AND NOT EXISTS (
              SELECT 1 FROM question_roles qr JOIN roles r ON r.id = qr.role_id
              WHERE qr.question_id = q.id AND r.slug <> 'product-manager')
    """)

    # 2. the interviews that touched one of them, or ran on the PM role. Turns, plan rows and the
    #    scorecard (entries, scores) cascade from the interview.
    op.execute("""
        DELETE FROM interviews
        WHERE role_id IN (SELECT id FROM roles WHERE slug = 'product-manager')
           OR current_question_id IN (SELECT id FROM dropped_questions)
           OR id IN (SELECT interview_id FROM turns
                     WHERE question_id IN (SELECT id FROM dropped_questions))
           OR id IN (SELECT interview_id FROM interview_questions
                     WHERE question_id IN (SELECT id FROM dropped_questions))
           OR id IN (SELECT s.interview_id FROM scorecards s
                     JOIN scorecard_entries e ON e.scorecard_id = s.id
                     WHERE e.question_id IN (SELECT id FROM dropped_questions))
    """)

    # 3. the questions. Briefs, tag links, role pairings and saved-set rows cascade.
    op.execute("DELETE FROM questions WHERE id IN (SELECT id FROM dropped_questions)")

    # 4. the vocabulary rows. The PM rubric and its dimensions cascade from the role; a profile
    #    defaulting to it is SET NULL. A job on the PM role would block this (no cascade) on purpose.
    op.execute("DELETE FROM question_types WHERE slug IN ('technical', 'product-sense')")
    op.execute("DELETE FROM roles WHERE slug = 'product-manager'")


def downgrade() -> None:
    """Downgrade schema: nothing to do — this migration only deletes data."""
