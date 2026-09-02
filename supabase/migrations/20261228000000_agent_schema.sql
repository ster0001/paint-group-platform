-- =============================================================================
-- Assistant agent — session S1 (parent brief §6, Addendum A §3.4/3.5)
--
-- The seven tables the assistant runs on. Nothing here computes a price or
-- sets a status: the assistant calls tools, tools call the RPCs everything
-- else already uses, and THESE tables are the transcript + audit trail.
--
--   agent_conversations  one per chat; channel portal|website|staff|meta
--   agent_messages       the transcript (user|assistant|staff|system)
--   agent_tool_calls     the audit trail — every number in a reply must be
--                        reconstructible from a row here (§2 rule 1)
--   agent_handoffs       requested → claimed → active → resolved | missed
--   callback_requests    after-hours "call me back" (am|pm|any)
--   agent_settings       models, budgets, hours, tone, disclosure, scripts —
--                        DB rows keyed by tenant, never code constants (§2 rule 10)
--   brain_entries        the knowledge base; approved entries only are served
--
-- Addendum A columns land now so the widget (A3) and Meta (A4) adapters need
-- no schema change: channel 'website'|'meta', anon_token (the anonymous
-- widget visitor's handle, linked to an account at email/OTP), and
-- external_thread_id (the Meta thread).
--
-- WRITE PATH: the server-only gateway (lib/agent/gateway.ts) writes these
-- tables through the service-role client, after zod. There are deliberately
-- NO insert/update policies for client roles on the transcript tables — a
-- browser cannot forge a tool result. Staff edit agent_settings and
-- brain_entries through RLS with their own session.
--
-- A3 tenancy ruling: tenant_id not null default current_tenant().
-- Ownership tests live in a SECURITY DEFINER helper (CLAUDE.md: a policy's
-- subquery is itself subject to RLS).
--
-- Idempotent; read-backs at the end, and the final select LISTS the policies.
-- =============================================================================

-- ---- conversations ---------------------------------------------------------

create table if not exists public.agent_conversations (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants (id) default public.current_tenant(),
  account_id         uuid references public.accounts (id) on delete cascade,
  property_id        uuid references public.properties (id) on delete set null,
  estimate_id        uuid references public.estimates (id) on delete set null,
  channel            text not null default 'portal'
    constraint agent_conversations_channel_check check (channel in ('portal', 'website', 'staff', 'meta')),
  mode               text not null default 'support'
    constraint agent_conversations_mode_check check (mode in ('guided', 'cowork', 'support')),
  view               text not null default 'customer'
    constraint agent_conversations_view_check check (view in ('customer', 'staff')),
  status             text not null default 'open'
    constraint agent_conversations_status_check check (status in ('open', 'handed_off', 'closed')),
  locale_tone        text not null default 'en-GB',
  -- Running total of tokens this conversation has spent (in + out), kept by
  -- the gateway so the per-conversation budget is one column read.
  token_spend        integer not null default 0
    constraint agent_conversations_token_spend_nonneg check (token_spend >= 0),
  -- Addendum A: anonymous website visitors carry a token (≥24 chars,
  -- base64url) until they give an email; Meta threads carry the platform id.
  anon_token         text
    constraint agent_conversations_anon_token_len check (anon_token is null or length(anon_token) >= 24),
  external_thread_id text,
  created_by         uuid,  -- auth.uid() at creation (anonymous-auth visitors included); null for Meta
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.agent_conversations is
  'Assistant brief §6. One per chat across every channel (R1: one assistant, many channels). Written only by the server-only gateway.';

create index if not exists agent_conversations_account_idx  on public.agent_conversations (account_id);
create index if not exists agent_conversations_estimate_idx on public.agent_conversations (estimate_id);
create index if not exists agent_conversations_status_idx   on public.agent_conversations (tenant_id, status);
create index if not exists agent_conversations_created_by_idx on public.agent_conversations (created_by);
create unique index if not exists agent_conversations_anon_token_key on public.agent_conversations (anon_token) where anon_token is not null;
create unique index if not exists agent_conversations_external_thread_key on public.agent_conversations (channel, external_thread_id) where external_thread_id is not null;
-- D12: anonymous website conversations with no account are purged after 30 days.
create index if not exists agent_conversations_purge_idx on public.agent_conversations (created_at) where account_id is null and channel = 'website';

drop trigger if exists t_agent_conversations_updated on public.agent_conversations;
create trigger t_agent_conversations_updated before update on public.agent_conversations
  for each row execute function public.set_updated_at();

-- ---- messages --------------------------------------------------------------

create table if not exists public.agent_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.agent_conversations (id) on delete cascade,
  role            text not null
    constraint agent_messages_role_check check (role in ('user', 'assistant', 'staff', 'system')),
  content         text not null,
  model_id        text,
  tokens_in       integer not null default 0 constraint agent_messages_tokens_in_nonneg check (tokens_in >= 0),
  tokens_out      integer not null default 0 constraint agent_messages_tokens_out_nonneg check (tokens_out >= 0),
  created_at      timestamptz not null default now()
);
comment on table public.agent_messages is 'The transcript. Persisted BEFORE any reply is generated (§5 realtime rule).';
create index if not exists agent_messages_conversation_idx on public.agent_messages (conversation_id, created_at);

-- ---- tool calls (the audit trail) -------------------------------------------

create table if not exists public.agent_tool_calls (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.agent_conversations (id) on delete cascade,
  message_id      uuid references public.agent_messages (id) on delete set null,
  tool            text not null
    constraint agent_tool_calls_tool_shape check (tool ~ '^[a-z][a-z0-9_]{2,48}$'),
  input           jsonb not null default '{}'::jsonb,
  result          jsonb not null default '{}'::jsonb,
  rpc_name        text,
  status          text not null
    constraint agent_tool_calls_status_check check (status in ('ok', 'refused', 'error')),
  created_at      timestamptz not null default now()
);
comment on table public.agent_tool_calls is
  'Every tool the assistant called, with input and result. §2 rule 1: any number in a reply must trace to a row here.';
create index if not exists agent_tool_calls_conversation_idx on public.agent_tool_calls (conversation_id, created_at);
create index if not exists agent_tool_calls_message_idx on public.agent_tool_calls (message_id);

-- ---- handoffs --------------------------------------------------------------

create table if not exists public.agent_handoffs (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.agent_conversations (id) on delete cascade,
  reason          text not null
    constraint agent_handoffs_reason_check check (reason in ('customer_asked', 'hard_stop', 'repeated_confusion', 'sentiment', 'staff_joined', 'budget_exhausted')),
  status          text not null default 'requested'
    constraint agent_handoffs_status_check check (status in ('requested', 'claimed', 'active', 'resolved', 'missed')),
  requested_at    timestamptz not null default now(),
  claimed_by      uuid references public.profiles (id) on delete set null,
  claimed_at      timestamptz,
  resolved_at     timestamptz,
  summary         text
);
comment on table public.agent_handoffs is '§5. requested → claimed → active → resolved | missed. The transcript stays on the conversation.';
create index if not exists agent_handoffs_conversation_idx on public.agent_handoffs (conversation_id);
create index if not exists agent_handoffs_open_idx on public.agent_handoffs (status, requested_at) where status in ('requested', 'claimed', 'active');
create index if not exists agent_handoffs_claimed_by_idx on public.agent_handoffs (claimed_by);

-- ---- callback requests -----------------------------------------------------

create table if not exists public.callback_requests (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.agent_conversations (id) on delete cascade,
  account_id       uuid references public.accounts (id) on delete cascade,
  phone_e164       text not null
    constraint callback_requests_phone_shape check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  "window"         text not null default 'any'
    constraint callback_requests_window_check check ("window" in ('am', 'pm', 'any')),
  status           text not null default 'open'
    constraint callback_requests_status_check check (status in ('open', 'done', 'cancelled')),
  created_for_date date not null,
  created_at       timestamptz not null default now()
);
comment on table public.callback_requests is '§5 after-hours. Dated for the next working morning; surfaces as a work item, never its own queue.';
create index if not exists callback_requests_open_idx on public.callback_requests (status, created_for_date);
create index if not exists callback_requests_account_idx on public.callback_requests (account_id);
create index if not exists callback_requests_conversation_idx on public.callback_requests (conversation_id);

-- ---- settings --------------------------------------------------------------

create table if not exists public.agent_settings (
  tenant_id                     uuid primary key references public.tenants (id) default public.current_tenant(),
  tenant_key                    text not null unique,
  model_default                 text not null,
  model_heavy                   text not null,
  budget_tokens_per_conversation integer not null
    constraint agent_settings_budget_pos check (budget_tokens_per_conversation > 0),
  daily_cap_per_account         integer not null
    constraint agent_settings_daily_cap_pos check (daily_cap_per_account > 0),
  support_hours                 jsonb not null default '{}'::jsonb,
  sla_claim_seconds             integer not null default 180
    constraint agent_settings_sla_pos check (sla_claim_seconds > 0),
  tone                          text not null default 'warm, plain Australian English; short sentences; never salesy',
  assistant_name                text not null default 'Paint Group assistant',
  disclosure_text               text not null default 'You''re chatting with Paint Group''s assistant. A person is one tap away.',
  hard_stop_scripts             jsonb not null default '{}'::jsonb,
  feature_flags                 jsonb not null default '{}'::jsonb,
  updated_at                    timestamptz not null default now()
);
comment on table public.agent_settings is
  '§2 rule 9/10: model ids, budgets, hours, tone, disclosure and the scripted hard stops live HERE, keyed by tenant, never in code.';

drop trigger if exists t_agent_settings_updated on public.agent_settings;
create trigger t_agent_settings_updated before update on public.agent_settings
  for each row execute function public.set_updated_at();

-- ---- brain -----------------------------------------------------------------

create table if not exists public.brain_entries (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) default public.current_tenant(),
  topic      text not null,
  question   text not null,
  answer_md  text not null,
  audience   text not null default 'both'
    constraint brain_entries_audience_check check (audience in ('customer', 'staff', 'both')),
  status     text not null default 'draft'
    constraint brain_entries_status_check check (status in ('draft', 'approved')),
  -- Retrieval: Postgres full text today (no embedding provider is wired);
  -- the embedding column is reserved so S6 can add a vector without a
  -- table rewrite.
  search     tsvector generated always as (to_tsvector('english', coalesce(topic, '') || ' ' || coalesce(question, '') || ' ' || coalesce(answer_md, ''))) stored,
  embedding  jsonb,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.brain_entries is 'D14: the Brain. Only status=approved entries are ever served; customers see audience customer|both.';
create index if not exists brain_entries_search_idx on public.brain_entries using gin (search);
create index if not exists brain_entries_status_idx on public.brain_entries (tenant_id, status, audience);
create index if not exists brain_entries_updated_by_idx on public.brain_entries (updated_by);

drop trigger if exists t_brain_entries_updated on public.brain_entries;
create trigger t_brain_entries_updated before update on public.brain_entries
  for each row execute function public.set_updated_at();

-- ---- ownership helper (SECURITY DEFINER so policies can ask without
--      the caller needing to read the evidence) ---------------------------------

create or replace function public.agent_is_my_conversation(p_conversation uuid)
returns boolean
language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.agent_conversations c
     where c.id = p_conversation
       and (
         c.created_by = auth.uid()
         or (c.account_id is not null and public.is_account_member(c.account_id))
       )
  )
