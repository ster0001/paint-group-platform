-- =============================================================================
-- CRM v2 · P1c — the facts layer: crm_account_facts
--
-- docs/briefs/crm-v2-deep-dive.md §3 F4 and §6.2. The Customers list loaded
-- the first 500 accounts and the newest 2,000 events across the whole
-- business, ran the stage rules over them in memory, and printed the
-- truncated count as the total. At 50–100 jobs a week that breaks in weeks.
--
-- This table is the CACHED result of the stage rules for every account — the
-- board card, the sort keys, the counters — so lists, searches, counts and
-- (later) audience rules run as SQL with paging. It is DERIVED and
-- rebuildable: nothing here is a source of truth, and `lib/crm/facts.ts` can
-- rebuild every row from the event log and the estimates/work-order/invoice
-- tables at any time. That keeps faith with the standing rule that stage is
-- never stored as a status column somebody drags — nobody writes this table
-- by hand, and a row disagreeing with the record is a row that has not been
-- refreshed yet, which `stale` says out loud.
--
-- Who marks a row stale: triggers on the tables whose change can move a card
-- (crm_events, accounts, estimates, work_orders, invoices, wizard_drafts,
-- properties). Who refreshes it: the TS refresher, which runs the SAME
-- `stageFor`/`buildBoard` the screens always ran — one implementation of the
-- rules, not a second one in SQL — after every CRM write, opportunistically
-- on CRM reads, and in full from the daily sweep.
--
-- A3: tenant_id. RLS staff-only (read and write — the refresher runs under
-- the staff session on CRM pages and under the service role in the sweep).
-- =============================================================================

create table if not exists public.crm_account_facts (
  account_id            uuid primary key references public.accounts (id) on delete cascade,
  tenant_id             uuid not null references public.tenants (id) default public.current_tenant(),

  -- identity mirror, for search and sort without a join
  name                  text,
  email                 text,
  phone                 text,
  suburb                text,
  account_type          text not null default 'residential',
  temperature           text,
  owner_id              uuid,
  search                text not null default '',

  -- the card, exactly as buildBoard computes it
  stage                 text not null default 'enquiry_unfinished',
  stage_since           timestamptz,
  because               text not null default '',
  meta                  text not null default '',
  chips                 text[] not null default '{}',
  flags                 jsonb not null default '{}'::jsonb,
  needs_you             boolean not null default false,
  wants_call            boolean not null default false,
  call_why              text[] not null default '{}',
  value_cents           bigint,
  source                text,
  note                  text,
  draft_bucket          text,
  draft_last_seen_at    timestamptz,

  -- counters and dates the list sorts and the rules read
  quote_at              timestamptz,
  last_activity_at      timestamptz,
  last_contact_at       timestamptz,
  last_contact_channel  text,
  opened_count          integer not null default 0,
  last_opened_at        timestamptz,
  estimates_count       integer not null default 0,
  open_value_cents      bigint not null default 0,
  won_cents             bigint not null default 0,
  last_job_completed_at timestamptz,
  next_followup_at      timestamptz,
  snoozed_until         timestamptz,

  stale                 boolean not null default true,
  refreshed_at          timestamptz
);
-- Added after the table first shipped to the test stack; a no-op on a fresh create.
alter table public.crm_account_facts add column if not exists meta text not null default '';

comment on table public.crm_account_facts is
  'DERIVED, rebuildable cache of the stage rules per account (lib/crm/facts.ts). Never edited by hand; a stale row is a row the refresher has not reached yet.';

create index if not exists crm_account_facts_stage_idx on public.crm_account_facts (tenant_id, stage);
create index if not exists crm_account_facts_stale_idx on public.crm_account_facts (refreshed_at nulls first) where stale;
create index if not exists crm_account_facts_quote_idx on public.crm_account_facts (quote_at desc nulls last);
create index if not exists crm_account_facts_activity_idx on public.crm_account_facts (last_activity_at desc nulls last);
create index if not exists crm_account_facts_value_idx on public.crm_account_facts (value_cents desc nulls last);
create index if not exists crm_account_facts_needs_idx on public.crm_account_facts (needs_you) where needs_you;
create index if not exists crm_account_facts_owner_idx on public.crm_account_facts (owner_id) where owner_id is not null;

-- Search: pg_trgm makes "%kennedy%" an index scan. Supabase ships it; if the
-- role cannot create it, the search still works as a scan over short strings.
do $$
begin
  create extension if not exists pg_trgm with schema extensions;
