"""question title

Revision ID: c4e6a8b0d2f3
Revises: b2d4f6a8c0e1
Create Date: 2026-10-15

`questions.title`: a short display name, so a list row can show the question without its full text.
NOT NULL, so every existing row is backfilled first:
- bank rows from BANK_TITLES (a frozen copy of the titles authored in data/questions.json; the seed
  writes them for a fresh database)
- every other row (generated, user-written, any bank slug not listed) from its own text, cut to 80
  characters at a word boundary

Apply (from server/):  .venv/Scripts/python.exe -m alembic upgrade head
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4e6a8b0d2f3'
down_revision: Union[str, Sequence[str], None] = 'b2d4f6a8c0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


BANK_TITLES = {
    "be-1": "Debugging production under pressure",
    "be-2": "Rate limiter for a public API",
    "be-3": "Optimistic vs pessimistic locking",
    "sd-bitly": "URL shortener (Bitly)",
    "sd-ticketmaster": "Ticket booking (Ticketmaster)",
    "sd-fb-news-feed": "News feed (Facebook)",
    "sd-whatsapp": "Real-time chat (WhatsApp)",
    "sd-youtube": "Video streaming (YouTube)",
    "sd-dropbox": "File storage and sync (Dropbox)",
    "sd-gopuff": "Local delivery (Gopuff)",
    "sd-tinder": "Dating app (Tinder)",
    "sd-leetcode": "Online coding judge (LeetCode)",
    "sd-fb-live-comments": "Live comments (Facebook Live)",
    "sd-top-k": "Top-K most-viewed videos",
    "sd-uber": "Ride hailing (Uber)",
    "sd-web-crawler": "Large-scale web crawler",
    "sd-ad-click-aggregator": "Real-time ad click aggregator",
    "sd-fb-post-search": "Post search (Facebook)",
    "ai-workflow": "AI-assisted development workflow",
    "ai-code-quality": "Code quality with AI-generated code",
    "ai-testing": "Testing AI-generated code",
    "ai-token-spend": "Keeping AI token spend low",
    "fe-hover-scale": "Efficient hover-scale button",
    "fe-design-system": "What makes a good design system",
    "fe-box-model": "The CSS box model",
    "fe-css-specificity": "CSS specificity",
    "fe-responsive-design": "Responsive design principles",
    "fe-event-loop": "The JavaScript event loop",
    "fe-debug-react": "Debugging a slow React app",
    "fe-object-vs-map": "Object vs Map in JavaScript",
    "fe-weakmap-gc": "Map vs WeakMap and garbage collection",
    "fe-scale-frontend": "Scaling a frontend to 100k users",
    "fe-llm-chatbot-protocol": "Protocol for an LLM chatbot",
    "pm-1": "A product decision that was wrong",
    "pm-2": "Improving note-taking app onboarding",
}


def upgrade() -> None:
    """Upgrade schema."""
    # 1. nullable first, so the backfill can run
    op.add_column("questions", sa.Column("title", sa.String(length=128), nullable=True))

    # 2. bank rows: the authored titles
    for slug, title in BANK_TITLES.items():
        op.execute(
            sa.text("UPDATE questions SET title = :title WHERE slug = :slug").bindparams(
                title=title, slug=slug
            )
        )

    # 3. everything else: the text on one line, cut to 80 chars at the last space (with an ellipsis);
    #    a text that already fits is used whole
    op.execute(
        r"""
        UPDATE questions
           SET title = CASE
               WHEN length(flat) <= 80 THEN flat
               ELSE regexp_replace(left(flat, 80), '\s+\S*$', '') || '…'
           END
          FROM (
              SELECT id, btrim(regexp_replace(text, '\s+', ' ', 'g')) AS flat FROM questions
          ) AS t
         WHERE questions.id = t.id AND questions.title IS NULL
        """
    )

    # 4. now every row has one
    op.alter_column("questions", "title", nullable=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("questions", "title")