$$;
revoke all on function public.agent_is_my_conversation(uuid) from public, anon;
grant execute on function public.agent_is_my_conversation(uuid) to authenticated;

-- ---- RLS --------------------------------------------------------------------

alter table public.agent_conversations enable row level security;
alter table public.agent_messages      enable row level security;
alter table public.agent_tool_calls    enable row level security;
alter table public.agent_handoffs      enable row level security;
alter table public.callback_requests   enable row level security;
alter table public.agent_settings      enable row level security;
alter table public.brain_entries       enable row level security;

-- Conversations: customers their own, staff all. No client write path.
drop policy if exists agent_conversations_select on public.agent_conversations;
create policy agent_conversations_select on public.agent_conversations
  for select to authenticated
  using (public.is_staff() or created_by = auth.uid()
         or (account_id is not null and public.is_account_member(account_id)));

drop policy if exists agent_messages_select on public.agent_messages;
create policy agent_messages_select on public.agent_messages
  for select to authenticated
  using (public.is_staff() or public.agent_is_my_conversation(conversation_id));

-- Tool calls carry charge-out and review flags: staff only.
drop policy if exists agent_tool_calls_select on public.agent_tool_calls;
create policy agent_tool_calls_select on public.agent_tool_calls
  for select to authenticated
  using (public.is_staff());

