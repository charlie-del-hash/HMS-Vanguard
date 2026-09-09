-- The same assertions as checks/db-rls.js, run inside the database.
--
-- Two reasons this exists alongside the JS check rather than instead of it:
--
--   · The JS check is the honest one — it uses the real publishable key over
--     the real API, which is what a reader actually holds. But it needs network
--     egress to the project, and a locked-down CI box or sandbox may not have
--     it. When it cannot connect it exits 2 and refuses to report, so something
--     has to cover the gap.
--   · This one tests the policies where they live. `set local role` makes the
--     session genuinely anon or authenticated, so the policies are evaluated
--     for real; what it cannot see is anything PostgREST does on top, which is
--     why it is the companion and not the replacement.
--
-- Run it through the Supabase SQL editor, psql, or the MCP execute_sql tool.
-- It creates its own fixtures and removes them. Every row must read pass = true.

begin;

create temp table rls_res(assertion text, pass boolean);
-- Both impersonated roles write their own results, so both need the grant.
-- (Without this the script fails on its first assertion with a permission
-- error on the RESULTS table, which reads alarmingly like a policy failure.)
grant insert on rls_res to anon, authenticated;

insert into public.reports (slug, title, status, published_at) values
  ('rls-check-published-fixture', 'RLS check - published', 'published', now()),
  ('rls-check-draft-fixture',     'RLS check - draft',     'draft',     null);

insert into public.report_blocks (report_id, ord, kind, payload)
select id, 0, 'prose',
       jsonb_build_object('text', case when status = 'published' then 'public' else 'secret' end)
from public.reports where slug like 'rls-check-%';

-- ── as an anonymous reader ───────────────────────────────────────────
set local role anon;

insert into rls_res
select 'anon: published report visible',  count(*) = 1 from public.reports where slug = 'rls-check-published-fixture'
union all
select 'anon: DRAFT report invisible',    count(*) = 0 from public.reports where slug = 'rls-check-draft-fixture'
union all
select 'anon: only published block visible', count(*) = 1 from public.report_blocks
union all
select 'anon: DRAFT block invisible',     count(*) = 0 from public.report_blocks where payload->>'text' = 'secret'
union all
select 'anon: sources readable',          count(*) >= 0 from public.sources
union all
select 'anon: series readable',           count(*) >= 0 from public.series
union all
select 'anon: series_points readable',    count(*) >= 0 from public.series_points
union all
select 'anon: events readable',           count(*) >= 0 from public.events
union all
select 'anon: visitors NOT readable',     not has_table_privilege('anon','public.visitors','select')
union all
select 'anon: interactions NOT readable', not has_table_privilege('anon','public.interactions','select')
union all
select 'anon: subscribers NOT readable',  not has_table_privilege('anon','public.subscribers','select')
union all
select 'anon: staff NOT readable',        not has_table_privilege('anon','public.staff','select')
union all
select 'anon: no insert on reports',      not has_table_privilege('anon','public.reports','insert')
union all
select 'anon: no update on reports',      not has_table_privilege('anon','public.reports','update')
union all
select 'anon: no delete on reports',      not has_table_privilege('anon','public.reports','delete')
union all
select 'anon: no insert on report_blocks',not has_table_privilege('anon','public.report_blocks','insert')
union all
select 'anon: no insert on sources',      not has_table_privilege('anon','public.sources','insert')
union all
select 'anon: no insert on events',       not has_table_privilege('anon','public.events','insert')
union all
select 'anon: no insert on interactions', not has_table_privilege('anon','public.interactions','insert')
union all
select 'anon: no insert on subscribers',  not has_table_privilege('anon','public.subscribers','insert')
union all
select 'anon: no insert on visitors',     not has_table_privilege('anon','public.visitors','insert')
union all
select 'anon: cannot use private schema', not has_schema_privilege('anon','private','usage');

reset role;

-- ── as a signed-in account that is NOT staff ─────────────────────────
-- This is the interesting one: authenticated HOLDS the table grants, so RLS is
-- the only thing in the way. An earlier draft of these policies would have let
-- the DELETE through, because DELETE has no WITH CHECK to catch it.
set local role authenticated;

do $$
begin
  begin
    insert into public.reports (slug, title) values ('auth-nonstaff-intruder', 'no');
    insert into rls_res values ('auth non-staff: INSERT on reports refused', false);
  exception when others then
    insert into rls_res values ('auth non-staff: INSERT on reports refused', true);
  end;

  update public.reports set title = 'defaced' where slug = 'rls-check-published-fixture';
  insert into rls_res values ('auth non-staff: UPDATE on reports refused', not found);

  delete from public.reports where slug = 'rls-check-published-fixture';
  insert into rls_res values ('auth non-staff: DELETE on reports refused', not found);

  begin
    insert into public.events (ts, kind, title) values (now(), 'rls-check', 'no');
    insert into rls_res values ('auth non-staff: INSERT on events refused', false);
  exception when others then
    insert into rls_res values ('auth non-staff: INSERT on events refused', true);
  end;
end $$;

insert into rls_res
select 'auth non-staff: published visible', count(*) = 1 from public.reports where slug = 'rls-check-published-fixture'
union all
select 'auth non-staff: DRAFT invisible',   count(*) = 0 from public.reports where slug = 'rls-check-draft-fixture'
union all
select 'auth non-staff: is_staff() is false', private.is_staff() = false;

reset role;

insert into rls_res
select 'the published fixture survived intact',
       exists (select 1 from public.reports
               where slug = 'rls-check-published-fixture' and title = 'RLS check - published')
union all
select 'no intruder report was created',
       not exists (select 1 from public.reports where slug = 'auth-nonstaff-intruder')
union all
select 'no stray event was created',
       not exists (select 1 from public.events where kind = 'rls-check');

select
  count(*) filter (where pass) || '/' || count(*) as score,
  count(*) filter (where not pass)                as failures
from rls_res;

select assertion, pass from rls_res where not pass order by assertion;

rollback;  -- fixtures and all
