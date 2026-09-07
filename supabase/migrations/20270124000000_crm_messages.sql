-- =============================================================================
-- CRM v2 · P3 — messages: the one table every conversation lives in
--
-- docs/briefs/crm-v2-deep-dive.md §3 F3 and §4.2. Before this file a send was
-- a flag in one of three event tables (nine paths recorded nothing), no body
-- or provider id was ever stored, a customer's email reply landed in a mailbox
-- the platform could not see, and an SMS reply from an unknown number was
-- dropped. After it every email, SMS, call, portal message and chat summary —
-- in or out — is one row here, with its body, its provider id, its delivery
-- status, its thread and the customer it belongs to.
--
--   · account_id is NULLABLE: an inbound message we cannot match is STORED
--     and becomes a Today item for a person to attach, never dropped.
--   · reply_token routes an email reply back to its thread and customer
--     without guessing (Reply-To: reply+<token>@<REPLY_DOMAIN>).
--   · every insert with an account writes a message_in / message_out event
--     on the timeline (dedupe message:<id>), which also keeps "last contact"
--     true through the facts trigger.
--   · estimate_messages (the portal thread) is mirrored in by trigger and
--     backfilled, so the record shows one conversation across channels.
--
-- A3: tenant_id. RLS staff-only (InitPlan form). Idempotent; read-back.
-- =============================================================================

