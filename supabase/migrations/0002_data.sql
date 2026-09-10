-- 0002_data — provenance, time series, and events.
--
-- `sources` is the load-bearing table here, and it exists because of a rule the
-- deck already enforces in code: what it will not do is invent. A missing
-- figure renders as a dash and a failed fetch keeps the previous value rather
-- than blanking it; EQ_IR and EQ_FIN ship EMPTY because a real filing link
-- beside an invented figure lends the invention the document's authority.
--
-- checks/sourced.js holds that in fourteen assertions against the deck. Here it
-- becomes structure: every figure a report prints either points at a source row
-- or is marked indicative, and the renderer says which, where the figures are.

create table public.sources (
  id            uuid primary key default gen_random_uuid(),
  key           text not null unique
                constraint sources_key_is_kebab check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name          text not null check (length(btrim(name)) > 0),
  publisher     text,
  url           text check (url is null or url ~ '^https://'),
  licence       text,
  retrieved_at  timestamptz,
  notes         text,

  -- The "not a live feed" chip, as data. A source marked indicative may be
  -- cited, but everything drawing on it has to say so where the figures are —
  -- not in a footnote underneath a table of confident numbers.
  is_indicative boolean not null default false,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger sources_touch_updated_at
  before update on public.sources
  for each row execute function public.touch_updated_at();

create type public.series_frequency as enum
  ('daily', 'weekly', 'monthly', 'quarterly', 'annual', 'irregular');

create table public.series (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique
             constraint series_key_is_kebab check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name       text not null check (length(btrim(name)) > 0),
  unit       text,
  frequency  public.series_frequency,
  source_id  uuid references public.sources(id) on delete restrict,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index series_source_idx on public.series (source_id);

create trigger series_touch_updated_at
  before update on public.series
  for each row execute function public.touch_updated_at();

create table public.series_points (
  series_id uuid not null references public.series(id) on delete cascade,
  ts        timestamptz not null,

  -- NULLABLE, deliberately. A gap in a series is a fact about the world — no
  -- print that day, a holiday, a suspended assessment — and it is not the same
  -- thing as a zero. Carrying the gap lets the chart draw a dash where the deck
  -- would; interpolating it would be inventing.
  value     double precision,

  -- Keyed on (series, ts) so a re-fetch upserts rather than duplicating. An
  -- ingestion that runs twice must not double the history.
  primary key (series_id, ts)
);

create type public.event_confidence as enum ('confirmed', 'reported', 'unconfirmed');

-- The Hormuz timeline, and every incident report after it.
create table public.events (
  id         uuid primary key default gen_random_uuid(),
  ts         timestamptz not null,
  kind       text not null check (length(btrim(kind)) > 0),
  title      text not null check (length(btrim(title)) > 0),
  summary    text,
  lat        double precision check (lat is null or lat between -90 and 90),
  lon        double precision check (lon is null or lon between -180 and 180),
  actor      text,
  severity   integer check (severity is null or severity between 1 and 5),

  -- Not decoration. This is "never invent a figure" applied to a claim: a
  -- strike that one outlet reported and nobody confirmed is a different object
  -- from one that is confirmed, and a map that draws them identically is
  -- asserting something the desk does not know. Defaults to the honest answer.
  confidence public.event_confidence not null default 'reported',

  source_id  uuid references public.sources(id) on delete restrict,
  source_url text check (source_url is null or source_url ~ '^https://'),
  tags       text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Half a coordinate is not a location, and it plots at the equator.
  constraint events_coords_are_a_pair
    check ((lat is null) = (lon is null))
);

create index events_ts_idx on public.events (ts desc);
create index events_kind_idx on public.events (kind);
create index events_source_idx on public.events (source_id);
create index events_tags_idx on public.events using gin (tags);

create trigger events_touch_updated_at
  before update on public.events
  for each row execute function public.touch_updated_at();

-- Left over from 0001: an unindexed foreign key is a sequential scan waiting
-- for the referenced row to be deleted.
create index report_revisions_created_by_idx on public.report_revisions (created_by);

comment on table public.sources is
  'Provenance ledger. Every figure a report prints cites a row here or is marked indicative.';
comment on column public.sources.is_indicative is
  'True when the figures are shaped like the feed rather than being it. The renderer must say so.';
comment on column public.series_points.value is
  'Nullable: a gap is a fact, not a zero. Never interpolate on write.';
comment on column public.events.confidence is
  'confirmed | reported | unconfirmed. A map that draws these identically asserts what nobody knows.';
