-- 0010_mailable_subscribers — make the safe query the easy one.
--
-- ── the problem ──────────────────────────────────────────────────────
-- /api/subscribe is public and unauthenticated by necessity, so `consent`
-- arrives from the caller. A script can assert it for an address that never
-- agreed, and no amount of origin-checking changes that — Astro's same-origin
-- check stops a form on somebody else's site, not a loop with a header set.
--
-- So `subscribers.consent` records a CLAIM. That is fine, and it is the honest
-- thing to store. What is not fine is a mailer written six months from now
-- that does `select email from subscribers where consent` and sends to every
-- address anybody ever claimed on behalf of.
--
-- `verified` is the flag that actually authorises a send, and nothing sets it
-- yet — double opt-in is the mechanism that would, and it is not built. Until
-- it is, this view returns nothing, which is the correct answer: there is
-- currently nobody this project may email.
--
-- The point of the view is that the obvious query is the safe one. Somebody
-- would have to go out of their way to query the raw table instead, and going
-- out of your way is exactly the friction this needs.

create or replace view public.mailable_subscribers
with (security_invoker = true) as
  select
    s.id,
    s.email,
    s.created_at,
    s.source_report,
    s.utm_source,
    s.utm_medium,
    s.utm_campaign
  from public.subscribers s
  where s.consent = true          -- they said yes
    and s.verified = true         -- and we confirmed it was them
    and s.unsubscribed_at is null -- and they have not since said no
;

-- security_invoker so the view does not become a way around the staff-only
-- RLS policy on the table beneath it. Without it a view owned by postgres
-- would read with the owner's rights and hand the subscriber list to anyone
-- who could select from the view.
comment on view public.mailable_subscribers is
  'The only list anything may send to. consent is a claim from a public endpoint; verified is the permission, and nothing sets it until double opt-in exists — so this is empty on purpose.';

-- ── the grant Supabase makes for you ─────────────────────────────────
-- A new view in `public` inherits the project's default privileges, which hand
-- SELECT to anon as well as authenticated. checks/db-rls.sql caught it: the
-- view was readable by the anonymous role the moment it was created, and the
-- `grant` below looked like it was the thing deciding that.
--
-- No row ever leaked — security_invoker means the base table's staff-only
-- policy still answers, so anon selects nothing. But "it returns nothing
-- because of a policy two objects away" is not where the subscriber list
-- should be defended, and a future `security_invoker = false` typo would turn
-- an existing grant into an open door rather than an error.
revoke all on public.mailable_subscribers from anon;
grant select on public.mailable_subscribers to authenticated;

comment on column public.subscribers.consent is
  'What the caller CLAIMED at signup. Public endpoint, so it is not proof. Never send on this alone — use public.mailable_subscribers.';
