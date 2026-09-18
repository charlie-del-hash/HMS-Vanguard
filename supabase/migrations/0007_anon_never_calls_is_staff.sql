-- 0007_anon_never_calls_is_staff — fix a lock that locked out the readers.
--
-- 0006 gave reports and report_blocks a single SELECT policy each, stating the
-- whole rule in one expression:
--
--     using (status = 'published' or private.is_staff())
--
-- and 0005 had moved is_staff() into `private`, revoking EXECUTE from anon and
-- USAGE on the schema so PostgREST could not publish it.
--
-- Those two are incompatible. A policy expression is evaluated as the querying
-- role, so an anonymous reader hitting a row where the first branch is false
-- has to evaluate the second — and gets `permission denied for function
-- is_staff`. Not "no rows": an error, on the reader's path, on the funnel's
-- only product. `or` short-circuits often enough that this could easily have
-- looked fine in a spot check and failed on the first draft in the table.
--
-- The fix is to stop asking anon the question. anon is never staff, so the
-- staff branch is dead weight for that role. One policy per role per action:
-- the linter's multiple_permissive_policies counts per (role, action), so
-- splitting by role costs nothing there either.

drop policy reports_select on public.reports;

create policy reports_select_anon on public.reports
  for select to anon
  using (status = 'published');

create policy reports_select_auth on public.reports
  for select to authenticated
  using (status = 'published' or private.is_staff());

drop policy report_blocks_select on public.report_blocks;

create policy report_blocks_select_anon on public.report_blocks
  for select to anon
  using (exists (
    select 1 from public.reports r
    where r.id = report_blocks.report_id and r.status = 'published'
  ));

create policy report_blocks_select_auth on public.report_blocks
  for select to authenticated
  using (
    private.is_staff()
    or exists (
      select 1 from public.reports r
      where r.id = report_blocks.report_id and r.status = 'published'
    )
  );
