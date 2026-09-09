-- 0006_one_policy_per_action — say each rule once.
--
-- 0004 gave the content tables two policies apiece: a public read, and a staff
-- `FOR ALL`. `FOR ALL` includes SELECT, so a signed-in reader matched both and
-- Postgres evaluated both on every row — which the performance linter flagged
-- as multiple_permissive_policies on six tables.
--
-- The tempting fix is to drop the public read and widen the staff policy's
-- USING to `status = 'published' or is_staff()`. That is wrong, and quietly:
-- USING governs SELECT, UPDATE and DELETE, but DELETE has no WITH CHECK to
-- catch it — so any signed-in account could delete a published report.
--
-- So each action gets exactly one policy. SELECT states the whole rule in one
-- expression; INSERT, UPDATE and DELETE are staff-only and separate. More
-- lines, no unions, and nothing that reads as permissive for one action while
-- meaning something else for another.

-- ── reports ──────────────────────────────────────────────────────────
drop policy reports_read_published on public.reports;
drop policy reports_staff_write on public.reports;

create policy reports_select on public.reports
  for select to anon, authenticated
  using (status = 'published' or private.is_staff());
create policy reports_insert on public.reports
  for insert to authenticated with check (private.is_staff());
create policy reports_update on public.reports
  for update to authenticated
  using (private.is_staff()) with check (private.is_staff());
create policy reports_delete on public.reports
  for delete to authenticated using (private.is_staff());

-- ── report_blocks ────────────────────────────────────────────────────
-- A block stays exactly as visible as its report, staff included: one EXISTS
-- rather than a second copy of "is this public" that can drift out of step.
drop policy report_blocks_read_published on public.report_blocks;
drop policy report_blocks_staff_write on public.report_blocks;

create policy report_blocks_select on public.report_blocks
  for select to anon, authenticated
  using (
    private.is_staff()
    or exists (
      select 1 from public.reports r
      where r.id = report_blocks.report_id and r.status = 'published'
    )
  );
create policy report_blocks_insert on public.report_blocks
  for insert to authenticated with check (private.is_staff());
create policy report_blocks_update on public.report_blocks
  for update to authenticated
  using (private.is_staff()) with check (private.is_staff());
create policy report_blocks_delete on public.report_blocks
  for delete to authenticated using (private.is_staff());

-- ── sources / series / series_points / events ────────────────────────
-- These are public in their own right — a chart deep-links to its series and a
-- source row is the citation — so SELECT is unconditional and needs no staff
-- branch at all.
drop policy sources_read on public.sources;
drop policy sources_staff_write on public.sources;

create policy sources_select on public.sources
  for select to anon, authenticated using (true);
create policy sources_insert on public.sources
  for insert to authenticated with check (private.is_staff());
create policy sources_update on public.sources
  for update to authenticated
  using (private.is_staff()) with check (private.is_staff());
create policy sources_delete on public.sources
  for delete to authenticated using (private.is_staff());

drop policy series_read on public.series;
drop policy series_staff_write on public.series;

create policy series_select on public.series
  for select to anon, authenticated using (true);
create policy series_insert on public.series
  for insert to authenticated with check (private.is_staff());
create policy series_update on public.series
  for update to authenticated
  using (private.is_staff()) with check (private.is_staff());
create policy series_delete on public.series
  for delete to authenticated using (private.is_staff());

drop policy series_points_read on public.series_points;
drop policy series_points_staff_write on public.series_points;

create policy series_points_select on public.series_points
  for select to anon, authenticated using (true);
create policy series_points_insert on public.series_points
  for insert to authenticated with check (private.is_staff());
create policy series_points_update on public.series_points
  for update to authenticated
  using (private.is_staff()) with check (private.is_staff());
create policy series_points_delete on public.series_points
  for delete to authenticated using (private.is_staff());

drop policy events_read on public.events;
drop policy events_staff_write on public.events;

create policy events_select on public.events
  for select to anon, authenticated using (true);
create policy events_insert on public.events
  for insert to authenticated with check (private.is_staff());
create policy events_update on public.events
  for update to authenticated
  using (private.is_staff()) with check (private.is_staff());
create policy events_delete on public.events
  for delete to authenticated using (private.is_staff());

-- report_revisions and staff keep their single FOR ALL / SELECT policies:
-- nothing else competes for the same action on either, so there is no union to
-- collapse.
