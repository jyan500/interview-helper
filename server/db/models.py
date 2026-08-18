"""The schema: the JSON files, re-expressed as tables.

Usage:  from db.models import Interview, Question, Role

WHERE EACH TABLE CAME FROM — every one of these already existed, just not as a table:

    data/questions.json     ->  roles · rubrics · rubric_dimensions · questions ·
                                question_types · tags
    data/sessions/*.json    ->  turns · interviews.summary       (the transcript)
    SESSIONS dict in api.py ->  interviews                       (live conversation state)
    returned-only scorecard ->  scorecards · scorecard_entries · scorecard_entry_scores
    (nothing yet)           ->  profiles                         (Phase B attaches them)
    (nothing yet)           ->  levels                           (Phase D uses it)
    (nothing yet)           ->  reference_briefs                 (Phase E fills it)

The interesting one is `interviews`. In `api.py` today, an interview is a Python dict
holding `persona`, `history`, `asked_ids`, `current_qid`, `current_qtext`,
`followups_used`, `max_followups` — process memory, so it dies on restart and can't be seen
by a second instance. Most of those dict keys become COLUMNS below. That's the whole
Phase A move: the same state, relocated behind the boundary, so any instance can serve any
turn.

ONE WORD FOR ONE THING: what the app calls an interview is an INTERVIEW everywhere — the
table, the model, the HTTP field (`interview_id`), the MCP resource. "Session" is reserved
for exactly one meaning in this codebase: a SQLAlchemy DB session, always the variable
`db`. (Phase A renames the old `session_id` API field / `session://` resource accordingly.)

SURROGATE KEY + SLUG, EVERY TABLE (the convention here):
    id   = autoincrement int. What other ROWS point at. Meaningless on purpose — it never
           has to change, so no FK ever has to be rewritten.
    slug = the domain id the OUTSIDE world speaks: "backend-engineer", "mid", "be-1", and
           the interview's uuid hex. What the API, the MCP URIs, and the LLM carry.
           Unique + indexed, because most lookups arrive as a slug.
    So every read path starts the same way: resolve slug -> row, then work in ids. Renaming
    a slug touches exactly one row instead of every table that references it.
    ONE DELIBERATE EXCEPTION: `profiles.id` — see the class for why.

EVERY TABLE IS TIMESTAMPED via TimestampMixin — `created_at` / `updated_at`, filled by the
DATABASE (server_default / onupdate), so they're right even for a row written by a
migration, a seed script, or psql. Declared once as a mixin rather than copied into eleven
classes.

READING THE `xxx_id` / `xxx` PAIRS: `role_id` is the real COLUMN (an int FK); `role` is a
relationship — not stored, just SQLAlchemy resolving that id into the row when you touch
it. Set and compare with the id, read the row through the relationship.

WHY EVERY RELATIONSHIP SAYS lazy="selectin". A relationship isn't fetched by the query that
loads its parent. By DEFAULT (lazy="select") SQLAlchemy waits and fires a SELECT the moment
you touch the attribute — which in async code CANNOT work: `role.questions` is a plain
attribute read, there's nowhere to await I/O, and it raises MissingGreenlet at runtime on
whichever path happens to touch it. So relationships must be loaded eagerly here, and
"selectin" is the strategy that does it with a second batched query
(`... WHERE role_id IN (1,2,3)`) rather than a JOIN that would multiply parent rows once a
collection has more than one child. Cost: it ALWAYS loads, even when unused — so if the
Phase C History list (50 interviews, each dragging all its turns) ever feels heavy, switch
that one relationship to lazy="raise" and opt in per query with selectinload().

NAMES THAT AVOID SQL RESERVED WORDS: `reference_briefs` (not `references`) and `sort_order`
(not `order`). SQLAlchemy would quote either, but anything you type by hand in psql then
needs the quotes too — not worth the papercut.

THE RULE THAT DECIDED EVERY BLOB-VS-TABLE CALL HERE:

    Table it if the DATABASE should enforce something about it — it references another row,
    or it's a vocabulary that could be misspelled or reworded out from under you.
    Leave it JSONB only if it's a value you always take or leave in ONE piece, whose shape
    isn't yours to guarantee.

Applied, that turned every JSONB field the JSON store had into tables — `tags`,
`rubrics.dimensions`, an entry's per-dimension `scores` — and left exactly one:
`message_history`, whose structure belongs to pydantic-ai rather than to us. The sharpest
case was scores: they used to be keyed by dimension NAME, so rewording a rubric dimension
silently orphaned every historical score keyed to the old string. Nothing would have
errored. That's the whole argument for rows in one example.

ONE COPY OF EVERY FACT, likewise:
  - `scorecards.role/level`         -> read through `scorecard.interview`
  - `scorecards.dimension_averages` -> GROUP BY over `scorecard_entry_scores`
  - `interviews.current_qtext`      -> read through `interview.current_question.text`
  - `interviews.asked_ids`          -> DERIVED, see Interview.asked_question_ids
  - `turns.at`                      -> it WAS created_at; the mixin supplies it
The one surviving cached aggregate is `scorecards.overall`, kept because the History list
SORTS on it — which is exactly when a cache earns its keep.

SQLALCHEMY 2.0 STYLE: `Mapped[...]` annotations + `mapped_column(...)`. The annotation
carries the Python type (and nullability, via `| None`); `mapped_column` carries the SQL
details.
"""
from __future__ import annotations