drop policy if exists agent_handoffs_select on public.agent_handoffs;
create policy agent_handoffs_select on public.agent_handoffs
  for select to authenticated
  using (public.is_staff() or public.agent_is_my_conversation(conversation_id));

drop policy if exists callback_requests_select on public.callback_requests;
create policy callback_requests_select on public.callback_requests
  for select to authenticated
  using (public.is_staff() or public.agent_is_my_conversation(conversation_id));

-- Settings: staff read and edit with their own session. The gateway reads
-- through the service role; customers never see this row (the disclosure
-- line reaches them inside the reply).
drop policy if exists agent_settings_staff_select on public.agent_settings;
create policy agent_settings_staff_select on public.agent_settings
  for select to authenticated using (public.is_staff());
drop policy if exists agent_settings_staff_update on public.agent_settings;
create policy agent_settings_staff_update on public.agent_settings
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- Brain: approved entries for the right audience; staff everything.
drop policy if exists brain_entries_select on public.brain_entries;
create policy brain_entries_select on public.brain_entries
  for select to authenticated
  using (public.is_staff() or (status = 'approved' and audience in ('customer', 'both')));
drop policy if exists brain_entries_staff_write on public.brain_entries;
create policy brain_entries_staff_write on public.brain_entries
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

revoke all on public.agent_conversations, public.agent_messages, public.agent_tool_calls,
              public.agent_handoffs, public.callback_requests, public.agent_settings, public.brain_entries
  from anon;
