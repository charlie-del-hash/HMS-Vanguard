-- 0009_funnel_access — record events atomically, and let staff read the funnel.
--
-- ── 1. why an RPC for the write ──────────────────────────────────────
-- A visitor's attribution is FIRST-touch. The referrer and UTM tags that
-- brought someone in are pinned on the first hit and must survive every visit
-- after it, or a reader who arrives from a newsletter and comes back directly
-- a week later is recorded as having arrived directly — and the newsletter
-- loses the credit for a signup it earned.
--
-- That is an `on conflict (anon_id) do update set last_seen = now()` and
-- nothing else. PostgREST's upsert writes every column it is given, so through
-- the REST API the choice is overwrite the attribution or do two round trips
-- with a race between them. One function, one statement, correct semantics.
--
-- SECURITY INVOKER: /api/track holds the service role, which bypasses RLS
-- anyway, so this needs no elevation of its own. Execute is revoked from anon
-- and authenticated so the only caller is the endpoint.
--
-- ── 2. why staff get a SELECT policy ─────────────────────────────────
-- 0004 left these three tables with RLS and no policies, and noted that the
-- admin would read them with the service role. That works and it puts the
-- authorization back in route code — one forgotten guard and the subscriber
-- list is public, with the database's own rules reduced to decoration.
--
-- A staff-only SELECT policy is strictly better: /admin/analytics reads as the
-- signed-in user, and it is the database that decides. anon is unaffected —
-- it has neither a grant nor a policy, so the funnel tables stay exactly as
-- unreachable as checks/db-rls.js asserts.

create or replace function public.record_events(
  p_anon_id  uuid,
  p_visitor  jsonb,
  p_events   jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  written integer;
begin
  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'p_events must be a JSON array, got %', jsonb_typeof(p_events);
  end if;

  insert into public.visitors (
    anon_id, referrer, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    country, device
  )
  values (
    p_anon_id,
    nullif(p_visitor->>'referrer', ''),
    nullif(p_visitor->>'utm_source', ''),
    nullif(p_visitor->>'utm_medium', ''),
    nullif(p_visitor->>'utm_campaign', ''),
    nullif(p_visitor->>'utm_content', ''),
    nullif(p_visitor->>'utm_term', ''),
    nullif(p_visitor->>'country', ''),
    nullif(p_visitor->>'device', '')::public.device_class
  )
  on conflict (anon_id) do update
    -- last_seen ONLY. Everything else is first-touch and stays as it landed.
    set last_seen = now();

  insert into public.interactions (anon_id, ts, kind, report_slug, meta)
  select
    p_anon_id,
    coalesce((e->>'ts')::timestamptz, now()),
    e->>'kind',
    nullif(e->>'slug', ''),
    coalesce(e->'meta', '{}'::jsonb)
  from jsonb_array_elements(p_events) as e
  where length(btrim(coalesce(e->>'kind', ''))) > 0;

  get diagnostics written = row_count;
  return written;
end;
$$;

revoke all on function public.record_events(uuid, jsonb, jsonb) from public, anon, authenticated;

comment on function public.record_events(uuid, jsonb, jsonb) is
  'Append funnel events and touch the visitor, preserving FIRST-touch attribution. Service role only.';

-- ── staff may read what they are measuring ───────────────────────────
grant select on public.visitors     to authenticated;
grant select on public.interactions to authenticated;
grant select on public.subscribers  to authenticated;

-- `drop … if exists` first, because Postgres has no `create or replace policy`
-- and every other object in this file is replaceable. Without these three
-- lines a re-run aborts on "policy already exists" partway through, which
-- leaves whoever is running it unsure how much of the file took effect.
drop policy if exists visitors_select_staff     on public.visitors;
drop policy if exists interactions_select_staff on public.interactions;
drop policy if exists subscribers_select_staff  on public.subscribers;

create policy visitors_select_staff on public.visitors
  for select to authenticated using (private.is_staff());
create policy interactions_select_staff on public.interactions
  for select to authenticated using (private.is_staff());
create policy subscribers_select_staff on public.subscribers
  for select to authenticated using (private.is_staff());

-- Still no INSERT, UPDATE or DELETE policy on any of the three, for any role.
-- Writing stays the service role's job through /api/track and /api/subscribe,
-- which is what keeps a public key from being able to forge a funnel.