import uuid as uuid_pkg
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """The declarative registry. Alembic autogenerate diffs `Base.metadata` against the
    live database to write migrations, so EVERY model must be imported (i.e. live in this
    module) for it to be seen."""


class TimestampMixin:
    """`created_at` / `updated_at` for every table, declared once.

    Not a model and not a table — a plain mixin whose columns get copied into each class
    that inherits it. (Inheriting from Base as well is what makes a class a table; this
    just contributes columns.)

    Both are filled by POSTGRES, not Python: `server_default=func.now()` becomes a column
    DEFAULT and `onupdate=func.now()` makes SQLAlchemy set it on every UPDATE it emits. The
    default means a row inserted by a migration, the seed script, or a hand-typed INSERT is
    still stamped correctly — a Python-side default would only cover rows this app writes.

    The one gap to know: `onupdate` is applied by SQLAlchemy, so a bulk UPDATE run directly
    in psql won't bump `updated_at`. A database trigger would close that; not worth one yet.
    """
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


# ===========================================================================
# THE PERSON — a PROFILE, not an identity. Supabase Auth owns identity.
# ===========================================================================
class Profile(Base, TimestampMixin):
    """The app's row for a signed-in person (Phase B attaches interviews to it).

    THE DIVISION OF LABOUR: Supabase Auth owns `auth.users` in this same database — email,
    password hash, provider, confirmation state. We never duplicate any of that (email
    especially: it drifts the moment someone changes it; read it from the JWT claim
    instead). This table is the APP's side of the same person — what OUR domain knows.

    THE ONE EXCEPTION TO THE SURROGATE-KEY RULE: `id` is not an autoincrement int, it's the
    auth user's UUID (the JWT's `sub`) verbatim. Reason is Phase B's Row-Level Security. A
    Supabase RLS policy compares against `auth.uid()`, which is that UUID — so with this
    key, every policy in the schema is a direct comparison:

        profiles:   auth.uid() = id
        interviews: auth.uid() = profile_id

    With a surrogate int it'd be a subquery on every policy of every table
    (`profile_id IN (SELECT id FROM profiles WHERE auth_user_id = auth.uid())`). Matching
    the key to the thing RLS actually compares is worth breaking the convention for.

    ROWS ARE CREATED BY A DATABASE TRIGGER, NOT BY THIS APP. A `SECURITY DEFINER` function
    on `INSERT INTO auth.users` inserts the matching profile — written by hand (op.execute)
    in the migration that creates this table, since Alembic can't autogenerate it. Why the
    trigger over an app-side get-or-create: signup can happen on paths our API never sees
    (the Supabase dashboard, an emailed invite, a social provider), and every one of those
    still needs a profile. Consequence to respect: the trigger runs INSIDE the signup
    transaction, so if it raises, the signup itself fails — keep that function minimal.

    NOT a foreign key to `auth.users` in the model: that table lives in a schema Alembic
    doesn't manage, and autogenerate (which only knows `Base.metadata`) would fight the
    constraint every run. The migration adds it by hand alongside the trigger, so deleting
    a Supabase user cascades instead of orphaning this row.
    """
    __tablename__ = "profiles"

    id: Mapped[uuid_pkg.UUID] = mapped_column(Uuid, primary_key=True)  # = auth.users.id
    display_name: Mapped[str | None] = mapped_column(String(128), nullable=True)

    interviews: Mapped[list[Interview]] = relationship(
        back_populates="profile", lazy="selectin"
    )


