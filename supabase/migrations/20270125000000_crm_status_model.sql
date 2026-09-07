-- =============================================================================
-- CRM v2 · P4 — the status model: relationship state, contact permissions,
-- tags, and what they mean for the rules
--
-- docs/briefs/crm-v2-deep-dive.md §4.5 (Tom accepted decisions 8.3, 8.4, 8.11).
-- "More buckets" done as one bigger dropdown becomes the field nobody updates.
-- These are five INDEPENDENT dimensions, each with one job:
--
--   · stage           — DERIVED (lib/crm/stage.ts), never set by hand
--   · relationship    — stored, staff-set, one value:
--                       active · delayed (until a date, with a reason and what to
--                       do when it wakes) · do_not_contact · lost (one of the
--                       five ruled reasons) · archived
--   · permissions     — per channel (email, sms, phone): allowed / declined /
--                       unknown, WITH provenance (who, when, how) — the consent
--                       record legal will ask for (C9)
--   · temperature     — stored, staff-set (unchanged; set-by/at recorded)
--   · tags            — office-defined list, free to filter and to target
--
-- Rules that read them, in this file:
--   · a NEW estimate on a lost customer re-opens them (state → active, logged)
--   · either channel declined keeps marketing_unsubscribed_at set (the guard
--     chain reads it until P5 reads the per-channel columns); both allowed
--     again clears it
--   · a `delayed` whose date has passed is DERIVED as awake: the facts and
--     Today treat it as active and ask a person — no sweep needed
--   · the facts row mirrors state / until / tags / permissions so lists,
--     chips and (P5) audience rules read them in SQL
--
-- A3: crm_tags carries tenant_id. Idempotent; read-back.
-- =============================================================================

-- ---- 1 · columns ---------------------------------------------------------------
alter table public.accounts
  add column if not exists relationship_state text not null default 'active'
    constraint accounts_relationship_state_check
    check (relationship_state in ('active', 'delayed', 'do_not_contact', 'lost', 'archived')),
  add column if not exists state_until timestamptz,
  add column if not exists state_reason text,
  add column if not exists state_note text,
  add column if not exists state_set_at timestamptz,
  add column if not exists state_set_by uuid references public.profiles (id) on delete set null,
  add column if not exists lost_reason text
    constraint accounts_lost_reason_check
    check (lost_reason is null or lost_reason in ('went_with_someone_else', 'too_expensive', 'just_planning', 'change_of_circumstances', 'something_else')),
  add column if not exists permit_email text not null default 'unknown'
    constraint accounts_permit_email_check check (permit_email in ('allowed', 'declined', 'unknown')),
  add column if not exists permit_sms text not null default 'unknown'
    constraint accounts_permit_sms_check check (permit_sms in ('allowed', 'declined', 'unknown')),
  add column if not exists permit_phone text not null default 'unknown'
    constraint accounts_permit_phone_check check (permit_phone in ('allowed', 'declined', 'unknown')),
  add column if not exists permit_meta jsonb not null default '{}'::jsonb,
  add column if not exists tags text[] not null default '{}',
  add column if not exists temperature_set_by uuid references public.profiles (id) on delete set null;

comment on column public.accounts.relationship_state is
  'Staff-set: active | delayed (state_until, state_note = what to do when it wakes) | do_not_contact | lost (lost_reason) | archived. Set only through crm_set_state().';
comment on column public.accounts.permit_meta is
  '{ email: { by, at, how }, sms: {…}, phone: {…} } — provenance of each permission: unsubscribe_link, sms_stop, staff, portal, complaint, bounce.';
comment on column public.accounts.lost_reason is
  'Tom, 30 Aug 2026 (C15): went_with_someone_else · too_expensive · just_planning · change_of_circumstances · something_else. The wording on screen is final; free text rides in state_note.';

create index if not exists accounts_state_idx on public.accounts (relationship_state) where relationship_state <> 'active';
create index if not exists accounts_tags_idx on public.accounts using gin (tags);

