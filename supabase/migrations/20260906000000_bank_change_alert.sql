-- =============================================================================
-- Bank-detail changes raise a staff alert - audit finding S10
--
-- Of the three controls the standard asks for on bank details, two were already
-- in place: encrypted at rest, displayed masked. The third - "changes trigger a
-- staff alert" - was not. `contractor_set_bank` has always written a
-- 'bank_changed' row into contractor_events, but nothing ever read it.
--
-- This is the invoice-redirection fraud vector: someone who reaches a
-- contractor's login changes the account number, and the next payment run sends
-- the money somewhere else. Nobody notices, because nothing on any screen says
-- the number moved.
--
-- Two changes:
--   1. the event records what it changed FROM, so staff can compare it against
--      whatever the contractor has on their invoices;
--   2. the event can be acknowledged, so the alert is a queue that empties
--      rather than a log nobody reads.
-- =============================================================================

-- ---- 1. acknowledgement -----------------------------------------------------
alter table public.contractor_events
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledged_by uuid references auth.users (id) on delete set null;

-- The alert query is "unacknowledged, newest first" - index for exactly that.
create index if not exists contractor_events_unack_idx
  on public.contractor_events (created_at desc)
  where acknowledged_at is null;

-- Staff-only, and it stamps who did it rather than trusting the caller to say.
create or replace function public.acknowledge_contractor_event(p_event_id uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  update public.contractor_events
     set acknowledged_at = now(), acknowledged_by = auth.uid()
   where id = p_event_id and acknowledged_at is null;

  if not found then
    -- Either it doesn't exist or someone else got there first. Both are fine to
    -- report the same way: the alert is gone either way.
    return case when exists (select 1 from public.contractor_events where id = p_event_id)
                then 'ok:already' else 'error:not_found' end;
  end if;
  return 'ok:acknowledged';
end $$;
revoke all on function public.acknowledge_contractor_event(uuid) from public, anon;
grant execute on function public.acknowledge_contractor_event(uuid) to authenticated;

-- Acknowledging goes through the function above, so the columns themselves stay
-- out of client hands - the same lock-down pattern as offerable/tier/active.
--
-- Nothing in the application writes this table from the browser: every event is
-- written by a SECURITY DEFINER function (contractor_set_bank, send_offer,
-- withdraw_offer), which runs as the owner and is unaffected by these grants.
-- So the write privilege can go entirely rather than being pared back - an
-- audit trail a suspect can edit, or pad with forged rows, is not an audit
-- trail.
revoke insert, update, delete on public.contractor_events from authenticated;

-- ---- 2. the event says what changed -----------------------------------------
-- Unchanged from 20260823000000 except for the detail payload: same signature,
-- same `extensions` on the search_path (pgcrypto lives there on Supabase).
create or replace function public.contractor_set_bank(p_bsb text, p_account text)
returns void language plpgsql security definer set search_path = public, vault, extensions as $$
declare
  v_cid uuid; v_key text;
  v_prev_bsb text; v_prev_last4 text; v_new_last4 text;
begin
  select id, bank_bsb, bank_account_last4 into v_cid, v_prev_bsb, v_prev_last4
    from public.contractors where profile_id = auth.uid();
  if v_cid is null then raise exception 'not a contractor'; end if;

  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'contractor_bank_key';
  v_new_last4 := right(regexp_replace(coalesce(p_account, ''), '\D', '', 'g'), 4);

  update public.contractors
     set bank_bsb = p_bsb,
         bank_account_enc = pgp_sym_encrypt(coalesce(p_account, ''), v_key),
         bank_account_last4 = v_new_last4
   where id = v_cid;

  -- Only when something actually moved. Re-saving the same numbers (which the
  -- form invites, since the account field always starts empty) is not an alert,
  -- and a queue that fills with non-events is a queue staff stop reading.
  --
  -- `first_time` separates "a painter finished their profile" from "the account
  -- we have been paying just changed" - very different things to be told.
  if v_prev_last4 is distinct from v_new_last4 or v_prev_bsb is distinct from p_bsb then
    insert into public.contractor_events (contractor_id, type, detail, actor)
    values (
      v_cid,
      'bank_changed',
      jsonb_build_object(
        'bsb', p_bsb,
        'last4', v_new_last4,
        'prev_bsb', v_prev_bsb,
        'prev_last4', v_prev_last4,
        'first_time', (v_prev_last4 is null)
      ),
      auth.uid()
    );
  end if;
end $$;
grant execute on function public.contractor_set_bank(text, text) to authenticated;

-- ---- Verification -----------------------------------------------------------
-- As a contractor, save bank details twice with different numbers, then as staff:
--   select type, detail, acknowledged_at from contractor_events order by created_at desc limit 2;
-- The second row should carry prev_last4. Saving the SAME numbers a third time
-- must add no row at all.
-- As a contractor this must fail (column not granted):
--   update contractor_events set acknowledged_at = now();
