-- 0004_rls — who can see and do what.
--
-- Three principals:
--
--   anon           a reader. Sees published reports and the data behind them.
--                  Writes NOTHING, anywhere.
--   authenticated  a signed-in account. Same reads as anon by default; the
--                  writes below are narrowed to staff by policy.
--   service_role   the server. Bypasses RLS entirely; only ever used from
--                  Astro endpoints, never from anything the browser loads.
--
-- ── the one departure from the plan ──────────────────────────────────
-- The plan had anonymous readers INSERT-ing their own analytics rows, with no
-- SELECT so the lists could not be read back. That is not worth doing, because
-- the endpoint has to exist anyway: the country on a visitor row is derived
-- from the request IP, the IP is deliberately never stored, and the browser
-- cannot know its own country reliably. So /api/track is required regardless —
-- and once a server endpoint is in the path, a public write grant is pure extra
-- surface. Every write goes through the service role. anon gets read only.

create table public.staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'editor' check (role in ('editor', 'admin')),
  created_at timestamptz not null default now()
);

-- SECURITY DEFINER so a signed-in non-staff user can be tested against the
-- staff table without being granted sight of it. search_path is pinned empty
-- and every reference schema-qualified, so nothing can be shadowed into it.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.staff s where s.user_id = (select auth.uid()));
$$;

revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;

-- ── RLS on, everywhere ───────────────────────────────────────────────
-- RLS with no matching policy denies. Every table is listed explicitly rather
-- than looped, so adding a table without deciding its policy is a visible
-- omission in the next migration rather than a silent inheritance.
alter table public.reports           enable row level security;
alter table public.report_blocks     enable row level security;
alter table public.report_revisions  enable row level security;
alter table public.sources           enable row level security;
alter table public.series            enable row level security;
alter table public.series_points     enable row level security;
alter table public.events            enable row level security;
alter table public.visitors          enable row level security;
alter table public.interactions      enable row level security;
alter table public.subscribers       enable row level security;
alter table public.staff             enable row level security;

-- ── grants ───────────────────────────────────────────────────────────
-- Grants and RLS are AND-ed, so this is the second lock rather than the only
-- one. Start from nothing and hand back exactly what each role needs.
revoke all on all tables in schema public from anon, authenticated;

grant select on
  public.reports, public.report_blocks, public.sources,
  public.series, public.series_points, public.events
  to anon, authenticated;

grant select, insert, update, delete on
  public.reports, public.report_blocks, public.report_revisions,
  public.sources, public.series, public.series_points, public.events
  to authenticated;

grant select on public.staff to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ── reading: published only ──────────────────────────────────────────
create policy reports_read_published on public.reports
  for select to anon, authenticated
  using (status = 'published');

-- A block is exactly as public as the report it belongs to. Written as an
-- EXISTS against the report rather than a duplicated status column, because two
-- copies of "is this public" is how a draft's blocks end up readable after
-- someone unpublishes the report.
create policy report_blocks_read_published on public.report_blocks
  for select to anon, authenticated
  using (exists (
    select 1 from public.reports r
    where r.id = report_blocks.report_id and r.status = 'published'
  ));

-- The data behind the reports is public in its own right: a chart deep-links to
-- its series, and a source row is the citation. There is nothing here that is
-- not already printed on a page.
create policy sources_read on public.sources
  for select to anon, authenticated using (true);
create policy series_read on public.series
  for select to anon, authenticated using (true);
create policy series_points_read on public.series_points
  for select to anon, authenticated using (true);
create policy events_read on public.events
  for select to anon, authenticated using (true);

-- ── writing: staff only, and only when signed in ─────────────────────
-- (select auth.uid()) inside is_staff() is wrapped so the planner caches it as
-- an initplan instead of re-evaluating per row.
create policy reports_staff_write on public.reports
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy report_blocks_staff_write on public.report_blocks
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy report_revisions_staff on public.report_revisions
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy sources_staff_write on public.sources
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy series_staff_write on public.series
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy series_points_staff_write on public.series_points
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy events_staff_write on public.events
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Staff can see who else is staff, and nothing else touches this table.
create policy staff_read_self on public.staff
  for select to authenticated
  using (public.is_staff());

-- ── the funnel tables have NO policy at all ──────────────────────────
-- visitors, interactions and subscribers carry RLS with zero policies, which
-- denies every role except service_role. That is the whole intent: reader data
-- is written by /api/track and read by /admin, both server-side. A subscriber
-- list that no public key can reach is one that cannot be scraped.

comment on function public.is_staff() is
  'True when the caller is in public.staff. SECURITY DEFINER so non-staff can be tested without seeing the table.';
comment on table public.staff is
  'Editorial allowlist. Rows are added by hand or by the service role; there is no self-signup.';