create table if not exists public.messages (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants (id) default public.current_tenant(),
  account_id          uuid references public.accounts (id) on delete set null,
  contact_id          uuid references public.account_contacts (id) on delete set null,
  channel             text not null
    constraint messages_channel_check check (channel in ('email', 'sms', 'call', 'chat', 'portal', 'note')),
  direction           text not null
    constraint messages_direction_check check (direction in ('in', 'out')),
  subject             text,
  body                text not null default '',
  body_html           text,
  provider            text not null default 'system'
    constraint messages_provider_check check (provider in ('resend', 'twilio', 'manual', 'system', 'portal', 'assistant')),
  provider_message_id text,
  thread_id           uuid references public.messages (id) on delete set null,
  reply_token         text,
  estimate_id         uuid references public.estimates (id) on delete set null,
  work_order_id       uuid references public.work_orders (id) on delete set null,
  invoice_id          uuid references public.invoices (id) on delete set null,
  campaign_message_id uuid references public.campaign_messages (id) on delete set null,
  status              text not null default 'sent'
    constraint messages_status_check
    check (status in ('queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'failed', 'not_configured', 'received')),
  status_at           timestamptz,
  read_at             timestamptz,
  actor_profile_id    uuid references public.profiles (id) on delete set null,
  to_address          text,
  from_address        text,
  meta                jsonb not null default '{}'::jsonb,
  occurred_at         timestamptz not null default now(),
  created_at          timestamptz not null default now()
);
comment on table public.messages is
  'Every conversation with a customer, in or out, any channel: body, provider id, delivery status, thread. account_id null = inbound we could not match (a Today item, never dropped).';

create index if not exists messages_account_idx on public.messages (account_id, occurred_at desc) where account_id is not null;
create unique index if not exists messages_provider_key on public.messages (provider, provider_message_id) where provider_message_id is not null;
create unique index if not exists messages_reply_token_key on public.messages (reply_token) where reply_token is not null;
create index if not exists messages_thread_idx on public.messages (thread_id) where thread_id is not null;
create index if not exists messages_unmatched_idx on public.messages (occurred_at desc) where account_id is null and direction = 'in';
create index if not exists messages_inbound_idx on public.messages (direction, occurred_at desc);
create index if not exists messages_estimate_idx on public.messages (estimate_id) where estimate_id is not null;

alter table public.messages enable row level security;
drop policy if exists messages_staff on public.messages;
create policy messages_staff on public.messages
  for all to authenticated
  using ((select public.is_staff()) and tenant_id = (select public.current_tenant()))
  with check ((select public.is_staff()) and tenant_id = (select public.current_tenant()));

-- ---- the timeline hears every message ---------------------------------------
create or replace function public.messages_emit_event(p public.messages)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p.account_id is null then return; end if;
  perform public.crm_emit(
    case when p.direction = 'in' then 'message_in' else 'message_out' end,
    p.account_id,
    jsonb_build_object('channel', p.channel, 'subject', left(coalesce(p.subject, ''), 200),
                       'excerpt', left(regexp_replace(coalesce(p.body, ''), '\s+', ' ', 'g'), 160),
                       'messageId', p.id, 'provider', p.provider, 'status', p.status),
    case when p.direction = 'in' then 'customer' when p.provider = 'manual' then 'staff' else 'system' end,
    p.occurred_at, p.estimate_id, p.work_order_id, p.invoice_id, 'message:' || p.id);
end $$;
revoke all on function public.messages_emit_event(public.messages) from public, anon, authenticated;

create or replace function public.messages_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.messages_emit_event(new);
  return new;
end $$;
drop trigger if exists t_messages_after_insert on public.messages;
create trigger t_messages_after_insert after insert on public.messages
  for each row execute function public.messages_after_insert();

-- The facts trigger learns the two message kinds (channel from the payload).
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
    when new.type in ('message_in', 'message_out') then
      case when new.payload->>'channel' in ('email', 'sms', 'call', 'chat', 'portal') then new.payload->>'channel' else null end
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

-- ---- RPCs ---------------------------------------------------------------------
-- Read: the office opened the thread.
create or replace function public.crm_mark_messages_read(p_account_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.is_staff() then raise exception 'crm_mark_messages_read: staff only' using errcode = '42501'; end if;
  update public.messages set read_at = now()
   where account_id = p_account_id and direction = 'in' and read_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
grant execute on function public.crm_mark_messages_read(uuid) to authenticated;

-- Attach: an unmatched inbound message belongs to this customer after all.
-- The timeline event is written now (the insert trigger saw no account).
create or replace function public.crm_attach_message(p_message_id uuid, p_account_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_m public.messages%rowtype;
begin
  if not public.is_staff() then raise exception 'crm_attach_message: staff only' using errcode = '42501'; end if;
  update public.messages set account_id = p_account_id where id = p_message_id and account_id is null returning * into v_m;
  if not found then raise exception 'crm_attach_message: not an unmatched message'; end if;
  perform public.messages_emit_event(v_m);
  -- The sender's address becomes reachable on the record: a contact row when
  -- the account does not already carry it.
  if v_m.channel = 'email' and v_m.from_address is not null
     and not exists (select 1 from public.accounts a where a.id = p_account_id and lower(a.email) = lower(v_m.from_address))
     and not exists (select 1 from public.account_contacts c where c.account_id = p_account_id and lower(c.email) = lower(v_m.from_address)) then
    insert into public.account_contacts (account_id, role, email) values (p_account_id, 'other', v_m.from_address);
  elsif v_m.channel = 'sms' and v_m.from_address is not null
     and not exists (select 1 from public.accounts a where a.id = p_account_id and a.phone_e164 = v_m.from_address)
     and not exists (select 1 from public.account_contacts c where c.account_id = p_account_id and c.phone_e164 = v_m.from_address) then
    insert into public.account_contacts (account_id, role, phone) values (p_account_id, 'other', v_m.from_address);
  end if;
end $$;
grant execute on function public.crm_attach_message(uuid, uuid) to authenticated;

-- ---- the portal thread rides along --------------------------------------------
create or replace function public.estimate_messages_mirror()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_account uuid;
begin
  select account_id into v_account from public.estimates where id = new.estimate_id;
  insert into public.messages (account_id, channel, direction, body, provider, provider_message_id, estimate_id, status, occurred_at,
                               from_address, meta)
  values (v_account, 'portal', case when new.direction = 'customer' then 'in' else 'out' end, new.body, 'portal',
          'estimate_messages:' || new.id, new.estimate_id, case when new.direction = 'customer' then 'received' else 'sent' end,
          new.created_at, null, jsonb_build_object('authorName', new.author_name))
  on conflict (provider, provider_message_id) where provider_message_id is not null do nothing;
  return new;
end $$;
drop trigger if exists t_estimate_messages_mirror on public.estimate_messages;
create trigger t_estimate_messages_mirror after insert on public.estimate_messages
  for each row execute function public.estimate_messages_mirror();

insert into public.messages (account_id, channel, direction, body, provider, provider_message_id, estimate_id, status, occurred_at, meta)
select e.account_id, 'portal', case when m.direction = 'customer' then 'in' else 'out' end, m.body, 'portal',
       'estimate_messages:' || m.id, m.estimate_id, case when m.direction = 'customer' then 'received' else 'sent' end,
       m.created_at, jsonb_build_object('authorName', m.author_name)
  from public.estimate_messages m join public.estimates e on e.id = m.estimate_id
on conflict (provider, provider_message_id) where provider_message_id is not null do nothing;

-- ---- Read-back --------------------------------------------------------------
select
  (select count(*) from public.messages) as messages,
  (select count(*) from public.messages where provider = 'portal') as portal_mirrored,
  (select count(*) from pg_policies where tablename = 'messages') as policies,
  (select count(*) from pg_trigger where tgname in ('t_messages_after_insert', 't_estimate_messages_mirror')) = 2 as triggers_ok,
  (select count(*) from pg_proc where proname in ('crm_mark_messages_read', 'crm_attach_message', 'messages_emit_event')) = 3 as functions_ok;