-- The office's tag list. Keys are what accounts.tags holds; labels are what people see.
create table if not exists public.crm_tags (
  key        text primary key,
  tenant_id  uuid not null references public.tenants (id) default public.current_tenant(),
  label      text not null,
  colour     text,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);
alter table public.crm_tags enable row level security;
drop policy if exists crm_tags_staff on public.crm_tags;
create policy crm_tags_staff on public.crm_tags
  for all to authenticated
  using ((select public.is_staff()) and tenant_id = (select public.current_tenant()))
  with check ((select public.is_staff()) and tenant_id = (select public.current_tenant()));
insert into public.crm_tags (key, label, sort_order) values
  ('referral', 'Referral', 10), ('repeat', 'Repeat customer', 20), ('strata', 'Strata', 30),
  ('insurance', 'Insurance job', 40), ('heritage', 'Heritage', 50), ('vip', 'VIP', 60),
  ('difficult_access', 'Difficult access', 70), ('sydney_partner', 'Sydney partner', 80)
on conflict (key) do nothing;

-- Backfill permissions from the one flag that existed.
update public.accounts
   set permit_email = 'declined', permit_sms = 'declined',
       permit_meta = permit_meta
         || jsonb_build_object('email', jsonb_build_object('how', 'unsubscribed', 'at', marketing_unsubscribed_at),
                               'sms', jsonb_build_object('how', 'unsubscribed', 'at', marketing_unsubscribed_at))
 where marketing_unsubscribed_at is not null and permit_email = 'unknown' and permit_sms = 'unknown';

-- ---- 2 · the facts row mirrors the dimensions ------------------------------------
alter table public.crm_account_facts
  add column if not exists relationship_state text not null default 'active',
  add column if not exists state_until timestamptz,
  add column if not exists state_note text,
  add column if not exists lost_reason text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists permit_email text not null default 'unknown',
  add column if not exists permit_sms text not null default 'unknown',
  add column if not exists permit_phone text not null default 'unknown',
  add column if not exists last_job_completed_type text,
  add column if not exists repaint_due_at timestamptz;
create index if not exists crm_account_facts_state_idx on public.crm_account_facts (relationship_state) where relationship_state <> 'active';
create index if not exists crm_account_facts_tags_idx on public.crm_account_facts using gin (tags);
create index if not exists crm_account_facts_repaint_idx on public.crm_account_facts (repaint_due_at) where repaint_due_at is not null;
create index if not exists crm_account_facts_job_done_idx on public.crm_account_facts (last_job_completed_at desc nulls last);

create or replace function public.accounts_touch_facts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.crm_account_facts (account_id, stale, name, email, phone, account_type, temperature, owner_id, snoozed_until, next_followup_at, search,
                                        relationship_state, state_until, state_note, lost_reason, tags, permit_email, permit_sms, permit_phone)
  values (new.id, true, new.name, new.email, new.phone, new.account_type, new.temperature, new.owner_id, new.snoozed_until, new.followup_due_at,
          lower(concat_ws(' ', new.name, new.email, new.phone, regexp_replace(coalesce(new.phone, ''), '\s+', '', 'g'), new.phone_e164)),
          new.relationship_state, new.state_until, new.state_note, new.lost_reason, new.tags, new.permit_email, new.permit_sms, new.permit_phone)
  on conflict (account_id) do update set
    stale = true, name = excluded.name, email = excluded.email, phone = excluded.phone, account_type = excluded.account_type,
    temperature = excluded.temperature, owner_id = excluded.owner_id, snoozed_until = excluded.snoozed_until, next_followup_at = excluded.next_followup_at,
    relationship_state = excluded.relationship_state, state_until = excluded.state_until, state_note = excluded.state_note, lost_reason = excluded.lost_reason,
    tags = excluded.tags, permit_email = excluded.permit_email, permit_sms = excluded.permit_sms, permit_phone = excluded.permit_phone,
    search = case when crm_account_facts.refreshed_at is null then excluded.search else crm_account_facts.search end;
  return new;