# ===========================================================================
# THE VOCABULARIES — tiny, slow-changing lookup tables everything else points at.
# ===========================================================================
class Role(Base, TimestampMixin):
    """An interview track: "backend-engineer", "product-manager".

    Callers arrive with the SLUG (`req.role`, `rubric://{role}`), so tool bodies resolve
    slug -> row once and then work in ids.
    """
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True)  # "backend-engineer"
    name: Mapped[str] = mapped_column(String(128))                          # "Backend Engineer"

    questions: Mapped[list[Question]] = relationship(
        back_populates="role", lazy="selectin", order_by="Question.sort_order"
    )
    rubric: Mapped[Rubric | None] = relationship(back_populates="role", lazy="selectin")


class Level(Base, TimestampMixin):
    """Seniority: entry · mid · senior. Three rows, and worth a table anyway.

    Why not a plain string (or a CHECK/ENUM): levels are ORDERED, and Phase D needs that
    order — the level picker's display order, and "questions at or below this level"
    filtering. `rank` is where that lives, and a string column has nowhere to put it. It's
    also the natural thing for a future rubric×level expectations table to reference.
    Adding "staff" later is then an INSERT, not a constraint migration.
    """
    __tablename__ = "levels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(16), unique=True, index=True)  # "entry"|"mid"|"senior"
    name: Mapped[str] = mapped_column(String(64))                           # "Entry level"
    rank: Mapped[int] = mapped_column(Integer, unique=True)                 # 1 < 2 < 3 — the ordering


class QuestionType(Base, TimestampMixin):
    """What KIND of question this is: behavioral · system-design · technical ·
    product-sense. Was a free-text `type` field in the JSON bank.

    A table for the same reasons as the two above — and one specific to it: grading and
    question selection will eventually want to branch on kind (a system-design answer isn't
    scored like a behavioral one), which means the kind needs to be a thing you can attach
    behavior to, not a string someone might spell two ways.
    """
    __tablename__ = "question_types"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(32), unique=True, index=True)  # "system-design"
    name: Mapped[str] = mapped_column(String(64))                           # "System design"


class Tag(Base, TimestampMixin):
    """A topic a question touches: "debugging", "scalability", "concurrency".

    THE ONE MANY-TO-MANY IN THE SCHEMA — a question has one type but several tags, which is
    why this needs the `question_tags` join table below while `question_types` doesn't.

    Why not a JSONB array of strings on `questions` (which a GIN index would query just
    fine): the vocabulary. As a blob, "system-design" and "systems-design" are two silently
    different tags, "list every tag in the bank" is a scan with `jsonb_array_elements`, and
    a tag has nowhere to keep a display label. As rows, a tag exists ONCE — which is also
    what makes the interesting future query possible: join scores to tags and you get
    topic-level feedback ("weak on concurrency across three interviews").
    """
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(48), unique=True, index=True)  # "scalability"
    name: Mapped[str] = mapped_column(String(96))                           # "Scalability"


