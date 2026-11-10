-- =============================================================================
-- 20270309 · Estimates tab & funnel, session 1 — the wizard session on the log
-- =============================================================================
-- Brief: docs/briefs/claude-code-brief-estimates-tab-funnel.md, rulings
-- E-A (underscore names, reuse what exists) and E-B (events can point at a
-- wizard session). Ruled by Tom 11 Nov 2026.
--
-- 1 · crm_events.wizard_draft_id. The wizard session is `wizard_drafts`
--     (20270107: there is no second sessions table). Until now an event only
--     carried it as payload.sessionId, unindexed, so everything this session
--     did was a scan of the whole log. The column is ON DELETE SET NULL like
--     every other link on the log, and the append-only guard learns that a
--     draft link going to null is a deletion, not an edit.
-- 2 · crm_log_event gains p_wizard_draft_id (last, default null). Same body
--     otherwise. The old ten-argument signature is dropped so there is one
--     function; every existing caller names its arguments and omits the new
--     one, so it resolves to this one unchanged.
-- 3 · The draft writes its own two funnel events, so every path that stamps
--     the column counts (the submit route, the visit-hold path, anything
--     later) without each remembering to log:
--       gate_completed_at null -> set   => wizard_gate_submitted
--       visits goes up                  => wizard_session_resumed {visit}
--     A failure here must never fail the save a customer makes, so it is caught
--     and raised as a WARNING (it reaches the Postgres log), never swallowed.
--
-- Converges on a re-run. Paste in ONE go; the last statement is the ledger row.
-- =============================================================================

set lock_timeout = '15s';

-- ---- 1 · the column, its index, the guard ------------------------------------
alter table public.crm_events
  add column if not exists wizard_draft_id uuid references public.wizard_drafts (id) on delete set null;

create index if not exists crm_events_wizard_draft_idx
  on public.crm_events (wizard_draft_id, occurred_at desc) where wizard_draft_id is not null;

create or replace function public.crm_events_no_update()
returns trigger language plpgsql as $$
declare v_same boolean := new.type = old.type and new.payload = old.payload and new.occurred_at = old.occurred_at
                          and new.source = old.source and new.dedupe_key is not distinct from old.dedupe_key;
begin
  if v_same and new.account_id is not distinct from old.account_id
     and (new.estimate_id is null or new.estimate_id = old.estimate_id)
     and (new.work_order_id is null or new.work_order_id = old.work_order_id)
     and (new.invoice_id is null or new.invoice_id = old.invoice_id)
     and (new.property_id is null or new.property_id = old.property_id)
     and (new.wizard_draft_id is null or new.wizard_draft_id = old.wizard_draft_id) then
    return new;  -- a linked row was deleted; the event keeps its history, loses the pointer
  end if;
  if current_setting('crm.merge', true) = 'on' and v_same and new.account_id is distinct from old.account_id then
    return new;  -- crm_merge_accounts re-pointing the events of the dropped account
  end if;
  raise exception 'crm_events is append-only: % on % is not allowed', tg_op, tg_table_name
    using hint = 'Record a correcting event instead of editing the original.';
end $$;

-- ---- 2 · crm_log_event, one signature -----------------------------------------
drop function if exists public.crm_log_event(text, uuid, jsonb, text, timestamptz, uuid, uuid, uuid, uuid, text);

