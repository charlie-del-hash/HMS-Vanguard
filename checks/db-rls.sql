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

-- ── funnel fixtures ──────────────────────────────────────────────────
-- Added with 0009, which granted `authenticated` the table grant on all three
-- of these and left RLS as the only thing between a signed-in stranger and the
-- subscriber list. Nothing here asserted that until now, and "no policy matches
-- so it denies" is a claim about a file rather than about the database.
insert into public.visitors (anon_id, country, device)
values ('99999999-9999-4999-8999-999999999999', 'GB', 'desktop');

insert into public.interactions (anon_id, kind, report_slug)
values ('99999999-9999-4999-8999-999999999999', 'pageview', 'rls-check-published-fixture');

insert into public.subscribers (email, anon_id, consent)
values ('rls-check@example.com', '99999999-9999-4999-8999-999999999999', true);

-- ── a staff fixture ──────────────────────────────────────────────────
-- `staff.user_id` references auth.users, so the account has to be real. Only
-- `id` is NOT NULL without a default, and the whole script rolls back, so this
-- is a row that exists for the length of one transaction and never commits.
--
-- It is here because "non-staff is refused" on its own is satisfied by a policy
-- that refuses EVERYONE — including the editor. The negative assertion is only
-- worth something next to the positive one.
insert into auth.users (id) values ('11111111-1111-4111-8111-111111111111');
insert into public.staff (user_id, role) values ('11111111-1111-4111-8111-111111111111', 'admin');

-- ── as an anonymous reader ───────────────────────────────────────────
set local role anon;

insert into rls_res
select 'anon: published report visible',  count(*) = 1 from public.reports where slug = 'rls-check-published-fixture'
union all
select 'anon: DRAFT report invisible',    count(*) = 0 from public.reports where slug = 'rls-check-draft-fixture'
union all
-- Counted over the FIXTURES, not over the whole table. This said
-- `count(*) = 1 from public.report_blocks` and passed against an empty
-- database; the first real report put 20-odd blocks in there and it started
-- failing for a reason that had nothing to do with a policy. An assertion
-- about a shared database has to name its own rows.
select 'anon: only published block visible', count(*) = 1 from public.report_blocks
       where payload->>'text' in ('public', 'secret')
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
select 'anon: cannot use private schema', not has_schema_privilege('anon','private','usage')
union all
-- record_events is SECURITY INVOKER and /api/track calls it with the service
-- role. If anon could execute it, a browser holding the publishable key could
-- write the funnel tables directly and every number in the dashboard would be
-- whatever a stranger decided it was.
select 'anon: record_events NOT executable',
       not has_function_privilege('anon','public.record_events(uuid,jsonb,jsonb)','execute')
union all
select 'anon: save_report_blocks NOT executable',
       not has_function_privilege('anon','public.save_report_blocks(uuid,jsonb,text)','execute')
union all
select 'anon: mailable_subscribers NOT readable',
       not has_table_privilege('anon','public.mailable_subscribers','select');

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
select 'auth non-staff: is_staff() is false', private.is_staff() = false
union all
-- ── the three that 0009 left RLS holding on its own ──────────────────
-- The grant assertions are not padding. `count(*) = 0` also comes back from a
-- table nobody may select from at all — except that a missing grant RAISES
-- rather than returning zero, so without the pair a future migration that
-- revoked the grant would look identical to a policy that works.
select 'auth non-staff: HOLDS the select grant on visitors',
       has_table_privilege('authenticated','public.visitors','select')
union all
select 'auth non-staff: visitors invisible',     count(*) = 0 from public.visitors
union all
select 'auth non-staff: HOLDS the select grant on interactions',
       has_table_privilege('authenticated','public.interactions','select')
union all
select 'auth non-staff: interactions invisible', count(*) = 0 from public.interactions
union all
select 'auth non-staff: HOLDS the select grant on subscribers',
       has_table_privilege('authenticated','public.subscribers','select')
union all
select 'auth non-staff: subscribers invisible',  count(*) = 0 from public.subscribers
union all
-- The view is security_invoker, so it inherits the table's policy rather than
-- becoming a way around it. This is the assertion that says so.
select 'auth non-staff: mailable_subscribers invisible',
       count(*) = 0 from public.mailable_subscribers;

reset role;

-- ── as a signed-in account that IS staff ─────────────────────────────
-- auth.uid() reads `sub` out of request.jwt.claims, so setting that claim and
-- then becoming `authenticated` is what a real signed-in editor's request looks
-- like to every policy in the database.
select set_config(
  'request.jwt.claims',
  json_build_object('sub','11111111-1111-4111-8111-111111111111','role','authenticated')::text,
  true
);
set local role authenticated;

insert into rls_res
select 'staff: is_staff() is true',        private.is_staff() = true
union all
select 'staff: DRAFT report visible',      count(*) = 1 from public.reports where slug = 'rls-check-draft-fixture'
union all
select 'staff: visitors readable',         count(*) >= 1 from public.visitors
union all
select 'staff: interactions readable',     count(*) >= 1 from public.interactions
union all
select 'staff: subscribers readable',      count(*) >= 1 from public.subscribers
union all
-- Empty on purpose: the fixture consented but is not `verified`, and nothing in
-- this project sets `verified` because double opt-in is not built. A row here
-- would mean something had started treating a claim as a permission.
select 'staff: mailable_subscribers empty', count(*) = 0 from public.mailable_subscribers;

reset role;
select set_config('request.jwt.claims', '', true);

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
