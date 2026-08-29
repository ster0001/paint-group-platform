-- =============================================================================
-- Fix: crm_log_event() could never write with a dedupe key
--
-- Found by running it, minutes after 20261205 was applied. The function used
--
--     on conflict (dedupe_key) do nothing
--
-- and the unique index it names is PARTIAL (`where dedupe_key is not null`).
-- Postgres will not infer a partial index from a bare column list, so EVERY
-- keyed write — every campaign sweep, every webhook, every idempotent log —
-- failed with 42P10 "no unique or exclusion constraint matching the ON
-- CONFLICT specification". Unkeyed writes were unaffected, which is exactly
-- how this would have hidden: the timeline would have worked and the sweeps
-- would have thrown.
--
-- The fix drops ON CONFLICT entirely rather than teaching it the predicate.
-- Catching unique_violation is the more honest shape here: the pre-SELECT
-- handles the ordinary repeat, and the handler covers only the genuine race
-- of two sweeps writing the same key at the same instant.
--
-- Same signature, so this is a replacement, not a second function.
-- =============================================================================

create or replace function public.crm_log_event(
  p_type          text,
  p_account_id    uuid    default null,
  p_payload       jsonb   default '{}'::jsonb,
  p_source        text    default 'system',
  p_occurred_at   timestamptz default null,
  p_estimate_id   uuid    default null,
  p_work_order_id uuid    default null,
  p_invoice_id    uuid    default null,
  p_property_id   uuid    default null,
  p_dedupe_key    text    default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_actor uuid := auth.uid();
begin
  if not (public.is_staff() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'crm_log_event: not permitted' using errcode = '42501';
  end if;

  -- The ordinary repeat: the same key has already been written.
  if p_dedupe_key is not null then
    select id into v_id from public.crm_events where dedupe_key = p_dedupe_key;
    if v_id is not null then return v_id; end if;
  end if;

  begin
    insert into public.crm_events
      (account_id, property_id, estimate_id, work_order_id, invoice_id,
       type, source, actor_profile_id, payload, occurred_at, dedupe_key)
    values
      (p_account_id, p_property_id, p_estimate_id, p_work_order_id, p_invoice_id,
       p_type, p_source, v_actor, coalesce(p_payload, '{}'::jsonb),
       coalesce(p_occurred_at, now()), p_dedupe_key)
    returning id into v_id;
  exception when unique_violation then
    -- Lost the race on the dedupe key: the winner's row is the answer.
    select id into v_id from public.crm_events where dedupe_key = p_dedupe_key;
  end;

  return v_id;
end $$;

revoke all on function public.crm_log_event(text, uuid, jsonb, text, timestamptz, uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.crm_log_event(text, uuid, jsonb, text, timestamptz, uuid, uuid, uuid, uuid, text) to authenticated;

-- ---- Verification -----------------------------------------------------------
-- As staff:
--   select public.crm_log_event('note_added', null, '{"body":"probe"}'::jsonb,
--                               'staff', null, null, null, null, null, 'probe-key');
--   select public.crm_log_event('note_added', null, '{"body":"probe"}'::jsonb,
--                               'staff', null, null, null, null, null, 'probe-key');
--   -> the same uuid twice, and one row:
--   select count(*) from crm_events where dedupe_key = 'probe-key';   -> 1