create or replace function public.crm_log_event(
  p_type            text,
  p_account_id      uuid    default null,
  p_payload         jsonb   default '{}'::jsonb,
  p_source          text    default 'system',
  p_occurred_at     timestamptz default null,
  p_estimate_id     uuid    default null,
  p_work_order_id   uuid    default null,
  p_invoice_id      uuid    default null,
  p_property_id     uuid    default null,
  p_dedupe_key      text    default null,
  p_wizard_draft_id uuid    default null
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
      (account_id, property_id, estimate_id, work_order_id, invoice_id, wizard_draft_id,
       type, source, actor_profile_id, payload, occurred_at, dedupe_key)
    values
      (p_account_id, p_property_id, p_estimate_id, p_work_order_id, p_invoice_id, p_wizard_draft_id,
       p_type, p_source, v_actor, coalesce(p_payload, '{}'::jsonb),
       coalesce(p_occurred_at, now()), p_dedupe_key)
    returning id into v_id;
  exception when unique_violation then
    -- Lost the race on the dedupe key: the row of the winner is the answer.
    select id into v_id from public.crm_events where dedupe_key = p_dedupe_key;
  end;

  return v_id;
end $$;

revoke all on function public.crm_log_event(text, uuid, jsonb, text, timestamptz, uuid, uuid, uuid, uuid, text, uuid) from public, anon;
grant execute on function public.crm_log_event(text, uuid, jsonb, text, timestamptz, uuid, uuid, uuid, uuid, text, uuid) to authenticated;

-- ---- 3 · the funnel events of the draft itself ----------------------------------------
-- A trigger function: no grant, it runs as the owner.
create or replace function public.wizard_drafts_crm_funnel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.gate_completed_at is not null and (tg_op = 'INSERT' or old.gate_completed_at is null) then
      insert into public.crm_events (account_id, estimate_id, wizard_draft_id, type, source, payload, occurred_at, dedupe_key)
      values (new.account_id, new.estimate_id, new.id, 'wizard_gate_submitted', 'customer',
              jsonb_build_object('sessionId', new.id), new.gate_completed_at, 'wiz-gatesub:' || new.id)
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end if;
    if tg_op = 'UPDATE' and coalesce(new.visits, 1) > coalesce(old.visits, 1) then
      insert into public.crm_events (account_id, estimate_id, wizard_draft_id, type, source, payload, occurred_at, dedupe_key)
      values (new.account_id, new.estimate_id, new.id, 'wizard_session_resumed', 'customer',
              jsonb_build_object('visit', new.visits, 'sessionId', new.id), now(), 'wiz-resume:' || new.id || ':' || new.visits)
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end if;
  exception when others then
    raise warning 'wizard_drafts_crm_funnel: % (%), draft %', sqlerrm, sqlstate, new.id;
  end;
  return new;
end $$;

drop trigger if exists t_wizard_drafts_crm_funnel on public.wizard_drafts;
create trigger t_wizard_drafts_crm_funnel
  after insert or update of gate_completed_at, visits on public.wizard_drafts
  for each row execute function public.wizard_drafts_crm_funnel();

-- ---- read-back ------------------------------------------------------------------
-- Compare every value to its _expect_ neighbour before anything is called live.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'crm_events' and column_name = 'wizard_draft_id') as col, 1 as _expect_col,
  (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'crm_events_wizard_draft_idx') as idx, 1 as _expect_idx,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'crm_log_event') as log_fns, 1 as _expect_log_fns,
  (select pronargs from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'crm_log_event') as log_args, 11 as _expect_log_args,
  has_function_privilege('authenticated', 'public.crm_log_event(text, uuid, jsonb, text, timestamptz, uuid, uuid, uuid, uuid, text, uuid)', 'execute') as log_auth, true as _expect_log_auth,
  has_function_privilege('anon', 'public.crm_log_event(text, uuid, jsonb, text, timestamptz, uuid, uuid, uuid, uuid, text, uuid)', 'execute') as log_anon, false as _expect_log_anon,
  (select count(*) from pg_trigger where tgname = 't_wizard_drafts_crm_funnel' and not tgisinternal) as funnel_trigger, 1 as _expect_funnel_trigger,
  (select position('wizard_draft_id' in prosrc) > 0 from pg_proc where proname = 'crm_events_no_update') as guard_knows, true as _expect_guard_knows;

insert into public._prod_migrations(name) values ('20270309000000_funnel_events_session1.sql') on conflict (name) do nothing;
