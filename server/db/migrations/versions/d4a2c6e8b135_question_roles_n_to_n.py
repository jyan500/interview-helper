"""question<->role N:N via question_roles

Revision ID: d4a2c6e8b135
Revises: c2e1a4b7d9f0
Create Date: 2026-09-14 00:00:00.000000

THE SHAPE CHANGE: a question used to belong to exactly one role (`questions.role_id`, NOT
NULL) with one global bank position (`questions.sort_order`). This makes it many-to-many:
a new `question_roles` join carries the (question, role) pairing AND the per-role
`sort_order` (a shared question sits in a different place in each role's list, so order can
only live on the pairing). `level_id` deliberately stays on `questions` — seniority is
intrinsic to the question, the same in whatever role asks it.

NON-DESTRUCTIVE UPGRADE: the new table is created, every existing question's single
(role_id, sort_order) is copied into it as one pairing, and only THEN are the two columns
dropped — so no bank data is lost going forward.

LOSSY DOWNGRADE (documented, unavoidable): collapsing N:N back to one column can only keep
ONE role per question. The downgrade picks each question's lowest-sort_order pairing and
drops the rest. If any question has been given a second role by then, that mapping is gone.

RLS: `question_roles` is shared reference data like `question_tags` — enable row-level
security and add the same `FOR SELECT TO authenticated USING (true)` read policy, so the
browser's anon/authenticated role can read it but not write it (seeding runs as postgres,
which bypasses). See the row-level-security migration for the full rationale.

Apply (from server/):   .venv/Scripts/python.exe -m alembic upgrade head
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4a2c6e8b135'
down_revision: Union[str, Sequence[str], None] = 'c2e1a4b7d9f0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # 1. The join table. Surrogate id + unique(question_id, role_id) as the natural key,
    #    both FKs ondelete CASCADE (drop a role or question -> its pairings go too).
    op.create_table(
        'question_roles',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('question_id', sa.Integer(), nullable=False),
        sa.Column('role_id', sa.Integer(), nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['question_id'], ['questions.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['role_id'], ['roles.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('question_id', 'role_id', name='uq_question_role'),
    )
    op.create_index(op.f('ix_question_roles_question_id'), 'question_roles', ['question_id'], unique=False)
    op.create_index(op.f('ix_question_roles_role_id'), 'question_roles', ['role_id'], unique=False)

    # 2. BACKFILL before dropping anything: one pairing per existing question, carrying its
    #    current role and order. created_at/updated_at fall to their column defaults.
    op.execute(
        """
        INSERT INTO question_roles (question_id, role_id, sort_order)
        SELECT id, role_id, sort_order FROM questions
        """
    )

    # 3. RLS for the new table — same read-only-for-signed-in shape as question_tags.
    op.execute("ALTER TABLE public.question_roles ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY question_roles_read ON public.question_roles
            FOR SELECT TO authenticated USING (true)
        """
    )

    # 4. Now retire the old single-role columns on questions.
    op.drop_index(op.f('ix_questions_role_id'), table_name='questions')
    op.drop_constraint('questions_role_id_fkey', 'questions', type_='foreignkey')
    op.drop_column('questions', 'role_id')
    op.drop_column('questions', 'sort_order')


def downgrade() -> None:
    """Downgrade schema. LOSSY: keeps only one role per question (see module docstring)."""
    # 1. Re-add the columns, nullable for now so the backfill can populate them.
    op.add_column('questions', sa.Column('role_id', sa.Integer(), nullable=True))
    op.add_column('questions', sa.Column('sort_order', sa.Integer(), nullable=True))

    # 2. Backfill from the join, keeping each question's lowest-sort_order pairing (ties broken
    #    by the smaller role_id, so the choice is deterministic). Extra pairings are discarded.
    op.execute(
        """
        UPDATE questions q
        SET role_id = keep.role_id, sort_order = keep.sort_order
        FROM (
            SELECT DISTINCT ON (question_id) question_id, role_id, sort_order
            FROM question_roles
            ORDER BY question_id, sort_order, role_id
        ) AS keep
        WHERE keep.question_id = q.id
        """
    )
    # Any question with no pairing at all gets a safe default so NOT NULL can be reimposed.
    op.execute("UPDATE questions SET sort_order = 0 WHERE sort_order IS NULL")

    # 3. Reimpose NOT NULL + the original FK and index.
    op.alter_column('questions', 'sort_order', existing_type=sa.Integer(), nullable=False)
    op.alter_column('questions', 'role_id', existing_type=sa.Integer(), nullable=False)
    op.create_foreign_key(
        'questions_role_id_fkey', 'questions', 'roles',
        ['role_id'], ['id'], ondelete='CASCADE',
    )
    op.create_index(op.f('ix_questions_role_id'), 'questions', ['role_id'], unique=False)

    # 4. Drop the join table (its RLS policy goes with it, but drop explicitly for symmetry).
    op.execute("DROP POLICY IF EXISTS question_roles_read ON public.question_roles")
    op.drop_index(op.f('ix_question_roles_role_id'), table_name='question_roles')
    op.drop_index(op.f('ix_question_roles_question_id'), table_name='question_roles')
    op.drop_table('question_roles')