end $$;
drop trigger if exists t_accounts_touch_facts on public.accounts;
create trigger t_accounts_touch_facts
  after insert or update of name, email, phone, account_type, temperature, snoozed_until, followup_due_at, owner_id,
    relationship_state, state_until, state_note, lost_reason, tags, permit_email, permit_sms, permit_phone on public.accounts
  for each row execute function public.accounts_touch_facts();

-- ---- 3 · the writes -------------------------------------------------------------
create or replace function public.crm_set_state(
  p_account_id uuid, p_state text, p_until timestamptz default null, p_reason text default null,
  p_note text default null, p_lost_reason text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_old public.accounts%rowtype;
begin
  if not public.is_staff() then raise exception 'crm_set_state: staff only' using errcode = '42501'; end if;
  if p_state not in ('active', 'delayed', 'do_not_contact', 'lost', 'archived') then raise exception 'crm_set_state: bad state'; end if;
  if p_state = 'delayed' and (p_until is null or p_until <= now()) then raise exception 'crm_set_state: delayed needs a future date'; end if;
  if p_state = 'lost' and p_lost_reason is null then raise exception 'crm_set_state: lost needs a reason'; end if;
  select * into v_old from public.accounts where id = p_account_id for update;
  if not found then raise exception 'crm_set_state: no such account'; end if;

  update public.accounts
     set relationship_state = p_state,
         state_until = case when p_state = 'delayed' then p_until else null end,
         state_reason = nullif(trim(coalesce(p_reason, '')), ''),
         state_note = nullif(trim(coalesce(p_note, '')), ''),
         lost_reason = case when p_state = 'lost' then p_lost_reason else null end,
         state_set_at = now(), state_set_by = auth.uid(),
         -- A delayed customer is not chased: the follow-up and snooze step aside.
         followup_due_at = case when p_state in ('delayed', 'do_not_contact', 'archived') then null else followup_due_at end,
         snoozed_until = case when p_state in ('delayed', 'do_not_contact', 'archived') then null else snoozed_until end
   where id = p_account_id;

  return public.crm_log_event('state_set', p_account_id,
    jsonb_strip_nulls(jsonb_build_object('state', p_state, 'previous', v_old.relationship_state, 'until', p_until,
                                         'reason', nullif(trim(coalesce(p_reason, '')), ''), 'note', nullif(trim(coalesce(p_note, '')), ''),
                                         'lostReason', case when p_state = 'lost' then p_lost_reason end)),
    'staff');
end $$;
grant execute on function public.crm_set_state(uuid, text, timestamptz, text, text, text) to authenticated;

create or replace function public.crm_set_permission(p_account_id uuid, p_channel text, p_value text, p_how text default 'staff')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_meta jsonb; v_n integer;
begin
  if not (public.is_staff() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'crm_set_permission: not permitted' using errcode = '42501';
  end if;
  if p_channel not in ('email', 'sms', 'phone') then raise exception 'crm_set_permission: bad channel'; end if;
  if p_value not in ('allowed', 'declined', 'unknown') then raise exception 'crm_set_permission: bad value'; end if;
  v_meta := jsonb_build_object(p_channel, jsonb_build_object('by', auth.uid(), 'at', now(), 'how', coalesce(p_how, 'staff')));
  execute format('update public.accounts set permit_%I = $1, permit_meta = permit_meta || $2 where id = $3', p_channel)
    using p_value, v_meta, p_account_id;
  -- EXECUTE never sets FOUND; the row count does.
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'crm_set_permission: no such account'; end if;
  return public.crm_log_event('permission_set', p_account_id,
    jsonb_build_object('channel', p_channel, 'value', p_value, 'how', coalesce(p_how, 'staff')),
    case when coalesce(p_how, 'staff') in ('unsubscribe_link', 'sms_stop', 'sms_start', 'portal') then 'customer'
         when coalesce(p_how, 'staff') in ('bounce', 'complaint') then 'system' else 'staff' end);
end $$;
grant execute on function public.crm_set_permission(uuid, text, text, text) to authenticated;

create or replace function public.crm_set_tags(p_account_id uuid, p_tags text[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_clean text[];
begin
  if not public.is_staff() then raise exception 'crm_set_tags: staff only' using errcode = '42501'; end if;
  select coalesce(array_agg(distinct t order by t), '{}') into v_clean
    from unnest(coalesce(p_tags, '{}')) t where t in (select key from public.crm_tags);
  update public.accounts set tags = v_clean where id = p_account_id;
  if not found then raise exception 'crm_set_tags: no such account'; end if;
  return public.crm_log_event('tags_set', p_account_id, jsonb_build_object('tags', to_jsonb(v_clean)), 'staff');
end $$;
grant execute on function public.crm_set_tags(uuid, text[]) to authenticated;

create or replace function public.crm_upsert_tag(p_key text, p_label text, p_colour text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_key text := regexp_replace(lower(trim(coalesce(p_key, p_label, ''))), '[^a-z0-9]+', '_', 'g');
begin
  if not public.is_staff() then raise exception 'crm_upsert_tag: staff only' using errcode = '42501'; end if;
  v_key := trim(both '_' from v_key);
  if v_key = '' or nullif(trim(coalesce(p_label, '')), '') is null then raise exception 'crm_upsert_tag: a tag needs a name'; end if;
  insert into public.crm_tags (key, label, colour) values (v_key, trim(p_label), p_colour)
  on conflict (key) do update set label = excluded.label, colour = excluded.colour;
end $$;
grant execute on function public.crm_upsert_tag(text, text, text) to authenticated;

create or replace function public.crm_delete_tag(p_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'crm_delete_tag: staff only' using errcode = '42501'; end if;
  update public.accounts set tags = array_remove(tags, p_key) where tags @> array[p_key];
  delete from public.crm_tags where key = p_key;
end $$;
grant execute on function public.crm_delete_tag(text) to authenticated;

-- ---- 4 · the rules ---------------------------------------------------------------
-- Either marketing channel declined keeps the one flag the guard reads set;
-- both back to allowed/unknown clears it. STOP / the unsubscribe link now
-- write the per-channel columns through crm_set_permission (app side).
create or replace function public.accounts_permissions_sync()
returns trigger language plpgsql as $$
begin
  if new.permit_email = 'declined' or new.permit_sms = 'declined' then
    new.marketing_unsubscribed_at := coalesce(new.marketing_unsubscribed_at, now());
  elsif old.permit_email = 'declined' or old.permit_sms = 'declined' then
    new.marketing_unsubscribed_at := null;
  end if;
  return new;
end $$;
drop trigger if exists t_accounts_permissions_sync on public.accounts;
create trigger t_accounts_permissions_sync
  before update of permit_email, permit_sms on public.accounts
  for each row execute function public.accounts_permissions_sync();

-- A lost customer who starts again is not lost.
create or replace function public.estimates_reopen_lost()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.account_id is null then return new; end if;
  update public.accounts
     set relationship_state = 'active', lost_reason = null, state_reason = 'new estimate', state_set_at = now()
   where id = new.account_id and relationship_state = 'lost';
  if found then
    perform public.crm_emit('state_set', new.account_id,
      jsonb_build_object('state', 'active', 'previous', 'lost', 'reason', 'new estimate'),
      'system', now(), new.id, null, null, 'reopen:' || new.id);
  end if;
  return new;
end $$;
drop trigger if exists t_estimates_reopen_lost on public.estimates;
create trigger t_estimates_reopen_lost after insert on public.estimates
  for each row execute function public.estimates_reopen_lost();

-- ---- 4b · the duplicate finder, fast for one record -------------------------------
-- 20270120's version unions every account, contact and property before
-- joining — fine for the office's whole list, 1–2 s on a record page at 27k
-- accounts. With p_account it now starts from that account's own keys.
create or replace function public.crm_duplicate_candidates(p_limit integer default 200, p_account uuid default null)
returns table (account_a uuid, account_b uuid, reason text, key text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_staff() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'crm_duplicate_candidates: not permitted' using errcode = '42501';
  end if;
  if p_account is not null then
    return query
    with mine as (
      select phone_e164 as k, 'phone' as kind from public.accounts where id = p_account and phone_e164 is not null
      union select phone_e164, 'phone' from public.account_contacts where account_id = p_account and phone_e164 is not null
      union select lower(email), 'email' from public.accounts where id = p_account and email is not null
      union select lower(email), 'email' from public.account_contacts where account_id = p_account and email is not null
      union select address_norm, 'address' from public.properties where account_id = p_account and address_norm is not null
    ),
    others as (
      select a.id as account_id, m.kind, m.k from mine m join public.accounts a on m.kind = 'phone' and a.phone_e164 = m.k
      union select c.account_id, m.kind, m.k from mine m join public.account_contacts c on m.kind = 'phone' and c.phone_e164 = m.k
      union select a.id, m.kind, m.k from mine m join public.accounts a on m.kind = 'email' and lower(a.email) = m.k
      union select c.account_id, m.kind, m.k from mine m join public.account_contacts c on m.kind = 'email' and lower(c.email) = m.k
      union select p.account_id, m.kind, m.k from mine m join public.properties p on m.kind = 'address' and p.address_norm = m.k
    )
    select least(p_account, o.account_id), greatest(p_account, o.account_id), o.kind, o.k
      from others o where o.account_id <> p_account
     group by 1, 2, 3, 4 order by 3, 4 limit p_limit;
    return;
  end if;
  return query
  with ident as (
    select id as account_id, phone_e164 as k, 'phone' as kind from public.accounts where phone_e164 is not null
    union
    select account_id, phone_e164, 'phone' from public.account_contacts where phone_e164 is not null
    union
    select id, lower(email), 'email' from public.accounts where email is not null
    union
    select account_id, lower(email), 'email' from public.account_contacts where email is not null
    union
    select account_id, address_norm, 'address' from public.properties where account_id is not null and address_norm is not null
  )
  select least(x.account_id, y.account_id), greatest(x.account_id, y.account_id), x.kind, x.k
    from ident x join ident y on x.k = y.k and x.kind = y.kind and x.account_id < y.account_id
   group by 1, 2, 3, 4
   order by 3, 4
   limit p_limit;
end $$;

-- ---- 5 · settings: thresholds the office can change (brief §7.1) --------------------
insert into public.settings (key, value) values ('crm', jsonb_build_object(
  'chaseUnopenedDays', 3, 'chaseOpenedDays', 5, 'goingColdDays', 14, 'secondAttemptDays', 7, 'pastCustomerDays', 30,
  'messageOverdueHours', 4, 'callbackOverdueHours', 4, 'afterCareDays', 30, 'reviewWindowMonths', 12,
  'repaintExteriorYears', 7, 'repaintInteriorYears', 10, 'repaintUnknownYears', 8
)) on conflict (key) do nothing;

-- ---- Read-back --------------------------------------------------------------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'accounts'
     and column_name in ('relationship_state', 'state_until', 'lost_reason', 'permit_email', 'permit_sms', 'permit_phone', 'permit_meta', 'tags')) = 8 as account_columns,
  (select count(*) from public.crm_tags) as tags_seeded,
  (select count(*) from public.accounts where permit_email = 'declined') as email_declined_backfilled,
  (select count(*) from pg_proc where proname in ('crm_set_state', 'crm_set_permission', 'crm_set_tags', 'crm_upsert_tag', 'crm_delete_tag')) = 5 as functions_ok,
  (select count(*) from pg_trigger where tgname in ('t_accounts_permissions_sync', 't_estimates_reopen_lost', 't_accounts_touch_facts')) = 3 as triggers_ok,
  (select value ? 'repaintExteriorYears' from public.settings where key = 'crm') as thresholds_seeded;
