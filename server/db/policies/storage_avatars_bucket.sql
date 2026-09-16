-- ===========================================================================
-- Supabase Storage — the `avatars` bucket + its Row-Level-Security policies.
--
-- RUN THIS ONCE, IN THE SUPABASE SQL EDITOR (Dashboard -> SQL Editor), when you apply the
-- b7e3f1c9a204_profile_avatar_url Alembic migration.
--
-- WHY IT LIVES HERE AND NOT IN db/migrations/. This is DDL against the `storage` schema, which is
-- owned by `supabase_storage_admin`. The `postgres` role our Alembic migrations run as (over the
-- session pooler) may lack privilege to add policies to `storage.objects`, and a failure mid-
-- migration would roll back the avatar_url column with it. The SQL editor runs with the ownership
-- these statements need. It's also a one-time, out-of-band setup rather than a versioned schema
-- change — so it's a policy script, not a migration. Every statement is idempotent; re-running is safe.
--
-- WHY CLIENT-DIRECT STORAGE (and why that's consistent with the rest of the app). The SPA otherwise
-- speaks ONLY to FastAPI and uses supabase-js for auth alone — every piece of INTERVIEW data goes
-- through the backend, which owns the rules (see server/api.py's Phase B notes). A profile picture
-- is not interview data: it's a public image, and Storage is the door Supabase provides for exactly
-- this. So the browser uploads straight to this bucket with the anon key + the user's JWT, and the
-- policies below ARE the real access control on that door — the same role the RLS migration
-- (a98eeeef7b99) plays for the PostgREST door. The backend still guards the pointer: PATCH
-- /api/profile refuses an avatar_url that isn't a public URL under THIS bucket.
-- ===========================================================================

-- 1. THE BUCKET. `public = true` so an object's public URL
--    (<SUPABASE_URL>/storage/v1/object/public/avatars/<path>) is served over the CDN with no
--    signed-URL dance — right for an avatar, which is not a secret and is rendered in a bare <img>.
--    ON CONFLICT keeps this idempotent if the bucket already exists.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- 2. OWN-FOLDER POLICY — a signed-in user may read/write ONLY UNDER THEIR OWN FOLDER.
--    The object path is `<uid>/avatar`, so the first path segment is the owner's auth uid;
--    `(storage.foldername(name))[1]` is that segment, compared to `auth.uid()` exactly as the
--    public-schema policies compare `auth.uid() = profile_id`. `(select auth.uid())` (an InitPlan
--    evaluated once, not per row) matches the a98eeeef7b99 style. No policy lets a user touch
--    another user's folder, so nobody can read-back, overwrite, or delete someone else's object.
--
--    WHY `FOR ALL` AND NOT WRITE-ONLY POLICIES (this is a real, hard-won correction). A public
--    bucket is readable by anyone via the /object/public/ route, which bypasses RLS — so it's
--    tempting to think the `authenticated` role needs INSERT/UPDATE/DELETE only, no SELECT. It does
--    NOT hold: storage-api's upload runs `INSERT ... RETURNING *` (and, with upsert, `ON CONFLICT DO
--    UPDATE`), which needs the `authenticated` role to SELECT the row it just wrote. With RLS on and
--    no SELECT policy, SELECT is deny-all for that role, the RETURNING can't read the row back, and
--    the upload fails with the misleading "new row violates row-level security policy" — even though
--    the INSERT's WITH CHECK is satisfied. The public-URL read path does not grant that SELECT. So a
--    single `FOR ALL` (SELECT + INSERT + UPDATE + DELETE, USING for reads/updates/deletes, WITH CHECK
--    for writes) is required. It's the same shape as the app's `interviews_own` policy. DROP-then-
--    CREATE (including the retired per-command names) keeps the whole script re-runnable.
drop policy if exists "avatars_insert_own" on storage.objects;
drop policy if exists "avatars_update_own" on storage.objects;
drop policy if exists "avatars_delete_own" on storage.objects;
drop policy if exists "avatars_all_own" on storage.objects;
create policy "avatars_all_own" on storage.objects
    for all to authenticated
    using (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = (select auth.uid())::text
    )
    with check (
        bucket_id = 'avatars'
        and (storage.foldername(name))[1] = (select auth.uid())::text
    );

-- Verify afterwards:
--   select id, public from storage.buckets where id = 'avatars';
--   select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects';
