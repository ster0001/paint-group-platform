-- =============================================================================
-- Home dashboard v2 · session 0b · capture: messaging (Part B4)
--
-- "Customers awaiting reply" and "first-reply time" need three things the
-- messages table did not say: WHO sent a message (a person, the customer, or
-- an automation), when each customer last wrote in, and when a PERSON last
-- wrote back. An automated chase is outbound but it is not a reply — the
-- customer is still waiting.
--
-- Already there (20270124) and NOT duplicated: `messages.direction` (in/out),
-- `messages.read_at` (the office opening a thread, via crm_mark_messages_read),
-- `occurred_at` (= sent_at), delivery status incl. `opened` from Resend.
--
-- New:
--   · messages.sender_role — customer | staff | system | assistant | unknown.
--     Set by the app (lib/messaging/record.ts derives it from the send
--     context); the BEFORE INSERT trigger derives it for direct inserts (the
--     portal mirror) and the backfill uses the same rule. `unknown` is only
--     ever a legacy outbound row nobody signed — it counts as a reply (the
--     pre-0b behaviour) so no old thread is resurrected as unanswered; new
--     rows always carry a real role.
--   · crm_account_facts.last_inbound_at / last_staff_reply_at — maintained by
--     trigger on messages (insert, and attach), backfilled. The account IS
--     the thread: every channel lands in one conversation (P3).
--   · customer_thread_opened(estimate ids) — the customer read the thread
--     (portal or token chat): staff replies mirrored from estimate_messages
--     get read_at with meta.readSource = 'portal'. Email opens set read_at
--     from the app with readSource = 'email_open' and readIsBestEffort = true.
-- =============================================================================

-- ---- 1 · sender_role --------------------------------------------------------
alter table public.messages add column if not exists sender_role text;
do $$ begin
  alter table public.messages add constraint messages_sender_role_check
    check (sender_role is null or sender_role in ('customer', 'staff', 'system', 'assistant', 'unknown'));
exception when duplicate_object then null; end $$;
create index if not exists messages_account_role_occurred_idx
  on public.messages (account_id, sender_role, occurred_at desc);

-- The one rule. Mirrors deriveSenderRole in lib/messaging/record.ts; the unit
-- test reads this file and compares the kind lists.
create or replace function public.message_sender_role(
  p_direction text, p_provider text, p_actor uuid, p_campaign uuid, p_meta jsonb
) returns text language sql immutable as $$
  select case
    when p_direction = 'in' then 'customer'
    when p_provider = 'assistant' then 'assistant'
    when p_meta->>'automation' is not null or p_campaign is not null
      or p_meta->>'kind' in ('campaign', 'job_welcome', 'tenant_link', 'magic_link', 'staff_alert', 'receipt', 'remittance', 'assistant_handoff')
      then 'system'
    when p_actor is not null or p_provider in ('manual', 'portal')
      or p_meta->>'kind' in ('estimate', 'chat_reply', 'variation', 'invoice', 'job_update', 'contractor_invite')
      then 'staff'
    else 'unknown'
  end
$$;

create or replace function public.messages_derive_sender_role()
returns trigger language plpgsql as $$
begin
  if new.sender_role is null then
    new.sender_role := public.message_sender_role(new.direction, new.provider, new.actor_profile_id, new.campaign_message_id, new.meta);
  end if;
  return new;
end $$;
drop trigger if exists t_messages_derive_sender_role on public.messages;
create trigger t_messages_derive_sender_role
  before insert on public.messages
  for each row execute function public.messages_derive_sender_role();

update public.messages
   set sender_role = public.message_sender_role(direction, provider, actor_profile_id, campaign_message_id, meta)
 where sender_role is null;

-- ---- 2 · the thread's two clocks, on the account's facts ---------------------
alter table public.crm_account_facts
  add column if not exists last_inbound_at     timestamptz,
  add column if not exists last_staff_reply_at timestamptz;
create index if not exists crm_account_facts_awaiting_reply_idx
  on public.crm_account_facts (last_inbound_at)
  where last_inbound_at is not null;

