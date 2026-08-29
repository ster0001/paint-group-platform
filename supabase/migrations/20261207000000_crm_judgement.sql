-- =============================================================================
-- CRM session 2.2 · staff judgement on the account, and the writes that log
--
-- Stage is DERIVED from facts and never stored (brief rev 2 §3). These three
-- are the opposite: they are judgement, they cannot be worked out from the
-- record, and so they live on the account.
--
--   temperature      hot / warm / cold — "Mark hot / warm / cold" in the mockup
--   snoozed_until    "not now, ask me again after this date"
--   followup_due_at  "Follow up on…", which the mockup says *sets a reminder*
--
-- Each one is written by its own RPC rather than by an UPDATE from the app,
-- for one reason: every judgement is ALSO an event. A temperature that changed
-- with no `temperature_set` row in the log would leave the timeline lying about
-- what happened, and the timeline is the thing the office trusts. One function,
-- one round trip, both writes or neither.
--
-- Idempotent; read-backs at the end.
-- =============================================================================

alter table public.accounts
  add column if not exists temperature        text
    constraint accounts_temperature_check check (temperature in ('hot', 'warm', 'cold')),
  add column if not exists temperature_set_at timestamptz,
  add column if not exists snoozed_until      timestamptz,
  add column if not exists followup_due_at    timestamptz,
  add column if not exists followup_note      text;

comment on column public.accounts.temperature is
  'Staff judgement, not derived. Null = never set. Set only through crm_set_temperature().';
comment on column public.accounts.snoozed_until is
  'Card sits out of the "needs you today" counts until this passes. Set only through crm_snooze().';

-- The board asks "who needs me today" constantly; these are its two filters.
create index if not exists accounts_followup_idx on public.accounts (followup_due_at)
  where followup_due_at is not null;
create index if not exists accounts_snooze_idx on public.accounts (snoozed_until)
  where snoozed_until is not null;

-- Belt and braces against the estimates-column-grant trap (20260903): a column
-- added after a column-level grant needs its own. A no-op where a table grant
-- already stands. RLS still restricts every writer to staff.
grant update (temperature, temperature_set_at, snoozed_until, followup_due_at, followup_note)
  on public.accounts to authenticated;

-- ---- 1 · temperature -------------------------------------------------------

create or replace function public.crm_set_temperature(p_account_id uuid, p_temperature text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_prev text;
  v_event uuid;
begin
  if not public.is_staff() then
    raise exception 'crm_set_temperature: staff only' using errcode = '42501';
  end if;
  if p_temperature is not null and p_temperature not in ('hot', 'warm', 'cold') then
    raise exception 'crm_set_temperature: temperature must be hot, warm or cold';
  end if;

  select temperature into v_prev from public.accounts where id = p_account_id for update;
  if not found then raise exception 'crm_set_temperature: no such account'; end if;

  update public.accounts
     set temperature = p_temperature,
         temperature_set_at = case when p_temperature is null then null else now() end
   where id = p_account_id;

  -- Setting the same temperature twice is not an event; nothing happened.
  if v_prev is distinct from p_temperature and p_temperature is not null then
    v_event := public.crm_log_event(
      'temperature_set', p_account_id,
      jsonb_build_object('temperature', p_temperature, 'previous', to_jsonb(v_prev)),
      'staff');
  end if;
  return v_event;
end $$;

-- ---- 2 · snooze ------------------------------------------------------------

create or replace function public.crm_snooze(p_account_id uuid, p_until timestamptz, p_reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_event uuid;
begin
  if not public.is_staff() then
    raise exception 'crm_snooze: staff only' using errcode = '42501';
  end if;
  if p_until is not null and p_until <= now() then
    raise exception 'crm_snooze: a snooze must end in the future';
  end if;

  update public.accounts set snoozed_until = p_until where id = p_account_id;
  if not found then raise exception 'crm_snooze: no such account'; end if;

  if p_until is not null then
    v_event := public.crm_log_event(
      'snoozed', p_account_id,
      jsonb_build_object('until', p_until) || case when p_reason is null then '{}'::jsonb
                                                   else jsonb_build_object('reason', p_reason) end,
      'staff');
  end if;
  return v_event;
end $$;

-- ---- 3 · follow-up reminder ------------------------------------------------

create or replace function public.crm_set_followup(p_account_id uuid, p_due_at timestamptz, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_event uuid;
begin
  if not public.is_staff() then
    raise exception 'crm_set_followup: staff only' using errcode = '42501';
  end if;

  update public.accounts
     set followup_due_at = p_due_at,
         followup_note = case when p_due_at is null then null else p_note end
   where id = p_account_id;
  if not found then raise exception 'crm_set_followup: no such account'; end if;

  if p_due_at is not null then
    v_event := public.crm_log_event(
      'followup_set', p_account_id,
      jsonb_build_object('dueAt', p_due_at) || case when p_note is null then '{}'::jsonb
                                                    else jsonb_build_object('note', p_note) end,
      'staff');
  end if;
  return v_event;
end $$;

revoke all on function public.crm_set_temperature(uuid, text) from public, anon;
revoke all on function public.crm_snooze(uuid, timestamptz, text) from public, anon;
revoke all on function public.crm_set_followup(uuid, timestamptz, text) from public, anon;
grant execute on function public.crm_set_temperature(uuid, text) to authenticated;
grant execute on function public.crm_snooze(uuid, timestamptz, text) to authenticated;
grant execute on function public.crm_set_followup(uuid, timestamptz, text) to authenticated;

-- ---- Verification -----------------------------------------------------------
-- As staff, against any real account id:
--   select public.crm_set_temperature('<account id>', 'hot');
--   select temperature, temperature_set_at from accounts where id = '<account id>';
--   select type, payload from crm_events where account_id = '<account id>'
--     order by recorded_at desc limit 1;      -> temperature_set · {"temperature":"hot",...}
--
--   select public.crm_set_temperature('<account id>', 'hot');   -- again
--   select count(*) from crm_events where account_id = '<account id>'
--     and type = 'temperature_set';           -> still 1: nothing happened, nothing logged
--
--   select public.crm_snooze('<account id>', now() - interval '1 day');
--     -> ERROR: a snooze must end in the future