# The association table — the one table with no timestamps, because it's a plain Core
# Table rather than a model: it carries nothing of its own, just the pairing. (If it ever
# needs a column — "who tagged this, when" — it graduates into a real model class and picks
# up TimestampMixin with it.)
question_tags = Table(
    "question_tags",
    Base.metadata,
    Column("question_id", ForeignKey("questions.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


# ===========================================================================
# THE BANK — seeded from data/questions.json, read constantly, written rarely.
# ===========================================================================
class Rubric(Base, TimestampMixin):
    """The scoring rubric for a role — one row per role (the JSON had it nested).

    Separate table rather than columns on `roles` because grading reads it independently of
    the bank, and Phase D may hang level-specific expectations off its dimensions.
    """
    __tablename__ = "rubrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"), unique=True)
    scale: Mapped[str] = mapped_column(Text)   # "1 (poor) to 5 (excellent) per dimension"

    role: Mapped[Role] = relationship(back_populates="rubric", lazy="selectin")
    dimensions: Mapped[list[RubricDimension]] = relationship(
        back_populates="rubric", lazy="selectin", order_by="RubricDimension.sort_order",
        cascade="all, delete-orphan",
    )


class RubricDimension(Base, TimestampMixin):
    """One thing an answer is scored on: "Clarity of communication", "Tradeoff reasoning".

    WHY THIS IS A TABLE AND NOT A JSONB ARRAY OF STRINGS — the failure it prevents: every
    score used to be keyed by the dimension's NAME. Reword a dimension and all historical
    scores stay keyed to a string that no longer exists; averages quietly stop matching and
    nothing raises. With rows, a score points at an ID and the wording is free to change.

    It also gives display order (the rubric had implicit array order), and is what Phase D's
    level-specific expectations would attach to.
    """
    __tablename__ = "rubric_dimensions"
    # a dimension slug is unique WITHIN its rubric, not globally — two roles can both score
    # "communication" and mean subtly different things.
    __table_args__ = (UniqueConstraint("rubric_id", "slug", name="uq_rubric_dimension_slug"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rubric_id: Mapped[int] = mapped_column(
        ForeignKey("rubrics.id", ondelete="CASCADE"), index=True
    )
    slug: Mapped[str] = mapped_column(String(64))     # "tradeoff-reasoning" — stable
    name: Mapped[str] = mapped_column(String(128))    # "Tradeoff reasoning" — rewordable
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    rubric: Mapped[Rubric] = relationship(back_populates="dimensions", lazy="selectin")


class Question(Base, TimestampMixin):
    """One bank question. `slug` ("be-1") is what `question://{slug}` resolves and what the
    API reports; every row that references a question uses `id`."""
    __tablename__ = "questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True)   # "be-1"
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"), index=True)
    type_id: Mapped[int] = mapped_column(ForeignKey("question_types.id"), index=True)
    text: Mapped[str] = mapped_column(Text)

    # Phase D fills this. Nullable until then so today's bank — which has no levels — seeds
    # cleanly and next_question can ignore the column.
    level_id: Mapped[int | None] = mapped_column(
        ForeignKey("levels.id"), nullable=True, index=True
    )

    # `next_question` returns "the first unasked question in BANK ORDER". A JSON array had
    # that order for free; a table has no inherent order, so we store it explicitly.
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    role: Mapped[Role] = relationship(back_populates="questions", lazy="selectin")
    type: Mapped[QuestionType] = relationship(lazy="selectin")
    level: Mapped[Level | None] = relationship(lazy="selectin")
    tags: Mapped[list[Tag]] = relationship(secondary=question_tags, lazy="selectin")


class ReferenceBrief(Base, TimestampMixin):
    """Phase E: the authored grading brief for one question (leveling bands + tiered
    concept anchors). Created now, populated later — so the migration is already in place
    when Phase E starts.

    Table is `reference_briefs`, NOT `references`: that's a reserved word in SQL.
    """
    __tablename__ = "reference_briefs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # unique: at most one brief per question (the deterministic question -> brief mapping
    # that makes this a join instead of a retrieval problem).
    question_id: Mapped[int] = mapped_column(
        ForeignKey("questions.id", ondelete="CASCADE"), unique=True, index=True
    )
    brief: Mapped[str] = mapped_column(Text)


# ===========================================================================
# THE LIVE STATE — what used to be the SESSIONS dict + the per-interview JSON file.
# ===========================================================================
class Interview(Base, TimestampMixin):
    """One interview: its identity, its live conversation state, its outcome.

    The middle block below is the state that was process memory ten minutes ago. Loading
    this row at the top of `/api/answer` and writing it back at the bottom is what makes
    the backend stateless — and is also, for free, what makes "resume this interview later"
    possible (Phase C). `updated_at` doubles as "last active", which is what a resume list
    would sort on.
    """
    __tablename__ = "interviews"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # the uuid4().hex[:8] the client already holds — the HTTP API's `interview_id`.
    # Same slug role as everywhere else: the outside world's id, never a foreign key.
    slug: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    # nullable until Phase B: today's interviews have no signed-in user to attach to.
    # Its VALUE is the auth uid (see Profile), so an RLS policy here is just
    # `auth.uid() = profile_id`.
    profile_id: Mapped[uuid_pkg.UUID | None] = mapped_column(
        ForeignKey("profiles.id", ondelete="CASCADE"), nullable=True, index=True
    )
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"), index=True)
    # StartRequest.seniority arrives as a slug ("mid"); the route resolves it to a row.
    level_id: Mapped[int] = mapped_column(ForeignKey("levels.id"))

    # --- the question spine the BACKEND owns (was: the SESSIONS dict's keys) ------------
    persona: Mapped[str] = mapped_column(Text)   # fetched once from the MCP prompt
    # which question is on the table right now. Nullable only before the first is picked.
    # The old `current_qtext` copy is gone — read `interview.current_question.text`.
    current_question_id: Mapped[int | None] = mapped_column(
        ForeignKey("questions.id"), nullable=True
    )
    followups_used: Mapped[int] = mapped_column(Integer, default=0)
    max_followups: Mapped[int] = mapped_column(Integer, default=3)

    # The agent's replay buffer — pydantic-ai's own serialized message list. Dump with
    # ModelMessagesTypeAdapter.dump_python(msgs, mode="json"), load with
    # ModelMessagesTypeAdapter.validate_python(...). Never hand-roll the shape.
    #
    # THE ONE JSONB COLUMN LEFT, and it earns it: read whole and written whole every turn,
    # and its structure belongs to pydantic-ai, not to us — rows would still hold
    # library-shaped blobs, buying no integrity, only version coupling we'd have to migrate.
    # Keeping it here also makes each turn ONE update: the agent's memory can't end up out
    # of step with the question spine beside it.
    # THE COST, honestly: Postgres rewrites the whole value (MVCC + TOAST) every turn, so
    # write volume grows with transcript length. Kilobytes at interview scale — irrelevant.
    # If it ever isn't, the fix is trimming/summarizing old turns (which token cost wants
    # anyway), or moving this one column to a 1:1 side table so the hot row stays small.
    message_history: Mapped[list] = mapped_column(JSONB, default=list)

    # outcome
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)   # save_interview_summary
    done: Mapped[bool] = mapped_column(Boolean, default=False)

    profile: Mapped[Profile | None] = relationship(back_populates="interviews", lazy="selectin")
    role: Mapped[Role] = relationship(lazy="selectin")
    level: Mapped[Level] = relationship(lazy="selectin")
    current_question: Mapped[Question | None] = relationship(lazy="selectin")
    # Phase C — an interview has AT MOST ONE scorecard (graded once at the end), so this is a
    # 1:1: `uselist=False` makes `interview.scorecard` a single row or None, not a list. It's
    # what lets the History list read each interview's `overall` in the same selectin load
    # instead of a second query per row. `viewonly=True` because the scorecard's lifecycle is
    # owned by grading (save_scorecard writes it) — this side only ever reads it, and marking
    # it view-only keeps SQLAlchemy from trying to null out `scorecard.interview_id` if this
    # attribute is ever reassigned. No new column and no migration: a relationship is pure ORM.
    scorecard: Mapped[Scorecard | None] = relationship(
        lazy="selectin", uselist=False, viewonly=True
    )
    # the relationship to watch: a History list of many interviews drags every turn of each.
    # See the lazy="selectin" note at the top for the lazy="raise" + selectinload() fix.
    turns: Mapped[list[Turn]] = relationship(
        back_populates="interview", lazy="selectin", order_by="Turn.created_at",
        cascade="all, delete-orphan",
    )

    @property
    def asked_question_ids(self) -> set[int]:
        """Which bank questions this interview has already put to the candidate.

        DERIVED, not stored — this replaces the old `asked_ids` JSONB array. Every asked
        question either has at least one recorded turn or is the one currently on the
        table, so the fact already exists twice in the schema and a third copy could only
        ever disagree with them. `turns` is selectin-loaded with the interview, so this
        costs no extra query.

        THE INVARIANT IT RESTS ON: a question is never presented and then skipped without
        an answer — true today, because `/api/answer` only advances after recording one.
        If "skip this question" is ever added, this derivation goes quietly wrong; the fix
        then is an `interview_questions` join table written at presentation time.
        """
        asked = {turn.question_id for turn in self.turns}
        if self.current_question_id is not None:
            asked.add(self.current_question_id)
        return asked


class Turn(Base, TimestampMixin):
    """One exchange — the interviewer's prompt AND the candidate's answer to it.

    THE ROW IS BORN AT ASK-TIME, COMPLETED AT ANSWER-TIME (Phase C). A turn used to be
    written only when an answer arrived. Now it's INSERTED the moment a question or follow-up
    is presented — with `prompt_text` filled and `answer` still NULL — and the answer UPDATEs
    that same row when it comes back. This is what lets the transcript show the EXACT question
    each answer responded to (a follow-up probe reads differently from its parent bank
    question) without parsing `message_history`. `question_id` still points at the PARENT bank
    question for both, so grouping/scoring is unchanged; `prompt_text` is what actually got
    asked (the bank question's text, or the probe's).

    THIS IS THE HUMAN TRANSCRIPT, NOT THE MODEL'S MEMORY. It deliberately does NOT hold the
    interviewer's reactions/feedback or the clarification back-and-forth — those live in
    `interviews.message_history`, pydantic-ai's own replay buffer, which the model is fed every
    turn. `turns` narrows the text overlap with that buffer but never replaces it: the buffer
    carries strictly more (reactions, clarifications, the library's message shape).

    `answer` IS NULLABLE, and NULL means exactly one thing: "presented, not yet answered" —
    the OPEN turn. An empty answer is the empty STRING, not NULL, so it still closes the turn.
    There is AT MOST ONE open turn per interview (you present one prompt and wait), enforced by
    the partial unique index below — so `/api/answer` finds the turn to complete with a plain
    `WHERE interview_id = ? AND answer IS NULL`, no turn id threaded through the client.

    A REAL FOREIGN KEY on `question_id`, because the flow changed. Back when the MODEL chose
    questions it could hand back an id it invented ("be-1-followup"); since the client-driven
    rewrite the BACKEND picks every question, so an id that isn't a real question can no longer
    reach this table — the FK is free integrity. (The scorecard groups by `question_id`
    directly; the old normalization retired with the JSON store.)
    """
    __tablename__ = "turns"
    __table_args__ = (
        # AT MOST ONE open turn per interview. A partial unique index: uniqueness applies only
        # to rows where `answer IS NULL`, so an interview may have many completed turns but only
        # one awaiting an answer. This turns the "one prompt outstanding at a time" invariant
        # into something the DATABASE guarantees — a second open turn (a double-submit, a logic
        # slip) is a constraint error, not a silently ambiguous `WHERE answer IS NULL` lookup.
        Index(
            "uq_one_open_turn_per_interview",
            "interview_id",
            unique=True,
            postgresql_where=text("answer IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    interview_id: Mapped[int] = mapped_column(
        ForeignKey("interviews.id", ondelete="CASCADE"), index=True
    )
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id"), index=True)
    # the EXACT text presented — the bank question's text, or the LLM's follow-up probe. This
    # is what the transcript shows; `question.text` (via the FK) is always the PARENT bank
    # question, which for a follow-up turn would read wrong. Nullable only so pre-Phase-C rows
    # (written before this column existed) tolerate a NULL; the migration backfills them.
    prompt_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # NULL = open (presented, unanswered). Set to the candidate's text (possibly "") to close.
    answer: Mapped[str | None] = mapped_column(Text, nullable=True)

    interview: Mapped[Interview] = relationship(back_populates="turns", lazy="selectin")
    question: Mapped[Question] = relationship(lazy="selectin")


# ===========================================================================
# THE GRADE — computed once at the end, then kept. Three levels: the card, one
# question's entry, one dimension's score.
# ===========================================================================
class Scorecard(Base, TimestampMixin):
    """The end-of-interview grade. Today `/api/scorecard` computes and RETURNS this and
    then forgets it; the table exists so Phase C can persist it and the History view can
    show a past interview's grade without re-running (and re-paying for) the grader.

    Role and level are NOT copied here — they're facts about the interview, reachable via
    `scorecard.interview.role` / `.level`.

    `overall` IS a derivable aggregate, kept anyway: it's what the History list sorts and
    filters on, and sorting on a value you'd have to compute per row is exactly where a
    cached number pays for itself. Per-dimension averages are NOT cached — those are a
    GROUP BY over the score rows below.
    """
    __tablename__ = "scorecards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    interview_id: Mapped[int] = mapped_column(
        ForeignKey("interviews.id", ondelete="CASCADE"), index=True
    )
    overall: Mapped[float] = mapped_column(Float)

    interview: Mapped[Interview] = relationship(lazy="selectin")
    entries: Mapped[list[ScorecardEntry]] = relationship(
        back_populates="scorecard", lazy="selectin", cascade="all, delete-orphan"
    )


class ScorecardEntry(Base, TimestampMixin):
    """One question's grade within a scorecard — what used to be an element of the
    `answers` JSONB array.

    Rows instead of a blob buys two things: the entry can't name a question that doesn't
    exist (and stops copying its text — join to `questions` for that), and per-question
    performance becomes a real query, which is what "how am I doing on rate limiting over
    time?" needs. Joined through `question_tags`, it's also what makes topic-level
    ("concurrency") feedback possible.

    The three text fields mirror the grader's output_type in grading.py — one concrete
    strength, one gap, one specific improvement.
    """
    __tablename__ = "scorecard_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scorecard_id: Mapped[int] = mapped_column(
        ForeignKey("scorecards.id", ondelete="CASCADE"), index=True
    )
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id"), index=True)
    strength: Mapped[str] = mapped_column(Text)
    gap: Mapped[str] = mapped_column(Text)
    improvement: Mapped[str] = mapped_column(Text)

    scorecard: Mapped[Scorecard] = relationship(back_populates="entries", lazy="selectin")
    question: Mapped[Question] = relationship(lazy="selectin")
    scores: Mapped[list[ScorecardEntryScore]] = relationship(
        back_populates="entry", lazy="selectin", cascade="all, delete-orphan"
    )


class ScorecardEntryScore(Base, TimestampMixin):
    """One dimension's 1-5 score for one graded question — the leaf of the grade.

    This is the row that replaced `{"Tradeoff reasoning": 4}`. Pointing at
    `rubric_dimensions.id` instead of the name is what makes a reworded dimension harmless
    and what makes "my tradeoff-reasoning scores over the last ten interviews" a plain
    indexed query.

    grading.py's job at write time: map each dimension NAME the grader returned back to its
    row. They come from the rubric text we handed the model, so they match; anything that
    doesn't resolve is dropped rather than written under a guess.
    """
    __tablename__ = "scorecard_entry_scores"
    # one score per dimension per graded question — the constraint that stops a double write
    __table_args__ = (
        UniqueConstraint("entry_id", "dimension_id", name="uq_entry_dimension_score"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entry_id: Mapped[int] = mapped_column(
        ForeignKey("scorecard_entries.id", ondelete="CASCADE"), index=True
    )
    dimension_id: Mapped[int] = mapped_column(ForeignKey("rubric_dimensions.id"), index=True)
    score: Mapped[int] = mapped_column(Integer)   # 1-5, per rubrics.scale

    entry: Mapped[ScorecardEntry] = relationship(back_populates="scores", lazy="selectin")
    dimension: Mapped[RubricDimension] = relationship(lazy="selectin")