grant select on public.agent_conversations, public.agent_messages, public.agent_tool_calls,
                public.agent_handoffs, public.callback_requests, public.agent_settings to authenticated;
grant update on public.agent_settings to authenticated;
grant select, insert, update, delete on public.brain_entries to authenticated;

-- ---- seed: the one settings row (defaults from agent-rulings.md) ------------
-- Model ids verified against the Anthropic model list 2 Sep 2026. Hard-stop
-- scripts are the v1 wording for Tom to review (§8) — edit the row, not code.
insert into public.agent_settings
  (tenant_key, model_default, model_heavy, budget_tokens_per_conversation, daily_cap_per_account,
   support_hours, sla_claim_seconds, hard_stop_scripts, feature_flags)
values (
  'paint-group', 'claude-haiku-4-5', 'claude-sonnet-5', 60000, 400000,
  '{"timezone":"Australia/Melbourne","days":{"mon":["08:00","17:00"],"tue":["08:00","17:00"],"wed":["08:00","17:00"],"thu":["08:00","17:00"],"fri":["08:00","17:00"]},"strongCoverageDays":["mon","tue","thu"]}'::jsonb,
  180,
  '{
    "lead_paint": "Because the paint is peeling on a home built before the 1970s, it may contain lead. That needs a look in person before we can price it safely, so this one goes to a site visit — you can keep building your estimate and we will confirm the rest on the day.",
    "asbestos": "Anything that might involve asbestos needs an inspection before we quote or touch it. We will arrange a site visit rather than price it here.",
    "heritage": "A heritage overlay can change what paints and methods are allowed. We will confirm the details on a site visit rather than guess here.",
    "injury": "I am sorry to hear that. This needs a person, not an assistant — I am flagging it for the office now, and you can call us straight away.",
    "complaint": "I am sorry — that is not the experience we want you to have. I have flagged this for a person at Paint Group to pick up with you directly.",
    "refund": "Refunds and account questions are handled by a person, not by me. I have passed this to the office.",
    "legal": "I am not able to discuss that here. I have flagged it for the office to respond to you directly.",
    "discount": "I cannot change prices or offer discounts — the estimate is priced from our rate card. A person can talk through options with you if you would like.",
    "margin": "I cannot share how our pricing is built internally. I can explain what is included in your estimate and why.",
    "out_of_area": "That address is outside the area we currently cover. I am sorry we cannot help with this one — I have noted your details in case that changes."
  }'::jsonb,
  '{"widget":false,"meta":false,"cowork":true,"guided":true,"support":true}'::jsonb
)
on conflict (tenant_key) do nothing;

-- ---- read-backs ------------------------------------------------------------

do $$
declare t text; v_n int;
begin
  foreach t in array array['agent_conversations','agent_messages','agent_tool_calls','agent_handoffs','callback_requests','agent_settings','brain_entries'] loop
    if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t) then
      raise exception 'read-back: % missing', t;
    end if;
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname = t and c.relrowsecurity) then
      raise exception 'read-back: RLS not enabled on %', t;
    end if;
  end loop;
  if not exists (select 1 from pg_proc where proname = 'agent_is_my_conversation') then
    raise exception 'read-back: agent_is_my_conversation missing';
  end if;
  select count(*) into v_n from pg_policies where schemaname = 'public'
    and tablename in ('agent_conversations','agent_messages','agent_tool_calls','agent_handoffs','callback_requests','agent_settings','brain_entries');
  if v_n < 9 then
    raise exception 'read-back: expected at least 9 agent policies, found %', v_n;
  end if;
  if not exists (select 1 from public.agent_settings where tenant_key = 'paint-group') then
    raise exception 'read-back: agent_settings seed row missing';
  end if;
end $$;

-- What this migration made — READ this output, do not assume it.
select tablename, policyname, cmd
  from pg_policies
 where schemaname = 'public'
   and tablename in ('agent_conversations','agent_messages','agent_tool_calls','agent_handoffs','callback_requests','agent_settings','brain_entries')
 order by tablename, policyname;
