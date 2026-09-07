-- =============================================================================
-- CRM v2 · P2 — the customer record's writes
--
-- docs/briefs/crm-v2-deep-dive.md §4.1 (phase P2). Before this file the CRM
-- could not change a name, an email or a phone number anywhere; a customer
-- could not be created from the Customers tab; nobody owned a record; and a
-- second person on a job had nowhere to live. Every write here is an RPC
-- (the browser never touches a table — the CRM's standing gate) and every one
-- leaves an event on the timeline, because a change with no row in the log
-- makes the timeline lie.
--
--   · crm_update_account   name / email / phone (details_updated)
--   · crm_set_owner        the responsible staff member (owner_set)
--   · crm_upsert_contact   another person on the account (contact_changed)
--   · crm_delete_contact   never the primary row
--   · crm_create_account   quick add — dedupes through crm_find_account first
--   · the facts trigger learns the two manual contact kinds P2 adds
--     (email_logged, sms_logged) so "last contact" is right for them too
--
-- Idempotent. Read-back at the end.
-- =============================================================================

-- ---- 1 · details --------------------------------------------------------------
create or replace function public.crm_update_account(
  p_account_id uuid, p_name text default null, p_email text default null, p_phone text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_old public.accounts%rowtype; v_changed text[] := '{}';
        v_name text := nullif(trim(coalesce(p_name, '')), '');
        v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
        v_phone text := nullif(trim(coalesce(p_phone, '')), '');
        v_other uuid;
begin
  if not public.is_staff() then raise exception 'crm_update_account: staff only' using errcode = '42501'; end if;
  select * into v_old from public.accounts where id = p_account_id for update;
  if not found then raise exception 'crm_update_account: no such account'; end if;

  if v_email is not null and v_email <> coalesce(v_old.email, '') then
    select id into v_other from public.accounts where lower(email) = v_email and id <> p_account_id;
    if v_other is not null then
      return jsonb_build_object('ok', false, 'reason', 'email_taken', 'otherAccountId', v_other);
    end if;
  end if;
  if v_email is null and public.phone_e164_au(v_phone) is null then
    return jsonb_build_object('ok', false, 'reason', 'unreachable');
  end if;

  if v_name is distinct from v_old.name then v_changed := array_append(v_changed, 'name'); end if;
  if v_email is distinct from v_old.email then v_changed := array_append(v_changed, 'email'); end if;
  if v_phone is distinct from v_old.phone then v_changed := array_append(v_changed, 'phone'); end if;
  if array_length(v_changed, 1) is null then return jsonb_build_object('ok', true, 'changed', '{}'::text[]); end if;

  update public.accounts set name = v_name, email = v_email, phone = v_phone where id = p_account_id;
  perform public.crm_log_event('details_updated', p_account_id,
    jsonb_build_object('changed', to_jsonb(v_changed),
                       'from', jsonb_build_object('name', v_old.name, 'email', v_old.email, 'phone', v_old.phone)),
    'staff');
  return jsonb_build_object('ok', true, 'changed', to_jsonb(v_changed));
end $$;
grant execute on function public.crm_update_account(uuid, text, text, text) to authenticated;

-- ---- 2 · owner --------------------------------------------------------------
create or replace function public.crm_set_owner(p_account_id uuid, p_owner_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if not public.is_staff() then raise exception 'crm_set_owner: staff only' using errcode = '42501'; end if;
  if p_owner_id is not null then
    select name into v_name from public.profiles where id = p_owner_id and role = 'staff';
    if not found then raise exception 'crm_set_owner: not a staff member'; end if;
  end if;
  update public.accounts set owner_id = p_owner_id where id = p_account_id;
  if not found then raise exception 'crm_set_owner: no such account'; end if;
  return public.crm_log_event('owner_set', p_account_id,
    case when p_owner_id is null then jsonb_build_object('ownerId', null)
         else jsonb_build_object('ownerId', p_owner_id, 'ownerName', v_name) end,
    'staff');
end $$;
grant execute on function public.crm_set_owner(uuid, uuid) to authenticated;

-- ---- 3 · contacts -----------------------------------------------------------
create or replace function public.crm_upsert_contact(
  p_account_id uuid, p_contact_id uuid default null, p_name text default null, p_role text default 'other',
  p_email text default null, p_phone text default null, p_preferred text default null, p_notes text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_primary boolean := false;
begin
  if not public.is_staff() then raise exception 'crm_upsert_contact: staff only' using errcode = '42501'; end if;
  if p_contact_id is not null then
    select is_primary into v_primary from public.account_contacts where id = p_contact_id and account_id = p_account_id;
    if not found then raise exception 'crm_upsert_contact: no such contact'; end if;
    if v_primary then raise exception 'crm_upsert_contact: the primary contact is edited on the account'; end if;
    update public.account_contacts
       set name = nullif(trim(coalesce(p_name, '')), ''), role = coalesce(p_role, role),
           email = nullif(trim(coalesce(p_email, '')), ''), phone = nullif(trim(coalesce(p_phone, '')), ''),
           preferred_channel = p_preferred, notes = nullif(trim(coalesce(p_notes, '')), '')
     where id = p_contact_id;
    v_id := p_contact_id;
    perform public.crm_log_event('contact_changed', p_account_id, jsonb_build_object('action', 'updated', 'name', p_name, 'role', p_role), 'staff');
  else
    insert into public.account_contacts (account_id, name, role, email, phone, preferred_channel, notes)
    values (p_account_id, nullif(trim(coalesce(p_name, '')), ''), coalesce(p_role, 'other'),
            nullif(trim(coalesce(p_email, '')), ''), nullif(trim(coalesce(p_phone, '')), ''), p_preferred, nullif(trim(coalesce(p_notes, '')), ''))
    returning id into v_id;
    perform public.crm_log_event('contact_changed', p_account_id, jsonb_build_object('action', 'added', 'name', p_name, 'role', p_role), 'staff');
  end if;
  perform public.crm_facts_touch(p_account_id);
  return v_id;
end $$;
grant execute on function public.crm_upsert_contact(uuid, uuid, text, text, text, text, text, text) to authenticated;

create or replace function public.crm_delete_contact(p_contact_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_c public.account_contacts%rowtype;
begin
  if not public.is_staff() then raise exception 'crm_delete_contact: staff only' using errcode = '42501'; end if;
  select * into v_c from public.account_contacts where id = p_contact_id;
  if not found then return; end if;
  if v_c.is_primary then raise exception 'crm_delete_contact: the primary contact cannot be removed'; end if;
  delete from public.account_contacts where id = p_contact_id;
  perform public.crm_log_event('contact_changed', v_c.account_id, jsonb_build_object('action', 'removed', 'name', v_c.name, 'role', v_c.role), 'staff');
end $$;
grant execute on function public.crm_delete_contact(uuid) to authenticated;

-- ---- 4 · quick add ----------------------------------------------------------
-- Name + phone is enough (decision 8.2). Finds an existing record first, so a
-- second enquiry from the same mobile lands on the same customer.
create or replace function public.crm_create_account(p_name text default null, p_email text default null, p_phone text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_existing uuid; v_id uuid;
        v_name text := nullif(trim(coalesce(p_name, '')), '');
        v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
        v_phone text := nullif(trim(coalesce(p_phone, '')), '');
begin
  if not public.is_staff() then raise exception 'crm_create_account: staff only' using errcode = '42501'; end if;
  if v_email is null and public.phone_e164_au(v_phone) is null then
    return jsonb_build_object('ok', false, 'reason', 'unreachable');
  end if;
  v_existing := public.crm_find_account(v_email, v_phone);
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'id', v_existing, 'existed', true);
  end if;
  insert into public.accounts (name, email, phone, owner_id) values (v_name, v_email, v_phone, auth.uid()) returning id into v_id;
  perform public.crm_log_event('account_created', v_id, jsonb_build_object('via', 'quick_add'), 'staff');
  return jsonb_build_object('ok', true, 'id', v_id, 'existed', false);
end $$;
grant execute on function public.crm_create_account(text, text, text) to authenticated;

-- ---- 5 · the facts trigger learns the manual contact kinds ---------------------
create or replace function public.crm_events_touch_facts()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_channel text;
begin
  if new.account_id is null then return new; end if;
  v_channel := case
    when new.type in ('call_connected', 'call_no_answer', 'message_left') then 'phone'
    when new.type in ('sms_reply', 'sms_logged') then 'sms'
    when new.type in ('estimate_sent', 'email_logged') then 'email'
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

-- ---- 6 · policies evaluate the tenant ONCE, not per row --------------------
-- On the 27,000-account test stack the Customers list hit the 8 s statement
-- timeout: `tenant_id = public.current_tenant()` in a policy runs the function
-- for every row. `(select ...)` makes it an InitPlan — the same fix
-- 20261213 applied to the work-order policies. The function is also marked
-- STABLE so the planner may cache it within a statement.
alter function public.current_tenant() stable;

drop policy if exists crm_account_facts_staff on public.crm_account_facts;
create policy crm_account_facts_staff on public.crm_account_facts
  for all to authenticated
  using ((select public.is_staff()) and tenant_id = (select public.current_tenant()))
  with check ((select public.is_staff()) and tenant_id = (select public.current_tenant()));

drop policy if exists account_contacts_staff on public.account_contacts;
create policy account_contacts_staff on public.account_contacts
  for all to authenticated
  using ((select public.is_staff()) and tenant_id = (select public.current_tenant()))
  with check ((select public.is_staff()) and tenant_id = (select public.current_tenant()));

create or replace function public.crm_board_counts()
returns table (stage text, cards bigint, needs_you bigint)
language sql stable security invoker as $$
  select stage, count(*), count(*) filter (where needs_you)
    from public.crm_account_facts
   where tenant_id = (select public.current_tenant())
   group by stage $$;

create or replace function public.crm_board_tiles(p_stages text[] default null)
returns table (overdue_followups bigint, going_cold bigint, open_value_cents bigint, won_90d bigint, lost_90d bigint)
language sql stable security invoker as $$
  with f as (
    select * from public.crm_account_facts
     where tenant_id = (select public.current_tenant())
       and stage not in ('past_customer', 'lost')
       and (p_stages is null or stage = any (p_stages))
  )
  select
    (select count(*) from f where (flags->>'followupOverdue')::boolean and not coalesce((flags->>'snoozed')::boolean, false)),
    (select count(*) from f where (flags->>'goingCold')::boolean and not coalesce((flags->>'snoozed')::boolean, false)),
    (select coalesce(sum(value_cents), 0) from f),
    (select count(*) from public.estimates where accepted_at >= now() - interval '90 days'),
    (select count(*) from public.estimates where declined_at >= now() - interval '90 days' and accepted_at is null) $$;

-- ---- Read-back --------------------------------------------------------------
select
  (select count(*) from pg_proc where proname in ('crm_update_account', 'crm_set_owner', 'crm_upsert_contact', 'crm_delete_contact', 'crm_create_account')) = 5 as functions_ok,
  (select prosecdef from pg_proc where proname = 'crm_create_account') as create_secdef,
  (select count(*) from pg_trigger where tgname = 't_crm_events_touch_facts') = 1 as facts_trigger_ok,
  (select provolatile = 's' from pg_proc where proname = 'current_tenant') as tenant_fn_stable,
  (select count(*) from pg_policies where tablename in ('crm_account_facts', 'account_contacts') and qual like '%(SELECT current_tenant())%' or qual like '%( SELECT current_tenant()%') as policies_initplan;
