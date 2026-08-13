"""row level security policies

Revision ID: a98eeeef7b99
Revises: 3bf1a2d6fb29
Create Date: 2026-08-10 21:17:18.302858

PHASE B, THE SECOND LINE OF DEFENCE

Raw SQL for the same reason as the trigger migration: `CREATE POLICY` is not schema
Alembic can autogenerate out of `models.py` — it isn't a table shape, it's a rule about
who may see a row.

WHAT RLS ACTUALLY IS. Normally a permission is per-TABLE: you may SELECT from `interviews`,
or you may not. Row-Level Security makes it per-ROW: Postgres silently appends your policy's
condition to every query against the table, so a `SELECT * FROM interviews` run by user A
returns A's interviews and — not "errors", not "403" — simply does not contain B's. The
filter lives in the database, so no application bug can forget it.

WHO IT APPLIES TO, AND WHY IT IS NOT WHAT PROTECTS YOUR USERS TODAY:

    our FastAPI backend  ── connects as `postgres` ──►  BYPASSRLS. Policies do not apply.
    a browser w/ anon key ── connects as `anon` / `authenticated` ──►  policies DO apply.

So today, with every query going through FastAPI, the check that actually stops user A
reading user B's interview is `require_ownership` in `server/auth.py`. This migration is
DEFENCE IN DEPTH: `@supabase/supabase-js` is now in the frontend holding a real anon key,
and that key can talk to PostgREST at `<SUPABASE_URL>/rest/v1/<table>` directly. Without
RLS, every table in `public` is world-readable to anyone who reads your JS bundle. We only
use supabase-js for AUTH — but the door is open whether or not we walk through it.

THE DEFAULT IS DENY, and it's a good default. `ENABLE ROW LEVEL SECURITY` on a table with
NO policies means "no non-bypassing role sees any row". Enabling it everywhere and then
adding back exactly the access we can justify is the order to do this in — not the reverse.

`auth.uid()` is Supabase's helper: the `sub` claim of the caller's JWT, as a uuid. It's the
same value as `profiles.id` and the same one `require_user` returns — which is why every
policy below is a plain column comparison instead of a join. (That is the entire payoff of
`profiles.id` breaking the surrogate-key convention; see the Profile model.)

Apply with (from server/):   .venv/Scripts/python.exe -m alembic upgrade head
Then verify in the Supabase SQL editor:
    select tablename, rowsecurity from pg_tables where schemaname = 'public';
    select tablename, policyname, cmd, qual from pg_policies where schemaname = 'public';
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a98eeeef7b99'
down_revision: Union[str, Sequence[str], None] = '3bf1a2d6fb29'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Every table in `public`. Split by how access is decided, because that's what decides the
# policy — not the table's contents.
OWNED_TABLES = ["interviews", "turns", "scorecards", "scorecard_entries",
                "scorecard_entry_scores"]        # reachable from a profile
PUBLIC_READ_TABLES = ["roles", "levels", "question_types", "tags", "questions", "question_tags",
               "rubrics", "rubric_dimensions"]   # shared reference data
GRADER_ONLY_TABLES = [
    "reference_briefs"
]


def upgrade() -> None:
    """Upgrade schema."""
    # -----------------------------------------------------------------------
    # 1. TURN IT ON EVERYWHERE FIRST. After this loop and before a single policy exists,
    #    every one of these tables is invisible to `anon` and `authenticated` — the safe
    #    state. Policies below only ever ADD access back.
    # -----------------------------------------------------------------------
    for table in ["profiles", *OWNED_TABLES, *PUBLIC_READ_TABLES, *GRADER_ONLY_TABLES]:
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")

    # -----------------------------------------------------------------------
    # 2. WORKED EXAMPLE — `profiles`: you are your own row, and nobody else's.
    #
    #    Read the anatomy once and the rest of the file is fill-in-the-blanks:
    #
    #      FOR SELECT       which STATEMENT this rule governs (SELECT/INSERT/UPDATE/DELETE/ALL)
    #      TO authenticated which ROLE it applies to. `authenticated` = a signed-in caller;
    #                       `anon` = holding the anon key with no session. Naming the role is
    #                       how a policy stays off `anon`'s menu entirely.
    #      USING (...)      the row FILTER, for rows that already exist. Appended to the
    #                       query; a row failing it isn't hidden-with-an-error, it just
    #                       isn't in the result.
    #      WITH CHECK (...) the row VALIDATOR, for rows being written (INSERT/UPDATE). This
    #                       is the half people forget: USING alone would let you UPDATE your
    #                       own row into someone else's id.
    #
    #    NO INSERT policy on purpose — profile rows are created by the signup TRIGGER, which
    #    runs SECURITY DEFINER and therefore isn't subject to these policies at all. If a
    #    client can't insert a profile, a client can't forge one.
    # -----------------------------------------------------------------------
    op.execute(
        """
        CREATE POLICY profiles_select_own ON public.profiles
            FOR SELECT TO authenticated
            USING (auth.uid() = id)
        """
    )
    op.execute(
        """
        CREATE POLICY profiles_update_own ON public.profiles
            FOR UPDATE TO authenticated
            USING (auth.uid() = id)
            WITH CHECK (auth.uid() = id)
        """
    )

    # -----------------------------------------------------------------------
    # 3. WORKED EXAMPLE — `interviews`: the direct-ownership case. `profile_id` holds the
    #    auth uid itself, so this is the same one-line comparison.
    #
    #    FOR ALL is the compact form covering all four statements. USING governs the
    #    read/update/delete side; WITH CHECK the insert/update side — it validates the row
    #    as it WOULD be after the write, which is what stops an UPDATE that hands your row
    #    to somebody else.
    #
    #    BOTH ARE SPELLED OUT, but for readability only: when WITH CHECK is omitted Postgres
    #    falls back to the USING expression for writes too, so the two clauses below are one
    #    rule written twice. WITH CHECK earns its own line only when it must DIFFER from
    #    USING (say "you may read archived rows but not create them") — which is true nowhere
    #    in this file. The cost of the duplication is the obvious one: two copies of an
    #    expression that must never disagree, in every policy here.
    # -----------------------------------------------------------------------
    op.execute(
        """
        CREATE POLICY interviews_own ON public.interviews
            FOR ALL TO authenticated
            USING (auth.uid() = profile_id)
            WITH CHECK (auth.uid() = profile_id)
        """
    )

    # -----------------------------------------------------------------------
    # 4. THE INDIRECT CASE: `turns`. A turn has no `profile_id`; it belongs to whoever
    #    owns its interview. So the condition becomes a subquery instead of a comparison:
    #
    #        EXISTS (SELECT 1 FROM public.interviews i
    #                 WHERE i.id = turns.interview_id AND i.profile_id = auth.uid())
    #
    #    Write it as `turns_own`, FOR ALL TO authenticated, with the SAME expression in both
    #    USING and WITH CHECK. It's indexed (`turns.interview_id` has an index, `interviews.id`
    #    is the PK), so the cost is a lookup per row, not a scan.
    #
    #    THE TRAP TO KNOW ABOUT: this subquery is itself a SELECT on `interviews`, which is
    #    also under RLS — but a policy's own subqueries do NOT recurse into other policies
    #    here, and `interviews_own` would give the same answer anyway. Where this DOES bite
    #    is a policy that queries a table the caller can't read at all: the subquery finds
    #    nothing and the policy silently denies everything. If a policy you're sure about
    #    denies everything, that's the first thing to check.
    op.execute(
        """
            CREATE POLICY turns_own ON public.turns
                FOR ALL TO authenticated
                USING (
                    EXISTS (
                        SELECT 1 FROM public.interviews i WHERE i.id = turns.interview_id AND i.profile_id = (SELECT auth.uid())
                    )
                )
                WITH CHECK (
                    EXISTS (
                        SELECT 1 FROM public.interviews i WHERE i.id = turns.interview_id AND i.profile_id = (SELECT auth.uid())
                    )
                )
        """
    )
    #
    # 5. `scorecards` is the same shape as turns (one hop: scorecards.interview_id).
    #    `scorecard_entries` is TWO hops (entry -> scorecard -> interview) and
    #    `scorecard_entry_scores` is THREE. Nest the EXISTS, or write it as a join inside the
    #    subquery — either reads fine; pick one and use it for all three.
    #
    #    WORTH NOTING BEFORE YOU WRITE THEM: nothing reads these tables through PostgREST
    #    today (Phase C will serve History through FastAPI), so leaving them enabled with NO
    #    policy is also a defensible answer — deny-all is exactly right for a table only the
    #    backend touches. Write them anyway: they document who the data belongs to, and they
    #    are what makes a future "let the SPA read its own history directly" a config change
    #    rather than a security review.
    # -----------------------------------------------------------------------
    op.execute(
        """
            CREATE POLICY scorecards_own ON public.scorecards
                FOR ALL TO authenticated
                USING (
                    EXISTS (
                        SELECT 1 from public.interviews i WHERE i.id = scorecards.interview_id AND i.profile_id = (SELECT auth.uid())
                    )
                )
                WITH CHECK (
                    EXISTS (
                        SELECT 1 from public.interviews i WHERE i.id = scorecards.interview_id AND i.profile_id = (SELECT auth.uid())
                    )
                )
        """ 
    )

    op.execute(
        """
            CREATE POLICY scorecard_entries_own ON public.scorecard_entries
                FOR ALL TO authenticated
                USING (
                    EXISTS (
                        SELECT 1 from public.scorecards JOIN public.interviews ON scorecards.interview_id = interviews.id 
                        WHERE scorecards.id = scorecard_entries.scorecard_id
                        AND interviews.profile_id = (SELECT auth.uid())
                    )    
                )
                WITH CHECK (
                    EXISTS (
                        SELECT 1 from public.scorecards JOIN public.interviews ON scorecards.interview_id = interviews.id 
                        WHERE scorecards.id = scorecard_entries.scorecard_id
                        AND interviews.profile_id = (SELECT auth.uid())
                    )    
                )
        """
    )

    op.execute(
        """
            CREATE POLICY scorecard_entry_scores_own ON public.scorecard_entry_scores
                FOR ALL TO authenticated
                USING (
                    EXISTS (
                        SELECT 1 from public.scorecards JOIN public.interviews ON scorecards.interview_id = interviews.id
                        JOIN public.scorecard_entries ON scorecard_entries.scorecard_id = scorecards.id
                        WHERE scorecard_entry_scores.entry_id = scorecard_entries.id
                        AND interviews.profile_id = (SELECT auth.uid())
                    )
                )
                WITH CHECK (
                    EXISTS (
                        SELECT 1 from public.scorecards JOIN public.interviews ON scorecards.interview_id = interviews.id
                        JOIN public.scorecard_entries ON scorecard_entries.scorecard_id = scorecards.id
                        WHERE scorecard_entry_scores.entry_id = scorecard_entries.id
                        AND interviews.profile_id = (SELECT auth.uid())
                    )    
                )
        """
    )

    # -----------------------------------------------------------------------
    # 6. THE BANK (`PUBLIC_READ_TABLES`): shared reference data, owned by nobody. Questions
    #    and rubrics aren't secrets, but they also must not be writable from a browser.
    #    So: one policy per table, `FOR SELECT TO authenticated USING (true)` — the constant
    #    `true` means "every row passes the filter", i.e. read-only-for-everyone-signed-in.
    #    No INSERT/UPDATE/DELETE policy at all: seeding runs as `postgres`, which bypasses.
    #
    #    A loop over PUBLIC_READ_TABLES writing `CREATE POLICY {table}_read ON public.{table} ...`
    #    is the honest way to write eight identical policies — the f-string is safe because
    #    the names are OUR constants, not user input. (If you'd rather see all nine spelled
    #    out in the file for grep-ability, that's a legitimate taste too.)
    #
    #    DECIDE `anon` DELIBERATELY: `TO authenticated` means a signed-out visitor can't read
    #    the question bank. Adding `anon` would let a future public "try a sample question"
    #    page work without a session. Neither is wrong — but it should be a decision, not an
    #    accident, which is why the role is named in every policy above.
    # -----------------------------------------------------------------------
    for table in PUBLIC_READ_TABLES:
        op.execute(
            f"""
                CREATE POLICY {table}_read ON public.{table}
                    FOR SELECT TO authenticated USING (true)
            """
        )


def downgrade() -> None:
    """Downgrade schema."""
    # Policies are dropped implicitly with their table, but not with a mere DISABLE — so
    # drop them explicitly, then turn RLS off. IF EXISTS keeps this runnable even if you
    # ran an upgrade with only some of the TODOs filled in.
    op.execute("DROP POLICY IF EXISTS profiles_select_own ON public.profiles")
    op.execute("DROP POLICY IF EXISTS profiles_update_own ON public.profiles")
    op.execute("DROP POLICY IF EXISTS interviews_own ON public.interviews")
    op.execute("DROP POLICY IF EXISTS turns_own ON public.turns")
    op.execute("DROP POLICY IF EXISTS scorecards_own ON public.scorecards")
    op.execute("DROP POLICY IF EXISTS scorecard_entries_own ON public.scorecard_entries")
    op.execute("DROP POLICY IF EXISTS scorecard_entry_scores_own ON public.scorecard_entry_scores")

    for table in PUBLIC_READ_TABLES:
        op.execute(f"DROP POLICY IF EXISTS {table}_read ON public.{table}")


    for table in ["profiles", *OWNED_TABLES, *PUBLIC_READ_TABLES, *GRADER_ONLY_TABLES]:
        op.execute(f"ALTER TABLE public.{table} DISABLE ROW LEVEL SECURITY")
