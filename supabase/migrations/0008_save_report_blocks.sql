-- 0008_save_report_blocks — save an edited report in one transaction.
--
-- ── the problem ──────────────────────────────────────────────────────
-- Saving an edited report is three operations: snapshot what is there, remove
-- the blocks that went, write the ones that stayed in their new order. Over
-- PostgREST each of those is its own request and therefore its own
-- transaction, so a failure between them leaves a published report half
-- rewritten — blocks deleted and not replaced, or a reorder applied to some
-- rows and not others. There is no "undo" for a reader who loaded the page in
-- between.
--
-- The deferrable unique on (report_id, ord) from 0001 exists so a reorder can
-- be one transaction. It cannot help across three of them.
--
-- ── SECURITY INVOKER, deliberately ───────────────────────────────────
-- This runs as the caller, so every policy in 0004/0006 still applies: the
-- delete needs private.is_staff(), the insert needs it in `with check`, and a
-- signed-in non-staff user calling this directly gets refused by the database
-- rather than by whatever the UI remembered to check. The function is
-- convenience and atomicity; it is not authority.
--
-- SECURITY DEFINER here would have been a single function that rewrites any
-- report for anyone who can reach the RPC endpoint — which is everyone.

create or replace function public.save_report_blocks(
  p_report_id uuid,
  p_blocks    jsonb,
  p_note      text default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  written integer;
begin
  if jsonb_typeof(p_blocks) <> 'array' then
    raise exception 'p_blocks must be a JSON array, got %', jsonb_typeof(p_blocks);
  end if;

  -- History first, so the snapshot is of what is being replaced. If anything
  -- below fails the whole call rolls back and the snapshot goes with it, which
  -- is right: there is no new version to have a history of.
  insert into public.report_revisions (report_id, snapshot, note, created_by)
  select
    p_report_id,
    jsonb_build_object(
      'report', to_jsonb(r),
      'blocks', coalesce(
        (select jsonb_agg(to_jsonb(b) order by b.ord)
           from public.report_blocks b
          where b.report_id = p_report_id),
        '[]'::jsonb
      )
    ),
    p_note,
    (select auth.uid())
  from public.reports r
  where r.id = p_report_id;

  -- A report with no row here is not an empty report, it is a wrong id.
  if not found then
    raise exception 'no report with id %', p_report_id using errcode = 'no_data_found';
  end if;

  delete from public.report_blocks where report_id = p_report_id;

  insert into public.report_blocks (report_id, ord, kind, payload)
  select p_report_id, x.ord, x.kind::public.block_kind, x.payload
  from jsonb_to_recordset(p_blocks) as x(ord integer, kind text, payload jsonb);

  get diagnostics written = row_count;

  -- The report's own updated_at is about the report a reader sees, and its
  -- blocks are most of that. Touching it here keeps "when did this last
  -- change" true without the editor having to remember a second write.
  update public.reports set updated_at = now() where id = p_report_id;

  return written;
end;
$$;

revoke all on function public.save_report_blocks(uuid, jsonb, text) from public, anon;
grant execute on function public.save_report_blocks(uuid, jsonb, text) to authenticated;

comment on function public.save_report_blocks(uuid, jsonb, text) is
  'Replace a report''s blocks in one transaction, snapshotting the previous version. SECURITY INVOKER: RLS still decides who may.';
