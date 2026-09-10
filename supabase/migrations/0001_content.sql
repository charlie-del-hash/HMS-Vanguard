-- 0001_content — reports, their blocks, and the editor's history.
--
-- A report is a row plus an ordered list of blocks. The block payload is jsonb
-- because eleven block kinds do not share a column set and never will; what is
-- NOT in jsonb is anything the site queries or orders by, which is why slug,
-- status, published_at and ord are real columns with real constraints.

create extension if not exists pgcrypto;

-- Every row carrying an updated_at gets this, so "when did this last change"
-- is a fact about the database rather than a thing the editor remembers to do.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create type public.report_status as enum ('draft', 'scheduled', 'published', 'archived');

create table public.reports (
  id           uuid primary key default gen_random_uuid(),
  -- The slug is the URL. Kebab-case is enforced here rather than trusted from
  -- the editor, because a slug with a space in it is a 404 nobody notices.
  slug         text not null unique
               constraint reports_slug_is_kebab check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  kicker       text,
  title        text not null check (length(btrim(title)) > 0),
  dek          text,
  summary      text,
  status       public.report_status not null default 'draft',
  published_at timestamptz,
  author       text,
  region       text,
  tags         text[] not null default '{}',
  read_minutes integer check (read_minutes is null or read_minutes > 0),
  hero         jsonb not null default '{}'::jsonb,
  og_image     text check (og_image is null or og_image ~ '^https://'),
  -- The way through to the Affinity research portal. https only, checked here
  -- as well as at the point of use — the deck's irOf() rule, applied to the
  -- store rather than only to the render.
  portal_url   text check (portal_url is null or portal_url ~ '^https://'),
  seo          jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Undated research is worthless: a reader cannot tell whether it is current,
  -- and an editorial mistake here is invisible until someone acts on a stale
  -- number. A report cannot reach 'published' without a date on it.
  constraint reports_published_needs_a_date
    check (status <> 'published' or published_at is not null),
  -- Same for scheduled: a schedule with no time is not a schedule.
  constraint reports_scheduled_needs_a_date
    check (status <> 'scheduled' or published_at is not null)
);

create index reports_status_published_idx
  on public.reports (status, published_at desc nulls last);
create index reports_tags_idx on public.reports using gin (tags);

create trigger reports_touch_updated_at
  before update on public.reports
  for each row execute function public.touch_updated_at();

create type public.block_kind as enum (
  'prose', 'kpi_row', 'chart', 'timeline', 'map', 'table',
  'callout', 'quote', 'sourcebox', 'cta', 'embed'
);

create table public.report_blocks (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references public.reports(id) on delete cascade,
  ord        integer not null check (ord >= 0),
  kind       public.block_kind not null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- DEFERRABLE on purpose. Reordering blocks means several rows briefly hold
  -- the same ord; an immediate constraint forces the editor into a shuffle
  -- through temporary values, which is how a reorder ends up half-applied.
  -- Deferred, the whole reorder is one transaction that is either right at
  -- commit or rejected entirely.
  constraint report_blocks_ord_unique unique (report_id, ord) deferrable initially deferred
);

create index report_blocks_report_ord_idx on public.report_blocks (report_id, ord);

create trigger report_blocks_touch_updated_at
  before update on public.report_blocks
  for each row execute function public.touch_updated_at();

-- Autosave and history for the editor. A snapshot is the whole report plus its
-- blocks, so restoring one never has to reassemble anything.
create table public.report_revisions (
  id         bigint generated always as identity primary key,
  report_id  uuid not null references public.reports(id) on delete cascade,
  snapshot   jsonb not null,
  note       text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index report_revisions_report_idx
  on public.report_revisions (report_id, created_at desc);

comment on table public.reports is
  'Special reports. The funnel''s product. Anonymous readers see status=published only.';
comment on table public.report_blocks is
  'Ordered content blocks. payload shape varies by kind; see src/lib/blocks.ts.';
comment on table public.report_revisions is
  'Editor autosave and history. Never read by the public site.';