-- A message that reached the customer, or came from them. Failed and
-- suppressed sends never reached anyone, so they are not a reply.
create or replace function public.messages_touch_reply_facts()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_in timestamptz; v_reply timestamptz;
begin
  if new.account_id is null then return null; end if;
  if new.direction = 'in' then
    v_in := new.occurred_at;
  elsif new.sender_role in ('staff', 'unknown')
        and new.status not in ('failed', 'not_configured', 'suppressed', 'bounced') then
    v_reply := new.occurred_at;
  else
    return null;
  end if;
  insert into public.crm_account_facts (account_id, stale, last_inbound_at, last_staff_reply_at)
  values (new.account_id, true, v_in, v_reply)
  on conflict (account_id) do update set
    stale = true,
    last_inbound_at     = greatest(crm_account_facts.last_inbound_at, excluded.last_inbound_at),
    last_staff_reply_at = greatest(crm_account_facts.last_staff_reply_at, excluded.last_staff_reply_at);
  return null;
end $$;
drop trigger if exists t_messages_touch_reply_facts on public.messages;
create trigger t_messages_touch_reply_facts
  after insert or update of account_id on public.messages
  for each row execute function public.messages_touch_reply_facts();

update public.crm_account_facts f
   set last_inbound_at     = s.last_in,
       last_staff_reply_at = s.last_reply
  from (
    select account_id,
           max(occurred_at) filter (where direction = 'in') as last_in,
           max(occurred_at) filter (where direction = 'out' and sender_role in ('staff', 'unknown')
                                      and status not in ('failed', 'not_configured', 'suppressed', 'bounced')) as last_reply
      from public.messages
     where account_id is not null
     group by account_id
  ) s
 where s.account_id = f.account_id;

-- ---- 3 · the customer opened the thread ---------------------------------------
-- Portal-mirrored staff replies on these estimates are read. Called by the
-- token chat RPC below and by the customer portal (service role). Keyed by
-- estimate so a customer's other conversations are untouched.
create or replace function public.customer_thread_opened(p_estimate_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if p_estimate_ids is null or array_length(p_estimate_ids, 1) is null then return 0; end if;
  update public.messages
     set read_at = now(),
         meta = meta || jsonb_build_object('readSource', 'portal')
   where provider = 'portal' and direction = 'out' and read_at is null
     and estimate_id = any (p_estimate_ids);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.customer_thread_opened(uuid[]) from public, anon, authenticated;

-- The token chat: reading the thread IS opening it. Same rows as before.
create or replace function public.get_estimate_thread_by_token(p_token text)
returns table (id uuid, direction text, body text, author_name text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select e.id into v_id from public.estimates e where e.share_token = p_token;
  if v_id is null then return; end if;
  perform public.customer_thread_opened(array[v_id]);
  return query
    select m.id, m.direction, m.body, m.author_name, m.created_at
      from public.estimate_messages m
     where m.estimate_id = v_id
     order by m.created_at;
end; $$;
grant execute on function public.get_estimate_thread_by_token(text) to anon, authenticated;

-- ---- read-back: what this file just made ------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and (table_name, column_name) in
      (('messages','sender_role'), ('crm_account_facts','last_inbound_at'), ('crm_account_facts','last_staff_reply_at'))) as new_columns_expect_3,
  (select count(*) from pg_trigger
    where tgname in ('t_messages_derive_sender_role', 't_messages_touch_reply_facts'))          as new_triggers_expect_2,
  (select prosrc like '%customer_thread_opened%' from pg_proc
    where proname = 'get_estimate_thread_by_token' limit 1)                                     as token_chat_marks_read,
  (select count(*) from public.messages where sender_role is null)                             as messages_without_role_expect_0,
  (select jsonb_object_agg(sender_role, n) from
     (select sender_role, count(*) n from public.messages group by sender_role) r)             as messages_by_role,
  (select count(*) from public.crm_account_facts where last_inbound_at is not null)            as accounts_with_inbound,
  (select count(*) from public.crm_account_facts
    where last_inbound_at > coalesce(last_staff_reply_at, '-infinity'))                        as accounts_awaiting_reply_right_now;

insert into public._prod_migrations(name) values ('20270176000000_dashboard_capture_messages.sql') on conflict (name) do nothing;
