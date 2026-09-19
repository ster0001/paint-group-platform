-- =============================================================================
-- Home dashboard v2 · session 0a · capture: estimates + presentations (Part B1)
--
-- The dashboard is a reader. Before it can report who sold what, from which
-- lead, in which category, the send action has to write those facts down.
-- This file adds the columns, the one server function that sets them at send,
-- the triggers that derive lead source and category onto the account, and the
-- backfills from the history that already exists in estimate_events and
-- crm_events. Nothing here prices anything and nothing here builds a list.
--
-- What already existed and is NOT duplicated:
--   · estimates.presentation_id — the builder's tick (20260821). Per ESTIMATE,
--     not per job type: the presentations summary describes a per-job-type
--     tick that was never built. The dashboard groups by the ticked
--     presentation's category_label; no tick = "Uncategorised".
--   · estimates.valid_until — written at send (+60 days) and read by
--     crm_lapse_estimates. That IS `expires_at`; a second column would drift.
--   · estimate_events 'sent' (payload.by = the sender) and 'question' (the
--     customer's question RPC). sent_by_user_id is backfilled from the former;
--     the latter is the brief's `question_asked`.
--
-- New:
--   · estimates.sent_by_user_id — set once by send_estimate, server-owned
--     (NOT in the authenticated column grant), backfilled from 'sent' events.
--   · presentations.category_label — default = name (trigger), editable in
--     Settings → Presentations. Two presentations may share a label.
--   · accounts.category — the first presentation sent to the account while it
--     has none; never overwritten (Tom's ruling 19 Sep).
--   · accounts.lead_source + estimates.lead_source — the CRM's first-touch
--     vocabulary (lib/crm/attribution.ts SOURCES; pinned by
--     lib/estimate/dashboardCapture.test.ts). The account is the source of
--     truth; the estimate carries a copy for cohort reporting. Staff-built
--     estimates need it picked before send (send_estimate refuses without
--     it); legacy rows are 'unknown' = "Not recorded".
--   · estimate_events 'downloaded' — written by /api/estimates/downloaded
--     when the customer taps "Download estimate (PDF)".
-- =============================================================================

-- ---- 1 · the lead-source vocabulary, one place ------------------------------
-- Mirrors SOURCES in lib/crm/attribution.ts. A key added there is added here
-- in the same PR (the unit test reads this file and compares).
create or replace function public.lead_source_keys()
returns text[] language sql immutable as $$
  select array['referral', 'repeat_customer', 'paid_google', 'organic_search', 'paid_social',
               'social', 'email', 'sign_or_vehicle', 'phone', 'direct', 'other', 'unknown'];
$$;

-- ---- 2 · columns ------------------------------------------------------------
alter table public.estimates
  add column if not exists sent_by_user_id uuid references auth.users (id) on delete set null,
  add column if not exists lead_source     text;
create index if not exists estimates_sent_by_idx     on public.estimates (sent_by_user_id);
create index if not exists estimates_lead_source_idx on public.estimates (lead_source);

alter table public.accounts
  add column if not exists category    text,
  add column if not exists lead_source text;
create index if not exists accounts_category_idx    on public.accounts (category);
create index if not exists accounts_lead_source_idx on public.accounts (lead_source);

alter table public.presentations
  add column if not exists category_label text not null default '';

do $$ begin
  alter table public.estimates add constraint estimates_lead_source_check
    check (lead_source is null or lead_source = any (public.lead_source_keys()));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.accounts add constraint accounts_lead_source_check
    check (lead_source is null or lead_source = any (public.lead_source_keys()));
exception when duplicate_object then null; end $$;

-- The builder writes the picker's value; the sender is server-owned. The
-- estimates column grant is an explicit list (20260903), so a new column is
-- unwritable by staff until named here — sent_by_user_id is deliberately not.
grant update (lead_source) on public.estimates to authenticated;

-- ---- 3 · presentations: a blank label means "same as the name" --------------
create or replace function public.presentations_default_category_label()
returns trigger language plpgsql as $$
begin
  if new.category_label is null or btrim(new.category_label) = '' then
    new.category_label := new.name;
  end if;
  return new;
end $$;
drop trigger if exists presentations_category_label on public.presentations;
create trigger presentations_category_label
  before insert or update of name, category_label on public.presentations
  for each row execute function public.presentations_default_category_label();

update public.presentations set category_label = name where btrim(category_label) = '';

-- ---- 4 · lead source flows account ⇄ estimate -------------------------------
-- (a) The first touch (one crm_event per account, written by the wizard) is
--     the account's lead source when it has none, and fills every estimate of
--     that account that is still blank. SECURITY DEFINER: the wizard's
--     service client and a staff session must both be able to do this.
create or replace function public.crm_first_touch_sets_lead_source()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_src text := new.payload->>'source';
begin
  if new.account_id is null or v_src is null then return null; end if;
  if not (v_src = any (public.lead_source_keys())) then v_src := 'other'; end if;
  update public.accounts set lead_source = v_src
   where id = new.account_id and lead_source is null;
  update public.estimates e set lead_source = a.lead_source
    from public.accounts a
   where a.id = new.account_id and e.account_id = a.id and e.lead_source is null;
  return null;
end $$;
drop trigger if exists crm_events_first_touch_lead_source on public.crm_events;
create trigger crm_events_first_touch_lead_source
  after insert on public.crm_events
  for each row when (new.type = 'first_touch_recorded')
  execute function public.crm_first_touch_sets_lead_source();

-- (b) An estimate born or linked to an account inherits the account's lead
--     source when it has none of its own.
create or replace function public.estimates_inherit_lead_source()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.lead_source is null and new.account_id is not null then
    select a.lead_source into new.lead_source from public.accounts a where a.id = new.account_id;
  end if;
  return new;
end $$;
drop trigger if exists estimates_inherit_lead_source on public.estimates;
create trigger estimates_inherit_lead_source
  before insert or update of account_id, lead_source on public.estimates
  for each row execute function public.estimates_inherit_lead_source();

-- (c) What the estimate learns, the account keeps — once, never overwritten:
--     · a staff pick on the estimate becomes the account's lead source when
--       the account has none ('unknown' is not knowledge and never propagates);
--     · the first presentation SENT to the account becomes its category.
--     Fires on the send (sent_at) as well as on the link (account_id), so the
--     order the builder does them in does not matter.
create or replace function public.estimates_capture_to_account()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.account_id is null then return null; end if;
  if new.lead_source is not null and new.lead_source <> 'unknown' then
    update public.accounts set lead_source = new.lead_source
     where id = new.account_id and lead_source is null;
  end if;
  if new.sent_at is not null and new.presentation_id is not null then
    update public.accounts a set category = p.category_label
      from public.presentations p
     where a.id = new.account_id and a.category is null
       and p.id = new.presentation_id and btrim(p.category_label) <> '';
  end if;
  return null;
end $$;
drop trigger if exists estimates_capture_to_account on public.estimates;
create trigger estimates_capture_to_account
  after insert or update of account_id, lead_source, sent_at, presentation_id on public.estimates
  for each row execute function public.estimates_capture_to_account();

-- ---- 5 · send_estimate: who sent it, and not without a lead source ----------
-- Same body as 20260903 plus: sent_by_user_id (first send wins, like sent_at),
-- the lead-source gate, and the 'sent' event now records the presentation and
-- lead source at the moment of sending (the account's category derives from
-- them through the trigger above; sent_at changing is what fires it).
create or replace function public.send_estimate(
  p_estimate_id uuid, p_expected_status text, p_valid_until date default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_e public.estimates%rowtype; v_rows integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select * into v_e from public.estimates where id = p_estimate_id;
  if not found then return 'error:not_found'; end if;
  if v_e.status = 'accepted' then return 'conflict:accepted'; end if;   -- signed quotes are locked
  if v_e.share_token is null then return 'error:not_saved'; end if;
  if v_e.sent_snapshot is null then return 'error:nothing_to_send'; end if;
  if v_e.lead_source is null then return 'error:lead_source_required'; end if;

  update public.estimates
     set status = 'sent',
         sent_at = coalesce(sent_at, now()),
         sent_by_user_id = coalesce(sent_by_user_id, auth.uid()),
         valid_until = coalesce(p_valid_until, valid_until, (current_date + 60))
   where id = p_estimate_id
     and status::text = p_expected_status;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then return 'conflict:' || v_e.status; end if;

  insert into public.estimate_events (estimate_id, type, payload)
    values (p_estimate_id, 'sent', jsonb_build_object(
      'by', auth.uid(), 'presentation_id', v_e.presentation_id, 'lead_source', v_e.lead_source));

  return 'ok:sent';
end $$;
grant execute on function public.send_estimate(uuid, text, date) to authenticated;

-- ---- 6 · backfills, all idempotent ------------------------------------------
-- Who sent: the earliest 'sent' event's payload.by, only where that is a user
-- that still exists (the column is an FK).
update public.estimates e
   set sent_by_user_id = s.by_id
  from (
    select distinct on (ev.estimate_id) ev.estimate_id, (ev.payload->>'by')::uuid as by_id
      from public.estimate_events ev
     where ev.type = 'sent'
       and ev.payload->>'by' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     order by ev.estimate_id, ev.created_at asc
  ) s
 where s.estimate_id = e.id
   and e.sent_by_user_id is null
   and exists (select 1 from auth.users u where u.id = s.by_id);

-- Account lead source from the first touch the wizard recorded.
update public.accounts a
   set lead_source = case when (ev.payload->>'source') = any (public.lead_source_keys())
                          then ev.payload->>'source' else 'other' end
  from (
    select distinct on (account_id) account_id, payload
      from public.crm_events
     where type = 'first_touch_recorded' and account_id is not null and payload->>'source' is not null
     order by account_id, occurred_at asc
  ) ev
 where ev.account_id = a.id and a.lead_source is null;

-- Estimates: from their account; then everything that has already left draft
-- and still has none is 'unknown' ("Not recorded"). Drafts stay null so the
-- picker is required before they go out.
update public.estimates e set lead_source = a.lead_source
  from public.accounts a
 where a.id = e.account_id and e.lead_source is null and a.lead_source is not null;
update public.estimates set lead_source = 'unknown'
 where lead_source is null and status <> 'draft';

-- Account category: the first presentation ever sent to the account.
update public.accounts a
   set category = p.category_label
  from (
    select distinct on (e.account_id) e.account_id, e.presentation_id
      from public.estimates e
     where e.account_id is not null and e.presentation_id is not null and e.sent_at is not null
     order by e.account_id, e.sent_at asc
  ) first_sent
  join public.presentations p on p.id = first_sent.presentation_id
 where first_sent.account_id = a.id and a.category is null and btrim(p.category_label) <> '';

-- ---- read-back: what this file just made ------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and (table_name, column_name) in
      (('estimates','sent_by_user_id'), ('estimates','lead_source'),
       ('accounts','category'), ('accounts','lead_source'),
       ('presentations','category_label')))                                   as new_columns_expect_5,
  (select count(*) from pg_trigger where tgname in
      ('presentations_category_label', 'crm_events_first_touch_lead_source',
       'estimates_inherit_lead_source', 'estimates_capture_to_account'))       as new_triggers_expect_4,
  (select prosrc like '%lead_source_required%' from pg_proc
    where proname = 'send_estimate' limit 1)                                   as send_requires_lead_source,
  (select bool_or(privilege_type = 'UPDATE') from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'estimates'
      and column_name = 'lead_source' and grantee = 'authenticated')           as staff_may_write_lead_source,
  (select coalesce(bool_or(privilege_type = 'UPDATE'), false) from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'estimates'
      and column_name = 'sent_by_user_id' and grantee = 'authenticated')       as staff_may_write_sender_expect_false,
  (select count(*) from public.estimates where sent_by_user_id is not null)   as estimates_with_sender,
  (select count(*) from public.estimates where lead_source is not null)       as estimates_with_lead_source,
  (select count(*) from public.accounts  where lead_source is not null)       as accounts_with_lead_source,
  (select count(*) from public.accounts  where category is not null)          as accounts_with_category,
  (select count(*) from public.presentations where btrim(category_label) = '') as presentations_without_label_expect_0;

insert into public._prod_migrations(name) values ('20270175000000_dashboard_capture_estimates.sql') on conflict (name) do nothing;
