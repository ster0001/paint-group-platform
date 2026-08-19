-- =============================================================================
-- Manual status changes by staff (feature: click the status, pick a new one).
--
-- The status column is server-owned (20260903 revoked direct UPDATE on it), so
-- a manual change goes through this SECURITY DEFINER RPC, same shape as
-- send_estimate. Staff-only. Accepted+signed estimates stay locked. A move to
-- 'declined' records the reason the customer gave.
--
-- Allowed manual targets: draft, sent, declined, expired. 'accepted' is NOT a
-- manual target — acceptance requires the signed customer flow
-- (accept_estimate), and this RPC refuses it so a staff click can never forge
-- a signature.
-- =============================================================================

create or replace function public.set_estimate_status(
  p_estimate_id uuid,
  p_status text,
  p_reason text default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_e public.estimates%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_status not in ('draft', 'sent', 'declined', 'expired') then
    return 'error:bad_status';
  end if;

  select * into v_e from public.estimates where id = p_estimate_id;
  if not found then return 'error:not_found'; end if;
  -- A signed acceptance is a legal record; unwinding it isn't a status click.
  if v_e.status = 'accepted' then return 'conflict:accepted'; end if;
  if v_e.status::text = p_status then return 'ok:' || p_status; end if; -- no-op

  update public.estimates
     set status = p_status::public.estimate_status,
         -- keep sent_at once set, so the timeline doesn't lie about first send
         sent_at = case when p_status = 'sent' then coalesce(sent_at, now()) else sent_at end,
         declined_at = case when p_status = 'declined' then now() else declined_at end,
         declined_reason = case when p_status = 'declined' then p_reason else declined_reason end
   where id = p_estimate_id;

  insert into public.estimate_events (estimate_id, type, payload)
    values (
      p_estimate_id,
      'status_changed',
      jsonb_build_object('to', p_status, 'from', v_e.status, 'by', auth.uid(),
                         'reason', case when p_status = 'declined' then p_reason else null end)
    );

  return 'ok:' || p_status;
end $$;

grant execute on function public.set_estimate_status(uuid, text, text) to authenticated;

-- ---- Verification -----------------------------------------------------------
-- As staff:  select public.set_estimate_status('<id>', 'declined', 'Went with a cheaper quote');
--   -> estimates.status='declined', declined_reason set, an estimate_events row.
-- select public.set_estimate_status('<accepted id>', 'draft');  -> 'conflict:accepted'
-- select public.set_estimate_status('<id>', 'accepted');        -> 'error:bad_status'
