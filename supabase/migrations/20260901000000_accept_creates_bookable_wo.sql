-- =============================================================================
-- An accepted estimate should be bookable straight away
--
-- accept_estimate created the work order as a DRAFT with no document, and the
-- scheduling tray only showed ISSUED work orders. So an accepted job sat
-- invisible to whoever does the scheduling until somebody remembered to open
-- the estimate and press "Issue to contractor" — a hidden prerequisite with no
-- prompt anywhere.
--
-- The builder now saves the contractor-safe document into
-- builder_state->'woDoc' on every save, so acceptance can carry it straight
-- onto the work order and mark it issued. No second implementation of the
-- pricing maths — it is the same document the builder already computes.
--
-- Estimates saved before this change have no woDoc; those still create a draft
-- and show in the tray as "needs issuing", which is honest rather than broken.
-- =============================================================================

create or replace function public.accept_estimate(
  p_token text, p_name text, p_options jsonb, p_total_cents integer, p_deposit_cents integer
) returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status public.estimate_status; v_share text; v_doc jsonb;
begin
  select id, status, share_token, builder_state->'woDoc'
    into v_id, v_status, v_share, v_doc
    from public.estimates where share_token = p_token;
  if v_id is null then return 'not_found'; end if;
  if v_status = 'accepted' then return 'already'; end if;

  update public.estimates
    set status = 'accepted', accepted_at = now(), accepted_name = p_name,
        selected_options = p_options, total_cents = coalesce(p_total_cents, total_cents)
    where id = v_id;

  insert into public.estimate_events (estimate_id, type, payload)
    values (v_id, 'accepted', jsonb_build_object('name', p_name, 'options', p_options, 'total_cents', p_total_cents));

  insert into public.invoices (estimate_id, status, amount_cents, issued_on)
    values (v_id, 'draft', coalesce(p_deposit_cents, 0), current_date);

  -- Carry the saved document across. With one, the job is ready to offer; without
  -- one it stays a draft and the board asks staff to issue it.
  insert into public.work_orders (estimate_id, wo_ref, share_token, wo_snapshot, issued_at, status)
    values (
      v_id,
      'WO-' || upper(substr(coalesce(v_share, replace(gen_random_uuid()::text,'-','')), 1, 8)),
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      v_doc,
      case when v_doc is not null then now() else null end,
      case when v_doc is not null then 'issued'::public.wo_status else 'draft'::public.wo_status end
    )
    on conflict (estimate_id) do nothing;

  return 'accepted';
end; $$;

grant execute on function public.accept_estimate(text, text, jsonb, integer, integer) to anon, authenticated;

-- ---- backfill: existing accepted estimates that never got issued -------------
-- Uses the document the builder has already saved, where there is one.
update public.work_orders w
   set wo_snapshot = e.builder_state->'woDoc',
       issued_at = now(),
       status = 'issued'
  from public.estimates e
 where w.estimate_id = e.id
   and w.issued_at is null
   and e.builder_state->'woDoc' is not null;

-- ---- Verification -----------------------------------------------------------
-- Accept an estimate that has been saved since this change, then:
--   select wo_ref, status, issued_at is not null as issued from work_orders
--    where estimate_id = '<id>';
--   -> expect issued = true, and the job appears in the scheduling tray ready to drag.
