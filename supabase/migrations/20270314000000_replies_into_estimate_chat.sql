-- =============================================================================
-- 20270314 · Replies land in the estimate chat (automations ruling A-G, Tom 11 Nov 2026)
-- =============================================================================
-- Brief: docs/briefs/claude-code-brief-automations-campaigns.md, ruling A-G:
-- inbound email and SMS replies are routed into estimate_messages.
--
-- Today a customer reply to one of our emails or texts is stored as a CRM
-- message (public.messages) and relayed to the office mailbox, but the
-- estimate chat never sees it: the customer reads one conversation on their
-- page and we hold a second one in the inbox.
--
-- 1 · estimate_messages.via (chat, email, sms) and source_message_id: the CRM
--     message a reply came in as. Unique, so a webhook retried by Resend or
--     Twilio posts the reply once.
-- 2 · The mirror trigger (20270124) copies every chat row into messages. A
--     reply already HAS its messages row, so the mirror skips any row that
--     names one; otherwise every emailed reply would show twice in the CRM.
-- 3 · estimate_message_from_reply: the one writer for a routed reply. It
--     posts the customer row and the activity event exactly as the chat RPC
--     does. Service role only (the inbound webhooks): no grant to anyone.
-- =============================================================================

set lock_timeout = '15s';

-- ---- 1 · where a chat row came from ---------------------------------------------------
alter table public.estimate_messages add column if not exists via text not null default 'chat';
alter table public.estimate_messages drop constraint if exists estimate_messages_via_check;
alter table public.estimate_messages add constraint estimate_messages_via_check check (via in ('chat', 'email', 'sms'));
alter table public.estimate_messages add column if not exists source_message_id uuid references public.messages (id) on delete set null;
create unique index if not exists estimate_messages_source_message_key
  on public.estimate_messages (source_message_id) where source_message_id is not null;

-- ---- 2 · the mirror skips a row that already has its CRM message ------------------------
create or replace function public.estimate_messages_mirror()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_account uuid;
begin
  -- 20270314: a routed reply was recorded in messages first; do not copy it back.
  if new.source_message_id is not null then return new; end if;
  select account_id into v_account from public.estimates where id = new.estimate_id;
  insert into public.messages (account_id, channel, direction, body, provider, provider_message_id, estimate_id, status, occurred_at,
                               from_address, meta)
  values (v_account, 'portal', case when new.direction = 'customer' then 'in' else 'out' end, new.body, 'portal',
          'estimate_messages:' || new.id, new.estimate_id, case when new.direction = 'customer' then 'received' else 'sent' end,
          new.created_at, null, jsonb_build_object('authorName', new.author_name))
  on conflict (provider, provider_message_id) where provider_message_id is not null do nothing;
  return new;
end $$;

-- ---- 3 · the one writer for a routed reply ----------------------------------------------
create or replace function public.estimate_message_from_reply(p_estimate uuid, p_message uuid, p_body text, p_via text)
returns text language plpgsql security definer set search_path = public as $$
declare v_body text; v_id uuid;
begin
  if p_via not in ('email', 'sms') then return 'bad_via'; end if;
  v_body := btrim(coalesce(p_body, ''));
  if v_body = '' then return 'empty'; end if;
  if length(v_body) > 4000 then v_body := left(v_body, 4000); end if;
  if not exists (select 1 from public.estimates where id = p_estimate) then return 'not_found'; end if;
  if p_message is null or not exists (select 1 from public.messages where id = p_message) then return 'no_message'; end if;

  insert into public.estimate_messages (estimate_id, direction, body, via, source_message_id)
    values (p_estimate, 'customer', v_body, p_via, p_message)
    on conflict (source_message_id) where source_message_id is not null do nothing
    returning id into v_id;
  if v_id is null then return 'duplicate'; end if;
  -- The activity feed, as post_estimate_message_by_token writes it.
  insert into public.estimate_events (estimate_id, type, payload)
    values (p_estimate, 'customer_message', jsonb_build_object('body', v_body, 'via', p_via));
  return 'ok';
end; $$;
revoke all on function public.estimate_message_from_reply(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.estimate_message_from_reply(uuid, uuid, text, text) to service_role;

-- ---- read-back: ONE row, every column equals its _expect_ -----------------------------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'estimate_messages' and column_name in ('via', 'source_message_id')) as new_columns, 2 as _expect_new_columns,
  (select count(*) from pg_indexes where indexname = 'estimate_messages_source_message_key') as once_only, 1 as _expect_once_only,
  (select position('source_message_id is not null' in prosrc) > 0 from pg_proc where oid = 'public.estimate_messages_mirror()'::regprocedure) as mirror_skips, true as _expect_mirror_skips,
  (select has_function_privilege('authenticated', 'public.estimate_message_from_reply(uuid, uuid, text, text)', 'execute')) as writer_auth, false as _expect_writer_auth,
  (select has_function_privilege('anon', 'public.estimate_message_from_reply(uuid, uuid, text, text)', 'execute')) as writer_anon, false as _expect_writer_anon,
  (select count(*) from pg_trigger where tgname = 't_estimate_messages_mirror' and not tgisinternal) as mirror_trigger, 1 as _expect_mirror_trigger;

insert into public._prod_migrations(name) values ('20270314000000_replies_into_estimate_chat.sql') on conflict (name) do nothing;
