-- 0005_advisors — close what the security linter found.
--
-- Three of the four findings from `get_advisors --type security` were real.
-- The fourth is the design and is documented at the bottom rather than fixed.

-- ── 1. citext was installed into public ──────────────────────────────
-- Anything in `public` is reachable through the exposed API surface and shares
-- a namespace with our own objects. Supabase keeps a schema for this; the type
-- moves with the extension and existing columns follow it by OID, so
-- subscribers.email is unaffected.
alter extension citext set schema extensions;

-- ── 2 and 3. is_staff() was callable over REST ───────────────────────
-- It is SECURITY DEFINER — it has to be, so a signed-in non-staff user can be
-- tested against the staff table without being granted sight of it — and any
-- SECURITY DEFINER function in `public` is published at /rest/v1/rpc/<name>.
--
-- Revoking EXECUTE is not the answer, because the RLS policies call it and
-- policy expressions are evaluated as the querying user, so `authenticated`
-- genuinely needs EXECUTE. The answer is to take it off the API surface
-- instead: PostgREST exposes `public` and `graphql_public` only, so a function
-- in `private` is unreachable from outside while still working from a policy.
--
-- The dependency from each policy is by OID, so they follow the function across
-- and keep working without being rewritten.
create schema if not exists private;
revoke all on schema private from anon, authenticated;
grant usage on schema private to authenticated;

alter function public.is_staff() set schema private;

revoke all on function private.is_staff() from public, anon;
grant execute on function private.is_staff() to authenticated;

comment on function private.is_staff() is
  'True when the caller is in public.staff. In `private` so PostgREST cannot publish it; SECURITY DEFINER so non-staff can be tested without seeing the table.';

-- ── 4. rls_enabled_no_policy on visitors / interactions / subscribers ─
-- Reported at INFO, and left exactly as it is. RLS enabled with no policy
-- denies every role that is subject to RLS, which is precisely what those three
-- tables want: they are written by /api/track and read by /admin, both holding
-- the service role, which bypasses RLS. Adding a permissive policy to quieten a
-- linter would be adding the hole the linter is looking for.
--
-- Grants were already revoked from anon and authenticated in 0004, so the lock
-- is on twice. checks/db-rls.js proves it from the outside with a real key.