exception when others then
  raise notice 'pg_trgm not created (%): search runs without the index', sqlerrm;
end $$;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_trgm') then
    execute 'create index if not exists crm_account_facts_search_trgm on public.crm_account_facts using gin (search extensions.gin_trgm_ops)';
  end if;
exception when others then
  raise notice 'trgm index not created (%)', sqlerrm;
end $$;

alter table public.crm_account_facts enable row level security;
drop policy if exists crm_account_facts_staff on public.crm_account_facts;
create policy crm_account_facts_staff on public.crm_account_facts
  for all to authenticated
  using ((select public.is_staff()) and tenant_id = public.current_tenant())
  with check ((select public.is_staff()) and tenant_id = public.current_tenant());

-- ---- staleness ---------------------------------------------------------------
create or replace function public.crm_facts_touch(p_account uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_account is null then return; end if;
  insert into public.crm_account_facts (account_id, stale)
  values (p_account, true)
  on conflict (account_id) do update set stale = true;
end $$;
revoke all on function public.crm_facts_touch(uuid) from public, anon, authenticated;

-- crm_events: every event marks the account stale; the cheap counters that
-- do not need the rules (last activity, last contact) update in place so the
-- list is right even before the refresher runs. A logged call now COUNTS as
-- activity — the fault the deep dive found at data.ts:27.
create or replace function public.crm_events_touch_facts()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_channel text;
begin
  if new.account_id is null then return new; end if;
  v_channel := case
    when new.type in ('call_connected', 'call_no_answer', 'message_left') then 'phone'
    when new.type = 'sms_reply' then 'sms'
    when new.type = 'estimate_sent' then 'email'
    when new.type = 'campaign_message_sent' then coalesce(new.payload->>'channel', 'email')
    when new.type in ('visit_completed') then 'visit'
    else null end;
  insert into public.crm_account_facts (account_id, stale, last_activity_at, last_contact_at, last_contact_channel)
  values (new.account_id, true,
          case when new.type = 'web_event' then null else new.occurred_at end,
          case when v_channel is null then null else new.occurred_at end,
          v_channel)
  on conflict (account_id) do update set
    stale = true,
    last_activity_at = case when new.type = 'web_event' then crm_account_facts.last_activity_at
                            else greatest(coalesce(crm_account_facts.last_activity_at, new.occurred_at), new.occurred_at) end,
    last_contact_at = case when v_channel is null then crm_account_facts.last_contact_at
                           else greatest(coalesce(crm_account_facts.last_contact_at, new.occurred_at), new.occurred_at) end,
    last_contact_channel = case when v_channel is not null and new.occurred_at >= coalesce(crm_account_facts.last_contact_at, '-infinity'::timestamptz)
                                then v_channel else crm_account_facts.last_contact_channel end;
  return new;
end $$;
drop trigger if exists t_crm_events_touch_facts on public.crm_events;
create trigger t_crm_events_touch_facts after insert on public.crm_events
  for each row execute function public.crm_events_touch_facts();

-- The identity mirror and the search text are kept true here, so a record
-- created a second ago is findable before the refresher reaches it.
create or replace function public.accounts_touch_facts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.crm_account_facts (account_id, stale, name, email, phone, account_type, temperature, owner_id, snoozed_until, next_followup_at, search)
  values (new.id, true, new.name, new.email, new.phone, new.account_type, new.temperature, new.owner_id, new.snoozed_until, new.followup_due_at,
          lower(concat_ws(' ', new.name, new.email, new.phone, regexp_replace(coalesce(new.phone, ''), '\s+', '', 'g'), new.phone_e164)))
  on conflict (account_id) do update set
    stale = true, name = excluded.name, email = excluded.email, phone = excluded.phone, account_type = excluded.account_type,
    temperature = excluded.temperature, owner_id = excluded.owner_id, snoozed_until = excluded.snoozed_until, next_followup_at = excluded.next_followup_at,
    search = case when crm_account_facts.refreshed_at is null then excluded.search else crm_account_facts.search end;
  return new;
end $$;
drop trigger if exists t_accounts_touch_facts on public.accounts;
create trigger t_accounts_touch_facts
  after insert or update of name, email, phone, account_type, temperature, snoozed_until, followup_due_at, owner_id on public.accounts
  for each row execute function public.accounts_touch_facts();

create or replace function public.estimates_touch_facts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.crm_facts_touch(new.account_id);
  if tg_op = 'UPDATE' and old.account_id is distinct from new.account_id then perform public.crm_facts_touch(old.account_id); end if;
  return new;
end $$;
drop trigger if exists t_estimates_touch_facts on public.estimates;
create trigger t_estimates_touch_facts
  after insert or update of status, sent_at, viewed_at, accepted_at, declined_at, total_cents, accepted_total_cents, account_id, title, job_kind on public.estimates
  for each row execute function public.estimates_touch_facts();

create or replace function public.work_orders_touch_facts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.crm_facts_touch((select account_id from public.estimates where id = new.estimate_id));
  return new;
end $$;
drop trigger if exists t_work_orders_touch_facts on public.work_orders;
create trigger t_work_orders_touch_facts
  after insert or update of stage, status, start_date, end_date on public.work_orders
  for each row execute function public.work_orders_touch_facts();

create or replace function public.wizard_drafts_touch_facts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.crm_facts_touch(new.account_id);
  return new;
end $$;
drop trigger if exists t_wizard_drafts_touch_facts on public.wizard_drafts;
create trigger t_wizard_drafts_touch_facts
  after insert or update of bucket, last_seen_at, converted_at, account_id, est_value_cents, progress_pct on public.wizard_drafts
  for each row execute function public.wizard_drafts_touch_facts();

create or replace function public.properties_touch_facts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.crm_facts_touch(new.account_id);
  return new;
end $$;
drop trigger if exists t_properties_touch_facts on public.properties;
create trigger t_properties_touch_facts
  after insert or update of suburb, address, account_id on public.properties
  for each row execute function public.properties_touch_facts();

-- Every account gets a row, stale, so the refresher's "what is stale" query
-- is the only backfill needed.
insert into public.crm_account_facts (account_id, name, email, phone, account_type, temperature, owner_id, snoozed_until, next_followup_at, stale)
select a.id, a.name, a.email, a.phone, a.account_type, a.temperature, a.owner_id, a.snoozed_until, a.followup_due_at, true
  from public.accounts a
on conflict (account_id) do nothing;

-- Seed the two cheap counters from the log so sorting is right before the
-- first refresh reaches every row.
update public.crm_account_facts f
   set last_activity_at = s.last_activity, last_contact_at = s.last_contact
  from (
    select account_id,
           max(occurred_at) filter (where type <> 'web_event') as last_activity,
           max(occurred_at) filter (where type in ('call_connected', 'call_no_answer', 'message_left', 'sms_reply', 'estimate_sent', 'campaign_message_sent', 'visit_completed')) as last_contact
      from public.crm_events where account_id is not null group by account_id
  ) s
 where s.account_id = f.account_id;

-- ---- the board's counts and tiles, from SQL ----------------------------------
create or replace function public.crm_board_counts()
returns table (stage text, cards bigint, needs_you bigint)
language sql stable security invoker as $$
  select stage, count(*), count(*) filter (where needs_you)
    from public.crm_account_facts
   where tenant_id = public.current_tenant()
   group by stage $$;
grant execute on function public.crm_board_counts() to authenticated;

-- ---- the board's tiles, from SQL ---------------------------------------------
create or replace function public.crm_board_tiles(p_stages text[] default null)
returns table (overdue_followups bigint, going_cold bigint, open_value_cents bigint, won_90d bigint, lost_90d bigint)
language sql stable security invoker as $$
  with f as (
    select * from public.crm_account_facts
     where tenant_id = public.current_tenant()
       and stage not in ('past_customer', 'lost')
       and (p_stages is null or stage = any (p_stages))
  )
  select
    (select count(*) from f where (flags->>'followupOverdue')::boolean and not coalesce((flags->>'snoozed')::boolean, false)),
    (select count(*) from f where (flags->>'goingCold')::boolean and not coalesce((flags->>'snoozed')::boolean, false)),
    (select coalesce(sum(value_cents), 0) from f),
    (select count(*) from public.estimates where accepted_at >= now() - interval '90 days'),
    (select count(*) from public.estimates where declined_at >= now() - interval '90 days' and accepted_at is null) $$;
grant execute on function public.crm_board_tiles(text[]) to authenticated;

-- ---- Read-back --------------------------------------------------------------
select
  (select count(*) from public.crm_account_facts) as facts_rows,
  (select count(*) from public.accounts) as accounts,
  (select count(*) from public.crm_account_facts where stale) as stale_rows,
  (select count(*) from pg_trigger where tgname like '%touch_facts') as touch_triggers,
  (select count(*) from pg_policies where tablename = 'crm_account_facts') as policies,
  exists (select 1 from pg_indexes where indexname = 'crm_account_facts_search_trgm') as trgm_index;
